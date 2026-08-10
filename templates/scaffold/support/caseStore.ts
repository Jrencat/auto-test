/**
 * caseStore —— 测试用例资产（.auto-test/cases）的读取、解析与最小化回写。
 *
 * 职责（对应 rules/case-store-rule.md 与 rules/test-data-rule.md）：
 *  1. 解析 Case Markdown 的 YAML Frontmatter（容错、保留未知字段）。
 *  2. 解析正文中的「测试数据明细」表（Test Data Matrix）→ Data Group → 供 Playwright 参数化执行。
 *  3. 最小化回写 Frontmatter（只改指定字段，不重写正文、不删未知字段）。
 *  4. 记录执行结果到 .auto-test/reports/<RunId>.jsonl，供报告阶段精确追踪。
 *
 * 本模块**自包含**：不依赖 env.ts / Playwright，可用 `node tests/support/caseStore.ts <cmd>` 直接调用（Node ≥ 22）。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

/** Case 生命周期状态（持久化测试资产），与执行结果 ExecutionResult 是两个维度 */
export type CaseStatus = 'pending_review' | 'ready' | 'running' | 'completed' | 'failed';

/** 单次执行结果（不写入 status，写入 last_run_status 与 Run Report） */
export type ExecutionResult = 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED';

/** 失败类型：业务断言失败 vs 自动化异常，二者不得混为一谈 */
export type FailureType = 'Assertion Failure' | 'Automation Error' | 'Environment' | 'Test Data' | 'Blocked';

export const CASE_STATUSES: CaseStatus[] = ['pending_review', 'ready', 'running', 'completed', 'failed'];

/** 合法状态转换表（rules/case-store-rule.md §状态机） */
export const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  pending_review: ['ready'],
  ready: ['running'],
  running: ['completed', 'failed'],
  completed: ['ready', 'running'],
  failed: ['ready', 'running'],
};

/** 待人工补充的数据占位符，出现则该 Case 不得进入 ready */
export const PLACEHOLDERS = ['TODO', 'REQUIRED_INPUT'];

export interface Frontmatter {
  id: string;
  title: string;
  status: CaseStatus;
  [key: string]: unknown;
}

export interface DataRow {
  /** 数据组 ID，如 D001 */
  groupId: string;
  /** 字段名称 */
  field: string;
  /** 具体测试输入（原样保留，仅去掉包裹的 code span 与首尾空格） */
  value: string;
  /** 数据类型，如 string / number */
  dataType: string;
  /** 数据特征/类型，如 正常值 / 超长 / XSS Payload */
  trait: string;
  /** 预期校验结果 */
  expected: string;
  /** 该行在表中的序号（从 0 起），用于报告定位 */
  index: number;
}

export interface DataGroup {
  /** 数据组 ID，如 D001 */
  id: string;
  /** 字段名 → 具体测试输入。同一数据组的多行合并为一次完整参数化输入 */
  input: Record<string, string>;
  /** 组内原始行 */
  rows: DataRow[];
  /** 组内非空预期结果（去重后按出现顺序拼接） */
  expected: string;
  /** 组内出现的数据特征（去重） */
  traits: string[];
  /** 是否含 TODO / REQUIRED_INPUT 占位符 */
  hasPlaceholder: boolean;
}

export interface TestCaseFile {
  /** Case 文件绝对路径 */
  file: string;
  frontmatter: Frontmatter;
  /** Frontmatter 之后的正文原文 */
  body: string;
  /** 解析出的数据组（按首次出现顺序） */
  dataGroups: DataGroup[];
}

export interface RunRecord {
  runId: string;
  caseId: string;
  caseTitle?: string;
  groupId: string;
  input: Record<string, string>;
  expected: string;
  actual: string;
  result: ExecutionResult;
  failureType?: FailureType;
  error?: string;
  durationMs?: number;
  specFile?: string;
  at: string;
}

/* ------------------------------------------------------------------ *
 * 路径解析
 * ------------------------------------------------------------------ */

function parseDotEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const rawLine of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = val;
  }
  return out;
}

/** 本模块所在目录。CJS（Playwright 默认）下取 `__dirname`；ESM/直接 node 运行时回退到 cwd */
function moduleDir(): string {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
}

/** 从起点逐级向上查找含 `.auto-test` 的目录，返回该 `.auto-test` 绝对路径；找不到返回空串 */
function findAutoTestRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, '.auto-test');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/**
 * 解析 `.auto-test` 根目录。优先级：
 * 1. 环境变量 `AUTO_TEST_DIR`
 * 2. `tests/.env.test` 的 `AUTO_TEST_DIR`
 * 3. 从本文件所在目录逐级向上查找已存在的 `.auto-test`
 * 4. 从 `process.cwd()` 逐级向上查找
 * 5. 兜底：`<cwd>/.auto-test`
 */
