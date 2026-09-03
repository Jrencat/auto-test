#!/usr/bin/env node
/**
 * install-agents.mjs —— 把 auto-test 的 Sub-Agent 定义注册到 Claude Code
 *
 * 背景：Claude Code 只从 `.claude/agents/`（user / project 级）与 plugin 的 `agents/` 加载
 * Agent 定义，**不会**加载 Skill 目录下的 `agents/`。因此需要一次性安装，
 * 之后即可用 Tier A（原生 Sub-Agent）调度。未安装时引擎自动走 Tier B，功能不受影响。
 *
 * 用法：
 *   node <skillDir>/scripts/install-agents.mjs            # 安装到 ~/.claude/agents/
 *   node <skillDir>/scripts/install-agents.mjs --project   # 安装到 <cwd>/.claude/agents/
 *   node <skillDir>/scripts/install-agents.mjs --check     # 只检查，不写入
 *   node <skillDir>/scripts/install-agents.mjs --uninstall  # 移除本 Skill 安装的 Agent
 *
 * 幂等：内容一致则跳过；已存在但内容不同则覆盖并打印 updated。
 * 零硬编码：所有路径由脚本自身位置 / os.homedir() / process.cwd() 推导。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_SRC = join(SKILL_DIR, 'agents');

// orchestrator 由主会话承担，注册为 Sub-Agent 会造成编排递归 —— 默认不安装
const SKIP = new Set(['orchestrator.md']);
const MARKER = '<!-- installed-by: auto-test skill -->';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const targetDir = has('--project')
  ? join(process.cwd(), '.claude', 'agents')
  : join(homedir(), '.claude', 'agents');

if (!existsSync(AGENTS_SRC)) {
  console.error(`[auto-test] 找不到 Agent 源目录：${AGENTS_SRC}`);
  process.exit(1);
}

const sources = readdirSync(AGENTS_SRC)
  .filter((f) => f.endsWith('.md') && !SKIP.has(f))
  .sort();

/** 从 frontmatter 取 name，用作目标文件名 */
function agentName(text, fallback) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const n = m && m[1].match(/^name:\s*(\S+)\s*$/m);
  return n ? n[1] : fallback.replace(/\.md$/, '');
}

if (has('--uninstall')) {
  let removed = 0;
  if (existsSync(targetDir)) {
    for (const f of readdirSync(targetDir).filter((x) => x.endsWith('.md'))) {
      const p = join(targetDir, f);
      if (readFileSync(p, 'utf8').includes(MARKER)) { unlinkSync(p); removed++; console.log(`removed  ${f}`); }
    }
  }
  console.log(`\n[auto-test] 已移除 ${removed} 个 Agent（${targetDir}）。重启会话后生效。`);
  process.exit(0);
}

const plan = sources.map((f) => {
  const raw = readFileSync(join(AGENTS_SRC, f), 'utf8');
  const name = agentName(raw, f);
  const dest = join(targetDir, `${name}.md`);
  // 追加安装标记，便于 --uninstall 精确识别；不改动正文语义
  const content = `${raw.trimEnd()}\n\n${MARKER}\n`;
  let action = 'install';
  if (existsSync(dest)) {
    const cur = readFileSync(dest, 'utf8');
    if (cur === content) action = 'skip';
    else if (!cur.includes(MARKER)) action = 'conflict';
    else action = 'update';
  }
  return { f, name, dest, content, action };
});

if (has('--check')) {
  for (const p of plan) console.log(`${p.action.padEnd(9)} ${p.name}`);
  console.log(`\n[auto-test] 目标目录：${targetDir}（--check 模式，未写入）`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
let installed = 0, updated = 0, skipped = 0, conflicts = 0;
for (const p of plan) {
  if (p.action === 'conflict') {
    console.warn(`conflict  ${p.name} —— 目标文件非本 Skill 安装，已保留，未覆盖：${p.dest}`);
    conflicts++; continue;
  }
  if (p.action === 'skip') { skipped++; console.log(`skip      ${p.name}`); continue; }
  writeFileSync(p.dest, p.content, 'utf8');
  if (p.action === 'update') { updated++; console.log(`updated   ${p.name}`); }
  else { installed++; console.log(`installed ${p.name}`); }
}

console.log(`\n[auto-test] 目标目录：${targetDir}`);
console.log(`installed=${installed} updated=${updated} skipped=${skipped} conflicts=${conflicts}`);
console.log('⚠ 需重启 Claude Code 会话后新 Agent 才会出现在可用类型列表中（届时自动切到 Tier A）。');
if (conflicts) process.exitCode = 2;
