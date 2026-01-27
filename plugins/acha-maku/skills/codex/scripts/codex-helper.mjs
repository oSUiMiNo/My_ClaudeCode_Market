#!/usr/bin/env node
// codex-helper.mjs - Codex CLI Helper Script
// 確定論的な処理をコードに分離し、トークン消費を削減する

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CodexPty, generateSessionId } from './pty-session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');
const PREFLIGHT_FILE = join(LOGS_DIR, '.preflight_ok');

// Windows ConPTY最小要件: Windows 10 build 18309以上
const MIN_WINDOWS_BUILD = 18309;

// プラットフォーム判定
const isWindows = process.platform === 'win32';

// =====================
// Utility Functions
// =====================

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function error(message, code = 1) {
  output({ success: false, error: message });
  process.exit(code);
}

function parseArgs(args) {
  const result = { _positional: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else {
      result._positional.push(args[i]);
    }
  }
  return result;
}

function getVersion(command) {
  try {
    const result = execSync(command, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    return result.trim().replace(/^v/, '');
  } catch {
    return null;
  }
}

function compareVersion(version, minVersion) {
  const v = version.split('.').map(Number);
  const min = minVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(v.length, min.length); i++) {
    const a = v[i] || 0;
    const b = min[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * WindowsのConPTYサポートを確認（PTYセッションに必要）
 * Windows 10 build 18309以上が必要
 * @returns {{ supported: boolean, build: number|null, error: string|null }}
 */
function checkWindowsConPTY() {
  if (!isWindows) {
    return { supported: true, build: null, error: null };
  }

  try {
    // Windowsのバージョン情報を取得
    const release = execSync('cmd /c ver', { encoding: 'utf-8' });
    // "Microsoft Windows [Version 10.0.19045.3930]" のような形式からビルド番号を抽出
    const match = release.match(/\[Version \d+\.\d+\.(\d+)/);
    if (match) {
      const build = parseInt(match[1], 10);
      const supported = build >= MIN_WINDOWS_BUILD;
      return {
        supported,
        build,
        error: supported ? null : `Windows build ${build} does not support ConPTY. Minimum required: ${MIN_WINDOWS_BUILD}`
      };
    }
    // バージョン解析失敗時は警告のみ（続行可能）
    return { supported: true, build: null, error: null };
  } catch {
    // チェック失敗時は続行可能
    return { supported: true, build: null, error: null };
  }
}

// =====================
// preflight
// =====================

async function preflight() {
  // logs ディレクトリが存在しない場合は作成
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }

  // キャッシュ確認（全バージョン一致 + TTL 24時間）
  if (existsSync(PREFLIGHT_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(PREFLIGHT_FILE, 'utf-8'));

      // TTLチェック（24時間）
      const cacheAge = Date.now() - new Date(cached.checked_at).getTime();
      const TTL_MS = 24 * 60 * 60 * 1000; // 24時間

      if (cacheAge < TTL_MS && cached.versions) {
        // 全バージョンを検証（Node, npx, Codex）
        const currentNodeVersion = getVersion('node -v');
        const currentNpxVersion = getVersion('npx -v');
        const currentCodexVersion = getVersion('npx --yes @openai/codex --version');

        const allMatch =
          cached.versions.node === currentNodeVersion &&
          cached.versions.npx === currentNpxVersion &&
          cached.versions.codex === currentCodexVersion;

        if (allMatch) {
          output({ success: true, cached: true, checks: cached.versions });
          return;
        }
      }
    } catch {
      // キャッシュが壊れている場合は再チェック
    }
  }

  const checks = {
    node: { ok: false, version: null },
    npx: { ok: false, version: null },
    codex: { ok: false, version: null },
    conpty: { ok: true, build: null, warning: null }  // PTYセッション用
  };

  // Node.js チェック
  const nodeVersion = getVersion('node -v');
  if (nodeVersion) {
    checks.node.version = nodeVersion;
    checks.node.ok = compareVersion(nodeVersion, '22.0.0') >= 0;
  }

  // npx チェック
  const npxVersion = getVersion('npx -v');
  if (npxVersion) {
    checks.npx.version = npxVersion;
    checks.npx.ok = true;
  }

  // Codex CLI チェック（--yes で対話プロンプト抑制）
  const codexVersion = getVersion('npx --yes @openai/codex --version');
  if (codexVersion) {
    checks.codex.version = codexVersion;
    checks.codex.ok = true;
  }

  // Windows ConPTY チェック（PTYセッションに必要）
  const conptyCheck = checkWindowsConPTY();
  checks.conpty.ok = conptyCheck.supported;
  checks.conpty.build = conptyCheck.build;
  if (!conptyCheck.supported) {
    checks.conpty.warning = conptyCheck.error;
  }

  // 必須チェック（ConPTYは警告のみ、失敗させない）
  const success = checks.node.ok && checks.npx.ok && checks.codex.ok;

  if (success) {
    // キャッシュに保存
    const cacheData = {
      checked_at: new Date().toISOString(),
      versions: {
        node: checks.node.version,
        npx: checks.npx.version,
        codex: checks.codex.version
      }
    };
    writeFileSync(PREFLIGHT_FILE, JSON.stringify(cacheData, null, 2));
  }

  let errorMsg = null;
  if (!checks.node.ok) {
    errorMsg = `Node.js version 22+ required, found ${checks.node.version || 'not installed'}`;
  } else if (!checks.npx.ok) {
    errorMsg = 'npx not found';
  } else if (!checks.codex.ok) {
    errorMsg = 'Codex CLI not found. Run: npm install -g @openai/codex';
  }

  output({
    success,
    checks,
    ...(errorMsg && { error: errorMsg })
  });

  if (!success) {
    process.exit(1);
  }
}

// =====================
// Log Update Functions
// =====================

/**
 * ログファイルの現在のラリー番号を取得
 * @param {string} content - ログファイルの内容
 * @returns {number} 最大のラリー番号（見つからない場合は0）
 */
function getCurrentRallyNumber(content) {
  const matches = content.matchAll(/## (?:Claude → Codex|Codex → Claude) \((\d+)\)/g);
  let maxN = 0;
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  return maxN;
}

/**
 * ログファイルにCodexの回答を追記し、session_idを更新
 * @param {string} logPath - ログファイルパス
 * @param {string} response - Codexの回答
 * @param {string|null} sessionId - セッションID（nullの場合は更新しない）
 * @param {number} rallyNumber - ラリー番号
 */
function updateLogWithResponse(logPath, response, sessionId, rallyNumber) {
  let content = readFileSync(logPath, 'utf-8');

  // session_idの更新（プレースホルダーまたは既存値を置換）
  if (sessionId) {
    content = content.replace(
      /\*\*Codexセッション\*\*:\s*[^\n]+/,
      `**Codexセッション**: ${sessionId}`
    );
  }

  // 回答セクションを探して挿入位置を決定
  // パターン: "## Codex → Claude (N)" が存在すれば置換、なければ追加
  const responseHeader = `## Codex → Claude (${rallyNumber})`;

  if (content.includes(responseHeader)) {
    // 既存セクションの内容を置換（次のセクションまで）
    const regex = new RegExp(
      `(## Codex → Claude \\(${rallyNumber}\\)\\n\\n)[\\s\\S]*?(?=\\n## |## 結論|$)`,
      'm'
    );
    content = content.replace(regex, `$1${response}\n\n`);
  } else {
    // セクションが存在しない場合、対応する質問セクションの後に追加
    const questionHeader = `## Claude → Codex (${rallyNumber})`;
    const insertPos = content.indexOf(questionHeader);
    if (insertPos !== -1) {
      // 質問セクションの終わりを探す（次の ## まで）
      const afterQuestion = content.slice(insertPos);
      const nextSectionMatch = afterQuestion.match(/\n(## (?!Claude → Codex))/);
      const insertPoint = nextSectionMatch
        ? insertPos + nextSectionMatch.index
        : content.indexOf('## 結論');

      if (insertPoint !== -1) {
        content = content.slice(0, insertPoint) +
                  `\n${responseHeader}\n\n${response}\n` +
                  content.slice(insertPoint);
      }
    }
  }

  writeFileSync(logPath, content);
}

// =====================
// run
// =====================

// sandbox値のホワイトリスト
const VALID_SANDBOXES = ['read-only', 'workspace-write'];

/**
 * codex exec を実行し、出力とセッションIDを返す
 * @param {string[]} commandArgs - npx に渡す引数配列
 * @param {number} timeoutMs - タイムアウト（ミリ秒）
 * @returns {Promise<{ code: number, sessionId: string|null }>}
 */
async function spawnCodexExec(commandArgs, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    // shell:true では引数が単純に連結されるため、手動でクォートする必要がある
    // 最後の引数（プロンプト）を特別に処理
    const quotedArgs = commandArgs.map((arg, i) => {
      // 最後の引数（プロンプト）または空白を含む引数をクォート
      if (i === commandArgs.length - 1 || arg.includes(' ') || arg.includes('<') || arg.includes('>')) {
        // ダブルクォートをエスケープしてダブルクォートで囲む
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });

    const fullCommand = `npx ${quotedArgs.join(' ')}`;
    const child = spawn(fullCommand, [], {
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // タイムアウト処理（AbortControllerの代わりにkillを使用）
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Windowsではkillが効かない場合があるため、強制終了も試行
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (timedOut) {
        reject(new Error(`Timeout: Codex did not respond within ${timeoutMs / 1000} seconds`));
        return;
      }
      const allOutput = stdout + stderr;
      const sessionIdMatch = allOutput.match(/session id:\s*([a-f0-9-]+)/i);
      resolve({
        code: code || 0,
        sessionId: sessionIdMatch ? sessionIdMatch[1] : null,
        output: stdout  // Codexの出力（ログ更新用）
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

// 有効な reasoning effort 値
const VALID_REASONING_EFFORTS = ['low', 'medium', 'high'];

function buildCommandArgs(mode, cd, prompt, reasoningEffort = null) {
  // codex exec（非インタラクティブ）ではデフォルトモデルを使用
  // ChatGPTアカウントでは--modelオプションで特定モデルを指定できない制限がある
  // --yes: npxの対話プロンプトを抑制（初回実行時のハング防止）
  const base = ['--yes', '@openai/codex', 'exec', '--full-auto'];

  // reasoning effort が指定されている場合は -c オプションで追加
  // Codex CLIは -c key=value 形式で設定を上書きする
  if (reasoningEffort && VALID_REASONING_EFFORTS.includes(reasoningEffort)) {
    base.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }

  switch (mode) {
    case 'question':
      // questionモードでも--cdが指定されていればファイル参照可能
      if (cd) {
        return [...base, '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cd, prompt];
      }
      return [...base, '--sandbox', 'read-only', '--skip-git-repo-check', prompt];
    case 'review':
      if (!cd) throw new Error('--cd is required for review mode');
      return [...base, '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cd, prompt];
    case 'modify':
      if (!cd) throw new Error('--cd is required for modify mode');
      return [...base, '--sandbox', 'workspace-write', '--skip-git-repo-check', '--cd', cd, prompt];
    default:
      throw new Error(`Unknown mode: ${mode}. Valid modes: question, review, modify`);
  }
}

function validateLogFile(logPath) {
  if (!logPath) {
    return { valid: false, error: 'Error: --log is required. Create log file first before running Codex.' };
  }

  if (!existsSync(logPath)) {
    return { valid: false, error: `Error: Log file not found: ${logPath}. Create log file first.` };
  }

  const content = readFileSync(logPath, 'utf-8');

  // 必須ヘッダーの確認
  if (!content.includes('# Codex議論ログ')) {
    return { valid: false, error: 'Error: Log file missing header "# Codex議論ログ". Use correct template.' };
  }

  // Claude → Codex セクションの存在確認
  if (!content.match(/## Claude → Codex \(\d+\)/)) {
    return { valid: false, error: 'Error: Log file missing "## Claude → Codex (N)" section. Write your question first.' };
  }

  return { valid: true, logPath };
}

async function run(args) {
  const parsed = parseArgs(args);
  const mode = parsed.mode;
  const cd = parsed.cd;
  const logPath = parsed.log;
  const prompt = parsed._positional.join(' ');
  // --search フラグの解釈: --search または --search true でtrue、--search false でfalse、未指定でfalse
  const useSearch = parsed.search === true || parsed.search === 'true' ||
                    (parsed.search !== undefined && parsed.search !== 'false');
  const timeoutMs = parseInt(parsed.timeout, 10) || 600000;  // デフォルト10分
  // --update-log フラグ: 回答とsession_idを自動でログに記録
  const updateLog = parsed['update-log'] === true;
  // --reasoning-effort: 推論強度 (low, medium, high)
  const reasoningEffort = parsed['reasoning-effort'] || null;

  if (!mode) {
    error('Error: --mode is required. Valid modes: question, review, modify');
  }
  if (!prompt) {
    error('Error: prompt is required as positional argument');
  }

  // reasoning effort の検証
  if (reasoningEffort && !VALID_REASONING_EFFORTS.includes(reasoningEffort)) {
    error(`Error: Invalid --reasoning-effort value "${reasoningEffort}". Valid values: ${VALID_REASONING_EFFORTS.join(', ')}`);
  }

  // --search と --mode modify の組み合わせは禁止（PTYはread-only固定）
  if (useSearch && mode === 'modify') {
    error('Error: --search cannot be used with --mode modify (PTY mode is read-only)');
  }

  // ログファイル存在チェック（必須ゲート）
  const logValidation = validateLogFile(logPath);
  if (!logValidation.valid) {
    error(logValidation.error);
  }

  // 現在のラリー番号を取得（--update-log用）
  const logContent = readFileSync(logPath, 'utf-8');
  const rallyNumber = getCurrentRallyNumber(logContent);

  // --search フラグが指定されている場合はPTYモードを使用
  if (useSearch) {
    await runWithPty(mode, cd, logPath, prompt, timeoutMs, updateLog, rallyNumber, reasoningEffort);
    return;
  }

  // 従来モード: codex exec を使用
  let commandArgs;
  try {
    commandArgs = buildCommandArgs(mode, cd, prompt, reasoningEffort);
  } catch (e) {
    error(`Error: ${e.message}`);
  }

  // 共通関数を使用して実行（shell: false, タイムアウト付き）
  try {
    const result = await spawnCodexExec(commandArgs, timeoutMs);

    // --update-log が指定されている場合、ログを自動更新
    if (updateLog && result.output) {
      updateLogWithResponse(logPath, result.output, result.sessionId, rallyNumber);
      console.error(`Log updated: ${logPath}`);
    }

    if (result.sessionId) {
      console.error(`SESSION_ID=${result.sessionId}`);
    }
    process.exit(result.code);
  } catch (e) {
    error(e.message);
  }
}

// =====================
// runWithPty (PTYモードで実行 - Web検索対応)
// =====================

async function runWithPty(mode, cd, logPath, prompt, timeoutMs, updateLog = false, rallyNumber = 1, reasoningEffort = null) {
  // セッションIDを生成
  const sessionId = generateSessionId();

  // cwdを決定（modeに応じて）
  let cwd = process.cwd();
  if (mode === 'review') {
    if (!cd) {
      error('Error: --cd is required for review mode');
    }
    cwd = cd;
  }

  try {
    // PTYセッションを作成・起動
    const ptySession = new CodexPty(sessionId, {
      search: true,  // Web検索を有効化
      cwd: cwd,
      logPath: logPath,
      reasoningEffort: reasoningEffort,  // 推論強度
    });

    console.error(`Starting PTY session with web search...`);
    if (reasoningEffort) {
      console.error(`Reasoning effort: ${reasoningEffort}`);
    }
    await ptySession.spawn();
    console.error(`PTY session started: ${sessionId}`);

    // 初期出力を収集（起動メッセージ等が落ち着くまで待機）
    // Codex CLIの起動には時間がかかるため、十分な待機時間を確保
    console.error(`Waiting for Codex CLI to initialize...`);
    await new Promise(resolve => setTimeout(resolve, 8000));

    // バッファをクリアして新しい出力のみを取得
    ptySession.outputBuffer = '';

    // プロンプトを送信（async版）
    console.error(`Sending prompt: ${prompt}`);
    await ptySession.send(prompt);

    // 入力が確実に処理されるまで少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 出力を収集（idleTimeout=30秒, checkInterval=1秒, maxTimeout=timeoutMs）
    const response = await ptySession.collectOutput(30000, 1000, timeoutMs);

    // 結果を出力
    console.log(response);

    // --update-log が指定されている場合、ログを自動更新
    // PTYモードではsession_idは取得できないため、生成したIDを使用
    if (updateLog && response) {
      updateLogWithResponse(logPath, response, sessionId, rallyNumber);
      console.error(`Log updated: ${logPath}`);
    }

    // セッションを終了
    ptySession.kill();
    console.error(`PTY session ended: ${sessionId}`);

    process.exit(0);

  } catch (err) {
    error(`PTY session failed: ${err.message}`);
  }
}

// =====================
// continue (ログを読ませて議論を継続)
// =====================

async function continueDiscussion(args) {
  const parsed = parseArgs(args);
  const logPath = parsed.log;
  const prompt = parsed._positional.join(' ');
  const timeoutMs = parseInt(parsed.timeout, 10) || 600000;  // デフォルト10分
  // --update-log フラグ: 回答とsession_idを自動でログに記録
  const updateLog = parsed['update-log'] === true;
  // --reasoning-effort: 推論強度 (low, medium, high)
  const reasoningEffort = parsed['reasoning-effort'] || null;

  if (!logPath) {
    error('Error: --log is required');
  }
  if (!prompt) {
    error('Error: prompt is required as positional argument');
  }

  // reasoning effort の検証
  if (reasoningEffort && !VALID_REASONING_EFFORTS.includes(reasoningEffort)) {
    error(`Error: Invalid --reasoning-effort value "${reasoningEffort}". Valid values: ${VALID_REASONING_EFFORTS.join(', ')}`);
  }

  // ログファイルの存在確認
  if (!existsSync(logPath)) {
    error(`Error: Log file not found: ${logPath}`);
  }

  // ログから作業ディレクトリとsandboxを取得
  const content = readFileSync(logPath, 'utf-8');
  // HTMLコメント (<!-- ... -->) を除外して値を取得
  const cdMatch = content.match(/\*\*作業ディレクトリ\*\*:\s*([^<\n]+)/);
  const sandboxMatch = content.match(/\*\*sandbox\*\*:\s*(\S+)/);

  const cdFromLog = cdMatch ? cdMatch[1].trim() : null;
  const sandboxFromLog = sandboxMatch ? sandboxMatch[1].trim() : null;

  // 作業ディレクトリ: 「なし」や未設定の場合は--cdを省略（questionモードの継続を許可）
  const hasWorkDir = cdFromLog && cdFromLog !== 'なし' && cdFromLog !== '（依頼内容に応じて記入）';
  const workDir = hasWorkDir ? cdFromLog : null;

  // sandbox: ホワイトリスト検証（不正な値はread-onlyにフォールバック）
  let sandbox = 'read-only';
  if (sandboxFromLog && VALID_SANDBOXES.includes(sandboxFromLog)) {
    sandbox = sandboxFromLog;
  } else if (sandboxFromLog) {
    console.error(`Warning: Invalid sandbox value "${sandboxFromLog}" in log, using "read-only"`);
  }

  // 現在のラリー番号を取得し、次のラリー番号を計算
  const currentRallyNumber = getCurrentRallyNumber(content);
  const nextRallyNumber = currentRallyNumber + 1;

  // Codexにログを読ませて議論を再開
  // Windowsパスをフォワードスラッシュに変換（Codexが読めるようにする）
  const normalizedPath = logPath.replace(/\\/g, '/');
  // 注: shell:true で引数を渡すため、改行を避けて1行で記述
  const resumePrompt = `以下のログファイルを読んで議論を再開: ${normalizedPath} - 追加の質問/指示: ${prompt}`;

  // コマンド引数を構築（workDirがある場合のみ--cdを追加）
  // --yes: npxの対話プロンプトを抑制
  const commandArgs = [
    '--yes', '@openai/codex', 'exec', '--full-auto',
    '--sandbox', sandbox,
    '--skip-git-repo-check',
    ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : []),
    ...(workDir ? ['--cd', workDir] : []),
    resumePrompt
  ];

  // 共通関数を使用して実行（shell: true, タイムアウト付き）
  try {
    const result = await spawnCodexExec(commandArgs, timeoutMs);

    // --update-log が指定されている場合、ログを自動更新
    // continueの場合は次のラリー番号を使用
    if (updateLog && result.output) {
      // まず質問セクションを追加
      let logContent = readFileSync(logPath, 'utf-8');
      const questionHeader = `## Claude → Codex (${nextRallyNumber})`;
      if (!logContent.includes(questionHeader)) {
        // 結論セクションの前に質問を挿入
        const conclusionPos = logContent.indexOf('## 結論');
        if (conclusionPos !== -1) {
          logContent = logContent.slice(0, conclusionPos) +
                       `${questionHeader}\n\n${prompt}\n\n` +
                       logContent.slice(conclusionPos);
          writeFileSync(logPath, logContent);
        }
      }
      // 回答を追加
      updateLogWithResponse(logPath, result.output, result.sessionId, nextRallyNumber);
      console.error(`Log updated: ${logPath}`);
    }

    if (result.sessionId) {
      console.error(`SESSION_ID=${result.sessionId}`);
    }
    process.exit(result.code);
  } catch (e) {
    error(e.message);
  }
}

// =====================
// init-log
// =====================

function initLog(args) {
  const parsed = parseArgs(args);
  const topic = parsed.topic || 'discussion';
  const purpose = parsed.purpose || '';
  const workdir = parsed.cd || 'なし';
  const sandbox = parsed.sandbox || 'read-only';
  // 参照パス: カンマ区切りで複数指定可能
  const refPaths = parsed.ref ? parsed.ref.split(',').map(p => p.trim()) : [];

  // テンプレートファイルのパス
  const templatePath = join(LOGS_DIR, '_TEMPLATE.md');

  if (!existsSync(templatePath)) {
    error('Error: Template file not found: logs/_TEMPLATE.md');
  }

  // テンプレートを読み込む
  let template = readFileSync(templatePath, 'utf-8');

  // 日時を生成（JST固定）
  const now = new Date();
  const jstOffset = 9 * 60; // JST = UTC+9
  const jstTime = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60 * 1000);

  const year = jstTime.getFullYear();
  const month = String(jstTime.getMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getDate()).padStart(2, '0');
  const hours = String(jstTime.getHours()).padStart(2, '0');
  const minutes = String(jstTime.getMinutes()).padStart(2, '0');
  const seconds = String(jstTime.getSeconds()).padStart(2, '0');

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${minutes}:${seconds}`;
  const datetime = `${dateStr} ${timeStr} JST`;

  // ファイル名用の日時（JST）
  const fileDate = `${year}${month}${day}`;
  const fileTime = `${hours}${minutes}${seconds}`;

  // [P1修正] トピックをファイル名用に変換
  // ASCII部分を抽出し、空の場合はハッシュを使用（日本語トピック対応）
  const asciiPart = topic.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').slice(0, 30);
  const topicHash = createHash('md5').update(topic).digest('hex').slice(0, 8);
  // ASCII部分があればそれを使用、なければハッシュのみ、両方あれば併用
  const safeTopic = asciiPart ? `${asciiPart}_${topicHash}` : topicHash;

  // ログファイルのパス
  const logFileName = `${fileDate}_${fileTime}_discussion_${safeTopic}.md`;
  const logPath = join(LOGS_DIR, logFileName);

  // 置換トークンを置換
  template = template.replace('{{DATETIME}}', datetime);
  template = template.replace(/\{\{TOPIC\}\}/g, topic);
  template = template.replace('{{PURPOSE}}', purpose || '（依頼内容に応じて記入）');
  template = template.replace('{{SESSION_ID}}', '（Codex実行後に記入）');
  template = template.replace('{{WORKDIR}}', workdir);
  template = template.replace('{{SANDBOX}}', sandbox);
  // 参照パス: 箇条書き形式に変換（なければ「  - なし」）
  const refPathsStr = refPaths.length > 0
    ? refPaths.map(p => `  - ${p}`).join('\n')
    : '  - なし';
  template = template.replace('{{REFPATHS}}', refPathsStr);
  template = template.replace('{{QUESTION}}', '（ここに依頼内容を書く）');
  template = template.replace('{{ANSWER}}', '（Codexの回答を書く）');
  template = template.replace('{{SUMMARY}}', '（得られた回答の要点）');
  template = template.replace('{{NEXT_ACTION}}', 'なし');

  // ファイルを書き込む
  writeFileSync(logPath, template);

  output({
    success: true,
    log_path: logPath,
    message: `Log file created: ${logPath}`
  });
}

// =====================
// get-session
// =====================

function getSession(args) {
  const parsed = parseArgs(args);
  const logPath = parsed.log;

  if (!logPath) {
    error('Error: --log is required');
  }

  if (!existsSync(logPath)) {
    error('Error: Log file not found');
  }

  const content = readFileSync(logPath, 'utf-8');

  // ヘッダーからセッション情報を抽出
  const sessionMatch = content.match(/\*\*Codexセッション\*\*:\s*([a-f0-9-]+)/i);
  const cdMatch = content.match(/\*\*作業ディレクトリ\*\*:\s*(.+)/);
  const sandboxMatch = content.match(/\*\*sandbox\*\*:\s*(\S+)/);

  if (!sessionMatch) {
    error('Error: No session found in log');
  }

  output({
    session_id: sessionMatch[1],
    cd: cdMatch ? cdMatch[1].trim() : null,
    sandbox: sandboxMatch ? sandboxMatch[1].trim() : null
  });
}

// =====================
// Main
// =====================

const [,, subcommand, ...args] = process.argv;

switch (subcommand) {
  case 'preflight':
    await preflight();
    break;
  case 'init-log':
    initLog(args);
    break;
  case 'run':
    await run(args);
    break;
  case 'continue':
    await continueDiscussion(args);
    break;
  case 'get-session':
    getSession(args);
    break;
  case '--help':
  case '-h':
  case undefined:
    console.log(`
codex-helper.mjs - Codex CLI Helper Script

Usage:
  node codex-helper.mjs <command> [options]

Commands:
  preflight              Check environment prerequisites
  init-log               Create log file from template (REQUIRED before run)
  run                    Execute Codex session (--log required)
  continue               Continue discussion from log file
  get-session            Get session info from log file

Examples:
  # Check environment
  node codex-helper.mjs preflight

  # Create log and run (standard mode)
  node codex-helper.mjs init-log --topic "rust-features" --purpose "Rustの特徴を調べる"
  node codex-helper.mjs run --mode question --log <log_path> "Rustの特徴を教えて"

  # Run with auto log update (recommended)
  node codex-helper.mjs run --mode question --update-log --log <log_path> "質問"

  # Run with lower reasoning effort (faster, less thorough)
  node codex-helper.mjs run --mode question --reasoning-effort low --log <log_path> "簡単な質問"

  # Run with web search enabled (PTY mode)
  node codex-helper.mjs run --mode question --search --log <log_path> "2026年の最新ニュースを教えて"

  # Continue discussion with auto log update
  node codex-helper.mjs continue --update-log --log <log_path> "追加の質問"

Options:
  --mode <mode>          Execution mode: question, review, modify
  --log <path>           Path to log file (required for most commands)
  --update-log           Auto-update log file with response and session_id
  --reasoning-effort <v> Reasoning effort: low, medium, high (default: from config)
  --search               Enable web search (uses PTY mode, question/review only)
  --timeout <ms>         Output collection timeout in ms (default: 600000, 10 min)
  --cd <path>            Working directory (required for review/modify)

Note: --search enables web search via PTY mode. Cannot be used with --mode modify.
      --update-log automatically appends Codex response and updates session_id in the log.
`);
    break;
  default:
    error(`Unknown subcommand: ${subcommand}. Use --help for usage.`);
}