export function resolveAutoTestDir(): string {
  const fromEnv = process.env.AUTO_TEST_DIR || parseDotEnvFile(resolve(moduleDir(), '..', '.env.test')).AUTO_TEST_DIR;
  if (fromEnv) return resolve(fromEnv);
  return findAutoTestRoot(moduleDir()) || findAutoTestRoot(process.cwd()) || resolve(process.cwd(), '.auto-test');
}

export function resolveCaseDir(): string {
  return process.env.AUTO_TEST_CASE_DIR
    ? resolve(process.env.AUTO_TEST_CASE_DIR)
    : join(resolveAutoTestDir(), 'cases');
}

export function resolveReportDir(): string {
  return process.env.AUTO_TEST_REPORT_DIR
    ? resolve(process.env.AUTO_TEST_REPORT_DIR)
    : join(resolveAutoTestDir(), 'reports');
}

/* ------------------------------------------------------------------ *
 * Frontmatter 解析
 * ------------------------------------------------------------------ */

function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function coerceScalar(raw: string): unknown {
  const v = stripQuotes(raw);
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/** 切分 Frontmatter 与正文；无 Frontmatter 时 raw 为空串 */
function splitFrontmatter(text: string): { raw: string; body: string } {
  // 容错：允许 BOM、允许 --- 前后有空白、允许 CRLF
  const normalized = text.replace(/^﻿/, '');
  const match = /^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) return { raw: '', body: normalized };
  return { raw: match[1], body: normalized.slice(match[0].length) };
}

/** 解析 Frontmatter 为对象。仅支持顶层 `key: value` 与顶层 `- ` 列表，未知字段原样保留 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let currentListKey = '';
  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const listItem = /^[ \t]*-[ \t]+(.*)$/.exec(rawLine);
    if (listItem && currentListKey) {
      (out[currentListKey] as unknown[]).push(coerceScalar(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/.exec(rawLine);
    if (!kv) continue; // 容错：无法识别的行忽略，不使解析失败
    const [, key, valuePart] = kv;
    if (valuePart.trim() === '') {
      out[key] = [];
      currentListKey = key;
    } else {
      out[key] = coerceScalar(valuePart);
      currentListKey = '';
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Test Data Matrix 解析
 * ------------------------------------------------------------------ */

/** 按未转义的 `|` 切分表格行，并还原 `\|` */
function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf);
  // 去掉行首/行尾竖线产生的空单元格
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

