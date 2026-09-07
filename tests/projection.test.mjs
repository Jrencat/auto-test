/**
 * Projection 防伪 —— Release Gate 的核心回归。
 *
 * 背景：`run.json` 只是投影，是一个可以被文本编辑器修改的普通文件。
 * 如果 verify 信任它，那么「改一行 JSON 就能拿到 FINALIZED_PASS」，
 * 整个 Harness 的可信性归零。本文件锁死这条边界。
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import * as core from '../core/index.mjs';
import { cleanupTempStores, makeFile, readyCase, useTempStore } from './helpers.mjs';

beforeEach(useTempStore);
after(cleanupTempStores);

/** 直接改写 run.json（模拟 Agent 手工编辑投影）。 */
function tamperRunJson(runId, mutate) {
  const file = core.runLayout(runId).run;
  const run = JSON.parse(readFileSync(file, 'utf-8'));
  mutate(run);
  writeFileSync(file, JSON.stringify(run, null, 2), 'utf-8');
  return run;
}

function honestPassingRun(caseId) {
  readyCase(core, caseId, ['A1']);
  const run = core.startRun({ caseId });
  const attempt = core.startAttempt(run.run_id);
  core.recordStep(run.run_id, attempt.attempt_id, { name: '打开页面' });
  const ev = core.addEvidence(run.run_id, attempt.attempt_id, {
    type: core.EVIDENCE_TYPE.SCREENSHOT,
    file: makeFile('p.png', `IMG-${caseId}`),
  });
  core.recordAssertion(run.run_id, attempt.attempt_id, {
    assertionId: 'A1',
    status: core.ASSERTION_STATUS.PASS,
    expected: 'x',
    actual: 'x',
    evidenceRefs: [ev.evidence_id],
  });
  core.finishAttempt(run.run_id, attempt.attempt_id, { status: core.ATTEMPT_STATUS.PASS, exitCode: 0 });
  core.recordClaim(run.run_id, core.CLAIM.PASS);
  return run.run_id;
}

describe('事件流是事实来源', () => {
  it('deriveRunFacts 仅凭 events.jsonl 即可重建 Attempt / 断言 / 证据 / Claim', () => {
    const runId = honestPassingRun('TC-P-001');
    const facts = core.loadRunFacts(runId);

    assert.equal(facts.case_id, 'TC-P-001');
    assert.equal(facts.attempts.length, 1);
    assert.equal(facts.attempts[0].attempt_id, 'A001');
    assert.equal(facts.attempts[0].status, core.ATTEMPT_STATUS.PASS);
    assert.equal(facts.attempts[0].steps.length, 1);
    assert.equal(facts.attempts[0].assertions.length, 1);
    assert.equal(facts.attempts[0].evidence_refs.length, 1);
    assert.equal(facts.assertions[0].assertion_id, 'A1');
    assert.equal(facts.agent_claim, core.CLAIM.PASS);
    assert.deepEqual(facts.case_assertions.map((a) => a.id), ['A1']);
  });

  it('诚实的 Run 不产生任何 projection 误报', () => {
    const runId = honestPassingRun('TC-P-002');
    const report = core.verifyRun(runId);
    assert.deepEqual(report.projectionMismatches, []);
    assert.equal(report.ok, true);
    assert.equal(core.finalizeRun(runId).final_status, core.FINAL_STATUS.FINALIZED_PASS);
  });
});

