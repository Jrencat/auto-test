/**
 * Verification 与 Finalization —— Phase 1 的核心验收场景 A–G。
 *
 * 每个场景都断言：**Harness 的终局判定不受 Agent Claim 影响**。
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import * as core from '../core/index.mjs';
import { cleanupTempStores, makeFile, readyCase, useTempStore } from './helpers.mjs';

beforeEach(useTempStore);
after(cleanupTempStores);

/** 造一个"证据齐备、断言通过"的完整 Attempt。 */
function passingAttempt(runId, assertionIds = ['A1']) {
  const attempt = core.startAttempt(runId);
  core.recordStep(runId, attempt.attempt_id, { name: '打开页面' });
  for (const id of assertionIds) {
    const ev = core.addEvidence(runId, attempt.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT,
      file: makeFile(`${id}.png`, `IMG-${id}-${Date.now()}`),
    });
    core.recordAssertion(runId, attempt.attempt_id, {
      assertionId: id,
      status: core.ASSERTION_STATUS.PASS,
      expected: '期望值',
      actual: '期望值',
      evidenceRefs: [ev.evidence_id],
    });
  }
  core.finishAttempt(runId, attempt.attempt_id, { status: core.ATTEMPT_STATUS.PASS, exitCode: 0 });
  return attempt;
}

/** 造一个 Legacy（无断言定义）且已 ready 的 Case。 */
function legacyReadyCase(caseId) {
  core.createCase({ case_id: caseId, name: '历史用例' });
  const file = core.loadCase(caseId).file;
  writeFileSync(
    file,
    readFileSync(file, 'utf-8').replace('status: pending_review', 'status: completed'),
    'utf-8',
  );
  return core.setCaseStatus(caseId, 'ready');
}

describe('Scenario A —— 正常 PASS', () => {
  it('真实执行 + 断言 PASS + 证据完整 → FINALIZED_PASS', () => {
    readyCase(core, 'TC-A-100', ['A1', 'A2']);
    const run = core.startRun({ caseId: 'TC-A-100', actor: 'agent', runtime: 'test' });
    passingAttempt(run.run_id, ['A1', 'A2']);
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const report = core.verifyRun(run.run_id);
    assert.equal(report.violations.length, 0);
    assert.equal(report.gaps.length, 0, JSON.stringify(report.gaps));
    assert.equal(report.claim.consistency, core.CLAIM_CONSISTENCY.CONSISTENT);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.FINALIZED_PASS);
    assert.deepEqual(verdict.assertions.passed, ['A1', 'A2']);
    assert.equal(core.loadRun(run.run_id).state, core.RUN_STATE.FINALIZED);
  });

  it('无 Claim 也可通过（终局仅依据执行事实）', () => {
    readyCase(core, 'TC-A-101');
    const run = core.startRun({ caseId: 'TC-A-101' });
    passingAttempt(run.run_id);
    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.FINALIZED_PASS);
    assert.equal(verdict.claim_consistency, core.CLAIM_CONSISTENCY.NOT_CLAIMED);
  });
});

describe('Scenario B —— 真实 Product Bug', () => {
  it('真实执行 + 必需断言 FAIL → FINALIZED_FAIL', () => {
    readyCase(core, 'TC-B-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-B-100' });
    const attempt = core.startAttempt(run.run_id);
    const ev = core.addEvidence(run.run_id, attempt.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('fail.png', 'IMG-FAIL'),
    });
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1',
      status: core.ASSERTION_STATUS.FAIL,
      expected: '继续填写',
      actual: '修改',
      evidenceRefs: [ev.evidence_id],
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      exitCode: 1,
      failure: { type: core.FAILURE_TYPE.PRODUCT_BUG, message: '按钮文案与需求不符' },
    });
    core.recordDiagnostic(run.run_id, {
      attemptId: attempt.attempt_id,
      classification: core.FAILURE_TYPE.PRODUCT_BUG,
      hypothesis: '列表渲染未按 status 分支',
      diagnostic: '接口返回 status=暂存，前端仍渲染「修改」',
      action: '提交缺陷单',
      evidenceRefs: [ev.evidence_id],
    });
    core.recordClaim(run.run_id, core.CLAIM.FAIL);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.FINALIZED_FAIL);
    assert.deepEqual(verdict.assertions.failed, ['A1']);
    assert.equal(verdict.claim_consistency, core.CLAIM_CONSISTENCY.CONSISTENT);
    assert.equal(core.loadRun(run.run_id).diagnostics.length, 1, '诊断必须被 Harness 保存');
  });
});

describe('Scenario C —— Flaky', () => {
  it('Attempt 1 FAIL、Attempt 2 PASS → FLAKY（不是 PASS）', () => {
    readyCase(core, 'TC-C-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-C-100' });

    const a1 = core.startAttempt(run.run_id);
    const ev1 = core.addEvidence(run.run_id, a1.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('a1.png', 'IMG-1'),
    });
    core.recordAssertion(run.run_id, a1.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.FAIL, evidenceRefs: [ev1.evidence_id],
    });
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.TIMEOUT, message: '首次超时' },
    });

    passingAttempt(run.run_id, ['A1']);
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.FLAKY);
    assert.equal(verdict.execution.flaky, true);
    assert.equal(verdict.execution.attempts, 2, '两个 Attempt 都必须保留');

    const loaded = core.loadRun(run.run_id);
    assert.equal(loaded.attempts[0].status, core.ATTEMPT_STATUS.FAIL);
    assert.equal(loaded.attempts[1].status, core.ATTEMPT_STATUS.PASS);
  });
});