/** 单元格归一化：去首尾空格；整体被 code span 包裹时去掉反引号（内部内容原样保留） */
export function normalizeCell(cell: string): string {
  const trimmed = cell.trim();
  const code = /^(`+)([\s\S]*)\1$/.exec(trimmed);
  const value = code ? code[2] : trimmed;
  // 仅去掉 code span 引入的一层包裹空格，不改变数据本身的可见字符
  return code ? value.replace(/^ (.*) $/, '$1') : value;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

type ColumnKey = 'groupId' | 'field' | 'value' | 'dataType' | 'trait' | 'expected';

/** 表头 → 列语义映射（中英文别名，按优先级判定，容忍「数据特征/类型」这类复合表头） */
function detectColumn(header: string, taken: Set<ColumnKey>): ColumnKey | '' {
  const h = header.trim().toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => h.includes(k.toLowerCase()));
  const pick = (key: ColumnKey): ColumnKey | '' => (taken.has(key) ? '' : key);
  if (has('数据组', 'group')) return pick('groupId');
  if (has('字段', 'field')) return pick('field');
  if (has('输入', '取值', 'value', 'input')) return pick('value');
  if (has('预期', 'expect')) return pick('expected');
  if (has('特征', 'trait', 'characteristic')) return pick('trait');
  if (has('数据类型', 'datatype')) return pick('dataType');
  if (has('类型', 'type')) return pick('dataType');
  return '';
}

/**
 * 从正文解析 Test Data Matrix。
 * 识别第一张同时含「数据组」「字段」「输入」语义列的表；无则返回空数组（不抛错）。
 */
export function parseDataMatrix(body: string): DataGroup[] {
  const lines = body.split(/\r?\n/);
  let headerIdx = -1;
  let columns: (ColumnKey | '')[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('|')) continue;
    const cells = splitTableRow(lines[i]);
    if (cells.length < 3 || isSeparatorRow(cells)) continue;
    const taken = new Set<ColumnKey>();
    const mapped = cells.map((c) => {
      const key = detectColumn(c, taken);
      if (key) taken.add(key);
      return key;
    });
    if (taken.has('groupId') && taken.has('field') && taken.has('value')) {
      headerIdx = i;
      columns = mapped;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const groups = new Map<string, DataGroup>();
  let rowIndex = 0;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('|')) {
      if (line.trim() === '') continue; // 容忍表中空行
      break; // 表结束
    }
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length < 2) break;

    const get = (key: ColumnKey): string => {
      const idx = columns.indexOf(key);
      return idx === -1 || idx >= cells.length ? '' : normalizeCell(cells[idx]);
    };
    const groupId = get('groupId');
    const field = get('field');
    if (!groupId || !field) continue; // 容错：跳过缺关键列的行，不影响其余数据

    const row: DataRow = {
      groupId,
      field,
      value: get('value'),
      dataType: get('dataType'),
      trait: get('trait'),
      expected: get('expected'),
      index: rowIndex,
    };
    rowIndex += 1;

    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, input: {}, rows: [], expected: '', traits: [], hasPlaceholder: false };
      groups.set(groupId, group);
    }
    group.rows.push(row);
    group.input[row.field] = row.value;
    if (row.expected && row.expected !== '-' && !group.expected.includes(row.expected)) {
      group.expected = group.expected ? `${group.expected}; ${row.expected}` : row.expected;
    }
    if (row.trait && row.trait !== '-' && !group.traits.includes(row.trait)) group.traits.push(row.trait);
    if (PLACEHOLDERS.includes(row.value.trim().toUpperCase())) group.hasPlaceholder = true;
  }

  return [...groups.values()];
}

/* ------------------------------------------------------------------ *
 * Case 读取
 * ------------------------------------------------------------------ */

export function parseCaseFile(file: string): TestCaseFile {
  const text = readFileSync(file, 'utf-8');
  const { raw, body } = splitFrontmatter(text);
  const fm = parseFrontmatter(raw) as Frontmatter;
  return {
    file: resolve(file),
    frontmatter: fm,
    body,
    dataGroups: parseDataMatrix(body),
  };
}

/** 读取用例目录下全部 Case（按文件名排序）；目录不存在返回空数组 */
export function loadCases(dir: string = resolveCaseDir()): TestCaseFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort()
    .map((f) => parseCaseFile(join(dir, f)))
    .filter((c) => Boolean(c.frontmatter && c.frontmatter.id));
}

export function loadCasesByStatus(status: CaseStatus, dir: string = resolveCaseDir()): TestCaseFile[] {
  return loadCases(dir).filter((c) => c.frontmatter.status === status);
}

/** 供 Playwright 参数化：只取已审核（ready）或执行中断后需重跑（running）的用例 */
export function loadExecutableCases(dir: string = resolveCaseDir()): TestCaseFile[] {
  return loadCases(dir).filter((c) => c.frontmatter.status === 'ready' || c.frontmatter.status === 'running');
}

/* ------------------------------------------------------------------ *
 * Frontmatter 最小化回写
 * ------------------------------------------------------------------ */

function serializeScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    // 仅在可能被 YAML 误解析时加引号
    return /^[\s]|[:#]\s|^[\s]*$|^(true|false|null|~)$|^-?\d+$/.test(value) ? JSON.stringify(value) : value;
  }
  return String(value);
}

/**
 * 最小化更新 Frontmatter：
 * - 已存在的键：只替换该行的值，保留键顺序与原有格式；
 * - 不存在的键：追加到 Frontmatter 末尾；
 * - 正文、未知字段、人工注释一律不动；
 * - 文件无 Frontmatter 时在文件头补一个（仅含 patch 字段）。
 */
export function updateFrontmatter(file: string, patch: Record<string, unknown>): void {
  const text = readFileSync(file, 'utf-8').replace(/^﻿/, '');
  const { raw, body } = splitFrontmatter(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  if (!raw) {
    const lines = Object.entries(patch).map(([k, v]) => `${k}: ${serializeScalar(v)}`);
    writeFileSync(file, `---${eol}${lines.join(eol)}${eol}---${eol}${body}`, 'utf-8');
    return;
  }

  const remaining = new Map(Object.entries(patch));
  const updated = raw.split(/\r?\n/).map((line) => {
    const kv = /^([A-Za-z0-9_.-]+)([ \t]*:[ \t]*)(.*)$/.exec(line);
    if (!kv) return line;
    const key = kv[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}: ${serializeScalar(value)}`;
  });
  for (const [key, value] of remaining) updated.push(`${key}: ${serializeScalar(value)}`);

  writeFileSync(file, `---${eol}${updated.join(eol)}${eol}---${eol}${body}`, 'utf-8');
}

