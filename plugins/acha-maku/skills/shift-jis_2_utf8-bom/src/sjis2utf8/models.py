"""Data models for the converter."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional


class Encoding(Enum):
    """検出されたエンコーディングの種類."""

    UTF8_BOM = "utf-8-bom"
    UTF8_NO_BOM = "utf-8"
    CP932 = "cp932"
    UTF16_LE = "utf-16-le"
    UTF16_BE = "utf-16-be"
    BINARY = "binary"
    UNKNOWN = "unknown"


class FileStatus(Enum):
    """ファイル処理結果のステータス."""

    CONVERTED = "converted"  # 変換成功
    SKIPPED = "skipped"  # スキップ（既にUTF-8等）
    ERROR = "error"  # エラー発生
    WARNING = "warning"  # 警告（UTF-16等、スキップ）


@dataclass
class FileResult:
    """個別ファイルの処理結果."""

    path: Path
    status: FileStatus
    source_encoding: Optional[Encoding] = None
    message: Optional[str] = None


@dataclass
class ConversionConfig:
    """変換設定."""

    target_path: Path
    extensions: list[str] = field(default_factory=lambda: [".cs"])
    exclude_patterns: list[str] = field(default_factory=list)
    include_utf8_no_bom: bool = False
    assume_cp932: bool = False
    strict: bool = False
    execute: bool = False
    backup_dir: Path = field(default_factory=lambda: Path("./backup"))
    log_file: Optional[Path] = None
    log_format: str = "text"
    quiet: bool = False
    verbose: bool = False


# デフォルト除外パターン（Unity/VS関連）
DEFAULT_EXCLUDE_PATTERNS: list[str] = [
    "Library/",
    "Temp/",
    "obj/",
    "bin/",
    ".git/",
    ".vs/",
]


@dataclass
class ConvertedFileInfo:
    """変換されたファイルの情報（manifest用）."""

    relative_path: str
    source_encoding: str
    backup_path: str


@dataclass
class RunManifest:
    """バックアップのマニフェスト情報."""

    run_id: str
    timestamp: str  # ISO format
    target_path: str
    converted_files: list[ConvertedFileInfo]
    config: dict

    def to_dict(self) -> dict:
        """辞書形式に変換."""
        return {
            "run_id": self.run_id,
            "timestamp": self.timestamp,
            "target_path": self.target_path,
            "converted_files": [
                {
                    "relative_path": f.relative_path,
                    "source_encoding": f.source_encoding,
                    "backup_path": f.backup_path,
                }
                for f in self.converted_files
            ],
            "config": self.config,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RunManifest":
        """辞書から復元."""
        return cls(
            run_id=data["run_id"],
            timestamp=data["timestamp"],
            target_path=data["target_path"],
            converted_files=[
                ConvertedFileInfo(
                    relative_path=f["relative_path"],
                    source_encoding=f["source_encoding"],
                    backup_path=f["backup_path"],
                )
                for f in data["converted_files"]
            ],
            config=data["config"],
        )


@dataclass
class ConversionSummary:
    """変換結果のサマリー."""

    total_files: int = 0
    converted: int = 0
    skipped: int = 0
    warnings: int = 0
    errors: int = 0

    # エンコーディング別カウント
    cp932_count: int = 0
    utf8_bom_count: int = 0
    utf8_no_bom_count: int = 0
    utf16_count: int = 0
    binary_count: int = 0
    unknown_count: int = 0
