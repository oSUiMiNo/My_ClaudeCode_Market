"""File scanning module.

ディレクトリの再帰的走査、拡張子フィルタ、除外パターン適用を行う。
"""

import os
from fnmatch import fnmatch
from pathlib import Path
from typing import Iterator

from .models import ConversionConfig, DEFAULT_EXCLUDE_PATTERNS


def should_exclude_dir(dir_name: str, patterns: list[str]) -> bool:
    """ディレクトリを除外すべきかチェック.

    Args:
        dir_name: ディレクトリ名
        patterns: 除外パターンのリスト

    Returns:
        除外すべきならTrue
    """
    for pattern in patterns:
        if pattern.endswith("/"):
            dir_pattern = pattern.rstrip("/")
            if fnmatch(dir_name, dir_pattern):
                return True
    return False


def matches_file_exclude_pattern(
    file_path: Path, base_path: Path, patterns: list[str]
) -> bool:
    """ファイルが除外パターンに一致するかチェック.

    Args:
        file_path: チェック対象のファイルパス
        base_path: 基準ディレクトリ
        patterns: 除外パターンのリスト

    Returns:
        除外パターンに一致すればTrue
    """
    try:
        relative = file_path.relative_to(base_path)
    except ValueError:
        return False

    relative_str = str(relative).replace("\\", "/")

    for pattern in patterns:
        # ディレクトリパターンはスキップ（os.walkで処理済み）
        if pattern.endswith("/"):
            continue
        # ファイルパターン
        if fnmatch(relative.name, pattern):
            return True
        if fnmatch(relative_str, pattern):
            return True

    return False


# 後方互換性のためのエイリアス
def matches_exclude_pattern(path: Path, base_path: Path, patterns: list[str]) -> bool:
    """除外パターンに一致するかチェック（後方互換性用）."""
    # ディレクトリの場合
    if path.is_dir():
        return should_exclude_dir(path.name, patterns)

    # ファイルの場合：ディレクトリパターンもチェック
    try:
        relative = path.relative_to(base_path)
    except ValueError:
        return False

    # パスの各部分がディレクトリ除外パターンに一致するか
    for part in relative.parts[:-1]:
        if should_exclude_dir(part, patterns):
            return True

    # ファイルパターンをチェック
    return matches_file_exclude_pattern(path, base_path, patterns)


def scan_files(config: ConversionConfig) -> Iterator[Path]:
    """指定ディレクトリを再帰的にスキャンする.

    os.walkを使用して除外ディレクトリを効率的にスキップする。
    Library/などの大量ファイルがあるディレクトリに入らないため高速。

    Args:
        config: 変換設定

    Yields:
        対象ファイルのパス
    """
    target_path = config.target_path.resolve()

    # 除外パターン（デフォルト + ユーザー指定）
    exclude_patterns = DEFAULT_EXCLUDE_PATTERNS + config.exclude_patterns

    # 拡張子を正規化（小文字、ドット付き）
    extensions = {
        ext.lower() if ext.startswith(".") else f".{ext.lower()}"
        for ext in config.extensions
    }

    # os.walkで効率的に走査（除外ディレクトリに入らない）
    for root, dirs, files in os.walk(target_path):
        root_path = Path(root)

        # 除外ディレクトリを走査対象から除去（dirs[:]で元リストを変更）
        dirs[:] = [d for d in dirs if not should_exclude_dir(d, exclude_patterns)]

        for file_name in files:
            file_path = root_path / file_name

            # 拡張子チェック
            if file_path.suffix.lower() not in extensions:
                continue

            # ファイル除外パターンチェック
            if matches_file_exclude_pattern(file_path, target_path, exclude_patterns):
                continue

            yield file_path


def count_files(config: ConversionConfig) -> int:
    """対象ファイル数をカウントする.

    Args:
        config: 変換設定

    Returns:
        対象ファイル数
    """
    return sum(1 for _ in scan_files(config))
