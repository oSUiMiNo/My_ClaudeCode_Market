# Codex Skill

Codex CLI（OpenAI）を使用してタスク実行・相談・レビューを行うスキル。

## 設計思想

### なぜMCPではなくSkillか

| 観点 | MCP | Skill |
|------|-----|-------|
| 出力の可視性 | バッチ処理後に結果 | リアルタイムで進捗が見える |
| 中断判断 | 困難 | 出力を見て適切に中断可能 |
| 呼び出し方法 | ツール経由 | スラッシュコマンドで即座 |
| セッション継続 | 別途実装が必要 | 標準でラリー継続可能 |

### context: fork の利点

`context: fork` により、このスキルはサブエージェント（別プロセス）として実行される。

- メインエージェントのコンテキストを汚さない
- Codexとの長いラリーでもメインのトークンを消費しない
- 失敗してもメインに影響しない

### 確定論的処理の分離

**「確定論的に決まる処理はコードに、判断が必要な処理はLLMに」**

| 処理 | 分離先 | 理由 |
|------|--------|------|
| 環境チェック | コード (preflight) | 入出力が確定的 |
| ログ初期化 | コード (init-log) | テンプレートコピー・日時設定 |
| コマンド組み立て | コード (run) | mode + オプションで決定 |
| 議論再開 | コード (continue) | ログパス指定でCodexに読ませる |
| session_id抽出 | コード | 正規表現で確定抽出 |
| 新規/追記の判断 | LLM | 関連トピックかの判断が必要 |
| ラリー継続判断 | LLM | 文脈・曖昧さの判断が必要 |
| ログへの記録 | LLM (Edit/Write) | 文脈に応じた編集 |

## ファイル構成

| ファイル | 説明 |
|----------|------|
| SKILL.md | メイン指示書（サブエージェント用） |
| README.md | 設計思想・参考情報（人間向け） |
| TROUBLESHOOTING.md | トラブルシューティング |
| scripts/codex-helper.mjs | ヘルパースクリプト（preflight, init-log, run, continue, get-session） |
| scripts/pty-session.mjs | PTYセッション管理（Web検索モード用） |
| scripts/check-log-exists.mjs | PreToolUseフック用ログ存在チェック |
| scripts/archive-logs.mjs | 古いログの自動アーカイブ（最終更新から7日経過 or 1000行超過、環境変数で変更可） |
| scripts/package.json | 依存関係定義（node-pty, uuid, strip-ansi） |
| logs/ | 議論ログ保存ディレクトリ |
| logs/_TEMPLATE.md | ログファイルのテンプレート |
| logs/_archive/ | アーカイブ済みログ |

---

## クイックスタート

```powershell
# 1. 初回のみ：依存関係インストール
cd .claude/skills/codex/scripts && npm ci

# 2. 初回のみ：ログイン
npx @openai/codex login

# 3. Claude Codeから呼び出す
#    以下のいずれかの言い方でトリガーされる：
#    - "codexと相談して〇〇"
#    - "codexに聞いて〇〇"
#    - "codexで実行して〇〇"
#    - "/codex 〇〇"
```

## 判断フローチャート

### このスキルを使うべきか？

```
依頼内容を確認
    │
    ├─ 簡単な質問？ ─────────────→ Claudeが直接回答（スキル不要）
    │
    ├─ 一般知識の質問？ ─────────→ Claudeが直接回答（スキル不要）
    │
    ├─ 技術的な相談/レビュー？ ──→ Codexスキルを使用
    │
    ├─ 設計・アーキテクチャ検討？ → Codexスキルを使用
    │
    └─ コード修正/ファイル作成？ ─→ Codexスキルを使用（APIキー必要）
```

### 新規 vs 追記 の判断

```
既存ログを確認（ls logs/*.md）
    │
    ├─ 関連トピックのログがある？
    │       │
    │       ├─ はい ──→ 追記（continueで既存ログに追加）
    │       │
    │       └─ いいえ ─→ 新規（init-logで新規作成）
    │
    └─ ログがない ────→ 新規（init-logで新規作成）
```

※ continueはログパスを指定してCodexに読ませる方式（セッションIDに依存しない）

### ラリーを継続すべきか？

```
Codexの回答を確認
    │
    ├─ 明確な成果が得られた？ ──→ 終了してメインに報告
    │
    ├─ 回答が曖昧/不完全？ ────→ ラリー継続
    │
    ├─ 議論の余地がある？ ─────→ ラリー継続して詰める
    │
    └─ 追加の深掘りが必要？ ───→ ラリー継続
```

## エラー対処早見表

