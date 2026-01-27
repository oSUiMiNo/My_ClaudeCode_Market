#!/usr/bin/env node
// archive-logs.mjs - 古いログファイルをアーカイブに移動
// 条件: 最終更新から7日以上経過 または 1000行超過

import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');
const ARCHIVE_DIR = join(LOGS_DIR, '_archive');

// 設定（環境変数で上書き可能）
const MAX_AGE_DAYS = parseInt(process.env.CODEX_ARCHIVE_DAYS, 10) || 7;  // デフォルト7日
const MAX_LINES = parseInt(process.env.CODEX_ARCHIVE_LINES, 10) || 1000;

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function shouldArchive(filePath, filename) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').length;
  const stats = statSync(filePath);

  // mtime（最終更新日時）ベースで経過日数を計算
  const ageMs = Date.now() - stats.mtimeMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  const reasons = [];
  if (ageDays >= MAX_AGE_DAYS) {
    reasons.push(`最終更新から${ageDays.toFixed(1)}日経過`);
  }
  if (lines > MAX_LINES) {
    reasons.push(`${lines}行`);
  }

  return {
    shouldArchive: reasons.length > 0,
    reasons,
    ageDays: ageDays.toFixed(1),
    lines
  };
}

function archiveLogs() {
  // ログディレクトリが存在しない場合は即終了
  if (!existsSync(LOGS_DIR)) {
    output({ success: true, archived: [], message: 'No logs directory' });
    return;
  }

  // LOGS_DIR が存在する場合のみ _archive を作成
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const files = readdirSync(LOGS_DIR);
  const archived = [];

  for (const file of files) {
    // 除外: _TEMPLATE.md, _archive ディレクトリ, .で始まるファイル
    if (file === '_TEMPLATE.md' || file === '_archive' || file.startsWith('.')) {
      continue;
    }

    // .md ファイルのみ対象
    if (!file.endsWith('.md')) {
      continue;
    }

    const filePath = join(LOGS_DIR, file);

    // ディレクトリはスキップ
    if (statSync(filePath).isDirectory()) {
      continue;
    }

    const check = shouldArchive(filePath, file);
    if (check.shouldArchive) {
      // 衝突対策: 同名ファイルが既に存在する場合は連番を付加
      let destPath = join(ARCHIVE_DIR, file);
      let destFile = file;
      let counter = 1;
      while (existsSync(destPath)) {
        const ext = '.md';
        const base = file.slice(0, -ext.length);
        destFile = `${base}_${counter}${ext}`;
        destPath = join(ARCHIVE_DIR, destFile);
        counter++;
      }
      renameSync(filePath, destPath);
      archived.push({
        file: destFile,
        originalFile: file !== destFile ? file : undefined,
        reasons: check.reasons
      });
    }
  }

  output({
    success: true,
    archived,
    message: archived.length > 0
      ? `${archived.length}件のログをアーカイブしました`
      : 'アーカイブ対象なし'
  });
}

archiveLogs();
