#!/usr/bin/env node
// pty-session.mjs - PTYセッション管理モジュール
// Codex CLIをインタラクティブモード（--search）で起動し、Web検索機能を有効にする

import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import stripAnsi from 'strip-ansi';

const isWindows = process.platform === 'win32';

/**
 * CodexPty - PTYプロセスのラッパークラス
 * Codex CLIをインタラクティブモードで起動し、入出力を管理する
 */
export class CodexPty {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.options = {
      search: options.search ?? true,   // Web検索を有効化（デフォルト: true）
      cwd: options.cwd ?? process.cwd(),
      logPath: options.logPath ?? null,
      reasoningEffort: options.reasoningEffort ?? null,  // 推論強度 (low, medium, high)
    };
    this.ptyProcess = null;
    this.outputBuffer = '';
    this.isAlive = false;
    this.startedAt = null;
  }

  /**
   * Codex CLIをインタラクティブモードで起動
   * @returns {Promise<void>}
   */
  async spawn() {
    return new Promise((resolve, reject) => {
      try {
        // コマンド引数を構築（インタラクティブモード用）
        // 注意: --skip-git-repo-check はインタラクティブモードでは使用不可
        const codexArgs = [];
        if (this.options.search) {
          codexArgs.push('--search');
        }
        // full-auto + sandbox設定
        codexArgs.push('--full-auto');
        codexArgs.push('--sandbox', 'read-only');
        // reasoning effort が指定されている場合は -c オプションで追加
        if (this.options.reasoningEffort) {
          codexArgs.push('-c', `model_reasoning_effort="${this.options.reasoningEffort}"`);
        }

        // PTYオプション
        const ptyOptions = {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: this.options.cwd,
          env: { ...process.env },
        };

        // プラットフォーム別のシェル設定
        // --yes: npxの対話プロンプトを抑制（初回実行時のハング防止）
        let shell, shellArgs;
        if (isWindows) {
          // Windows: cmd.exe /c でコマンド全体を1つの文字列として渡す
          shell = 'cmd.exe';
          const fullCommand = `npx --yes @openai/codex ${codexArgs.join(' ')}`;
          shellArgs = ['/c', fullCommand];
        } else {
          // Unix: bash経由でnpxを実行
          shell = 'bash';
          shellArgs = ['-c', `npx --yes @openai/codex ${codexArgs.join(' ')}`];
        }

        this.ptyProcess = pty.spawn(shell, shellArgs, ptyOptions);
        this.isAlive = true;
        this.startedAt = new Date().toISOString();

        // 出力をバッファに蓄積
        this.ptyProcess.onData((data) => {
          this.outputBuffer += data;
        });

        // プロセス終了時の処理
        this.ptyProcess.onExit(({ exitCode, signal }) => {
          this.isAlive = false;
        });

        // 起動完了を待つ（初期出力が落ち着くまで）
        setTimeout(() => {
          if (this.isAlive) {
            resolve();
          } else {
            reject(new Error('PTY process exited immediately after spawn'));
          }
        }, 2000);

      } catch (err) {
        reject(new Error(`Failed to spawn PTY: ${err.message}`));
      }
    });
  }

  /**
   * 入力を送信
   * @param {string} input - 送信する入力文字列
   * @returns {Promise<void>}
   */
  async send(input) {
    if (!this.isAlive || !this.ptyProcess) {
      throw new Error('PTY process is not running');
    }
    // 現在のバッファをクリア（新しい出力のみ取得するため）
    this.outputBuffer = '';

    // Escキーを送信してコマンドモードに入る（もし編集モードの場合）
    this.ptyProcess.write('\x1b');  // ESC
    await this._delay(50);

    // Ctrl+Uで現在の入力行をクリア
    this.ptyProcess.write('\x15');  // Ctrl+U: 行クリア
    await this._delay(50);

    // 文字を一文字ずつ少し遅延を入れて送信
    // Codex CLIのTUIは高速な入力を処理しきれない場合がある
    for (const char of input) {
      this.ptyProcess.write(char);
      await this._delay(10);  // 10ms遅延
    }

    // 改行を送信して実行
    await this._delay(50);
    this.ptyProcess.write('\r');
  }

  /**
   * 遅延を入れるユーティリティ
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 出力を収集（アイドルタイムアウト + 絶対タイムアウト）
   * @param {number} idleTimeoutMs - 出力がない状態が続く最大時間（ミリ秒）
   * @param {number} checkIntervalMs - チェック間隔（ミリ秒）
   * @param {number} maxTimeoutMs - 絶対タイムアウト（ミリ秒）- この時間を超えたら強制終了
   * @returns {Promise<string>} - ANSIエスケープを除去した出力
   */
  async collectOutput(idleTimeoutMs = 30000, checkIntervalMs = 500, maxTimeoutMs = 600000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastOutputLength = this.outputBuffer.length;
      let noChangeCount = 0;
      const maxNoChangeChecks = Math.ceil(idleTimeoutMs / checkIntervalMs);

      // 絶対タイムアウト用のタイマー
      const maxTimeoutTimer = setTimeout(() => {
        clearInterval(checkInterval);
        const output = stripAnsi(this.outputBuffer);
        resolve(output);
      }, maxTimeoutMs);

      const checkInterval = setInterval(() => {
        const currentLength = this.outputBuffer.length;
        const elapsed = Date.now() - startTime;

        // 絶対タイムアウトチェック（念のため）
        if (elapsed >= maxTimeoutMs) {
          clearInterval(checkInterval);
          clearTimeout(maxTimeoutTimer);
          const output = stripAnsi(this.outputBuffer);
          resolve(output);
          return;
        }

        if (currentLength === lastOutputLength) {
          noChangeCount++;
          // 出力がidleTimeoutMs間変化しなければ完了と判定
          if (noChangeCount >= maxNoChangeChecks) {
            clearInterval(checkInterval);
            clearTimeout(maxTimeoutTimer);
            const output = stripAnsi(this.outputBuffer);
            resolve(output);
          }
        } else {
          // 新しい出力があればカウンターをリセット
          lastOutputLength = currentLength;
          noChangeCount = 0;
        }

        // プロセスが終了した場合も完了
        if (!this.isAlive) {
          clearInterval(checkInterval);
          clearTimeout(maxTimeoutTimer);
          const output = stripAnsi(this.outputBuffer);
          resolve(output);
        }
      }, checkIntervalMs);
    });
  }

  /**
   * プロセスを終了
   */
  kill() {
    if (this.ptyProcess && this.isAlive) {
      // Ctrl+C を送信してから終了
      this.ptyProcess.write('\x03');
      setTimeout(() => {
        if (this.ptyProcess) {
          this.ptyProcess.kill();
        }
      }, 500);
    }
    this.isAlive = false;
  }

  /**
   * セッション情報を取得
   * @returns {object} セッション情報
   */
  getSessionInfo() {
    return {
      session_id: this.sessionId,
      log_path: this.options.logPath,
      started_at: this.startedAt,
      search_enabled: this.options.search,
      is_alive: this.isAlive,
    };
  }
}

/**
 * 新しいセッションIDを生成
 * @returns {string} UUID形式のセッションID
 */
export function generateSessionId() {
  return uuidv4();
}
