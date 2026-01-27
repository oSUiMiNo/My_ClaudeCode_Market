"""CLI entry point.

argparseによるコマンドライン引数解析、終了コード管理を行う。
"""

import argparse
import signal
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import __version__
from .backup import (
    generate_run_id,
    list_backups,
    load_manifest,
    restore_backup,
    save_manifest,
)
from .converter import convert_file, update_summary
from .logger import ConversionLogger, print_header, print_restore_result
from .models import ConversionConfig, ConversionSummary, ConvertedFileInfo, RunManifest
from .scanner import scan_files

# 終了コード
EXIT_SUCCESS = 0
EXIT_PARTIAL_ERROR = 1
EXIT_FATAL_ERROR = 2
EXIT_USER_INTERRUPT = 3

# グローバルな中断フラグ
_interrupted = False


def _signal_handler(signum, frame):
    """シグナルハンドラ（Ctrl+C対応）."""
    global _interrupted
    _interrupted = True
    print("\n中断されました。")


def create_parser() -> argparse.ArgumentParser:
    """引数パーサを作成する.

    Returns:
        ArgumentParser
    """
    parser = argparse.ArgumentParser(
        prog="sjis2utf8",
        description="Shift-JIS (CP932) を UTF-8 BOM に一括変換するツール",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  # ドライラン（デフォルト）
  sjis2utf8 ./UnityProject

  # 実際に変換
  sjis2utf8 ./UnityProject --execute

  # UTF-8 BOMなしも変換対象に
  sjis2utf8 ./UnityProject --execute --include-utf8-no-bom

  # バックアップから復元
  sjis2utf8 --restore 20260127_120000_abc12345
""",
    )

    parser.add_argument(
        "target_path",
        type=Path,
        nargs="?",
        help="変換対象のディレクトリパス",
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="実際に変換を実行（指定なしはドライラン）",
    )

    parser.add_argument(
        "--ext",
        nargs="+",
        default=[".cs"],
        metavar="EXT",
        help="対象拡張子（デフォルト: .cs）",
    )

    parser.add_argument(
        "--include-utf8-no-bom",
        action="store_true",
        help="UTF-8 BOMなしも変換対象に含める",
    )

    parser.add_argument(
        "--assume-cp932",
        action="store_true",
        help="日本語を含むファイルはCP932優先で判定",
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help="判定が曖昧な場合はスキップ",
    )

    parser.add_argument(
        "--exclude",
        nargs="+",
        default=[],
        metavar="PATTERN",
        help="除外パターン（複数指定可）",
    )

    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path("./backup"),
        metavar="DIR",
        help="バックアップディレクトリ（デフォルト: ./backup）",
    )

    parser.add_argument(
        "--restore",
        metavar="RUN_ID",
        help="指定したrun-idのバックアップから復元",
    )

    parser.add_argument(
        "--list-backups",
        action="store_true",
        help="バックアップ一覧を表示",
    )

    parser.add_argument(
        "--log-file",
        type=Path,
        metavar="PATH",
        help="ログファイルパス",
    )

    parser.add_argument(
        "--log-format",
        choices=["text", "json"],
        default="text",
        help="ログ形式（デフォルト: text）",
    )

    parser.add_argument(
        "--quiet",
        action="store_true",
        help="進捗表示を抑制",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="詳細ログを出力",
    )

    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    return parser


def run_conversion(config: ConversionConfig) -> int:
    """変換処理を実行する.

    Args:
        config: 変換設定

    Returns:
        終了コード
    """
    global _interrupted

    # ヘッダー表示
    print_header(config.target_path, config.extensions, dry_run=not config.execute)

    # run-id生成
    run_id = generate_run_id()

    # サマリー初期化
    summary = ConversionSummary()

    # 変換情報リスト（manifest用）
    converted_files: list[ConvertedFileInfo] = []

    # ロガー初期化
    with ConversionLogger(
        log_file=config.log_file,
        log_format=config.log_format,
        quiet=config.quiet,
        verbose=config.verbose,
    ) as logger:
        # ファイルスキャン＆変換
        for file_path in scan_files(config):
            if _interrupted:
                return EXIT_USER_INTERRUPT

            result, converted_info = convert_file(file_path, config, run_id)

            # サマリー更新
            update_summary(summary, result)

            # ログ出力
            logger.log_result(result, config.target_path)

            # 変換情報を記録
            if converted_info:
                converted_files.append(converted_info)

        # サマリー表示
        logger.log_summary(summary, dry_run=not config.execute)

    # manifest保存（実行モードで変換があった場合のみ）
    if config.execute and converted_files:
        manifest = RunManifest(
            run_id=run_id,
            timestamp=datetime.now().isoformat(),
            target_path=str(config.target_path.resolve()),
            converted_files=converted_files,
            config={
                "extensions": config.extensions,
                "include_utf8_no_bom": config.include_utf8_no_bom,
                "exclude_patterns": config.exclude_patterns,
            },
        )
        save_manifest(manifest, config.backup_dir)
        if not config.quiet:
            print(f"バックアップID: {run_id}")
            print(f"復元コマンド:   sjis2utf8 --restore {run_id}")
            print()

    # 終了コード判定
    if summary.errors > 0:
        return EXIT_PARTIAL_ERROR
    return EXIT_SUCCESS


def run_restore(backup_dir: Path, run_id: str) -> int:
    """バックアップから復元する.

    Args:
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        終了コード
    """
    try:
        restored_files = restore_backup(backup_dir, run_id)
        print_restore_result(restored_files)
        return EXIT_SUCCESS
    except ValueError as e:
        print(f"エラー: {e}", file=sys.stderr)
        return EXIT_FATAL_ERROR
    except OSError as e:
        print(f"復元エラー: {e}", file=sys.stderr)
        return EXIT_FATAL_ERROR


def run_list_backups(backup_dir: Path) -> int:
    """バックアップ一覧を表示する.

    Args:
        backup_dir: バックアップディレクトリ

    Returns:
        終了コード
    """
    backups = list_backups(backup_dir)

    if not backups:
        print("バックアップはありません。")
        return EXIT_SUCCESS

    print()
    print("=== バックアップ一覧 ===")
    print()

    for run_id in backups:
        manifest = load_manifest(backup_dir, run_id)
        if manifest:
            file_count = len(manifest.converted_files)
            print(f"  {run_id} ({file_count} files)")
        else:
            print(f"  {run_id}")

    print()
    return EXIT_SUCCESS


def main() -> int:
    """CLIエントリーポイント.

    Returns:
        終了コード
    """
    # シグナルハンドラ設定
    signal.signal(signal.SIGINT, _signal_handler)

    parser = create_parser()
    args = parser.parse_args()

    # バックアップ一覧表示
    if args.list_backups:
        return run_list_backups(args.backup_dir)

    # 復元モード
    if args.restore:
        return run_restore(args.backup_dir, args.restore)

    # 変換モード（target_pathが必要）
    if not args.target_path:
        parser.error("target_path is required for conversion")

    if not args.target_path.exists():
        print(f"エラー: ディレクトリが存在しません: {args.target_path}", file=sys.stderr)
        return EXIT_FATAL_ERROR

    if not args.target_path.is_dir():
        print(f"エラー: ディレクトリではありません: {args.target_path}", file=sys.stderr)
        return EXIT_FATAL_ERROR

    # 設定作成
    config = ConversionConfig(
        target_path=args.target_path.resolve(),
        extensions=args.ext,
        exclude_patterns=args.exclude,
        include_utf8_no_bom=args.include_utf8_no_bom,
        assume_cp932=args.assume_cp932,
        strict=args.strict,
        execute=args.execute,
        backup_dir=args.backup_dir.resolve(),
        log_file=args.log_file,
        log_format=args.log_format,
        quiet=args.quiet,
        verbose=args.verbose,
    )

    return run_conversion(config)


if __name__ == "__main__":
    sys.exit(main())
