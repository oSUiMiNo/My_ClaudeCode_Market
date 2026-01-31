---
name: get_self-knowledge
# context: fork
agent: general-purpose
description: |
  メインエージェントがユーザーのプロンプトに含まれるトピックに関連するナレッジを素早く参照するために使用。

  トリガーワード:
  - 「スキルズ」「スキル」「Skills」「skill」 → skills.md
  - 「フックス」「フック」「Hooks」「hook」 → hooks.md
  - 「カスタムサブエージェント」「サブエージェント」「Sub-agent」「subagent」 → subagents.md
  - 「MCP」「Model Context Protocol」 → mcp.md
  - 「ルールズ」「ルール」「Rules」「rule」「.claude/rules」 → rules.md
  - 「スラッシュコマンド」「Slash Command」「commands」「カスタムコマンド」「カスタムスラッシュコマンド」 → commands.md
  - 「Claude Codeの機能」「Claude Codeの使い方」「Claude Codeの最新」「アップデート」 → version.md, README.md
  - 「プラグイン」「Plugins」 → other.md

argument-hint: [keyword]
---
# ⚠️ 必ず実行： あなたがサブエージェントでない場合は general-purpose を起動しタスクを行わせよ
**1. あなたがサブエージェントあると伝えられている場合は2番以降無視せよ**
**2. あなたがサブエージェントではない場合、下記をあなたがやってはいけない。これ以降のタスクを必ずサブエージェントに任せること。**

# Self-Knowledge Path Resolver

ユーザーから渡されたキーワード: `$ARGUMENTS`

以下のマッピングに基づいて、対応するナレッジファイルの絶対パスを返してください。

## トリガーワード → ファイルマッピング

| キーワード（部分一致可） | ファイルパス |
|--------------------------|--------------|
| skill, スキル, Skills | `~/.claude/docs/self-knowledge/skills.md` |
| hook, フック, Hooks | `~/.claude/docs/self-knowledge/hooks.md` |
| subagent, サブエージェント, Sub-agent, エージェント, agent | `~/.claude/docs/self-knowledge/subagents.md` |
| MCP, Model Context Protocol, mcp | `~/.claude/docs/self-knowledge/mcp.md` |
| rule, ルール, Rules, .claude/rules | `~/.claude/docs/self-knowledge/rules.md` |
| command, コマンド, スラッシュ, slash | `~/.claude/docs/self-knowledge/commands.md` |
| version, バージョン, 最新, アップデート, update, 機能, 使い方 | `~/.claude/docs/self-knowledge/version.md` |
| plugin, プラグイン, Plugins | `~/.claude/docs/self-knowledge/other.md` |
| other, その他, Chrome, VSCode, VS Code, ターミナル, terminal | `~/.claude/docs/self-knowledge/other.md` |
| all, 全て, 一覧, index, README | `~/.claude/docs/self-knowledge/README.md` |

## メインエージェントへの出力形式

マッチしたファイルパスを以下の形式で出力:

```
関連ナレッジファイル:
- ~/.claude/docs/self-knowledge/<filename>.md

上記ファイルを Read ツールで読み込み、内容を把握してから次のタスクを遂行してください。
```

複数のキーワードがマッチした場合は、全ての関連ファイルをリストアップ。

マッチするキーワードがない場合:
```
該当するナレッジファイルが見つかりませんでした。
利用可能なトピック: skills, hooks, subagents, mcp, rules, commands, version, other
インデックス: ~/.claude/docs/self-knowledge/README.md

README.md を Read ツールで読み込み、内容を把握してから次のタスクを遂行してください。
```
