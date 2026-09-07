/**
 * case-store —— Test Case 一等实体的读写、Assertion 定义与生命周期状态机。
 *
 * 兼容性是本模块的第一约束：磁盘格式仍是 v1.x 的「Markdown + YAML Frontmatter」，
 * 已有 Case 无需迁移即可被 Core 读取。2.0 只增加两样东西：
 *   1. `## 断言定义` 表（Assertion 一等实体）
 *   2. `schema_version` 字段
 *
 * 人工修改保护（v1.x 已验证有效，原样保留）：
 *   - 回写一律**最小化**：只替换指定的 Frontmatter 行，正文与未知字段原样透传；
 *   - 绝不重写整个文件、绝不删除人工新增的字段与章节。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  CASE_STATUS,
  CASE_STATUSES,
  CASE_TRANSITIONS,
  LEGACY_NO_ASSERTION,
  SCHEMA_VERSION,
  normalizeCaseStatus,
} from './constants.mjs';
import { caseFile, layout } from './paths.mjs';
import { fail, nowIso, requireString, writeFileAtomic } from './util.mjs';

/** 待人工补充的数据占位符；出现则该 Case 不具备可执行性。 */
export const PLACEHOLDERS = ['TODO', 'REQUIRED_INPUT'];

/**
 * 合法 Case ID：字母、数字、下划线、点、连字符。
 * 不允许路径分隔符与 `..` —— Case ID 会直接拼进文件名，
 * 放任 `../../x` 会让写入逃逸出资产目录。
 */
const CASE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** 校验并返回规范化的 Case ID；非法直接抛错。 */
export function assertValidCaseId(caseId) {
  const id = requireString(caseId, 'case_id');
  if (!CASE_ID_PATTERN.test(id) || id.includes('..')) {
    fail(
      `Case ID 非法：${JSON.stringify(caseId)}。只允许字母/数字/下划线/点/连字符，且不得包含 ".."`,
      'BAD_CASE_ID',
    );
  }
  return id;
}

const SECTION = {
  PURPOSE: '测试目标',
  PRECONDITIONS: '前置条件',
  STEPS: '测试步骤',
  DATA: '测试数据明细',
  ASSERTIONS: '断言定义',
};

/* ------------------------------------------------------------------ *
 * Frontmatter（自 v1.x caseStore.ts 移植，容错行为保持一致）
 * ------------------------------------------------------------------ */

function stripQuotes(raw) {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function coerceScalar(raw) {
  const v = stripQuotes(raw);
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function serializeScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return /^[\s]|[:#]\s|^[\s]*$|^(true|false|null|~)$|^-?\d+$/.test(value) ? JSON.stringify(value) : value;
  }
  return String(value);
}

/** 切分 Frontmatter 与正文；无 Frontmatter 时 raw 为空串。容忍 BOM / CRLF。 */
function splitFrontmatter(text) {
  const normalized = text.replace(/^﻿/, '');
  const match = /^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) {
    return { raw: '', body: normalized };
  }
  return { raw: match[1], body: normalized.slice(match[0].length) };
}

