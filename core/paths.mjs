/**
 * paths —— `.auto-test/` 资产根目录的解析与布局。
 *
 * 解析优先级（与 v1.x `caseStore.ts` 保持一致，避免同一仓库出现两套根目录判定）：
 *   1. 环境变量 AUTO_TEST_DIR
 *   2. 从 cwd 逐级向上查找已存在的 `.auto-test`
 *   3. 兜底 <cwd>/.auto-test
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ensureDir } from './util.mjs';

/** 从起点逐级向上查找含 `.auto-test` 的目录；找不到返回空串。 */
function findUp(startDir, maxDepth = 12) {
  let dir = resolve(startDir);
  for (let i = 0; i < maxDepth; i += 1) {
    const candidate = join(dir, '.auto-test');
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return '';
}

export function resolveAutoTestDir(cwd = process.cwd()) {
  if (process.env.AUTO_TEST_DIR) {
    return resolve(process.env.AUTO_TEST_DIR);
  }
  return findUp(cwd) || resolve(cwd, '.auto-test');
}

/**
 * 一次性解析全部布局路径。
 * 传 `create: true` 时创建缺失目录（**只创建，绝不清空已有内容**）。
 */
export function layout({ cwd = process.cwd(), create = false } = {}) {
  const root = resolveAutoTestDir(cwd);
  const paths = {
    root,
    cases: join(root, 'cases'),
    runs: join(root, 'runs'),
    policy: join(root, 'policy.json'),
    // v1.x 遗留目录：Core 不写入，仅保留路径供兼容层引用
    legacyReports: join(root, 'reports'),
  };
  if (create) {
    ensureDir(paths.root);
    ensureDir(paths.cases);
    ensureDir(paths.runs);
  }
  return paths;
}

/** 单个 Run 的目录布局。Run 的一切产物都在自己的目录内，可整体归档/移动。 */
export function runLayout(runId, opts = {}) {
  const { runs } = layout(opts);
  const dir = join(runs, runId);
  return {
    dir,
    run: join(dir, 'run.json'),
    events: join(dir, 'events.jsonl'),
    manifest: join(dir, 'evidence-manifest.json'),
    verdict: join(dir, 'verdict.json'),
    evidence: join(dir, 'evidence'),
  };
}

export function caseFile(caseId, opts = {}) {
  return join(layout(opts).cases, `${caseId}.md`);
}
