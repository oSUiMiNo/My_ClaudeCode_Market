---
name: shift-jis_2_utf8-bom
description: |
  Shift-JIS（CP932）ファイルをUTF-8 BOM付きに一括変換するツール。
  Unity/Visual Studio/VSCode間のエンコーディング問題を解決する。
  トリガー: "/shift-jis_2_utf8-bom", "文字コード変換", "Shift-JIS変換", "エンコーディング変換"
argument-hint: "<対象ディレクトリ> [--execute] [--restore <run-id>]"
context: current
allowed-tools: Bash, Read
---

# Shift-JIS → UTF-8 BOM 変換スキル

このスキルは、Shift-JIS（CP932）エンコードのファイルをUTF-8 BOM付きに一括変換する。

## 使用シーン

- Unity/Visual Studio/VSCode間で日本語コメントが文字化けする
- Unityバージョン更新前にエンコーディングを統一したい
- 既存プロジェクトのエンコーディングを確認・修正したい

---

# 実行手順

## 0. 環境構築（初回のみ）

スキルを初めて使う場合、または `.venv` が存在しない場合は仮想環境を構築する：

```bash
uv sync --project .claude/skills/shift-jis_2_utf8-bom
```

**注**: `uv run` は自動で環境構築するため、このステップは通常スキップ可能。
明示的に環境を準備したい場合や、エラーが発生した場合に実行する。

---

## 1. 引数の確認

ユーザーの入力から以下を判断：

| 引数 | 意味 |
|------|------|
| `<ディレクトリ>` | 変換対象のディレクトリパス |
| `--execute` | 実際に変換を実行（なければドライラン） |
| `--restore <run-id>` | バックアップから復元 |
| `--list` | バックアップ一覧を表示 |

**引数がない場合**: ユーザーに対象ディレクトリを確認する。

---

## 2. コマンド実行

**注**: `--project` オプションでスキル内の仮想環境を使用する。

### ドライラン（確認のみ）

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 <対象ディレクトリ> --verbose
```

### 実際に変換

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 <対象ディレクトリ> --execute --verbose
```

### バックアップから復元

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 --restore <run-id>
```

### バックアップ一覧

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 --list-backups
```

---

## 3. 結果の報告

実行後、以下の様式で報告する：
**方向様式**

┌───────────────────┬────────────┐
│     検出結果      │ ファイル数 │ ├───────────────────┼────────────┤                                                                           
│ Shift-JIS (CP932) │            │
├───────────────────┼────────────┤
│ UTF-8 (BOMなし)   │            │
├───────────────────┼────────────┤
│ UTF-8 (BOM付き)   │            │
├───────────────────┼────────────┤
│ 合計              │            │
└───────────────────┴────────────┘
┌──────────┬─────────────┐
│ 処理結果 │  ファイル数  │                                                                             
├──────────┼─────────────┤
│ 変換成功 │             │
├──────────┼─────────────┤
│ スキップ │             │
├──────────┼─────────────┤
│ 合計     │             │
└──────────┴─────────────┘

　<!-- ツール出力から run-id を取得し、以下の形式で完全な復元コマンドを報告する -->
　**もし問題があれば以下のコマンドで復元できます：**
  
　uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 --restore <run-id>

---

# オプション一覧

| オプション | 説明 |
|------------|------|
| `--execute` | 実際に変換を実行（デフォルトはドライラン） |
| `--ext .cs .txt` | 対象拡張子を指定（デフォルト: .cs） |
| `--include-utf8-no-bom` | UTF-8 BOMなしも変換対象に含める |
| `--exclude <パターン>` | 除外パターンを追加 |
| `--backup-dir <パス>` | バックアップディレクトリを指定 |
| `--restore <run-id>` | 指定したrun-idのバックアップから復元 |
| `--list-backups` | バックアップ一覧を表示 |
| `--verbose` | 詳細ログを出力 |
| `--quiet` | 進捗表示を抑制 |

---

# デフォルト除外ディレクトリ

以下のディレクトリは自動的に除外される（Unity/VS関連）：

- `Library/`
- `Temp/`
- `obj/`
- `bin/`
- `.git/`
- `.vs/`

---

# 安全機能

1. **ドライランがデフォルト**: `--execute`を付けない限り変換しない
2. **バックアップ必須**: 変換前に元ファイルをバックアップ
3. **原子的書き込み**: 途中失敗でもファイル破損しない
4. **復元可能**: `--restore`でいつでも元に戻せる

---

# 実行例

## 基本的な使い方

```bash
# 1. まずドライランで確認
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 ./UnityProject --verbose

# 2. 問題なければ実行
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 ./UnityProject --execute --verbose

# 3. 問題があれば復元
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 --restore 20260127_120000_abc12345
```

## 拡張子を追加

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 ./Project --execute --ext .cs .shader .txt
```

## 特定フォルダを除外

```bash
uv run --project .claude/skills/shift-jis_2_utf8-bom python -m sjis2utf8 ./Project --execute --exclude "Plugins/" "ThirdParty/"
```
