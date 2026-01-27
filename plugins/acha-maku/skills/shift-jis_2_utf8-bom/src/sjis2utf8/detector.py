"""Encoding detection module.

要件定義書の「決定的フロー」に基づくエンコーディング検出:
1. BOMチェック（UTF-8 BOM, UTF-16 LE/BE）
2. バイナリ判定（NULバイト含む）
3. UTF-8厳密デコード試行
4. CP932デコード試行
5. 不明
"""

from pathlib import Path

from .models import Encoding

# BOM定数
UTF8_BOM = b"\xef\xbb\xbf"
UTF16_LE_BOM = b"\xff\xfe"
UTF16_BE_BOM = b"\xfe\xff"


def detect_encoding_from_bytes(data: bytes) -> Encoding:
    """バイト列からエンコーディングを検出する.

    Args:
        data: ファイルのバイト列

    Returns:
        検出されたエンコーディング
    """
    # 1. BOMチェック（最優先）
    if data.startswith(UTF8_BOM):
        return Encoding.UTF8_BOM
    if data.startswith(UTF16_LE_BOM):
        return Encoding.UTF16_LE
    if data.startswith(UTF16_BE_BOM):
        return Encoding.UTF16_BE

    # 空ファイルはUTF-8として扱う
    if len(data) == 0:
        return Encoding.UTF8_NO_BOM

    # 2. バイナリ判定（NULバイトを含む場合）
    if b"\x00" in data:
        return Encoding.BINARY

    # 3. UTF-8厳密デコード試行
    try:
        data.decode("utf-8", errors="strict")
        return Encoding.UTF8_NO_BOM
    except UnicodeDecodeError:
        pass

    # 4. CP932デコード試行
    try:
        data.decode("cp932", errors="strict")
        return Encoding.CP932
    except UnicodeDecodeError:
        pass

    # 5. 不明
    return Encoding.UNKNOWN


def detect_encoding(file_path: Path) -> Encoding:
    """ファイルのエンコーディングを検出する.

    Args:
        file_path: 検出対象のファイルパス

    Returns:
        検出されたエンコーディング

    Raises:
        FileNotFoundError: ファイルが存在しない場合
        PermissionError: 読み取り権限がない場合
    """
    data = file_path.read_bytes()
    return detect_encoding_from_bytes(data)


def should_convert(
    encoding: Encoding,
    include_utf8_no_bom: bool = False,
) -> bool:
    """変換対象かどうかを判定する.

    Args:
        encoding: 検出されたエンコーディング
        include_utf8_no_bom: UTF-8 BOMなしも変換対象に含めるか

    Returns:
        変換対象ならTrue
    """
    if encoding == Encoding.CP932:
        return True
    if include_utf8_no_bom and encoding == Encoding.UTF8_NO_BOM:
        return True
    return False


def is_warning_encoding(encoding: Encoding) -> bool:
    """警告を出すべきエンコーディングかどうか.

    Args:
        encoding: 検出されたエンコーディング

    Returns:
        警告対象ならTrue
    """
    return encoding in (
        Encoding.UTF16_LE,
        Encoding.UTF16_BE,
        Encoding.BINARY,
        Encoding.UNKNOWN,
    )
