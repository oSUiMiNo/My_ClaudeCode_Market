---
name: add_mcp
description: |
  MCP（Model Context Protocol）サーバーを追加またはテストする。
  トリガー: 「〇〇MCPを追加して」「〇〇MCP追加」「〇〇MCPをテストして」などの自然言語プロンプト
context: fork
agent: general-purpose
allowed-tools: Bash(claude mcp*), WebSearch, WebFetch, Read
argument-hint: [MCP名]
---

# add_mcp コマンド

MCP名: $ARGUMENTS

## 実行フロー

### Step 1: MCP存在確認

```bash
claude mcp list
```

出力から対象MCPが既に登録されているか確認する。

### Step 2: 分岐処理

#### 2A: MCPが既に存在する場合 → 実動テスト

1. 対象MCPが提供するツールを1つ呼び出してテストする
2. 結果に応じて出力:
   - 成功: `「{MCP名} MCP は正常に動作しています」`
   - 失敗: エラー内容を報告

#### 2B: MCPが存在しない場合 → 追加処理

1. **Webサーチで最新設定方法を確認**
   ```
   WebSearch: "{MCP名} MCP claude code setup 2025 2026"
   ```

2. **追加コマンドを実行**
   - scopeは必ず `user` を指定（~/.claude/mcp.json に追記される）
   ```bash
   claude mcp add {name} -s user -- {command}
   ```

3. **登録確認**
   ```bash
   claude mcp list
   ```
   出力に対象MCPが含まれていることを確認する。

4. **出力**
   ```
   「{MCP名} MCP をユーザーレベルに設定完了（再起動後 /add_mcp {MCP名} でテスト可能）」
   ```

## 出力形式

状況に応じて以下の1文のみを出力:

| 状況 | 出力 |
|------|------|
| 追加完了 | `{MCP名} MCP をユーザーレベルに設定完了（再起動後 /add_mcp {MCP名} でテスト可能）` |
| テスト成功 | `{MCP名} MCP は正常に動作しています` |
| テスト失敗 | `{MCP名} MCP のテストに失敗しました: {エラー内容}` |
| 追加失敗 | `{MCP名} MCP の追加に失敗しました: {エラー内容}` |

## 注意事項

- settings.json には書き込まない。必ず `~/.claude/mcp.json`（`-s user` オプション）を使用する
- Webサーチで最新の設定方法を必ず確認してから追加する
