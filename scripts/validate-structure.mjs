#!/usr/bin/env node
/**
 * validate-structure.mjs —— auto-test 引擎自身的结构自检（零依赖）
 *
 * 检查：
 *   1. 必要文件/目录存在
 *   2. agents/*.md 的 YAML frontmatter 合法（name / description）+ 必需章节齐全
 *   3. Markdown 内部引用的 rules/ templates/ agents/ 文件真实存在
 *   4. 引擎内无硬编码绝对路径（Windows 盘符 / *nix 家目录）
 *   5. JSON / JSONC 示例块可解析（去注释后）
 *
 * 用法： node <skillDir>/scripts/validate-structure.mjs
 * 退出码：0 = PASS，1 = FAIL
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warns = [];
let checks = 0;

const ok = (cond, msg) => { checks++; if (!cond) errors.push(msg); };

// ---------- 1. 必要文件 ----------
const REQUIRED = [
  'SKILL.md', 'USAGE.md', 'CHANGELOG.md',
  'prompts/orchestrator.md',
  'agents/orchestrator.md', 'agents/preflight-binding.md', 'agents/source-analyst.md',
  'agents/case-designer.md', 'agents/script-engineer.md', 'agents/executor-reporter.md',
  'rules/auto-test-agent.md', 'rules/pipeline-state-rule.md', 'rules/preflight-rule.md',
  'rules/binding-rule.md', 'rules/mode-rule.md', 'rules/case-store-rule.md',
  'rules/testcase-rule.md', 'rules/test-data-rule.md', 'rules/script-rule.md',
  'rules/execute-rule.md', 'rules/report-rule.md', 'rules/source-analysis-rule.md',
  'rules/environment-rule.md',
  'templates/case.md', 'templates/report.md', 'templates/run-report.md',
  'templates/assertion-patterns.md', 'templates/selectors/README.md',
  'configs/project.schema.md',
];
for (const f of REQUIRED) ok(existsSync(join(ROOT, f)), `缺少必要文件: ${f}`);

// ---------- 2. agents frontmatter + 章节 ----------
const AGENT_SECTIONS = ['Role', 'Responsibilities', 'Non-Responsibilities', 'Allowed Rules',
  'Input', 'Output', 'State Transitions', 'Artifact Contract', 'Error Handling', 'Idempotency'];
const agentNames = new Set();
for (const f of readdirSync(join(ROOT, 'agents')).filter((x) => x.endsWith('.md'))) {
  const p = join('agents', f);
  const t = readFileSync(join(ROOT, p), 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  ok(!!m, `${p}: 缺少 YAML frontmatter`);
  if (!m) continue;
  const fm = m[1];
  // frontmatter 必须是扁平 key: value，不得出现未闭合结构
  for (const line of fm.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    ok(/^[A-Za-z_][\w-]*:\s*.+$/.test(line), `${p}: frontmatter 非法行 -> ${line.slice(0, 60)}`);
  }
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (fm.match(/^description:\s*(.+)$/m) || [])[1];
  ok(!!name, `${p}: frontmatter 缺 name`);
  ok(!!desc && desc.length >= 40, `${p}: frontmatter 缺 description 或过短`);
  if (name) {
    ok(!agentNames.has(name), `${p}: Agent name 重复 -> ${name}`);
    ok(!name.startsWith('-'), `${p}: Agent name 不得以 '-' 开头`);
    agentNames.add(name);
  }
  const missing = AGENT_SECTIONS.filter((s) =>
    !new RegExp('^#{2,3} .*' + s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'm').test(t));
  ok(missing.length === 0, `${p}: 缺少章节 -> ${missing.join(', ')}`);
}

// ---------- 3. 交叉引用 ----------
const mdFiles = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.md')) mdFiles.push(p);
  }
})(ROOT);

const REF = /`((?:rules|templates|agents|prompts|configs|scripts)\/[A-Za-z0-9._<>*{},-]+(?:\/[A-Za-z0-9._<>*{},-]+)*)`/g;
for (const abs of mdFiles) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  const text = readFileSync(abs, 'utf8');
  for (const [, ref] of text.matchAll(REF)) {
    if (/[<>*{}]/.test(ref)) continue;            // 占位符/通配，跳过
    const base = ref.split(' ')[0].replace(/[.,;:)]+$/, '');
    if (!existsSync(join(ROOT, base))) warns.push(`${rel}: 引用不存在的文件 -> ${base}`);
  }
}

// ---------- 4. 硬编码绝对路径 ----------
const HARDCODE = /(^|[\s`"'(])([A-Za-z]:[\\/](?!\.\.)[A-Za-z0-9_])|(\/home\/[a-z]+\/)|(\/Users\/[A-Za-z0-9]+\/)/;
const PATH_ALLOW = new Set(['CHANGELOG.md']);   // 变更记录可引用历史示例
for (const abs of mdFiles.concat([join(ROOT, 'scripts/install-agents.mjs'), join(ROOT, 'scripts/validate-structure.mjs')])) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  if (PATH_ALLOW.has(rel)) continue;
  const text = readFileSync(abs, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    // 含 <占位符> 的行是安装位置示例（如 C:\Users\<你>\.claude\...），不算硬编码
    if (/<[^>\s]+>/.test(line)) return;
    if (HARDCODE.test(line)) errors.push(`${rel}:${i + 1} 疑似硬编码绝对路径 -> ${line.trim().slice(0, 80)}`);
  });
  checks++;
}

// ---------- 5. JSON 示例块 ----------
for (const abs of mdFiles) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  const text = readFileSync(abs, 'utf8');
  for (const m of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    checks++;
    const body = m[1];
    if (/<[^>]+>|\.\.\./.test(body)) continue;   // 含占位符的示例不解析
    try { JSON.parse(body); }
    catch {
      // 文档里常只贴片段（如 `"ui": { ... }`）—— 包一层再试
      try { JSON.parse(`{${body}}`); }
      catch (e2) { errors.push(`${rel}: json 代码块无法解析 -> ${e2.message.slice(0, 70)}`); }
    }
  }
}

// ---------- 输出 ----------
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\nchecks=${checks} errors=${errors.length} warns=${warns.length}`);
console.log(errors.length ? '[FAILED]' : '[PASS]');
process.exit(errors.length ? 1 : 0);
