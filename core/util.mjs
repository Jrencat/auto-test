/**
 * util —— Core 的零依赖基础设施：原子写、JSONL 追加、SHA256、ID、时间。
 *
 * 全部同步 API：Harness 的写入必须在返回前落盘，异步会引入"事件已记录但进程崩溃时丢失"的窗口，
 * 而"崩溃后磁盘仍有事实"正是 2.0 要保证的能力之一。
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Harness 的受控错误。CLI 捕获后转成退出码，不打印堆栈。 */
export class HarnessError extends Error {
  constructor(message, code = 'HARNESS_ERROR') {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

export function fail(message, code) {
  throw new HarnessError(message, code);
}

/* ------------------------------------------------------------------ *
 * 时间与 ID
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

/** 本地 ISO 时间（含时区偏移），与 v1.x Case Frontmatter 的 created_at 风格一致。 */
export function nowIso(date = new Date()) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 执行批次 ID：RUN-YYYYMMDD-HHMMSS（沿用 v1.x 命名，历史报告可继续对照）。 */
export function makeRunId(date = new Date()) {
  return (
    `RUN-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Attempt ID：A001、A002…… 序号即执行顺序，永不复用。 */
export function makeAttemptId(sequence) {
  return `A${String(sequence).padStart(3, '0')}`;
}

/** 短随机 ID，用于 Evidence / Event 等不需要语义顺序的实体。 */
export function shortId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-6);
  return `${prefix}_${time}${rand}`;
}

/* ------------------------------------------------------------------ *
 * 文件系统
 * ------------------------------------------------------------------ */

export function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 原子写：先写 `.tmp` 再 rename。
 * 避免进程在写入中途崩溃时留下半个 JSON —— 那会让整个 Run 不可读。
 */
export function writeFileAtomic(file, content) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, file);
}

export function writeJson(file, data) {
  writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function readJson(file, fallback = null) {
  if (!existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    fail(`JSON 解析失败：${file}（${e.message}）`, 'CORRUPT_JSON');
  }
  return fallback;
}

/** 追加一行 JSONL。事件流只追加、不重写——历史事实不可篡改。 */
export function appendJsonl(file, record) {
  ensureDir(dirname(file));
  appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf-8');
}

export function readJsonl(file) {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        fail(`JSONL 第 ${i + 1} 行解析失败：${file}（${e.message}）`, 'CORRUPT_JSONL');
      }
      return null;
    });
}

/* ------------------------------------------------------------------ *
 * 完整性
 * ------------------------------------------------------------------ */

/** 计算文件 SHA256。文件不存在返回 null（由调用方判定是 missing 还是 mismatch）。 */
export function sha256File(file) {
  if (!existsSync(file)) {
    return null;
  }
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function fileSize(file) {
  return existsSync(file) ? statSync(file).size : null;
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

/** 断言取值在枚举内，否则抛 HarnessError（CLI 会转成用法错误）。 */
export function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    fail(`${label} 取值非法：${JSON.stringify(value)}；合法取值 ${allowed.join(' | ')}`, 'BAD_VALUE');
  }
  return value;
}

export function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} 不能为空`, 'BAD_VALUE');
  }
  return value.trim();
}