/** 当前时间的本地 ISO 表示（含时区偏移），与 Frontmatter 里的 created_at 风格一致 */
export function nowIso(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

/** 校验状态转换是否合法（rules/case-store-rule.md §状态机） */
export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/**
 * 按状态机推进 Case 状态并回写（最小化）。
 * 非法转换直接抛错——尤其阻止 `pending_review → running`（绕过人工审核）。
 */
export function setCaseStatus(
  file: string,
  next: CaseStatus,
  extra: Record<string, unknown> = {},
  now: string = nowIso(),
): void {
  const current = parseCaseFile(file).frontmatter.status;
  if (current && !canTransition(current, next)) {
    throw new Error(`非法状态转换：${current} → ${next}（${file}）`);
  }
  updateFrontmatter(file, { status: next, updated_at: now, ...extra });
}

/* ------------------------------------------------------------------ *
 * Run 记录（供报告阶段精确追踪 Case → Data Group → 输入 → 结果）
 * ------------------------------------------------------------------ */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 生成执行批次 ID：RUN-YYYYMMDD-HHMMSS（本地时间） */
export function makeRunId(date: Date = new Date()): string {
  return [
    'RUN-',
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/** 当前进程的 Run ID：优先取 `AUTO_TEST_RUN_ID`（由编排层统一下发），否则按启动时间生成 */
export const RUN_ID: string = process.env.AUTO_TEST_RUN_ID || makeRunId();

/** 追加一条执行记录到 `.auto-test/reports/<RunId>.jsonl`（JSONL，便于报告阶段聚合） */
export function recordResult(record: Omit<RunRecord, 'runId' | 'at'> & Partial<Pick<RunRecord, 'runId' | 'at'>>): void {
  const dir = resolveReportDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const full: RunRecord = {
    runId: record.runId || RUN_ID,
    at: record.at || nowIso(),
    ...record,
  } as RunRecord;
  appendFileSync(join(dir, `${full.runId}.jsonl`), `${JSON.stringify(full)}\n`, 'utf-8');
}

/** 读回某批次的全部执行记录（报告生成用） */
export function readRunRecords(runId: string = RUN_ID): RunRecord[] {
  const file = join(resolveReportDir(), `${runId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRecord);
}

/* ------------------------------------------------------------------ *
 * CLI：node tests/support/caseStore.ts <cmd>（Node ≥ 22，供编排层直接调用）
 * ------------------------------------------------------------------ */

function cli(argv: string[]): void {
  const [cmd, ...rest] = argv;
  if (cmd === 'list') {
    const statusFlag = rest.indexOf('--status');
    const cases = statusFlag === -1 ? loadCases() : loadCasesByStatus(rest[statusFlag + 1] as CaseStatus);
    console.log(
      JSON.stringify(
        cases.map((c) => ({
          file: c.file,
          id: c.frontmatter.id,
          title: c.frontmatter.title,
          status: c.frontmatter.status,
          dataGroups: c.dataGroups.map((g) => g.id),
          hasPlaceholder: c.dataGroups.some((g) => g.hasPlaceholder),
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === 'show') {
    console.log(JSON.stringify(parseCaseFile(rest[0]), null, 2));
    return;
  }
  if (cmd === 'set') {
    const [file, ...pairs] = rest;
    const patch: Record<string, unknown> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq > 0) patch[pair.slice(0, eq)] = coerceScalar(pair.slice(eq + 1));
    }
    updateFrontmatter(file, patch);
    console.log(`updated ${file}: ${JSON.stringify(patch)}`);
    return;
  }
  if (cmd === 'status') {
    setCaseStatus(rest[0], rest[1] as CaseStatus);
    console.log(`${rest[0]} → ${rest[1]}`);
    return;
  }
  if (cmd === 'run-id') {
    console.log(makeRunId());
    return;
  }
  console.log('usage: caseStore.ts list [--status ready] | show <file> | set <file> k=v... | status <file> <state> | run-id');
}

// 仅在被直接执行时进入 CLI（兼容 CJS / ESM，被 Playwright import 时不触发）
const entryFile = process.argv[1] ? resolve(process.argv[1]) : '';
if (/caseStore\.(ts|js|cjs|mjs)$/.test(entryFile)) cli(process.argv.slice(2));
