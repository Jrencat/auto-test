#!/usr/bin/env node
/**
 * genCaseHtml —— 由测试用例资产（.auto-test/cases）生成「开发人员可审查」的 HTML 视图。
 *
 * 解决的问题：测试报告只给汇总统计，看不到每条用例**用了哪些参数、执行了哪些步骤**。
 * 本脚本把 Case SSOT 渲染成可点击的 HTML，保证审查视图与用例资产永远一致（不靠人工誊抄）。
 *
 * 职责（对应 rules/report-rule.md §一点五）：
 *  1. 解析 .auto-test/cases/TC-*.md：YAML Frontmatter + 正文章节 + 测试数据明细表（Test Data Matrix）。
 *  2. 读取 .auto-test/reports/RUN-*.jsonl 的逐数据组真实执行记录（A 轨）；
 *     无 jsonl 时回退 Frontmatter 的 last_run_id / last_run_status，并在页面**显式标注 B 轨降级**。
 *  3. 按 Frontmatter 的 module 分组，输出到 <repoRoot>/docs/testcases/<module>/html/。
 *
 * 本脚本**零依赖、纯 Node ESM**，不要求项目已安装 caseStore.ts，可直接：
 *   node tests/support/genCaseHtml.mjs [--module <name>] [--run <RUN-ID>] [--out <dir>] [--quiet]
 *
 * 路径基准（见 rules/binding-rule.md §一 路径基准表）：
 *   输出目录一律相对 <cwd>（仓库根），**不是**前端项目根——即使本脚本从前端目录被调用。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Case 正文中按固定顺序渲染的章节（缺失则跳过，不报错） */
const SECTION_ORDER = ['测试目标', '前置条件', '测试步骤', '断言', '关联用例', '备注（人工）'];

/** 待人工补充的数据占位符，命中则该数据组标记为「待补充」 */
const PLACEHOLDERS = ['TODO', 'REQUIRED_INPUT'];

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = { module: '', run: '', out: '', cases: '', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--module' || a === '-m') opts.module = argv[++i] || '';
    else if (a === '--run' || a === '-r') opts.run = argv[++i] || '';
    else if (a === '--out' || a === '-o') opts.out = argv[++i] || '';
    else if (a === '--cases') opts.cases = argv[++i] || '';
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node tests/support/genCaseHtml.mjs [--module <name>] [--run <RUN-ID>] [--out <dir>] [--cases <dir>] [--quiet]',
      );
      process.exit(0);
    }
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * 路径解析：定位 .auto-test 与仓库根
 * ------------------------------------------------------------------ */

