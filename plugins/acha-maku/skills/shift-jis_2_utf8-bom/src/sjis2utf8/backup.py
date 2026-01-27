"""Backup and restore module.

バックアップの作成・復元、run-id生成、manifest.json管理を行う。
"""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from .models import ConvertedFileInfo, RunManifest


def generate_run_id() -> str:
    """run-idを生成する.

    形式: YYYYMMDD_HHMMSS_短縮UUID

    Returns:
        生成されたrun-id
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    short_uuid = uuid.uuid4().hex[:8]
    return f"{timestamp}_{short_uuid}"


def get_backup_path(
    file_path: Path,
    target_root: Path,
    backup_dir: Path,
    run_id: str,
) -> Path:
    """バックアップ先のパスを計算する.

    元のディレクトリ構造を維持してバックアップする。

    Args:
        file_path: バックアップ対象のファイルパス
        target_root: 変換対象のルートディレクトリ
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        バックアップ先のパス
    """
    relative_path = file_path.relative_to(target_root)
    return backup_dir / run_id / relative_path


def create_backup(
    file_path: Path,
    target_root: Path,
    backup_dir: Path,
    run_id: str,
) -> Path:
    """ファイルをバックアップする.

    Args:
        file_path: バックアップ対象のファイルパス
        target_root: 変換対象のルートディレクトリ
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        バックアップ先のパス

    Raises:
        OSError: バックアップに失敗した場合
    """
    backup_path = get_backup_path(file_path, target_root, backup_dir, run_id)

    # ディレクトリ作成
    backup_path.parent.mkdir(parents=True, exist_ok=True)

    # ファイルコピー
    shutil.copy2(file_path, backup_path)

    return backup_path


def get_manifest_path(backup_dir: Path, run_id: str) -> Path:
    """manifest.jsonのパスを取得する.

    Args:
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        manifest.jsonのパス
    """
    return backup_dir / run_id / "manifest.json"


def save_manifest(manifest: RunManifest, backup_dir: Path) -> Path:
    """マニフェストを保存する.

    Args:
        manifest: マニフェスト情報
        backup_dir: バックアップディレクトリ

    Returns:
        保存先のパス
    """
    manifest_path = get_manifest_path(backup_dir, manifest.run_id)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest.to_dict(), f, ensure_ascii=False, indent=2)

    return manifest_path


def load_manifest(backup_dir: Path, run_id: str) -> Optional[RunManifest]:
    """マニフェストを読み込む.

    Args:
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        マニフェスト情報、存在しない場合はNone
    """
    manifest_path = get_manifest_path(backup_dir, run_id)

    if not manifest_path.exists():
        return None

    with manifest_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    return RunManifest.from_dict(data)


def list_backups(backup_dir: Path) -> list[str]:
    """バックアップ一覧を取得する.

    Args:
        backup_dir: バックアップディレクトリ

    Returns:
        run-idのリスト（新しい順）
    """
    if not backup_dir.exists():
        return []

    run_ids = []
    for path in backup_dir.iterdir():
        if path.is_dir() and (path / "manifest.json").exists():
            run_ids.append(path.name)

    # 新しい順（run-idはタイムスタンプで始まるのでソートで日時順になる）
    return sorted(run_ids, reverse=True)


def _validate_path_within(path: Path, root: Path, description: str) -> Path:
    """パスがルートディレクトリ内に収まることを検証する.

    パストラバーサル攻撃（../を使った任意パスへのアクセス）を防ぐ。

    Args:
        path: 検証対象のパス
        root: ルートディレクトリ
        description: エラーメッセージ用の説明

    Returns:
        解決済みのパス

    Raises:
        ValueError: パスがルート外を指している場合
    """
    resolved = path.resolve()
    root_resolved = root.resolve()

    try:
        resolved.relative_to(root_resolved)
    except ValueError:
        raise ValueError(
            f"Path traversal detected in {description}: {path} "
            f"is outside {root_resolved}"
        )

    return resolved


def restore_backup(backup_dir: Path, run_id: str) -> list[Path]:
    """バックアップから復元する.

    Args:
        backup_dir: バックアップディレクトリ
        run_id: 実行ID

    Returns:
        復元されたファイルのリスト

    Raises:
        ValueError: 指定されたrun-idが存在しない場合、またはパストラバーサルが検出された場合
        OSError: 復元に失敗した場合
    """
    manifest = load_manifest(backup_dir, run_id)

    if manifest is None:
        raise ValueError(f"Backup not found: {run_id}")

    target_root = Path(manifest.target_path)
    backup_root = backup_dir / run_id
    restored_files = []

    for file_info in manifest.converted_files:
        # パストラバーサル検証
        backup_path = _validate_path_within(
            backup_root / file_info.relative_path,
            backup_root,
            "backup path"
        )
        target_path = _validate_path_within(
            target_root / file_info.relative_path,
            target_root,
            "target path"
        )

        if not backup_path.exists():
            raise OSError(f"Backup file not found: {backup_path}")

        # 復元（上書き）
        shutil.copy2(backup_path, target_path)
        restored_files.append(target_path)

    return restored_files
