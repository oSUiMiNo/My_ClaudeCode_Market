#!/usr/bin/env node
// check-log-exists.mjs - PreToolUseフック用ログ存在チェック
// Bashでnpx @openai/codex execが実行される前に、ログファイルの存在を確認する

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');

// 標準入力からツール入力を読み取る
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data.tool_input?.command || '';

    // npx @openai/codex exec コマンドかチェック
    if (!command.includes('npx') || !command.includes('@openai/codex') || !command.includes('exec')) {
      // Codexコマンドではないので許可
      process.exit(0);
    }

    // codex-helper.mjs経由の場合は許可（スクリプト側でチェック済み）
    if (command.includes('codex-helper.mjs')) {
      process.exit(0);
    }

    // 直接npxでCodex CLIを呼び出そうとしている場合は常にブロック
    // 設計意図: 「常にcodex-helper.mjs経由で実行」を強制する
    // ログの有無に関わらず、直叩きは許可しない
    console.log(JSON.stringify({
      decision: 'block',
      reason: 'Codex CLIの直接実行は禁止されています。必ずcodex-helper.mjs経由で実行してください。\n使用例: node .claude/skills/codex/scripts/codex-helper.mjs run --mode question --log <log_path> "質問"'
    }));
    process.exit(0);
  } catch (e) {
    // パースエラー等は許可（フックが壊れても動作を妨げない）
    process.exit(0);
  }
});
