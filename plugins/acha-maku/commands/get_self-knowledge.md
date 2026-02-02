---
name: get_self-knowledge
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

# 手順

手順1でサブエージェントに、該当するファイルを見つけさせ、手順2であなたがその知見を理解せよ。

## 手順1. サブエージェントに下記をやらせる
以下のマッピングに基づいて、`$ARGUMENTS` や今回の話題に対応するナレッジファイルの絶対パスを返させる。

### トリガーワード → ファイルマッピング

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

### 出力形式

メインエージェントに対し、マッチしたファイルパスを以下の形式で報告:

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


## 手順2. 知見を把握する

サブエージェントから受け取ったパスのドキュメントを参照し、今回のトピックについて理解せよ。
ユーザーへの報告は 「〇〇について理解しました。」のみで良い。
