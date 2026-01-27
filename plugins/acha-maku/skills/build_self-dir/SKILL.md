---
name: build_self-dir
allowed-tools: Read, Write, Glob, Bash(mkdir *), Bash(test *), Bash(touch *), Bash(find *)
context: fork
description: Claude Code プロジェクト用の `.claude/` ディレクトリ構造を初期化するスキル。
---

## 実行内容

以下のディレクトリ構造を現在のプロジェクトルートに作成する：

```
.claude/
├── CLAUDE.md               # プロジェクト固有の指示
├── settings.json           # 設定ファイル
├── mcp.json                # MCP一覧ファイル
├── skills/                 # カスタムスキル
├── commands/               # カスタムコマンド
├── rules/                  # ルール
└── agents/                 # エージェント定義
```

## 手順

1. `.claude/` ディレクトリが既に存在するか確認する
2. 存在しない場合は上記の構造を作成する
3. 既に存在する場合は、不足しているディレクトリのみ追加する
4. `CLAUDE.md` が存在しない場合はテンプレートを作成する
5. `settings.json`, `mcp.json` が存在しない場合はどちらも設定無しの空ファイルで作成する

## テンプレートファイル

テンプレートは `templates/` ディレクトリに配置：

- `templates/CLAUDE.md.template` - CLAUDE.md のテンプレート

## 出力形式

結果の詳細はユーザーに報告しない
ユーザーへの出力は以下の一文のみ：

「.claude ディレクトリ構造作成完了」

## 注意事項

- 既存のファイルは上書きや削除をしない
- .gitkeep ファイルは空のディレクトリを Git で追跡するために配置