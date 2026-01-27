# sjis2utf8 - Shift-JIS to UTF-8 BOM Converter

Unity/Visual Studio/VSCode間のエンコーディング問題を解決するための一括変換ツール。

## 背景

Unity開発において、Visual Studio CommunityとVSCodeの間でエンコーディングの不整合が発生する:

- **Visual Studio Community**: 日本語環境ではShift-JIS（ANSI）でC#ファイルを保存することがある
- **VSCode**: デフォルトでUTF-8として開くため、Shift-JISの日本語が文字化け
- **Unity**: UTF-8（BOMなし）でスクリプトを作成するが、Visual Studioが正しく認識できない場合がある

**リスク**: Unityバージョン更新時の自動API置換により、Shift-JISファイルの日本語が**永久に破損**する可能性がある。

## インストール

```bash
# プロジェクトルートで
uv sync
```

## 使い方

### 基本コマンド

```bash
# ドライラン（変換せず確認のみ）
uv run python -m sjis2utf8 <対象ディレクトリ>

# 実際に変換
uv run python -m sjis2utf8 <対象ディレクトリ> --execute

# バックアップから復元
uv run python -m sjis2utf8 --restore <run-id>

# バックアップ一覧
uv run python -m sjis2utf8 --list-backups
```

### オプション

| オプション | 説明 |
|------------|------|
| `--execute` | 実際に変換を実行（デフォルトはドライラン） |
| `--ext .cs .txt` | 対象拡張子を指定（デフォルト: .cs） |
| `--include-utf8-no-bom` | UTF-8 BOMなしも変換対象に含める |
| `--exclude <パターン>` | 除外パターンを追加 |
| `--backup-dir <パス>` | バックアップディレクトリを指定（デフォルト: ./backup） |
| `--restore <run-id>` | 指定したrun-idのバックアップから復元 |
| `--list-backups` | バックアップ一覧を表示 |
| `--log-file <パス>` | ログファイルパス |
| `--log-format text\|json` | ログ形式（デフォルト: text） |
| `--verbose` | 詳細ログを出力 |
| `--quiet` | 進捗表示を抑制 |

### 使用例

```bash
# Unityプロジェクトを確認（ドライラン）
uv run python -m sjis2utf8 ./UnityProject --verbose

# 確認後に変換実行
uv run python -m sjis2utf8 ./UnityProject --execute --verbose

# シェーダーやテキストも対象に
uv run python -m sjis2utf8 ./Project --execute --ext .cs .shader .txt

# 特定フォルダを除外
uv run python -m sjis2utf8 ./Project --execute --exclude "Plugins/" "ThirdParty/"

# 問題があれば復元
uv run python -m sjis2utf8 --restore 20260127_120000_abc12345
```

## 技術仕様

### エンコーディング検出

決定的フローで判定（外部ライブラリ不使用）:

```
1. BOMチェック
   - EF BB BF → UTF-8 BOM → スキップ（変換不要）
   - FF FE → UTF-16 LE → スキップ+警告
   - FE FF → UTF-16 BE → スキップ+警告

2. バイナリ判定（BOMなしの場合）
   - NULバイト（0x00）を含む → バイナリ → スキップ+警告

3. 文字コード判定
   - Step 1: UTF-8として厳密デコードを試行
     - 成功 → UTF-8（BOMなし）として扱う
     - 失敗 → Step 2へ
   - Step 2: CP932としてデコードを試行
     - 成功 → CP932（Shift-JIS） → 変換対象
     - 失敗 → 不明 → スキップ+警告
```

### 対象エンコーディング

| エンコーディング | デフォルト動作 | オプション |
|------------------|----------------|------------|
| CP932（Shift-JIS） | **変換対象** | - |
| UTF-8（BOMなし） | スキップ | `--include-utf8-no-bom` で変換対象に |
| UTF-8 BOM | スキップ | - |
| UTF-16 LE/BE | スキップ+警告 | - |
| バイナリ | スキップ+警告 | - |
| 不明 | スキップ+警告 | - |

### デフォルト除外ディレクトリ

Unity/VS関連で自動的に除外:

- `Library/`
- `Temp/`
- `obj/`
- `bin/`
- `.git/`
- `.vs/`

### バックアップ方式

```
backup/
└── {run-id}/                    # 例: 20260127_143052_abc123
    ├── manifest.json            # 実行情報
    └── Assets/
        └── Scripts/
            └── *.cs             # 元のディレクトリ構造を維持
```

- **run-id形式**: `{YYYYMMDD}_{HHMMSS}_{短縮UUID}`
- **manifest.json**: 実行日時、対象ディレクトリ、変換ファイル一覧、元エンコーディング
- **復元**: `--restore {run-id}` でいつでも元に戻せる
- **自動削除なし**: ユーザーが手動で管理

### 終了コード

| コード | 意味 |
|--------|------|
| 0 | 正常終了 |
| 1 | 一部エラーあり |
| 2 | 致命的エラー |
| 3 | ユーザーによる中断 |

## 安全機能

1. **ドライランがデフォルト**: `--execute`を付けない限り変換しない
2. **バックアップ必須**: 変換前に元ファイルを必ずバックアップ
3. **原子的書き込み**: 一時ファイル→リネームで途中失敗でもファイル破損しない
4. **パストラバーサル防止**: 復元時に不正なパスを検出・拒否
5. **復元可能**: `--restore`でいつでも元に戻せる

## モジュール構成

```
src/sjis2utf8/
├── __init__.py      # バージョン情報
├── __main__.py      # エントリーポイント
├── cli.py           # コマンドライン処理
├── converter.py     # 変換処理（原子的書き込み）
├── detector.py      # エンコーディング検出
├── backup.py        # バックアップ・復元
├── scanner.py       # ファイルスキャン
├── logger.py        # ログ出力
└── models.py        # データクラス
```

## テスト

```bash
# 全テスト実行
uv run pytest tests/ -v

# カバレッジ付き
uv run pytest tests/ --cov=sjis2utf8
```

## ライセンス

MIT License
