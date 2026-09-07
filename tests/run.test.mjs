/**
 * Run / Attempt / Assertion Result / Evidence / Event / Resume。
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { after, beforeEach, describe, it } from 'node:test';
import * as core from '../core/index.mjs';
import { cleanupTempStores, makeFile, readyCase, useTempStore } from './helpers.mjs';

beforeEach(useTempStore);
after(cleanupTempStores);

describe('Run 创建与持久化', () => {
  it('创建 Run 并固化 case_version 与 case_flags', () => {
    readyCase(core, 'TC-R-001', ['A1', 'A2']);
    const run = core.startRun({ caseId: 'TC-R-001', actor: 'agent', runtime: 'claude-code', model: 'opus-5' });

    assert.match(run.run_id, /^RUN-\d{8}-\d{6}$/);
    assert.equal(run.case_id, 'TC-R-001');
    assert.equal(run.case_version, 1);
    assert.deepEqual(run.case_flags, []);
    assert.equal(run.state, core.RUN_STATE.CREATED);
    assert.equal(run.final_status, null, 'final_status 只能由 finalize 写入');
    assert.equal(run.case_assertions.length, 2);
    assert.equal(run.actor, 'agent');
    assert.equal(run.runtime, 'claude-code');
  });

  it('Run 可被重新读取，内容一致', () => {
    readyCase(core, 'TC-R-002');
    const run = core.startRun({ caseId: 'TC-R-002' });
    assert.deepEqual(core.loadRun(run.run_id), run);
  });

  it('pending_review(DRAFT) 的 Case 不得执行', () => {
    core.createCase({ case_id: 'TC-R-003', name: 'x' });
    assert.throws(() => core.startRun({ caseId: 'TC-R-003' }), /不得执行/);
  });

  it('RUN_CREATED 事件已写入 events.jsonl', () => {
    readyCase(core, 'TC-R-005');
    const run = core.startRun({ caseId: 'TC-R-005' });
    const events = core.loadEvents(run.run_id);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, core.EVENT_TYPE.RUN_CREATED);
    assert.equal(core.hasExecutionFacts(run.run_id), false, 'RUN_CREATED 不算执行事实');
  });
});

describe('Attempt 历史不可覆盖', () => {
  it('Retry 追加新 Attempt，旧 Attempt 原样保留', () => {
    readyCase(core, 'TC-T-001');
    const run = core.startRun({ caseId: 'TC-T-001' });

    const a1 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      exitCode: 1,
      failure: { type: core.FAILURE_TYPE.ASSERTION, message: '首次失败' },
    });

    const a2 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a2.attempt_id, { status: core.ATTEMPT_STATUS.PASS, exitCode: 0 });

    const loaded = core.loadRun(run.run_id);
    assert.equal(loaded.attempts.length, 2);
    assert.equal(loaded.attempts[0].attempt_id, 'A001');
    assert.equal(loaded.attempts[0].status, core.ATTEMPT_STATUS.FAIL, 'Attempt 1 的失败必须保留');
    assert.equal(loaded.attempts[0].failure.message, '首次失败');
    assert.equal(loaded.attempts[1].attempt_id, 'A002');
    assert.equal(loaded.attempts[1].status, core.ATTEMPT_STATUS.PASS);
    assert.equal(loaded.failures.length, 1);
  });

  it('存在未结束 Attempt 时拒绝开启新 Attempt', () => {
    readyCase(core, 'TC-T-002');
    const run = core.startRun({ caseId: 'TC-T-002' });
    core.startAttempt(run.run_id);
    assert.throws(() => core.startAttempt(run.run_id), /存在未结束的 Attempt/);
  });

  it('已结束的 Attempt 不得重复结束', () => {
    readyCase(core, 'TC-T-003');
    const run = core.startRun({ caseId: 'TC-T-003' });
    const a = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    assert.throws(
      () => core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.FAIL }),
      /已结束/,
    );
  });

  it('FLAKY 序列可被识别', () => {
    readyCase(core, 'TC-T-004');
    const run = core.startRun({ caseId: 'TC-T-004' });
    const a1 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.TIMEOUT, message: 't' },
    });
    const a2 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a2.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    assert.equal(core.isFlaky(core.loadRun(run.run_id)), true);
  });

  it('Retry Policy 在预算内允许重试，超预算拒绝', () => {
    readyCase(core, 'TC-T-005');
    const run = core.startRun({ caseId: 'TC-T-005' });
    const a1 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.TIMEOUT, message: 't' },
    });
    assert.deepEqual(core.shouldRetry(core.loadRun(run.run_id)), {
      retry: true,
      reason: 'retry_on:TIMEOUT',
    });

    const a2 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a2.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.TIMEOUT, message: 't' },
    });
    assert.equal(core.shouldRetry(core.loadRun(run.run_id)).retry, false, 'maxAttempts=2 已用尽');
  });

  it('stopOn 类失败不重试', () => {
    readyCase(core, 'TC-T-006');
    const run = core.startRun({ caseId: 'TC-T-006' });
    const a1 = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL,
      failure: { type: core.FAILURE_TYPE.DATA, message: '数据缺失' },
    });
    assert.equal(core.shouldRetry(core.loadRun(run.run_id)).reason, 'stop_on:DATA');
  });
});

describe('Assertion Result', () => {
  it('记录 PASS / FAIL / NOT_EVALUATED', () => {
    readyCase(core, 'TC-S-001', ['A1', 'A2', 'A3']);
    const run = core.startRun({ caseId: 'TC-S-001' });
    const a = core.startAttempt(run.run_id);

    core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A1', status: core.ASSERTION_STATUS.PASS, expected: 'x', actual: 'x',
    });
    core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A2', status: core.ASSERTION_STATUS.FAIL, expected: 'x', actual: 'y',
    });
    core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A3', status: core.ASSERTION_STATUS.NOT_EVALUATED,
    });

    const loaded = core.loadRun(run.run_id);
    assert.equal(loaded.assertions.length, 3);
    assert.equal(loaded.assertions.find((x) => x.assertion_id === 'A2').actual, 'y');
    assert.ok(loaded.assertions.every((x) => x.declared), '均应识别为 Case 已声明');
  });

  it('未在 Case 中声明的断言被标记 declared=false', () => {
    readyCase(core, 'TC-S-002', ['A1']);
    const run = core.startRun({ caseId: 'TC-S-002' });
    const a = core.startAttempt(run.run_id);
    const result = core.recordAssertion(run.run_id, a.attempt_id, {
      assertionId: 'A99', status: core.ASSERTION_STATUS.PASS,
    });
    assert.equal(result.declared, false);
  });

  it('Run 级汇总以最后一次 Attempt 的结果为准', () => {
    readyCase(core, 'TC-S-003', ['A1']);
    const run = core.startRun({ caseId: 'TC-S-003' });

    const a1 = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, a1.attempt_id, { assertionId: 'A1', status: core.ASSERTION_STATUS.FAIL });
    core.finishAttempt(run.run_id, a1.attempt_id, {
      status: core.ATTEMPT_STATUS.FAIL, failure: { type: core.FAILURE_TYPE.ASSERTION, message: 'x' },
    });

    const a2 = core.startAttempt(run.run_id);
    core.recordAssertion(run.run_id, a2.attempt_id, { assertionId: 'A1', status: core.ASSERTION_STATUS.PASS });
    core.finishAttempt(run.run_id, a2.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    const loaded = core.loadRun(run.run_id);
    assert.equal(loaded.assertions.length, 1);
    assert.equal(loaded.assertions[0].status, core.ASSERTION_STATUS.PASS);
    assert.equal(loaded.assertions[0].attempt_id, 'A002');
    assert.equal(
      loaded.attempts[0].assertions[0].status,
      core.ASSERTION_STATUS.FAIL,
      'Attempt 1 的断言历史仍必须保留',
    );
  });

  it('非法断言状态被拒绝', () => {
    readyCase(core, 'TC-S-004');
    const run = core.startRun({ caseId: 'TC-S-004' });
    const a = core.startAttempt(run.run_id);
    assert.throws(
      () => core.recordAssertion(run.run_id, a.attempt_id, { assertionId: 'A1', status: 'OK' }),
      /assertion status 取值非法/,
    );
  });
});

describe('Evidence 登记与完整性', () => {
  it('登记证据并计算 SHA256', () => {
    readyCase(core, 'TC-V-001');
    const run = core.startRun({ caseId: 'TC-V-001' });
    const a = core.startAttempt(run.run_id);
    const src = makeFile('shot.png', 'PNG-CONTENT');

    const entry = core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: src,
    });

    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(entry.size, Buffer.byteLength('PNG-CONTENT'));
    assert.equal(entry.attempt_id, a.attempt_id);
    assert.ok(existsSync(core.resolveEvidencePath(run.run_id, entry)), '证据应已复制进 Run 目录');
    assert.ok(core.loadRun(run.run_id).evidence_refs.includes(entry.evidence_id));
  });

  it('未修改时完整性校验通过', () => {
    readyCase(core, 'TC-V-002');
    const run = core.startRun({ caseId: 'TC-V-002' });
    const a = core.startAttempt(run.run_id);
    core.addEvidence(run.run_id, a.attempt_id, { type: core.EVIDENCE_TYPE.STDOUT, file: makeFile('o.log', 'ok') });

    const result = core.verifyEvidence(run.run_id);
    assert.equal(result.ok, true);
    assert.equal(result.checked, 1);
  });

  it('证据被修改后 SHA256 不匹配可被检测', () => {
    readyCase(core, 'TC-V-003');
    const run = core.startRun({ caseId: 'TC-V-003' });
    const a = core.startAttempt(run.run_id);
    const entry = core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('s.png', 'ORIGINAL'),
    });
    const original = entry.sha256;

    writeFileSync(core.resolveEvidencePath(run.run_id, entry), 'TAMPERED', 'utf-8');

    const result = core.verifyEvidence(run.run_id);
    assert.equal(result.ok, false);
    assert.equal(result.mismatched.length, 1);
    assert.equal(result.mismatched[0].expected_sha256, original);
    assert.notEqual(result.mismatched[0].actual_sha256, original);
  });

  it('证据文件缺失可被检测', () => {
    readyCase(core, 'TC-V-004');
    const run = core.startRun({ caseId: 'TC-V-004' });
    const a = core.startAttempt(run.run_id);
    const entry = core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.TRACE, file: makeFile('t.zip', 'TRACE'),
    });
    rmSync(core.resolveEvidencePath(run.run_id, entry));

    const result = core.verifyEvidence(run.run_id);
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, 1);
  });

  it('非法证据类型被拒绝', () => {
    readyCase(core, 'TC-V-005');
    const run = core.startRun({ caseId: 'TC-V-005' });
    const a = core.startAttempt(run.run_id);
    assert.throws(
      () => core.addEvidence(run.run_id, a.attempt_id, { type: 'meme', file: makeFile('x', 'y') }),
      /evidence type 取值非法/,
    );
  });
});

describe('Run-level Resume', () => {
  it('resume 保持同一个 run_id，并保留全部已有事实', () => {
    readyCase(core, 'TC-U-001', ['A1']);
    const run = core.startRun({ caseId: 'TC-U-001' });
    const a = core.startAttempt(run.run_id);
    core.recordStep(run.run_id, a.attempt_id, { name: '登录' });
    core.recordStep(run.run_id, a.attempt_id, { name: '打开列表页' });
    core.recordAssertion(run.run_id, a.attempt_id, { assertionId: 'A1', status: core.ASSERTION_STATUS.PASS });
    core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('p.png', 'IMG'),
    });
    const eventsBefore = core.loadEvents(run.run_id).length;

    // 模拟中断：Attempt 未结束
    const resumed = core.resumeRun(run.run_id);

    assert.equal(resumed.run.run_id, run.run_id, 'run_id 必须保持不变');
    assert.equal(resumed.run.attempts.length, 1);
    assert.equal(resumed.run.attempts[0].steps.length, 2);
    assert.equal(resumed.run.assertions.length, 1);
    assert.equal(resumed.run.evidence_refs.length, 1);
    assert.equal(resumed.openAttempts.length, 1, '未结束的 Attempt 应被如实报告');
    assert.equal(resumed.events.length, eventsBefore + 1, '应追加 RUN_RESUMED 事件');
    assert.equal(resumed.events.at(-1).type, core.EVENT_TYPE.RUN_RESUMED);
  });

  it('resume 后可继续在同一 Run 上完成执行', () => {
    readyCase(core, 'TC-U-002', ['A1']);
    const run = core.startRun({ caseId: 'TC-U-002' });
    const a = core.startAttempt(run.run_id);
    core.recordStep(run.run_id, a.attempt_id, { name: '步骤1' });

    core.resumeRun(run.run_id);
    core.recordStep(run.run_id, a.attempt_id, { name: '步骤2' });
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });

    const loaded = core.loadRun(run.run_id);
    assert.equal(loaded.run_id, run.run_id);
    assert.equal(loaded.attempts[0].steps.length, 2);
    assert.equal(loaded.attempts[0].status, core.ATTEMPT_STATUS.PASS);
  });

  it('已 FINALIZED 的 Run 不可 resume、不可写入', () => {
    readyCase(core, 'TC-U-003', ['A1']);
    const run = core.startRun({ caseId: 'TC-U-003' });
    const a = core.startAttempt(run.run_id);
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    core.finalizeRun(run.run_id);

    assert.throws(() => core.resumeRun(run.run_id), /已 FINALIZED/);
    assert.throws(() => core.startAttempt(run.run_id), /不可再写入/);
    assert.throws(() => core.recordClaim(run.run_id, 'PASS'), /不可再写入/);
  });
});

describe('事件流不变量（回归）', () => {
  it('证据事件的 type 必须是 EVIDENCE_REGISTERED，不得被 payload 的 type 覆盖', () => {
    readyCase(core, 'TC-W-001', ['A1']);
    const run = core.startRun({ caseId: 'TC-W-001' });
    const a = core.startAttempt(run.run_id);
    core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.SCREENSHOT, file: makeFile('w.png', 'IMG'),
    });

    const evidenceEvents = core.loadEvents(run.run_id)
      .filter((e) => e.type === core.EVENT_TYPE.EVIDENCE_REGISTERED);
    assert.equal(evidenceEvents.length, 1);
    assert.equal(evidenceEvents[0].evidence_type, core.EVIDENCE_TYPE.SCREENSHOT);
  });

  it('仅登记证据（无 step / 无 attempt-finish）也构成执行事实', () => {
    readyCase(core, 'TC-W-002', ['A1']);
    const run = core.startRun({ caseId: 'TC-W-002' });
    assert.equal(core.hasExecutionFacts(run.run_id), false);
    const a = core.startAttempt(run.run_id);
    assert.equal(core.hasExecutionFacts(run.run_id), true, 'ATTEMPT_STARTED 即为执行事实');
    core.addEvidence(run.run_id, a.attempt_id, {
      type: core.EVIDENCE_TYPE.STDOUT, file: makeFile('w.log', 'x'),
    });
    assert.ok(
      core.loadEvents(run.run_id).some((e) => core.EXECUTION_FACT_EVENTS.includes(e.type)),
    );
  });

  it('所有事件都带 event_id / run_id / type / timestamp', () => {
    readyCase(core, 'TC-W-003', ['A1']);
    const run = core.startRun({ caseId: 'TC-W-003' });
    const a = core.startAttempt(run.run_id);
    core.recordStep(run.run_id, a.attempt_id, { name: 's' });
    core.finishAttempt(run.run_id, a.attempt_id, { status: core.ATTEMPT_STATUS.PASS });
    for (const e of core.loadEvents(run.run_id)) {
      assert.match(e.event_id, /^evt_/);
      assert.equal(e.run_id, run.run_id);
      assert.ok(Object.values(core.EVENT_TYPE).includes(e.type), `未知事件类型：${e.type}`);
      assert.ok(e.timestamp);
    }
  });
});