/** 仅支持顶层 `key: value` 与顶层 `- ` 列表；未知字段原样保留，无法识别的行忽略。 */
export function parseFrontmatter(raw) {
  const out = {};
  let currentListKey = '';
  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const listItem = /^[ \t]*-[ \t]+(.*)$/.exec(rawLine);
    if (listItem && currentListKey) {
      out[currentListKey].push(coerceScalar(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/.exec(rawLine);
    if (!kv) continue;
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
 * Markdown 表格
 * ------------------------------------------------------------------ */

/** 按未转义的 `|` 切分表格行，并还原 `\|`。 */
function splitTableRow(line) {
  const cells = [];
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
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

/** 去首尾空格；整体被 code span 包裹时去掉反引号，内部内容原样保留。 */
function normalizeCell(cell) {
  const trimmed = cell.trim();
  const code = /^(`+)([\s\S]*)\1$/.exec(trimmed);
  const value = code ? code[2] : trimmed;
  return code ? value.replace(/^ (.*) $/, '$1') : value;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

/**
 * 解析一段文本中的第一张表，返回 { header: string[], rows: string[][] }。
 * `detect` 用于判断某行是否是想要的表头。
 */
function parseFirstTable(text, detect) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('|')) continue;
    const header = splitTableRow(lines[i]).map(normalizeCell);
    if (header.length < 2 || isSeparatorRow(header) || !detect(header)) continue;

    const rows = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.includes('|')) {
        if (line.trim() === '') continue;
        break;
      }
      const cells = splitTableRow(line).map(normalizeCell);
      if (isSeparatorRow(cells)) continue;
      if (cells.length < 2) break;
      rows.push(cells);
    }
    return { header, rows };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 正文章节
 * ------------------------------------------------------------------ */

/**
 * 取 `## <name>` 到下一个同级标题之间的正文。
 *
 * 按行扫描而非正则：正则要同时表达"到下一个 ## 或文件末尾"，在 JS 里没有 `\Z`，
 * 用 lookahead 拼容易在**最后一个章节**上静默失配（断言表恰好常在末尾）。
 */
function section(body, name) {
  const lines = body.split(/\r?\n/);
  const isHeading = (line) => /^##[ \t]+/.test(line);
  const start = lines.findIndex((line) => isHeading(line) && line.includes(name));
  if (start === -1) {
    return '';
  }
  const rest = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isHeading(lines[i])) break;
    rest.push(lines[i]);
  }
  return rest.join('\n').trim();
}

/** 从「测试步骤」章节提取编号步骤。 */
function parseSteps(body) {
  const text = section(body, SECTION.STEPS);
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)、]\s*/.test(l) || /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^\d+[.)、]\s*/, '').replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Test Data Matrix
 * ------------------------------------------------------------------ */

const DATA_COLUMNS = [
  ['groupId', ['数据组', 'group']],
  ['field', ['字段', 'field']],
  ['value', ['输入', '取值', 'value', 'input']],
  ['expected', ['预期', 'expect']],
  ['trait', ['特征', 'trait']],
  ['dataType', ['数据类型', 'datatype']],
];

function mapDataColumns(header) {
  const taken = new Set();
  return header.map((h) => {
    const lower = h.toLowerCase();
    for (const [key, aliases] of DATA_COLUMNS) {
      if (taken.has(key)) continue;
      if (aliases.some((a) => lower.includes(a.toLowerCase()))) {
        taken.add(key);
        return key;
      }
    }
    return '';
  });
}

/** 解析「测试数据明细」为 Data Group 列表；无表则返回空数组（不抛错）。 */
export function parseDataMatrix(body) {
  const table = parseFirstTable(section(body, SECTION.DATA) || body, (header) => {
    const cols = mapDataColumns(header);
    return cols.includes('groupId') && cols.includes('field') && cols.includes('value');
  });
  if (!table) return [];

  const cols = mapDataColumns(table.header);
  const at = (cells, key) => {
    const idx = cols.indexOf(key);
    return idx === -1 || idx >= cells.length ? '' : cells[idx];
  };

  const groups = new Map();
  for (const cells of table.rows) {
    const groupId = at(cells, 'groupId');
    const field = at(cells, 'field');
    if (!groupId || !field) continue;

    if (!groups.has(groupId)) {
      groups.set(groupId, { id: groupId, input: {}, expected: '', traits: [], hasPlaceholder: false });
    }
    const group = groups.get(groupId);
    const value = at(cells, 'value');
    const expected = at(cells, 'expected');
    const trait = at(cells, 'trait');

    group.input[field] = value;
    if (expected && expected !== '-' && !group.expected.includes(expected)) {
      group.expected = group.expected ? `${group.expected}; ${expected}` : expected;
    }
    if (trait && trait !== '-' && !group.traits.includes(trait)) group.traits.push(trait);
    if (PLACEHOLDERS.includes(value.trim().toUpperCase())) group.hasPlaceholder = true;
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ *
 * Assertion 定义
 * ------------------------------------------------------------------ */

const ASSERTION_COLUMNS = [
  ['id', ['断言 id', '断言id', 'assertion', 'id']],
  ['layer', ['层', 'layer']],
  ['description', ['描述', 'description', '说明']],
  ['required', ['必需', '必填', 'required']],
];

function mapAssertionColumns(header) {
  const taken = new Set();
  return header.map((h) => {
    const lower = h.toLowerCase().trim();
    for (const [key, aliases] of ASSERTION_COLUMNS) {
      if (taken.has(key)) continue;
      if (aliases.some((a) => lower.includes(a.toLowerCase()))) {
        taken.add(key);
        return key;
      }
    }
    return '';
  });
}

function parseRequired(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (['否', 'no', 'false', 'optional', '可选', '0'].includes(v)) return false;
  return true; // 默认必需——宁可严格，不可默认放水
}

/**
 * 解析「断言定义」表。
 * 无该章节 → 返回空数组，Case 即为 LEGACY_NO_ASSERTION（见 isLegacyCase）。
 */
export function parseAssertions(body) {
  const text = section(body, SECTION.ASSERTIONS);
  if (!text) return [];
  const table = parseFirstTable(text, (header) => mapAssertionColumns(header).includes('id'));
  if (!table) return [];

  const cols = mapAssertionColumns(table.header);
  const at = (cells, key) => {
    const idx = cols.indexOf(key);
    return idx === -1 || idx >= cells.length ? '' : cells[idx];
  };

  const out = [];
  const seen = new Set();
  for (const cells of table.rows) {
    const id = at(cells, 'id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      layer: at(cells, 'layer') || 'unspecified',
      description: at(cells, 'description'),
      required: parseRequired(at(cells, 'required')),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

/**
 * 读取并解析一个 Case 文件。
 * 返回的对象同时提供 2.0 字段名（case_id / case_version / …）与原始 frontmatter，
 * 使调用方既能用新词汇，也能访问人工新增的未知字段。
 */
export function parseCaseText(text, file = '') {
  const { raw, body } = splitFrontmatter(text);
  const fm = parseFrontmatter(raw);
  const assertions = parseAssertions(body);

  return {
    file,
    schema_version: fm.schema_version || null,
    case_id: fm.id || (file ? basename(file, '.md') : ''),
    case_version: fm.version ?? 1,
    name: fm.title || '',
    description: section(body, SECTION.PURPOSE),
    preconditions: section(body, SECTION.PRECONDITIONS),
    steps: parseSteps(body),
    test_data: parseDataMatrix(body),
    assertions,
    script_ref: fm.script || null,
    status: fm.status || CASE_STATUS.PENDING_REVIEW,
    created_at: fm.created_at || null,
    updated_at: fm.updated_at || null,
    last_run_id: fm.last_run_id ?? null,
    last_run_status: fm.last_run_status ?? null,
    frontmatter: fm,
    body,
  };
}

export function loadCase(caseId, opts = {}) {
  const file = caseId.endsWith('.md') ? resolve(caseId) : caseFile(assertValidCaseId(caseId), opts);
  if (!existsSync(file)) {
    fail(`Case 不存在：${file}`, 'CASE_NOT_FOUND');
  }
  return parseCaseText(readFileSync(file, 'utf-8'), file);
}

export function listCases(opts = {}) {
  const dir = layout(opts).cases;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort()
    .map((f) => parseCaseText(readFileSync(join(dir, f), 'utf-8'), join(dir, f)))
    .filter((c) => Boolean(c.case_id));
}

/**
 * Legacy 判定：没有任何 Assertion 定义的 Case。
 *
 * 这类 Case 允许读取 / 执行 / 迁移，但其 Run **永远不得** FINALIZED_PASS ——
 * 没有断言就没有"满足需求"的判据，通过与否无从谈起。
 */
export function isLegacyCase(testCase) {
  return !testCase.assertions || testCase.assertions.length === 0;
}

export function caseFlags(testCase) {
  return isLegacyCase(testCase) ? [LEGACY_NO_ASSERTION] : [];
}

/* ------------------------------------------------------------------ *
 * 写入（最小化）
 * ------------------------------------------------------------------ */

/**
 * 最小化更新 Frontmatter：
 * 已存在的键只替换该行的值；不存在的键追加到末尾；正文、未知字段、人工注释一律不动。
 */
export function updateFrontmatter(file, patch) {
  const text = readFileSync(file, 'utf-8').replace(/^﻿/, '');
  const { raw, body } = splitFrontmatter(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  if (!raw) {
    const lines = Object.entries(patch).map(([k, v]) => `${k}: ${serializeScalar(v)}`);
    writeFileAtomic(file, `---${eol}${lines.join(eol)}${eol}---${eol}${body}`);
    return;
  }

  const remaining = new Map(Object.entries(patch));
  const updated = raw.split(/\r?\n/).map((line) => {
    const kv = /^([A-Za-z0-9_.-]+)([ \t]*:[ \t]*)(.*)$/.exec(line);
    if (!kv || !remaining.has(kv[1])) return line;
    const key = kv[1];
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}: ${serializeScalar(value)}`;
  });
  for (const [key, value] of remaining) {
    updated.push(`${key}: ${serializeScalar(value)}`);
  }

  writeFileAtomic(file, `---${eol}${updated.join(eol)}${eol}---${eol}${body}`);
}

const ASSERTION_TABLE_HEADER = [
  '| 断言 ID | 层 | 描述 | 必需 |',
  '|---|---|---|---|',
];

function renderAssertionRow(a) {
  const desc = String(a.description || '').replace(/\|/g, '\\|');
  return `| ${a.id} | ${a.layer || 'unspecified'} | ${desc} | ${a.required === false ? '否' : '是'} |`;
}

/**
 * 新增一条 Assertion 定义（幂等：同 id 已存在则报错，不静默覆盖人工内容）。
 * 章节不存在时在正文末尾追加，不触碰任何既有内容。
 */
export function addAssertion(caseId, assertion, opts = {}) {
  const testCase = loadCase(caseId, opts);
  const id = requireString(assertion.id, 'assertion.id');
  if (testCase.assertions.some((a) => a.id === id)) {
    fail(`Assertion 已存在：${id}（${testCase.case_id}）`, 'ASSERTION_EXISTS');
  }

  const entry = {
    id,
    layer: assertion.layer || 'unspecified',
    description: assertion.description || '',
    required: assertion.required !== false,
  };

  const text = readFileSync(testCase.file, 'utf-8').replace(/^﻿/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const heading = `## ${SECTION.ASSERTIONS}`;
  let next;

  if (text.includes(heading)) {
    // 追加到该表最后一行之后：定位章节内最后一个以 | 开头的行
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim().startsWith(heading));
    let last = start;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith('## ')) break;
      if (lines[i].trim().startsWith('|')) last = i;
    }
    lines.splice(last + 1, 0, renderAssertionRow(entry));
    next = lines.join(eol);
  } else {
    const block = [heading, '', ...ASSERTION_TABLE_HEADER, renderAssertionRow(entry), ''];
    next = `${text.replace(/\s*$/, '')}${eol}${eol}${block.join(eol)}${eol}`;
  }

  writeFileAtomic(testCase.file, next);
  updateFrontmatter(testCase.file, { updated_at: nowIso() });
  return loadCase(caseId, opts);
}

/* ------------------------------------------------------------------ *
 * 创建
 * ------------------------------------------------------------------ */

function renderCaseMarkdown(fields, eol = '\n') {
  const fm = [
    '---',
    `schema_version: ${SCHEMA_VERSION}`,
    `id: ${fields.case_id}`,
    `title: ${serializeScalar(fields.name)}`,
    `status: ${fields.status}`,
    `version: ${fields.case_version}`,
    `created_at: ${fields.created_at}`,
    `updated_at: ${fields.updated_at}`,
    'last_run_id: null',
    'last_run_status: null',
    ...(fields.kind ? [`kind: ${fields.kind}`] : []),
    ...(fields.module ? [`module: ${fields.module}`] : []),
    ...(fields.script_ref ? [`script: ${fields.script_ref}`] : []),
    '---',
  ];

  const body = [
    '',
    `# ${fields.case_id} ${fields.name}`,
    '',
    `## ${SECTION.PURPOSE}`,
    '',
    fields.description || '（待补充）',
    '',
    `## ${SECTION.PRECONDITIONS}`,
    '',
    fields.preconditions || '（待补充）',
    '',
    `## ${SECTION.STEPS}`,
    '',
    ...(fields.steps && fields.steps.length
      ? fields.steps.map((s, i) => `${i + 1}. ${s}`)
      : ['1. （待补充）']),
    '',
    `## ${SECTION.DATA}`,
    '',
    '| 数据组 ID | 字段名称 | 具体测试输入 | 数据类型 | 数据特征/类型 | 预期校验结果 |',
    '|---|---|---|---|---|---|',
    '',
    `## ${SECTION.ASSERTIONS}`,
    '',
    ...ASSERTION_TABLE_HEADER,
    ...(fields.assertions || []).map(renderAssertionRow),
    '',
  ];

  return [...fm, ...body].join(eol) + eol;
}

/**
 * 创建新 Case。新 Case 一律以 `pending_review`（DRAFT）落盘 ——
 * 直接生成 `ready` 会绕过 Assertion Gate，那正是 2.0 要堵住的路径。
 */
export function createCase(fields, opts = {}) {
  const caseId = assertValidCaseId(fields.case_id || fields.id);
  const file = caseFile(caseId, opts);
  if (existsSync(file)) {
    fail(`Case 已存在，拒绝覆盖：${file}`, 'CASE_EXISTS');
  }
  layout({ ...opts, create: true });

  const at = nowIso();
  const content = renderCaseMarkdown({
    case_id: caseId,
    name: fields.name || fields.title || caseId,
    status: CASE_STATUS.PENDING_REVIEW,
    case_version: fields.case_version || 1,
    created_at: at,
    updated_at: at,
    kind: fields.kind,
    module: fields.module,
    script_ref: fields.script_ref || fields.script,
    description: fields.description,
    preconditions: fields.preconditions,
    steps: fields.steps,
    assertions: fields.assertions || [],
  });

  writeFileAtomic(file, content);
  return loadCase(caseId, opts);
}

/* ------------------------------------------------------------------ *
 * 状态机
 * ------------------------------------------------------------------ */

export function canTransition(from, to) {
  if (from === to) return true;
  return (CASE_TRANSITIONS[from] || []).includes(to);
}

/**
 * 推进 Case 状态并最小化回写。
 *
 * **Assertion Gate（2.0 新增的结构约束）**：
 * `pending_review(DRAFT) → ready` 必须满足 `assertions.length >= 1`。
 * 这只作用于"新 Case 进入可执行"这条边——历史 Case 的 `completed → ready` 重跑不受影响，
 * 否则会让存量资产直接不可用（见 migration-plan 的 Legacy 兼容约定）。
 */
export function setCaseStatus(caseId, nextStatus, extra = {}, opts = {}) {
  const testCase = loadCase(caseId, opts);
  const to = normalizeCaseStatus(nextStatus);
  const from = testCase.status;

  if (!CASE_STATUSES.includes(to)) {
    fail(`Case 状态非法：${nextStatus}；合法取值 ${CASE_STATUSES.join(' | ')}`, 'BAD_STATUS');
  }
  if (!canTransition(from, to)) {
    fail(`非法状态转换：${from} → ${to}（${testCase.case_id}）`, 'ILLEGAL_TRANSITION');
  }
  if (from === CASE_STATUS.PENDING_REVIEW && to === CASE_STATUS.READY && isLegacyCase(testCase)) {
    fail(
      `Case requires at least one Assertion before entering READY（${testCase.case_id}）：`
        + `请先执行 \`auto-test case assert-add ${testCase.case_id} --id A1 --description "..."\``,
      'ASSERTION_REQUIRED',
    );
  }

  updateFrontmatter(testCase.file, { status: to, updated_at: nowIso(), ...extra });
  return loadCase(caseId, opts);
}

/** 可执行性检查（进入 Run 之前）。返回问题清单，空数组表示可执行。 */
export function validateCase(testCase) {
  const problems = [];
  if (!testCase.case_id) problems.push('缺少 case_id');
  if (!testCase.name) problems.push('缺少 title');
  if (!CASE_STATUSES.includes(testCase.status)) problems.push(`status 非法：${testCase.status}`);
  if (isLegacyCase(testCase)) {
    problems.push(`${LEGACY_NO_ASSERTION}：无 Assertion 定义，其 Run 不得 FINALIZED_PASS`);
  }
  for (const group of testCase.test_data) {
    if (group.hasPlaceholder) problems.push(`数据组 ${group.id} 含未填占位符（TODO / REQUIRED_INPUT）`);
  }
  return problems;
}