| エラー | 原因 | 対処 |
|--------|------|------|
| `Not inside a trusted directory` | Gitリポジトリ外 | `--skip-git-repo-check` を追加（質問のみ）または Gitリポジトリ内に移動 |
| `401 Unauthorized` | 未ログイン | `npx @openai/codex login` |
| 日本語が文字化け | PowerShell 5.1 | `Get-Content -Encoding UTF8 <path>` を使用、または PowerShell 7 をインストール |
| タイムアウト | 質問が大きすぎる | 質問を分割、または `--timeout` で延長（デフォルト10分） |
| 部分的な結果 | 応答が途中で切れた | `continue` で続きを依頼 |
| 書き込みブロック | ChatGPTサブスク制限 | read-onlyで使用するか、APIキーに切り替え |

## モード選択ガイド

`codex-helper.mjs run --mode <mode>` で指定するモード。内部的にサンドボックスとオプションを設定する。

| やりたいこと | mode | 内部設定 |
|-------------|------|----------|
| 技術的な質問 | `question` | `--sandbox read-only --skip-git-repo-check` |
| コードレビュー・分析 | `review` | `--sandbox read-only --cd <dir>` |
| コード修正・ファイル作成 | `modify` | `--sandbox workspace-write --cd <dir>`（APIキー必要） |

※ `review`/`modify`には`--cd <作業ディレクトリ>`が必要

### Web検索モード（`--search`オプション）

最新情報が必要な場合は `--search` オプションを追加。PTYモードで実行され、Web検索が有効になる。

```powershell
# Web検索有効で質問
codex-helper.mjs run --mode question --search --log <log_path> "2026年の最新ニュースは？"
```

| 観点 | 通常モード | Web検索モード |
|------|-----------|--------------|
| 実行方式 | `codex exec` | PTY + `codex --search` |
| Web検索 | ❌ | ✅ |
| 対応mode | question, review, modify | question, review のみ |
| タイムアウト | 10分（`--timeout`で変更可） | 同左 |

**注意**: Web検索モードは Windows 10 build 18309以上（ConPTYサポート）が必要

### 自動ログ更新（`--update-log`オプション）

Codex実行後の回答とsession_idをログファイルに自動記録する。手動コピーの手間とミスを削減。

```powershell
# 自動ログ更新付きで実行
codex-helper.mjs run --mode question --update-log --log <log_path> "質問"

# 継続議論も自動ログ更新対応
codex-helper.mjs continue --update-log --log <log_path> "追加の質問"
```

| 機能 | 動作 |
|------|------|
| 回答記録 | `## Codex → Claude (N)` セクションに自動追記 |
| session_id更新 | ヘッダーの `Codexセッション` を自動更新 |
| 継続時 | 質問・回答両方を自動追記（次のラリー番号で） |

**推奨**: SKILL.md のフローでは `--update-log` の使用を推奨。手動でのログ編集が不要になる。

## 認証方式による制限

Codex CLIは2種類の認証方式に対応しているが、機能に差がある。

| 認証方式 | sandbox | ファイル編集 | クラウド機能 |
|----------|---------|-------------|-------------|
| ChatGPTサブスク（Plus/Pro/Business等） | 常に `read-only` | ❌ 不可 | ✅ GitHub連携等 |
| API課金（OPENAI_API_KEY） | `workspace-write` 可 | ✅ 可能 | ❌ 不可 |

**重要**: サブスクリプション認証では `--sandbox workspace-write` を指定しても**強制的に `read-only` になる**。ファイル編集（`modify`モード）を使用するには API 課金が必須。

```powershell
# サブスク認証（読み取り専用）
npx @openai/codex login

# API認証（書き込み可能）
$env:OPENAI_API_KEY = "sk-..."
```

## 関連ファイル

- `SKILL.md` - サブエージェント向け指示書（編集時は注意）
- `TROUBLESHOOTING.md` - トラブルシューティング
- `logs/_TEMPLATE.md` - ログファイルのテンプレート
- `scripts/codex-helper.mjs` - ヘルパースクリプト（preflight, init-log, run, continue, get-session）
- `scripts/pty-session.mjs` - PTYセッション管理（Web検索モード用）
- `scripts/check-log-exists.mjs` - PreToolUseフック用スクリプト
- `~/.codex/AGENTS.md` - Codexのグローバル設定
- `~/.codex/config.toml` - Codex CLI設定

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CODEX_ARCHIVE_DAYS` | 7 | アーカイブ対象とする最終更新からの経過日数 |
| `CODEX_ARCHIVE_LINES` | 1000 | アーカイブ対象とする行数閾値 |

```powershell
# 例: 14日経過 or 2000行超過でアーカイブ
$env:CODEX_ARCHIVE_DAYS = "14"
$env:CODEX_ARCHIVE_LINES = "2000"
```

## 参考リンク

- [Codex CLI GitHub](https://github.com/openai/codex)
- ヘルプ: `npx @openai/codex --help`
- Execヘルプ: `npx @openai/codex exec --help`