describe('Scenario D —— Evidence 缺失', () => {
  it('断言通过但无证据支撑 → INCONCLUSIVE', () => {
    readyCase(core, 'TC-D-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-D-100' });
    const attempt = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.PASS, expected: 'x', actual: 'x',
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INCONCLUSIVE);
    assert.ok(verdict.gaps.some((g) => g.code === 'EVIDENCE_POLICY_UNSATISFIED'));
  });

  it('必需断言未求值 → INCONCLUSIVE', () => {
    readyCase(core, 'TC-D-101', ['A1', 'A2']);
    const run = core.startRun({ caseId: 'TC-D-101' });
    passingAttempt(run.run_id, ['A1']); // A2 从未求值

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INCONCLUSIVE);
    assert.deepEqual(verdict.assertions.not_evaluated, ['A2']);
  });

  it('Legacy Case（无断言定义）永远不得 FINALIZED_PASS', () => {
    legacyReadyCase('TC-D-102');
    const run = core.startRun({ caseId: 'TC-D-102' });
    assert.deepEqual(run.case_flags, [core.LEGACY_NO_ASSERTION]);

    const attempt = core.startAttempt(run.run_id);
    core.recordStep(run.run_id, attempt.attempt_id, { name: '跑完了' });
    core.finishAttempt(run.run_id, attempt.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const verdict = core.finalizeRun(run.run_id);
    assert.notEqual(verdict.final_status, core.FINAL_STATUS.FINALIZED_PASS);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INCONCLUSIVE);
    assert.ok(verdict.gaps.some((g) => g.code === core.LEGACY_NO_ASSERTION));
  });
});

describe('Scenario E —— Environment Blocked', () => {
  it('环境不可用 → BLOCKED', () => {
    readyCase(core, 'TC-E-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-E-100' });
    const attempt = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, attempt.attempt_id, {
      status: core.ATTEMPT_STATUS.BLOCKED,
      failure: { type: core.FAILURE_TYPE.ENVIRONMENT, message: '网关 10110 不可达' },
    });
    core.blockRun(run.run_id, '依赖服务不可用：网关 10110 拒绝连接');
    core.recordClaim(run.run_id, core.CLAIM.BLOCKED);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.BLOCKED);
  });
});

describe('Scenario F —— Agent 谎报 PASS', () => {
  it('Claim=PASS 但没有任何执行事实 → INVALID', () => {
    readyCase(core, 'TC-F-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-F-100' });
    core.recordClaim(run.run_id, core.CLAIM.PASS); // 直接声称通过，一步没跑

    const report = core.verifyRun(run.run_id);
    assert.equal(report.execution.hasFacts, false);
    assert.equal(report.trustworthy, false);
    assert.ok(report.violations.some((v) => v.code === 'NO_EXECUTION_FACTS'));

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
    assert.equal(verdict.claim, core.CLAIM.PASS, 'Claim 被如实保留');
    assert.notEqual(verdict.final_status, core.FINAL_STATUS.FINALIZED_PASS);
  });

  it('Claim=PASS 但必需断言失败 → INVALID（Claim 与事实矛盾）', () => {
    readyCase(core, 'TC-F-101', ['A1']);
    const run = core.startRun({ caseId: 'TC-F-101' });
    const attempt = core.startAttempt(run.run_id);
    const ev = core.addEvidence(run.run_id, attempt.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('x.png', 'IMG'),
    });
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.FAIL, evidenceRefs: [ev.evidence_id],
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.ASSERTION, message: '断言失败' },
    });
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
    assert.equal(verdict.claim_consistency, core.CLAIM_CONSISTENCY.CONTRADICTED);
  });

  it('Agent 直接改 run.json 的 final_status 不会被采信', () => {
    readyCase(core, 'TC-F-102', ['A1']);
    const run = core.startRun({ caseId: 'TC-F-102' });
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    // 模拟 Agent 手改持久化文件
    const runFile = core.runLayout(run.run_id).run;
    const tampered = JSON.parse(readFileSync(runFile, 'utf-8'));
    tampered.final_status = core.FINAL_STATUS.FINALIZED_PASS;
    writeFileSync(runFile, JSON.stringify(tampered, null, 2), 'utf-8');

    // finalize 重新依据事实判定，覆盖伪造值
    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
    assert.equal(core.loadRun(run.run_id).final_status, core.FINAL_STATUS.INVALID);
  });
});

