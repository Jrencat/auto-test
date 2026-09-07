/**
 * evidence-store —— Evidence 一等实体：登记、Manifest、SHA256 完整性校验。
 *
 * 核心边界（`policy-and-diagnostics.md` §2）：
 *   **Evidence 证明发生了什么，不判断是否满足需求。**
 * 本模块不参与任何 PASS/FAIL 判定，只回答两个问题：
 *   1. 这份证据登记过吗？
 *   2. 它现在还和登记时一模一样吗？
 *
 * 证据文件默认**复制进 Run 目录**，使 Run 自包含、可整体归档；
 * Manifest（含 sha256）入 Git，二进制文件本身不入 Git。
 */
import { copyFileSync, existsSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { EVIDENCE_TYPES, SCHEMA_VERSION } from './constants.mjs';
import { runLayout } from './paths.mjs';
import {
  assertOneOf,
  ensureDir,
  fail,
  fileSize,
  nowIso,
  readJson,
  sha256File,
  shortId,
  writeJson,
} from './util.mjs';

function emptyManifest(runId) {
  return { schema_version: SCHEMA_VERSION, run_id: runId, evidence: [] };
}

export function loadManifest(runId, opts = {}) {
  return readJson(runLayout(runId, opts).manifest, emptyManifest(runId));
}

function saveManifest(runId, manifest, opts = {}) {
  writeJson(runLayout(runId, opts).manifest, manifest);
  return manifest;
}

/**
 * 登记一份证据。
 *
 * @param {string} runId
 * @param {object} spec  { type, file, attemptId, stepId, copy }
 * @returns {object} evidence 条目（含 sha256）
 */
export function registerEvidence(runId, { type, file, attemptId = null, stepId = null, copy = true }, opts = {}) {
  assertOneOf(type, EVIDENCE_TYPES, 'evidence type');
  const source = resolve(file);
  if (!existsSync(source)) {
    fail(`证据文件不存在：${source}`, 'EVIDENCE_FILE_NOT_FOUND');
  }

  const paths = runLayout(runId, opts);
  const evidenceId = shortId('ev');
  let storedAbs = source;

  if (copy) {
    ensureDir(paths.evidence);
    const ext = extname(source) || '';
    // 文件名内嵌证据类型（`ev_xxx.screenshot.png`），使 .gitignore 能按类型精确排除
    // 二进制证据（screenshot / trace / video），而文本类证据照常入库。
    storedAbs = join(paths.evidence, `${evidenceId}.${type}${ext}`);
    copyFileSync(source, storedAbs);
  }

  const entry = {
    evidence_id: evidenceId,
    type,
    // 相对 Run 目录，使整个 Run 目录可移动/归档
    path: copy ? relative(paths.dir, storedAbs).split('\\').join('/') : storedAbs.split('\\').join('/'),
    absolute: !copy,
    original_name: basename(source),
    sha256: sha256File(storedAbs),
    size: fileSize(storedAbs),
    attempt_id: attemptId,
    step_id: stepId,
    created_at: nowIso(),
  };

  const manifest = loadManifest(runId, opts);
  manifest.evidence.push(entry);
  saveManifest(runId, manifest, opts);
  return entry;
}

/** 把 Manifest 中的相对路径还原为绝对路径。 */
export function resolveEvidencePath(runId, entry, opts = {}) {
  const paths = runLayout(runId, opts);
  return entry.absolute ? entry.path : resolve(paths.dir, entry.path);
}

/**
 * 完整性校验：对每条证据重新计算 SHA256 并与登记值比对。
 *
 * 返回 { ok, checked, missing[], mismatched[] }。
 * 文件被替换或篡改 → mismatched；文件被删除 → missing。两者都会让 Run 判为 INVALID。
 */
export function verifyEvidence(runId, opts = {}) {
  const manifest = loadManifest(runId, opts);
  const missing = [];
  const mismatched = [];

  for (const entry of manifest.evidence) {
    const abs = resolveEvidencePath(runId, entry, opts);
    const actual = sha256File(abs);
    if (actual === null) {
      missing.push({ evidence_id: entry.evidence_id, path: entry.path });
      continue;
    }
    if (actual !== entry.sha256) {
      mismatched.push({
        evidence_id: entry.evidence_id,
        path: entry.path,
        expected_sha256: entry.sha256,
        actual_sha256: actual,
      });
    }
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    checked: manifest.evidence.length,
    missing,
    mismatched,
  };
}

/** 按 attempt 分组统计证据类型，供 Evidence Policy 判定使用。 */
export function evidenceByAttempt(runId, opts = {}) {
  const manifest = loadManifest(runId, opts);
  const map = new Map();
  for (const entry of manifest.evidence) {
    const key = entry.attempt_id || '__run__';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

export function findEvidence(runId, evidenceId, opts = {}) {
  return loadManifest(runId, opts).evidence.find((e) => e.evidence_id === evidenceId) || null;
}
