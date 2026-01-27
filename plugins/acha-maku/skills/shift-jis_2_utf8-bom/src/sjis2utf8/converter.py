"""Converter module.

ファイルの変換処理（原子的書き込み）を行う。
"""

import os
import tempfile
from pathlib import Path
from typing import Optional

from .backup import create_backup, get_backup_path
from .detector import detect_encoding, should_convert, is_warning_encoding, UTF8_BOM
from .models import (
    ConversionConfig,
    ConversionSummary,
    ConvertedFileInfo,
    Encoding,
    FileResult,
    FileStatus,
)


def read_file_content(file_path: Path, encoding: Encoding) -> tuple[str, bytes]:
    """ファイルの内容を読み込む.

    Args:
        file_path: ファイルパス
        encoding: 検出されたエンコーディング

    Returns:
        (デコードされた文字列, 元のバイト列)

    Raises:
        UnicodeDecodeError: デコードに失敗した場合
    """
    data = file_path.read_bytes()

    # BOM付きの場合はBOMを除去してデコード
    if encoding == Encoding.UTF8_BOM:
        text = data[3:].decode("utf-8")
    elif encoding == Encoding.CP932:
        text = data.decode("cp932")
    elif encoding == Encoding.UTF8_NO_BOM:
        text = data.decode("utf-8")
    else:
        raise ValueError(f"Cannot read content with encoding: {encoding}")

    return text, data


def convert_to_utf8_bom(text: str, original_data: bytes) -> bytes:
    """UTF-8 BOM付きに変換する.

    改行コードは元ファイルのものを保持する。

    Args:
        text: 変換する文字列
        original_data: 元のバイト列（改行コード判定用）

    Returns:
        UTF-8 BOM付きのバイト列
    """
    # 改行コードの検出と保持
    # Pythonのdecodeは\r\nを\nに変換しないので、
    # エンコード時にも特別な処理は不要
    encoded = text.encode("utf-8")
    return UTF8_BOM + encoded


def atomic_write(file_path: Path, content: bytes) -> None:
    """原子的にファイルを書き込む.

    一時ファイルに書き込んでからリネームすることで、
    途中失敗によるファイル破損を防ぐ。

    Args:
        file_path: 書き込み先のファイルパス
        content: 書き込む内容

    Raises:
        OSError: 書き込みに失敗した場合
    """
    # 同一ディレクトリに一時ファイルを作成（異なるファイルシステム間の問題を回避）
    fd, temp_path = tempfile.mkstemp(
        dir=file_path.parent,
        suffix=".tmp",
    )
    temp_path = Path(temp_path)

    try:
        # os.fdopen でファイルオブジェクトに変換
        # file.write() は全バイト書き込みを保証する
        with os.fdopen(fd, "wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        fd = None  # fdopen の with ブロックが close を担当

        # 原子的リネーム
        temp_path.replace(file_path)
    except Exception:
        # エラー時は一時ファイルを削除
        # fdopen 成功後は with ブロックが close を担当するため fd は None
        if fd is not None:
            os.close(fd)
        if temp_path.exists():
            temp_path.unlink()
        raise


def convert_file(
    file_path: Path,
    config: ConversionConfig,
    run_id: str,
) -> tuple[FileResult, Optional[ConvertedFileInfo]]:
    """ファイルを変換する.

    Args:
        file_path: 変換対象のファイルパス
        config: 変換設定
        run_id: 実行ID

    Returns:
        (処理結果, 変換情報（変換した場合）)
    """
    try:
        # エンコーディング検出
        encoding = detect_encoding(file_path)

        # 警告対象のエンコーディング
        if is_warning_encoding(encoding):
            return (
                FileResult(
                    path=file_path,
                    status=FileStatus.WARNING,
                    source_encoding=encoding,
                    message=f"Skipped: {encoding.value}",
                ),
                None,
            )

        # 変換対象かどうか判定
        if not should_convert(encoding, config.include_utf8_no_bom):
            return (
                FileResult(
                    path=file_path,
                    status=FileStatus.SKIPPED,
                    source_encoding=encoding,
                    message=f"Already {encoding.value}",
                ),
                None,
            )

        # ドライランの場合は変換せずに終了
        if not config.execute:
            return (
                FileResult(
                    path=file_path,
                    status=FileStatus.CONVERTED,  # 変換「予定」
                    source_encoding=encoding,
                    message="Would convert (dry run)",
                ),
                None,
            )

        # ファイル内容を読み込み
        text, original_data = read_file_content(file_path, encoding)

        # バックアップ作成
        backup_path = create_backup(
            file_path,
            config.target_path.resolve(),
            config.backup_dir.resolve(),
            run_id,
        )

        # UTF-8 BOMに変換
        converted_data = convert_to_utf8_bom(text, original_data)

        # 原子的書き込み
        atomic_write(file_path, converted_data)

        # 変換情報を作成
        relative_path = file_path.relative_to(config.target_path.resolve())
        converted_info = ConvertedFileInfo(
            relative_path=str(relative_path).replace("\\", "/"),
            source_encoding=encoding.value,
            backup_path=str(backup_path.relative_to(config.backup_dir.resolve())).replace("\\", "/"),
        )

        return (
            FileResult(
                path=file_path,
                status=FileStatus.CONVERTED,
                source_encoding=encoding,
                message="Converted successfully",
            ),
            converted_info,
        )

    except PermissionError:
        return (
            FileResult(
                path=file_path,
                status=FileStatus.ERROR,
                message="Permission denied",
            ),
            None,
        )
    except FileNotFoundError:
        return (
            FileResult(
                path=file_path,
                status=FileStatus.ERROR,
                message="File not found",
            ),
            None,
        )
    except Exception as e:
        return (
            FileResult(
                path=file_path,
                status=FileStatus.ERROR,
                message=str(e),
            ),
            None,
        )


def update_summary(summary: ConversionSummary, result: FileResult) -> None:
    """サマリーを更新する.

    Args:
        summary: 更新対象のサマリー
        result: ファイル処理結果
    """
    summary.total_files += 1

    if result.status == FileStatus.CONVERTED:
        summary.converted += 1
    elif result.status == FileStatus.SKIPPED:
        summary.skipped += 1
    elif result.status == FileStatus.WARNING:
        summary.warnings += 1
    elif result.status == FileStatus.ERROR:
        summary.errors += 1

    # エンコーディング別カウント
    if result.source_encoding:
        if result.source_encoding == Encoding.CP932:
            summary.cp932_count += 1
        elif result.source_encoding == Encoding.UTF8_BOM:
            summary.utf8_bom_count += 1
        elif result.source_encoding == Encoding.UTF8_NO_BOM:
            summary.utf8_no_bom_count += 1
        elif result.source_encoding in (Encoding.UTF16_LE, Encoding.UTF16_BE):
            summary.utf16_count += 1
        elif result.source_encoding == Encoding.BINARY:
            summary.binary_count += 1
        elif result.source_encoding == Encoding.UNKNOWN:
            summary.unknown_count += 1
