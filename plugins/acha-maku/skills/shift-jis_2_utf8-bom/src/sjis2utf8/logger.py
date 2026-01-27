"""Logging module.

text/json形式のログ出力、進捗表示を行う。
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, TextIO

from .models import ConversionSummary, FileResult, FileStatus


class ConversionLogger:
    """変換ログを管理するクラス."""

    def __init__(
        self,
        log_file: Optional[Path] = None,
        log_format: str = "text",
        quiet: bool = False,
        verbose: bool = False,
    ):
        """初期化.

        Args:
            log_file: ログファイルパス（Noneの場合はファイル出力なし）
            log_format: ログ形式（"text" または "json"）
            quiet: 進捗表示を抑制
            verbose: 詳細ログを出力
        """
        self.log_file = log_file
        self.log_format = log_format
        self.quiet = quiet
        self.verbose = verbose
        self._file_handle: Optional[TextIO] = None
        self._results: list[dict] = []

    def __enter__(self):
        """コンテキストマネージャの開始."""
        if self.log_file:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            self._file_handle = self.log_file.open("w", encoding="utf-8")
            if self.log_format == "json":
                # JSON配列の開始
                self._file_handle.write("[\n")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """コンテキストマネージャの終了."""
        if self._file_handle:
            if self.log_format == "json":
                # JSON配列の終了
                self._file_handle.write("\n]")
            self._file_handle.close()
            self._file_handle = None

    def log_result(self, result: FileResult, target_root: Path) -> None:
        """個別ファイルの結果をログ.

        Args:
            result: ファイル処理結果
            target_root: 変換対象のルートディレクトリ
        """
        try:
            relative_path = result.path.relative_to(target_root)
        except ValueError:
            relative_path = result.path

        # コンソール出力
        if not self.quiet:
            self._print_result(result, relative_path)

        # ファイル出力
        if self._file_handle:
            self._write_result(result, relative_path)

    def _print_result(self, result: FileResult, relative_path: Path) -> None:
        """コンソールに結果を表示.

        Args:
            result: ファイル処理結果
            relative_path: 相対パス
        """
        status_symbols = {
            FileStatus.CONVERTED: "[OK]",
            FileStatus.SKIPPED: "[--]",
            FileStatus.WARNING: "[!!]",
            FileStatus.ERROR: "[ER]",
        }

        symbol = status_symbols.get(result.status, "[??]")
        encoding = result.source_encoding.value if result.source_encoding else "unknown"

        if self.verbose or result.status in (FileStatus.WARNING, FileStatus.ERROR):
            # 詳細表示
            message = result.message or ""
            print(f"{symbol} {relative_path} ({encoding}) {message}")
        elif result.status == FileStatus.CONVERTED:
            # 変換されたファイルは常に表示
            print(f"{symbol} {relative_path} ({encoding})")

    def _write_result(self, result: FileResult, relative_path: Path) -> None:
        """ファイルに結果を書き込む.

        Args:
            result: ファイル処理結果
            relative_path: 相対パス
        """
        if self.log_format == "json":
            entry = {
                "path": str(relative_path).replace("\\", "/"),
                "status": result.status.value,
                "encoding": result.source_encoding.value if result.source_encoding else None,
                "message": result.message,
            }
            # 最初の要素以外はカンマを付ける
            if self._results:
                self._file_handle.write(",\n")
            self._file_handle.write("  " + json.dumps(entry, ensure_ascii=False))
            self._results.append(entry)
        else:
            # text形式
            status = result.status.value.upper()
            encoding = result.source_encoding.value if result.source_encoding else "unknown"
            message = result.message or ""
            self._file_handle.write(f"{status}\t{relative_path}\t{encoding}\t{message}\n")

    def log_summary(self, summary: ConversionSummary, dry_run: bool = False) -> None:
        """サマリーを出力.

        Args:
            summary: 変換結果のサマリー
            dry_run: ドライランかどうか
        """
        if self.quiet:
            return

        print()
        print("=" * 50)
        if dry_run:
            print("=== ドライラン結果 ===")
        else:
            print("=== 変換結果 ===")
        print("=" * 50)
        print()

        # エンコーディング別カウント
        print("[検出結果]")
        print(f"  Shift-JIS (CP932): {summary.cp932_count:>5} ファイル")
        print(f"  UTF-8 (BOMなし):   {summary.utf8_no_bom_count:>5} ファイル")
        print(f"  UTF-8 (BOMあり):   {summary.utf8_bom_count:>5} ファイル")
        if summary.utf16_count > 0:
            print(f"  UTF-16:            {summary.utf16_count:>5} ファイル")
        if summary.binary_count > 0:
            print(f"  バイナリ:          {summary.binary_count:>5} ファイル")
        if summary.unknown_count > 0:
            print(f"  不明:              {summary.unknown_count:>5} ファイル")
        print()

        # 処理結果
        print("[処理結果]")
        if dry_run:
            print(f"  変換予定:   {summary.converted:>5} ファイル")
        else:
            print(f"  変換成功:   {summary.converted:>5} ファイル")
        print(f"  スキップ:   {summary.skipped:>5} ファイル")
        if summary.warnings > 0:
            print(f"  警告:       {summary.warnings:>5} ファイル")
        if summary.errors > 0:
            print(f"  エラー:     {summary.errors:>5} ファイル")
        print(f"  合計:       {summary.total_files:>5} ファイル")
        print()

        if dry_run and summary.converted > 0:
            print("変換を実行するには --execute オプションを付けてください")
            print()


def print_header(target_path: Path, extensions: list[str], dry_run: bool = True) -> None:
    """ヘッダーを表示.

    Args:
        target_path: 変換対象ディレクトリ
        extensions: 対象拡張子
        dry_run: ドライランかどうか
    """
    print()
    print("=" * 50)
    print("=== Shift-JIS → UTF-8 BOM 変換ツール ===")
    print("=" * 50)
    print()
    print(f"スキャン対象: {target_path}")
    print(f"対象拡張子:   {', '.join(extensions)}")
    if dry_run:
        print("モード:       ドライラン（変換は行いません）")
    else:
        print("モード:       実行")
    print()


def print_restore_result(restored_files: list[Path]) -> None:
    """復元結果を表示.

    Args:
        restored_files: 復元されたファイルのリスト
    """
    print()
    print("=" * 50)
    print("=== 復元完了 ===")
    print("=" * 50)
    print()
    print(f"復元されたファイル: {len(restored_files)} 件")
    for path in restored_files:
        print(f"  - {path}")
    print()
