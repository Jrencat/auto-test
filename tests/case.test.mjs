/**
 * Case 一等实体：创建、解析、Legacy 判定、Assertion Gate、状态机。
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import * as core from '../core/index.mjs';
import { cleanupTempStores, readyCase, useTempStore } from './helpers.mjs';

beforeEach(useTempStore);
after(cleanupTempStores);

describe('Case 创建与读取', () => {
  it('新建 Case 以 pending_review(DRAFT) 落盘，不得直接 ready', () => {
    const created = core.createCase({ case_id: 'TC-A-001', name: '登录校验' });
    assert.equal(created.status, core.CASE_STATUS.PENDING_REVIEW);
    assert.equal(created.case_id, 'TC-A-001');
    assert.equal(created.case_version, 1);
    assert.deepEqual(created.assertions, []);
  });

  it('重复创建同 ID 拒绝覆盖', () => {
    core.createCase({ case_id: 'TC-A-001', name: 'x' });
    assert.throws(() => core.createCase({ case_id: 'TC-A-001', name: 'y' }), /已存在/);
  });

  it('读取回来的字段与 2.0 模型一致', () => {
    core.createCase({
      case_id: 'TC-A-002',
      name: '带脚本',
      script_ref: 'tests/e2e/a.spec.ts',
      module: 'auth',
      steps: ['打开登录页', '输入账号'],
    });
    const loaded = core.loadCase('TC-A-002');
    assert.equal(loaded.name, '带脚本');
    assert.equal(loaded.script_ref, 'tests/e2e/a.spec.ts');
    assert.deepEqual(loaded.steps, ['打开登录页', '输入账号']);
    assert.equal(loaded.frontmatter.module, 'auth');
  });

  it('listCases 返回全部 Case', () => {
    core.createCase({ case_id: 'TC-A-001', name: 'a' });
    core.createCase({ case_id: 'TC-A-002', name: 'b' });
    assert.equal(core.listCases().length, 2);
  });
});

describe('Assertion 定义', () => {
  it('新增断言后可被解析，required 默认为真', () => {
    core.createCase({ case_id: 'TC-B-001', name: 'x' });
    core.addAssertion('TC-B-001', { id: 'A1', layer: 'ui', description: '出现「继续填写」' });
    const loaded = core.loadCase('TC-B-001');
    assert.equal(loaded.assertions.length, 1);
    assert.deepEqual(loaded.assertions[0], {
      id: 'A1',
      layer: 'ui',
      description: '出现「继续填写」',
      required: true,
    });
  });

  it('可选断言写入 required=false', () => {
    core.createCase({ case_id: 'TC-B-002', name: 'x' });
    core.addAssertion('TC-B-002', { id: 'A9', description: 'DB 守恒', required: false });
    assert.equal(core.loadCase('TC-B-002').assertions[0].required, false);
  });

  it('多条断言按顺序追加，不覆盖已有行', () => {
    core.createCase({ case_id: 'TC-B-003', name: 'x' });
    core.addAssertion('TC-B-003', { id: 'A1', description: '第一条' });
    core.addAssertion('TC-B-003', { id: 'A2', description: '第二条' });
    core.addAssertion('TC-B-003', { id: 'A3', description: '第三条' });
    assert.deepEqual(core.loadCase('TC-B-003').assertions.map((a) => a.id), ['A1', 'A2', 'A3']);
  });

  it('重复 Assertion ID 被拒绝', () => {
    core.createCase({ case_id: 'TC-B-004', name: 'x' });
    core.addAssertion('TC-B-004', { id: 'A1', description: '一' });
    assert.throws(() => core.addAssertion('TC-B-004', { id: 'A1', description: '二' }), /已存在/);
  });

  it('描述中的竖线被转义，不破坏表结构', () => {
    core.createCase({ case_id: 'TC-B-005', name: 'x' });
    core.addAssertion('TC-B-005', { id: 'A1', description: '状态为 a|b|c' });
    assert.equal(core.loadCase('TC-B-005').assertions[0].description, '状态为 a|b|c');
  });
});

describe('Assertion Gate：DRAFT → READY', () => {
  it('没有 Assertion 时拒绝进入 READY', () => {
    core.createCase({ case_id: 'TC-C-001', name: '无断言' });
    assert.throws(
      () => core.setCaseStatus('TC-C-001', 'ready'),
      /Case requires at least one Assertion before entering READY/,
    );
    assert.equal(core.loadCase('TC-C-001').status, core.CASE_STATUS.PENDING_REVIEW);
  });

  it('补上 Assertion 后允许进入 READY', () => {
    core.createCase({ case_id: 'TC-C-002', name: '有断言' });
    core.addAssertion('TC-C-002', { id: 'A1', description: '断言' });
    const updated = core.setCaseStatus('TC-C-002', 'ready');
    assert.equal(updated.status, core.CASE_STATUS.READY);
  });

  it('DRAFT 别名等价于 pending_review', () => {
    assert.equal(core.normalizeCaseStatus('DRAFT'), core.CASE_STATUS.PENDING_REVIEW);
    assert.equal(core.normalizeCaseStatus('draft'), core.CASE_STATUS.PENDING_REVIEW);
  });

  it('Legacy Case 的 completed → ready 重跑不受 Gate 阻断', () => {
    // 构造一个 v1.x 风格、无断言、已 completed 的历史 Case
    core.createCase({ case_id: 'TC-C-003', name: '历史用例' });
    const file = core.loadCase('TC-C-003').file;
    const text = readFileSync(file, 'utf-8').replace('status: pending_review', 'status: completed');
    writeFileSync(file, text, 'utf-8');

    const updated = core.setCaseStatus('TC-C-003', 'ready');
    assert.equal(updated.status, core.CASE_STATUS.READY);
    assert.ok(core.isLegacyCase(updated), '仍应被标记为 Legacy');
  });
});

describe('Case 状态机', () => {
  it('合法转换被允许', () => {
    assert.ok(core.canTransition('pending_review', 'ready'));
    assert.ok(core.canTransition('ready', 'running'));
    assert.ok(core.canTransition('running', 'completed'));
    assert.ok(core.canTransition('completed', 'ready'));
  });

  it('非法转换被代码拒绝', () => {
    assert.equal(core.canTransition('pending_review', 'running'), false);
    assert.equal(core.canTransition('pending_review', 'completed'), false);
    core.createCase({ case_id: 'TC-D-001', name: 'x' });
    assert.throws(() => core.setCaseStatus('TC-D-001', 'completed'), /非法状态转换/);
  });

  it('未知状态被拒绝', () => {
    core.createCase({ case_id: 'TC-D-002', name: 'x' });
    assert.throws(() => core.setCaseStatus('TC-D-002', 'DONE'), /Case 状态非法/);
  });
});

describe('Legacy 与人工修改保护', () => {
  it('无断言 Case 被标记 LEGACY_NO_ASSERTION', () => {
    core.createCase({ case_id: 'TC-E-001', name: 'x' });
    const loaded = core.loadCase('TC-E-001');
    assert.ok(core.isLegacyCase(loaded));
    assert.deepEqual(core.caseFlags(loaded), [core.LEGACY_NO_ASSERTION]);
    assert.ok(core.inspectCase('TC-E-001').problems.some((p) => p.includes(core.LEGACY_NO_ASSERTION)));
  });

  it('状态回写只改目标字段，正文与人工新增字段原样保留', () => {
    readyCase(core, 'TC-E-002');
    const file = core.loadCase('TC-E-002').file;

    // 模拟人工编辑：新增未知字段 + 正文备注
    let text = readFileSync(file, 'utf-8');
    text = text.replace('---\n\n#', '---\n\n#'); // 保持结构
    text = text.replace(/^---$/m, '---\nowner: 张三');
    text += '\n## 备注（人工）\n\n这段不许动。\n';
    writeFileSync(file, text, 'utf-8');

    core.setCaseStatus('TC-E-002', 'running');

    const after = readFileSync(file, 'utf-8');
    assert.ok(after.includes('owner: 张三'), '人工新增的 Frontmatter 字段必须保留');
    assert.ok(after.includes('这段不许动。'), '人工新增的正文必须保留');
    assert.ok(after.includes('status: running'), '目标字段应已更新');
    assert.ok(after.includes('| A1 |'), '断言表必须保留');
  });
});

describe('Test Data Matrix 兼容 v1.x', () => {
  it('解析数据组、输入与占位符', () => {
    core.createCase({ case_id: 'TC-F-001', name: 'x' });
    const file = core.loadCase('TC-F-001').file;
    const text = readFileSync(file, 'utf-8').replace(
      '|---|---|---|---|---|---|',
      '|---|---|---|---|---|---|\n'
        + '| D001 | username | admin | string | 正常值 | 登录成功 |\n'
        + '| D001 | password | `p@ss\\|word` | string | 特殊字符 | - |\n'
        + '| D002 | username | TODO | string | 待补 | - |',
    );
    writeFileSync(file, text, 'utf-8');

    const groups = core.loadCase('TC-F-001').test_data;
    assert.equal(groups.length, 2);
    assert.equal(groups[0].input.username, 'admin');
    assert.equal(groups[0].input.password, 'p@ss|word', '转义竖线应被还原');
    assert.equal(groups[0].expected, '登录成功');
    assert.equal(groups[1].hasPlaceholder, true, 'TODO 应被识别为占位符');
    assert.ok(core.inspectCase('TC-F-001').problems.some((p) => p.includes('D002')));
  });
});

describe('Case ID 安全校验（回归）', () => {
  it('含路径分隔符的 Case ID 被拒绝，不得逃逸资产目录', () => {
    for (const bad of ['../../evil', '..\evil', 'a/b', 'a\b', '..', 'x/../y']) {
      assert.throws(
        () => core.createCase({ case_id: bad, name: 'x' }),
        /Case ID 非法/,
        `应拒绝：${bad}`,
      );
    }
  });

  it('读取时同样校验 Case ID', () => {
    assert.throws(() => core.loadCase('../../etc/passwd'), /Case ID 非法/);
  });

  it('正常 Case ID 不受影响', () => {
    const created = core.createCase({ case_id: 'TC-OK_1.2-A', name: 'x' });
    assert.equal(created.case_id, 'TC-OK_1.2-A');
  });
});