/** 读取 .env 风格文件为对象（用于取 tests/.env.test 的 AUTO_TEST_DIR） */
function parseDotEnvFile(path) {
  const out = {};
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

/** 从起点逐级向上查找含 `.auto-test` 的目录，返回该 `.auto-test` 绝对路径；找不到返回空串 */
function findAutoTestRoot(startDir) {
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
 * 解析 `.auto-test` 根目录，优先级与 caseStore.ts 保持一致：
 * 1. 环境变量 AUTO_TEST_DIR → 2. tests/.env.test 的 AUTO_TEST_DIR
 * 3. 从本脚本所在目录上溯 → 4. 从 process.cwd() 上溯 → 5. 兜底 <cwd>/.auto-test
 */
function resolveAutoTestDir() {
  const fromEnv = process.env.AUTO_TEST_DIR || parseDotEnvFile(resolve(SCRIPT_DIR, '..', '.env.test')).AUTO_TEST_DIR;
  if (fromEnv) return resolve(fromEnv);
  return findAutoTestRoot(SCRIPT_DIR) || findAutoTestRoot(process.cwd()) || resolve(process.cwd(), '.auto-test');
}

/** 读取项目绑定 <repoRoot>/.claude/auto-test/project.json（可缺失，用默认值） */
function loadBinding(repoRoot) {
  const file = join(repoRoot, '.claude', 'auto-test', 'project.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn(`⚠ 解析 ${file} 失败，使用默认输出路径：${err.message}`);
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Frontmatter 解析
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

/** 切分 Frontmatter 与正文；无 Frontmatter 时 raw 为空串 */
function splitFrontmatter(text) {
  const normalized = text.replace(/^﻿/, '');
  const match = /^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(normalized);
  if (!match) return { raw: '', body: normalized };
  return { raw: match[1], body: normalized.slice(match[0].length) };
}

/** 解析 Frontmatter 为对象（顶层 key: value 与顶层 `- ` 列表；无法识别的行忽略，不使解析失败） */
function parseFrontmatter(raw) {
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
 * 正文章节切分
 * ------------------------------------------------------------------ */

/** 按 `## 标题` 切分正文，返回 { 标题 → 该节内容 }。同名标题后者不覆盖前者（追加） */
function splitSections(body) {
  const sections = new Map();
  const lines = body.split(/\r?\n/);
  let current = '';
  let buf = [];
  const flush = () => {
    if (!current) return;
    const text = buf.join('\n').trim();
    sections.set(current, sections.has(current) ? `${sections.get(current)}\n\n${text}` : text);
  };
  for (const line of lines) {
    const h2 = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      flush();
      current = h2[1].trim();
      buf = [];
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return sections;
}

/* ------------------------------------------------------------------ *
 * Test Data Matrix 解析（列语义识别与 caseStore.ts parseDataMatrix 对齐）
 * ------------------------------------------------------------------ */

/** 按未转义的 `|` 切分表格行，并还原 `\|` */
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

/** 单元格归一化：去首尾空格；整体被 code span 包裹时去掉反引号 */
function normalizeCell(cell) {
  const trimmed = cell.trim();
  const code = /^(`+)([\s\S]*)\1$/.exec(trimmed);
  const value = code ? code[2] : trimmed;
  return code ? value.replace(/^ (.*) $/, '$1') : value;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

/** 表头 → 列语义映射（中英文别名，按优先级判定） */
function detectColumn(header, taken) {
  const h = header.trim().toLowerCase();
  const has = (...keys) => keys.some((k) => h.includes(k.toLowerCase()));
  const pick = (key) => (taken.has(key) ? '' : key);
  if (has('数据组', 'group')) return pick('groupId');
  if (has('字段', 'field')) return pick('field');
  if (has('输入', '取值', 'value', 'input')) return pick('value');
  if (has('预期', 'expect')) return pick('expected');
  if (has('特征', 'trait', 'characteristic')) return pick('trait');
  if (has('数据类型', 'datatype')) return pick('dataType');
  if (has('类型', 'type')) return pick('dataType');
  return '';
}

/** 从正文解析 Test Data Matrix：识别第一张同时含「数据组/字段/输入」语义列的表 */
function parseDataMatrix(body) {
  const lines = body.split(/\r?\n/);
  let headerIdx = -1;
  let columns = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('|')) continue;
    const cells = splitTableRow(lines[i]);
    if (cells.length < 3 || isSeparatorRow(cells)) continue;
    const taken = new Set();
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

  const groups = new Map();
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('|')) {
      if (line.trim() === '') continue;
      break;
    }
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) continue;
    if (cells.length < 2) break;

    const get = (key) => {
      const idx = columns.indexOf(key);
      return idx === -1 || idx >= cells.length ? '' : normalizeCell(cells[idx]);
    };
    const groupId = get('groupId');
    const field = get('field');
    if (!groupId || !field) continue;

    const row = {
      groupId,
      field,
      value: get('value'),
      dataType: get('dataType'),
      trait: get('trait'),
      expected: get('expected'),
    };

    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, rows: [], traits: [], hasPlaceholder: false };
      groups.set(groupId, group);
    }
    group.rows.push(row);
    if (row.trait && row.trait !== '-' && !group.traits.includes(row.trait)) group.traits.push(row.trait);
    if (PLACEHOLDERS.includes(row.value.trim().toUpperCase())) group.hasPlaceholder = true;
  }

  return [...groups.values()];
}

/* ------------------------------------------------------------------ *
 * 极简 Markdown 渲染（仅覆盖 Case 正文实际用到的语法）
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内：`code` / **bold**（先转义再还原标记，避免 XSS 与标签串位） */
function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
  return out;
}

/** 渲染一张 markdown 表格（cells 已按行切分） */
function renderMdTable(rows) {
  const header = rows[0];
  const bodyRows = rows.slice(1).filter((r) => !isSeparatorRow(r));
  const th = header.map((c) => `<th>${renderInline(c.trim())}</th>`).join('');
  const tb = bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c.trim())}</td>`).join('')}</tr>`)
    .join('\n');
  return `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>\n${tb}\n</tbody></table></div>`;
}

/**
 * 把一段 markdown 渲染为 HTML。支持：有序列表、无序列表、引用块、表格、段落。
 * 有序列表项的续行（缩进行）并入上一项，保证多行步骤不被拆散。
 */
function renderMarkdown(md) {
  if (!md || !md.trim()) return '<p class="muted">（无）</p>';
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 表格：连续的含 | 行
    if (line.includes('|') && splitTableRow(line).length >= 2) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      html.push(renderMdTable(rows));
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 有序列表（步骤）：续行按缩进并入当前项
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i += 1;
        } else if (/^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        } else break;
      }
      html.push(`<ol>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[1]);
          i += 1;
        } else if (/^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
        } else break;
      }
      html.push(`<ul>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    // 普通段落：吸收到下一个空行或块级起始
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\d+\.|[-*])\s+/.test(lines[i]) && !/^>\s?/.test(lines[i])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    if (buf.length) html.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }

  return html.join('\n');
}

/* ------------------------------------------------------------------ *
 * Case 与执行记录加载
 * ------------------------------------------------------------------ */

function parseCaseFile(file) {
  const text = readFileSync(file, 'utf-8');
  const { raw, body } = splitFrontmatter(text);
  const fm = parseFrontmatter(raw);
  return {
    file,
    frontmatter: fm,
    sections: splitSections(body),
    dataGroups: parseDataMatrix(body),
  };
}

function loadCases(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort()
    .map((f) => parseCaseFile(join(dir, f)))
    .filter((c) => Boolean(c.frontmatter && c.frontmatter.id));
}

/**
 * 载入执行记录（A 轨）。默认取最新一个 RUN-*.jsonl；指定 --run 则取该批次。
 * 返回 { runId, byCase: Map<caseId, RunRecord[]> }；无 jsonl 则 runId 为空（调用方走 B 轨降级）。
 */
function loadRunRecords(reportDir, wantedRun) {
  if (!existsSync(reportDir)) return { runId: '', byCase: new Map() };
  const files = readdirSync(reportDir)
    .filter((f) => /^RUN-.*\.jsonl$/i.test(f))
    .sort();
  const target = wantedRun ? files.find((f) => f.startsWith(wantedRun)) : files[files.length - 1];
  if (!target) return { runId: '', byCase: new Map() };

  const byCase = new Map();
  let hasRecord = false;
  for (const line of readFileSync(join(reportDir, target), 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // 容错：跳过损坏行，不中断生成
    }
    // 投影输出（B 轨的 stats/failures 汇总行）没有 caseId，不算逐数据组记录
    if (!rec || !rec.caseId) continue;
    hasRecord = true;
    if (!byCase.has(rec.caseId)) byCase.set(rec.caseId, []);
    byCase.get(rec.caseId).push(rec);
  }
  return { runId: hasRecord ? target.replace(/\.jsonl$/i, '') : '', byCase };
}

/* ------------------------------------------------------------------ *
 * HTML 渲染
 * ------------------------------------------------------------------ */

const STYLE = `
:root{
  --bg:#f6f7f9; --panel:#ffffff; --fg:#1a1d21; --muted:#6b7280; --border:#e3e6ea;
  --accent:#2f6feb; --code-bg:#f0f2f5; --head:#eef1f5;
  --pass:#137333; --pass-bg:#e6f4ea; --fail:#b3261e; --fail-bg:#fce8e6;
  --warn:#8a5300; --warn-bg:#fef3e2; --idle:#4b5563; --idle-bg:#eceff3;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#14171a; --panel:#1c2024; --fg:#e6e8eb; --muted:#9aa3ad; --border:#2c3238;
    --accent:#77a5ff; --code-bg:#252b31; --head:#232830;
    --pass:#7ee2a8; --pass-bg:#12301f; --fail:#ff9d94; --fail-bg:#3a1d1a;
    --warn:#f5c77e; --warn-bg:#3a2c12; --idle:#aab3bd; --idle-bg:#272c32;
  }
}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);
  font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:16px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
a{color:var(--accent)}
p{margin:8px 0}
code{background:var(--code-bg);padding:1px 5px;border-radius:4px;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;word-break:break-all}
blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--border);
  background:var(--code-bg);color:var(--muted);border-radius:0 4px 4px 0}