describe('Scenario G —— Evidence 被篡改', () => {
  it('证据 SHA256 不匹配 → INVALID', () => {
    readyCase(core, 'TC-G-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-G-100' });
    passingAttempt(run.run_id, ['A1']);
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    // 未篡改前应当可以通过
    assert.equal(core.verifyRun(run.run_id).ok, true);

    const entry = core.loadManifest(run.run_id).evidence[0];
    writeFileSync(core.resolveEvidencePath(run.run_id, entry), 'TAMPERED', 'utf-8');

    const report = core.verifyRun(run.run_id);
    assert.equal(report.evidence.integrity.ok, false);
    assert.ok(report.violations.some((v) => v.code === 'EVIDENCE_TAMPERED'));

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
  });

  it('证据文件被删除 → INVALID', () => {
    readyCase(core, 'TC-G-101', ['A1']);
    const run = core.startRun({ caseId: 'TC-G-101' });
    passingAttempt(run.run_id, ['A1']);

    const entry = core.loadManifest(run.run_id).evidence[0];
    rmSync(core.resolveEvidencePath(run.run_id, entry));

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
    assert.ok(verdict.violations.some((v) => v.code === 'EVIDENCE_FILE_MISSING'));
  });
});

describe('Finalization 不变量', () => {
  it('finalize 幂等：已终局的 Run 不重算、不覆盖', () => {
    readyCase(core, 'TC-I-100', ['A1']);
    const run = core.startRun({ caseId: 'TC-I-100' });
    passingAttempt(run.run_id, ['A1']);

    const first = core.finalizeRun(run.run_id);
    const second = core.finalizeRun(run.run_id);
    assert.equal(second.already_finalized, true);
    assert.equal(second.final_status, first.final_status);
    assert.equal(second.finalized_at, first.finalized_at);
  });

  it('verdict.json 落盘且可复读', () => {
    readyCase(core, 'TC-I-101', ['A1']);
    const run = core.startRun({ caseId: 'TC-I-101' });
    passingAttempt(run.run_id, ['A1']);
    const verdict = core.finalizeRun(run.run_id);

    const reloaded = core.loadVerdict(run.run_id);
    assert.equal(reloaded.final_status, verdict.final_status);
    assert.equal(reloaded.schema_version, core.SCHEMA_VERSION);
  });

  it('Attempt 未结束时不得 FINALIZED_PASS', () => {
    readyCase(core, 'TC-I-102', ['A1']);
    const run = core.startRun({ caseId: 'TC-I-102' });
    core.startAttempt(run.run_id); // 开着不结束
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const verdict = core.finalizeRun(run.run_id);
    assert.notEqual(verdict.final_status, core.FINAL_STATUS.FINALIZED_PASS);
  });

  it('六个终局状态全部可达', () => {
    const reached = new Set();

    // PASS
    readyCase(core, 'TC-Z-001', ['A1']);
    let run = core.startRun({ caseId: 'TC-Z-001' });
    passingAttempt(run.run_id, ['A1']);
    reached.add(core.finalizeRun(run.run_id).final_status);

    // FAIL
    readyCase(core, 'TC-Z-002', ['A1']);
    run = core.startRun({ caseId: 'TC-Z-002' });
    let attempt = core.startAttempt(run.run_id);
    let ev = core.addEvidence(run.run_id, attempt.attempt_id, {
      type: core.EVIDENCE_TYPE.STDOUT, file: makeFile('o.log', 'fail'),
    });
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.FAIL, evidenceRefs: [ev.evidence_id],
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, { status: core.ATTEMPT_STATUS.FAIL });
    reached.add(core.finalizeRun(run.run_id).final_status);

    // FLAKY
    readyCase(core, 'TC-Z-003', ['A1']);
    run = core.startRun({ caseId: 'TC-Z-003' });
    attempt = core.startAttempt(run.run_id);
    ev = core.addEvidence(run.run_id, attempt.attempt_id, {
      type: core.EVIDENCE_TYPE.STDOUT, file: makeFile('o.log', 'x'),
    });
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.FAIL, evidenceRefs: [ev.evidence_id],
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL, failure: { type: core.FAILURE_TYPE.TIMEOUT, message: 't' },
    });
    passingAttempt(run.run_id, ['A1']);
    reached.add(core.finalizeRun(run.run_id).final_status);

    // INCONCLUSIVE
    readyCase(core, 'TC-Z-004', ['A1']);
    run = core.startRun({ caseId: 'TC-Z-004' });
    attempt = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, attempt.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.PASS,
    });
    core.finishAttempt(run.run_id, attempt.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    reached.add(core.finalizeRun(run.run_id).final_status);

    // BLOCKED
    readyCase(core, 'TC-Z-005', ['A1']);
    run = core.startRun({ caseId: 'TC-Z-005' });
    core.blockRun(run.run_id, '环境不可用');
    reached.add(core.finalizeRun(run.run_id).final_status);

    // INVALID
    readyCase(core, 'TC-Z-006', ['A1']);
    run = core.startRun({ caseId: 'TC-Z-006' });
    core.recordClaim(run.run_id, core.CLAIM.PASS);
    reached.add(core.finalizeRun(run.run_id).final_status);

    assert.deepEqual([...reached].sort(), [...core.FINAL_STATUSES].sort());
  });
});
