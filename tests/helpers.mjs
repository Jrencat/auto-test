/**
 * 测试辅助：为每个用例准备一个隔离的 `.auto-test` 资产目录。
 *
 * Core 通过 AUTO_TEST_DIR 解析根目录，因此只要在每个用例前指向新的临时目录，
 * 各用例之间就不会互相污染。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = [];

/** 建立并切换到一个全新的临时资产目录，返回其路径。 */
export function useTempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'autotest-'));
  process.env.AUTO_TEST_DIR = join(dir, '.auto-test');
  created.push(dir);
  return process.env.AUTO_TEST_DIR;
}

export function cleanupTempStores() {
  while (created.length) {
    const dir = created.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响断言结果
    }
  }
  delete process.env.AUTO_TEST_DIR;
}

/** 写一个临时文件用作证据来源。 */
export function makeFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'autotest-src-'));
  created.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, 'utf-8');
  return file;
}

/** 创建一个带 N 条必需断言、且已进入 ready 的 Case。 */
export function readyCase(core, caseId, assertionIds = ['A1']) {
  core.createCase({ case_id: caseId, name: `${caseId} 测试` });
  for (const id of assertionIds) {
    core.addAssertion(caseId, { id, layer: 'ui', description: `断言 ${id}`, required: true });
  }
  return core.setCaseStatus(caseId, 'ready');
}