describe('伪造 run.json 无法伪造终局', () => {
  it('把 Attempt 改成 PASS + 塞入断言 → PROJECTION_MISMATCH → INVALID', () => {
    readyCase(core, 'TC-P-010', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-010' });
    core.startAttempt(run.run_id); // 唯一一件真事

    tamperRunJson(run.run_id, (r) => {
      r.state = 'EXECUTED';
      const fake = {
        assertion_id: 'A1', attempt_id: 'A001', status: 'PASS',
        expected: 'x', actual: 'x', evidence_refs: ['ev_fake'], declared: true,
      };
      Object.assign(r.attempts[0], {
        status: 'PASS', exit_code: 0, assertions: [fake], evidence_refs: ['ev_fake'],
      });
      r.assertions = [fake];
      r.evidence_refs = ['ev_fake'];
      r.agent_claim = 'PASS';
    });

    const report = core.verifyRun(run.run_id);
    assert.equal(report.trustworthy, false);
    assert.ok(report.violations.some((v) => v.code === 'PROJECTION_MISMATCH'));
    assert.equal(
      report.execution.actualResult, null,
      '判定必须基于事件流：Attempt 实际仍是 RUNNING',
    );
    assert.deepEqual(report.assertions.notEvaluated, ['A1'], '伪造的断言不得被采信');

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
  });

  it('删掉 case_assertions 想绕过必需断言 → PROJECTION_MISMATCH → INVALID', () => {
    readyCase(core, 'TC-P-011', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-011' });
    const a = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    tamperRunJson(run.run_id, (r) => {
      r.case_assertions = [];
      r.case_flags = [];
    });

    const verdict = core.finalizeRun(run.run_id);
    assert.equal(verdict.final_status, core.FINAL_STATUS.INVALID);
    assert.ok(verdict.violations.some((v) => v.message.includes('case_assertions')));
  });

  it('删除某个 Attempt 的历史 → PROJECTION_MISMATCH → INVALID', () => {
    readyCase(core, 'TC-P-012', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-012' });
    const a1 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.TIMEOUT, message: 't' },
    });
    const a2 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a2.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    // 想把 FLAKY 洗成 PASS：删掉失败的那次 Attempt
    tamperRunJson(run.run_id, (r) => {
      r.attempts = r.attempts.filter((x) => x.attempt_id !== 'A001');
    });

    const report = core.verifyRun(run.run_id);
    assert.ok(report.violations.some((v) => v.code === 'PROJECTION_MISMATCH'));
    assert.equal(report.execution.attempts, 2, '事件流中两个 Attempt 都还在');
    assert.equal(report.execution.flaky, true);
    assert.equal(core.finalizeRun(run.run_id).final_status, core.FINAL_STATUS.INVALID);
  });

  it('伪造 agent_claim 也会被发现', () => {
    readyCase(core, 'TC-P-013', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-013' });
    const a = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    tamperRunJson(run.run_id, (r) => { r.agent_claim = 'PASS'; });

    const report = core.verifyRun(run.run_id);
    assert.ok(report.violations.some((v) => v.message.includes('agent_claim')));
    assert.equal(report.claim.claim, null, 'Claim 必须取自事件流');
  });
});

describe('证据引用必须真实存在', () => {
  it('引用 Manifest 中不存在的证据 → EVIDENCE_REF_DANGLING → INVALID', () => {
    readyCase(core, 'TC-P-020', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-020' });
    const a = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A1',
      status: core.ASSERTION_STATUS.PASS,
      evidenceRefs: ['ev_totally_fake'],
    });
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    core.recordClaim(run.run_id, core.CLAIM.PASS);

    const report = core.verifyRun(run.run_id);
    assert.ok(report.violations.some((v) => v.code === 'EVIDENCE_REF_DANGLING'));
    assert.equal(report.evidence.policy.dangling.length, 1);
    assert.equal(core.finalizeRun(run.run_id).final_status, core.FINAL_STATUS.INVALID);
  });

  it('悬空引用不得被算作满足 Evidence Policy', () => {
    readyCase(core, 'TC-P-021', ['A1']);
    const run = core.startRun({ caseId: 'TC-P-021' });
    const a = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.PASS, evidenceRefs: ['ev_x', 'ev_y'],
    });
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    const report = core.verifyRun(run.run_id);
    assert.equal(report.evidence.policy.satisfied, false);
    assert.ok(report.evidence.policy.missing.some((m) => m.need.includes('有效')));
  });
});
