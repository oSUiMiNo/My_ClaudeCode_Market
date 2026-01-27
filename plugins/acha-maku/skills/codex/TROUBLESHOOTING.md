# Codex Skill トラブルシューティング

問題が発生した場合はこのドキュメントを参照。

## 目次

1. [Gitリポジトリ関連](#1-gitリポジトリ関連)
2. [認証関連](#2-認証関連)
3. [タイムアウト・部分的結果](#3-タイムアウト部分的結果)
4. [文字化け](#4-文字化け)
5. [書き込みブロック](#5-書き込みブロック)
6. [PTYモード・Web検索関連](#6-ptyモードweb検索関連)
7. [npx関連](#7-npx関連)

---

## 1. Gitリポジトリ関連

### "Not inside a trusted directory" エラー

**原因**: Gitリポジトリ外で実行している

**対処**:
- Gitリポジトリ内に移動する
- 質問のみの場合: `--skip-git-repo-check` を追加（`question`モードは自動付与）

---

## 2. 認証関連

### 認証エラー（401）

**原因**: ログインセッションが切れた

**対処**:
```bash
npx @openai/codex login
```

---

## 3. タイムアウト・部分的結果

### タイムアウト

**原因**: デフォルトタイムアウト（10分）を超過

**対処**:
- 質問を分割して再試行
- `--timeout` オプションでタイムアウトを延長
  ```bash
  codex-helper.mjs run --mode question --timeout 900000 --log <path> "質問"  # 15分
  ```

### 部分的な結果

**対処**: `continue` で続きを依頼

### 繰り返し失敗

**対処**: 新規セッション（`run`）で再開

---

## 4. 文字化け

### 日本語ファイルが文字化け（Windows PowerShell 5.1）

**原因**: PowerShell 5.1のデフォルトエンコーディングがUTF-8でない

**対処（優先順）**:

1. **まず試す**: ファイル読み取り時に指定
   ```powershell
   Get-Content -Encoding UTF8 <path>
   ```

2. **恒久対策**: PowerShell 7をインストール
   ```powershell
   winget install Microsoft.PowerShell
   [Environment]::SetEnvironmentVariable('Path', 'C:\Program Files\PowerShell\7;' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')
   ```

---

## 5. 書き込みブロック

### 書き込み操作がブロックされる

**原因**: ChatGPTサブスクリプション利用時は `read-only` 固定

**対処**:
- 書き込みが必要な場合はOpenAI APIキーに切り替え
- APIキー設定: `npx @openai/codex login` で再認証

---

## 6. PTYモード・Web検索関連

### Web検索モード（`--search`）が動作しない

**原因**: Windows版でConPTYがサポートされていない

**対処**:
- Windows 10 build 18309以上が必要
- ビルド番号確認: `cmd /c ver`
- 古いWindowsの場合はWeb検索なしで使用

### PTYセッションが起動しない

**原因**: 依存関係（node-pty）がインストールされていない

**対処**:
```bash
cd .claude/skills/codex/scripts && npm ci
```

### PTYモードでタイムアウト

**原因**: Codex CLIの応答が遅い、または出力が途中で止まった

**対処**:
- `--timeout` でタイムアウトを延長
- idleTimeout（30秒）内に出力がないと完了と判定される

---

## 7. npx関連

### npx実行時にハングする

**原因**: 初回実行時にnpxが対話プロンプトを表示している

**対処**:
- 通常は `--yes` フラグで自動的に抑制される（スキル内で対応済み）
- 手動実行時は `npx --yes @openai/codex ...` を使用

### npxでパッケージが見つからない

**対処**:
```bash
# キャッシュクリア
npm cache clean --force

# 再インストール
npm install -g @openai/codex
```