ol,ul{margin:8px 0;padding-left:22px}
li{margin:5px 0}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px 22px;margin-bottom:16px}
.muted{color:var(--muted)}
.tbl-wrap{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--border);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--head);font-weight:600;white-space:nowrap}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin:10px 0 0;font-size:12.5px;color:var(--muted)}
.badge{display:inline-block;padding:1px 9px;border-radius:11px;font-size:12px;font-weight:600;white-space:nowrap}
.b-pass{background:var(--pass-bg);color:var(--pass)}
.b-fail{background:var(--fail-bg);color:var(--fail)}
.b-warn{background:var(--warn-bg);color:var(--warn)}
.b-idle{background:var(--idle-bg);color:var(--idle)}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 4px}
.stat{flex:1 1 110px;background:var(--panel);border:1px solid var(--border);
  border-radius:9px;padding:12px 14px}
.stat .n{font-size:22px;font-weight:700;line-height:1.2}
.stat .k{font-size:12px;color:var(--muted);margin-top:2px}
.controls{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
input[type=search],select{background:var(--panel);color:var(--fg);border:1px solid var(--border);
  border-radius:7px;padding:7px 11px;font-size:13px;font-family:inherit}
input[type=search]{flex:1 1 260px}
.group{margin:14px 0;border:1px solid var(--border);border-radius:9px;overflow:hidden}
.group-hd{background:var(--head);padding:8px 13px;font-weight:600;font-size:13.5px;
  display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.group-bd{padding:0 13px 4px}
.crumb{font-size:12.5px;color:var(--muted);margin-bottom:12px}
.foot{margin-top:26px;font-size:12px;color:var(--muted);text-align:center}
`;

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
${bodyHtml}
</div>
</body>
</html>
`;
}

/** 执行结果 → badge class */
function resultBadge(result) {
  const r = String(result || '').toUpperCase();
  if (r === 'PASS') return `<span class="badge b-pass">PASS</span>`;
  if (r === 'FAIL' || r === 'ERROR') return `<span class="badge b-fail">${escapeHtml(r)}</span>`;
  if (r === 'BLOCKED') return `<span class="badge b-warn">BLOCKED</span>`;
  if (!r || r === 'NULL') return `<span class="badge b-idle">未执行</span>`;
  return `<span class="badge b-idle">${escapeHtml(r)}</span>`;
}

/**
 * 渲染「具体测试输入」单元格。
 * 整格是纯值 → 整体 <code>；格内混有 code span 与中文说明（如 `fn()`（动态解析）） → 走行内渲染，
 * 避免反引号被当字面量显示。
 */
function renderValueCell(v) {
  const s = String(v ?? '');
  if (!s) return '<span class="muted">-</span>';
  return s.includes('`') ? renderInline(s) : `<code>${escapeHtml(s)}</code>`;
}

function statusBadge(status) {
  const s = String(status || '');
  const cls = s === 'completed' ? 'b-pass' : s === 'failed' ? 'b-fail' : s === 'pending_review' ? 'b-warn' : 'b-idle';
  return `<span class="badge ${cls}">${escapeHtml(s || '-')}</span>`;
}

/** 单条用例页 */
function renderCasePage(c, ctx) {
  const fm = c.frontmatter;
  const records = ctx.byCase.get(fm.id) || [];
  const trackA = records.length > 0;

  const metaRows = [
    ['Case ID', `<code>${escapeHtml(fm.id)}</code>`],
    ['类型', escapeHtml(fm.kind || '-')],
    ['模块', escapeHtml(fm.module || '-')],
    ['状态', statusBadge(fm.status)],
    ['路由', fm.route ? `<code>${escapeHtml(fm.route)}</code>` : '-'],
    ['测试脚本', fm.script ? `<code>${escapeHtml(fm.script)}</code>` : '-'],
    ['Case 文件', `<code>.auto-test/cases/${escapeHtml(fm.id)}.md</code>`],
    ['最近执行', fm.last_run_id ? `<code>${escapeHtml(fm.last_run_id)}</code>` : '未执行'],
    ['最近结果', resultBadge(fm.last_run_status)],
    ['更新时间', escapeHtml(fm.updated_at || '-')],
  ];

  const parts = [];
  parts.push(`<div class="crumb"><a href="index.html">← 返回用例索引</a></div>`);
  parts.push(`<h1>${escapeHtml(fm.id)} ${escapeHtml(fm.title || '')}</h1>`);
  parts.push(
    `<div class="card"><div class="tbl-wrap"><table><tbody>` +
      metaRows.map(([k, v]) => `<tr><th style="width:110px">${escapeHtml(k)}</th><td>${v}</td></tr>`).join('') +
      `</tbody></table></div></div>`,
  );

  // 正文章节（测试目标 / 前置条件 / 测试步骤 / 断言 / …）
  for (const name of SECTION_ORDER) {
    if (!c.sections.has(name)) continue;
    parts.push(`<h2>${escapeHtml(name)}</h2>`);
    parts.push(`<div class="card">${renderMarkdown(c.sections.get(name))}</div>`);
  }

  // 参数矩阵：按数据组分块，逐字段列出具体输入
  parts.push(`<h2>测试参数矩阵（${c.dataGroups.length} 个数据组）</h2>`);
  if (!c.dataGroups.length) {
    parts.push(`<div class="card"><p class="muted">该用例未定义 Test Data Matrix（无参数化数据组）。</p></div>`);
  } else {
    for (const g of c.dataGroups) {
      const rec = records.find((r) => r.groupId === g.id);
      const tags = [
        g.traits.length ? `<span class="muted">${escapeHtml(g.traits.join(' / '))}</span>` : '',
        g.hasPlaceholder ? `<span class="badge b-warn">待人工补充</span>` : '',
        rec ? resultBadge(rec.result) : '',
      ]
        .filter(Boolean)
        .join('');
      const rows = g.rows
        .map(
          (r) =>
            `<tr><td><code>${escapeHtml(r.field)}</code></td><td>${renderValueCell(r.value)}</td>` +
            `<td>${escapeHtml(r.dataType || '-')}</td><td>${escapeHtml(r.trait || '-')}</td>` +
            `<td>${renderInline(r.expected || '-')}</td></tr>`,
        )
        .join('\n');
      const actual = rec
        ? `<p><strong>实际输入</strong>（本轮真实执行值）：<code>${escapeHtml(JSON.stringify(rec.input || {}))}</code></p>` +
          `<p><strong>实际结果</strong>：${renderInline(rec.actual || '-')}</p>` +
          (rec.error ? `<blockquote>${escapeHtml(String(rec.error).split('\n').slice(0, 20).join(' '))}</blockquote>` : '')
        : '';
      parts.push(
        `<div class="group"><div class="group-hd"><span>${escapeHtml(g.id)}</span>${tags}</div>` +
          `<div class="group-bd"><div class="tbl-wrap"><table><thead><tr>` +
          `<th>字段</th><th>具体测试输入</th><th>数据类型</th><th>数据特征</th><th>预期校验结果</th>` +
          `</tr></thead><tbody>\n${rows}\n</tbody></table></div>${actual}</div></div>`,
      );
    }
  }

  // 执行结果与证据来源轨（A/B 轨必须如实标注，见 rules/report-rule.md §零）
  parts.push(`<h2>本轮执行结果</h2>`);
  if (trackA) {
    parts.push(
      `<div class="card"><p><strong>证据来源：A 轨</strong>（<code>${escapeHtml(ctx.runId)}.jsonl</code> 逐数据组真实记录）。</p>` +
        `<div class="tbl-wrap"><table><thead><tr><th>数据组</th><th>结果</th><th>失败类型</th><th>耗时</th><th>执行时间</th></tr></thead><tbody>` +
        records
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.groupId || '-')}</td><td>${resultBadge(r.result)}</td>` +
              `<td>${escapeHtml(r.failureType || '-')}</td><td>${r.durationMs ? `${escapeHtml(r.durationMs)}ms` : '-'}</td>` +
              `<td>${escapeHtml(r.at || '-')}</td></tr>`,
          )
          .join('') +
        `</tbody></table></div></div>`,
    );
  } else {
    parts.push(
      `<div class="card"><p><strong>证据来源：B 轨（降级）</strong> —— 本项目未接入 <code>caseStore.ts</code>，` +
        `无 <code>RUN-*.jsonl</code> 逐数据组记录，故<strong>无逐数据组实际输入</strong>。` +
        `下表仅为 Case 文件的执行摘要回写值，追踪链止于用例与测试脚本。</p>` +
        `<div class="tbl-wrap"><table><tbody>` +
        `<tr><th style="width:110px">Run ID</th><td>${fm.last_run_id ? `<code>${escapeHtml(fm.last_run_id)}</code>` : '未执行'}</td></tr>` +
        `<tr><th>执行结果</th><td>${resultBadge(fm.last_run_status)}</td></tr>` +
        `<tr><th>逐数据组实录</th><td class="muted">N/A（未接入 case-store）</td></tr>` +
        `</tbody></table></div></div>`,
    );
  }

  parts.push(`<div class="foot">由 auto-test <code>genCaseHtml.mjs</code> 从 <code>.auto-test/cases/</code> 自动生成 · 生成于 ${escapeHtml(ctx.generatedAt)}</div>`);
  return page(`${fm.id} ${fm.title || ''}`, parts.join('\n'));
}

/** 模块索引页 */
function renderIndexPage(moduleName, cases, ctx) {
  const count = (pred) => cases.filter(pred).length;
  const res = (c) => String(c.frontmatter.last_run_status || '').toUpperCase();
  const groupTotal = cases.reduce((n, c) => n + c.dataGroups.length, 0);

  const stats = [
    ['用例总数', cases.length],
    ['数据组总数', groupTotal],
    ['PASS', count((c) => res(c) === 'PASS')],
    ['FAIL / ERROR', count((c) => res(c) === 'FAIL' || res(c) === 'ERROR')],
    ['BLOCKED', count((c) => res(c) === 'BLOCKED')],
    ['未执行', count((c) => !res(c))],
    ['待人工审核', count((c) => c.frontmatter.status === 'pending_review')],
  ];

  const rows = cases
    .map((c) => {
      const fm = c.frontmatter;
      const steps = (c.sections.get('测试步骤') || '').split(/\r?\n/).filter((l) => /^\s*\d+\.\s+/.test(l)).length;
      return (
        `<tr data-search="${escapeHtml(`${fm.id} ${fm.title || ''} ${fm.kind || ''} ${fm.script || ''}`.toLowerCase())}" ` +
        `data-result="${escapeHtml(res(c) || 'NONE')}">` +
        `<td><a href="${escapeHtml(fm.id)}.html"><code>${escapeHtml(fm.id)}</code></a></td>` +
        `<td><a href="${escapeHtml(fm.id)}.html">${escapeHtml(fm.title || '')}</a></td>` +
        `<td>${escapeHtml(fm.kind || '-')}</td>` +
        `<td>${statusBadge(fm.status)}</td>` +
        `<td style="text-align:right">${steps}</td>` +
        `<td style="text-align:right">${c.dataGroups.length}</td>` +
        `<td>${resultBadge(fm.last_run_status)}</td>` +
        `<td>${fm.script ? `<code>${escapeHtml(fm.script)}</code>` : '-'}</td>` +
        `</tr>`
      );
    })
    .join('\n');

  const trackNote = ctx.runId
    ? `证据来源 <strong>A 轨</strong>：逐数据组实录取自 <code>${escapeHtml(ctx.runId)}.jsonl</code>。`
    : `证据来源 <strong>B 轨（降级）</strong>：本项目未接入 <code>caseStore.ts</code>，无逐数据组实际输入记录，结果列取自 Case 文件的 <code>last_run_status</code> 回写值。`;

  const body = `
<h1>测试用例审查视图 —— ${escapeHtml(moduleName)}</h1>
<p class="muted">数据源：<code>.auto-test/cases/</code>（用例 SSOT）。点击用例查看完整的测试步骤与参数矩阵。</p>
<div class="stats">
${stats.map(([k, n]) => `<div class="stat"><div class="n">${n}</div><div class="k">${escapeHtml(k)}</div></div>`).join('\n')}
</div>
<div class="card"><p style="margin:0">${trackNote}</p></div>
<div class="controls">
  <input type="search" id="q" placeholder="搜索用例 ID / 标题 / 脚本…">
  <select id="f">
    <option value="">全部执行结果</option>
    <option value="PASS">PASS</option>
    <option value="FAIL">FAIL</option>
    <option value="ERROR">ERROR</option>
    <option value="BLOCKED">BLOCKED</option>
    <option value="NONE">未执行</option>
  </select>
</div>
<div class="tbl-wrap">
<table id="t">
<thead><tr><th>用例 ID</th><th>标题</th><th>类型</th><th>状态</th><th>步骤数</th><th>数据组</th><th>最近结果</th><th>测试脚本</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="muted" id="cnt"></p>
<div class="foot">由 auto-test <code>genCaseHtml.mjs</code> 从 <code>.auto-test/cases/</code> 自动生成 · 生成于 ${escapeHtml(ctx.generatedAt)}</div>
<script>
(function(){
  var q=document.getElementById('q'),f=document.getElementById('f'),cnt=document.getElementById('cnt');
  var rows=[].slice.call(document.querySelectorAll('#t tbody tr'));
  function apply(){
    var kw=q.value.trim().toLowerCase(), fv=f.value, n=0;
    rows.forEach(function(r){
      var ok=(!kw||r.dataset.search.indexOf(kw)>-1)&&(!fv||r.dataset.result===fv);
      r.style.display=ok?'':'none'; if(ok)n++;
    });
    cnt.textContent='显示 '+n+' / '+rows.length+' 条用例';
  }
  q.addEventListener('input',apply); f.addEventListener('change',apply); apply();
})();
</script>
`;
  return page(`测试用例审查 —— ${moduleName}`, body);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const autoTestDir = resolveAutoTestDir();
  const repoRoot = dirname(autoTestDir);
  const caseDir = opts.cases ? resolve(opts.cases) : join(autoTestDir, 'cases');
  const reportDir = join(autoTestDir, 'reports');

  const cases = loadCases(caseDir);
  if (!cases.length) {
    console.error(`✗ 未找到任何用例：${caseDir}`);
    process.exit(1);
  }

  const binding = loadBinding(repoRoot);
  // 输出目录模板与模块目录别名（模块名与既有中文目录名不一致时用别名对齐）
  const htmlDirTemplate = binding.htmlDir || 'docs/testcases/<module>/html/';
  const alias = binding.moduleDirAlias || {};

  const { runId, byCase } = loadRunRecords(reportDir, opts.run);
  const ctx = { runId, byCase, generatedAt: nowLocal() };

  // 按 module 分组（缺 module 时从 Case ID 中段回退推导）
  const byModule = new Map();
  for (const c of cases) {
    const fm = c.frontmatter;
    const mod = fm.module || (/^TC-([^-]+)-/.exec(fm.id || '') || [, 'misc'])[1].toLowerCase();
    if (opts.module && mod !== opts.module) continue;
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push(c);
  }
  if (!byModule.size) {
    console.error(`✗ 没有匹配的模块${opts.module ? `：--module ${opts.module}` : ''}`);
    process.exit(1);
  }

  const written = [];
  for (const [mod, list] of byModule) {
    const outDir = opts.out
      ? resolve(opts.out, mod)
      : join(repoRoot, htmlDirTemplate.replace(/<module>/g, alias[mod] || mod));
    mkdirSync(outDir, { recursive: true });

    writeFileSync(join(outDir, 'index.html'), renderIndexPage(mod, list, ctx), 'utf-8');
    written.push(join(outDir, 'index.html'));
    for (const c of list) {
      const file = join(outDir, `${c.frontmatter.id}.html`);
      writeFileSync(file, renderCasePage(c, ctx), 'utf-8');
      written.push(file);
    }
  }

  if (!opts.quiet) {
    console.log(`✓ 用例审查 HTML 生成完成（证据来源：${runId ? `A 轨 ${runId}` : 'B 轨降级，无逐数据组实录'}）`);
    console.log(`  仓库根：${repoRoot}`);
    for (const f of written) console.log(`  + ${f.replace(`${repoRoot}\\`, '').replace(`${repoRoot}/`, '')}`);
    console.log(`  共 ${written.length} 个文件 / ${byModule.size} 个模块 / ${cases.length} 条用例`);
  }
}

main();
