/**
 * verify —— 对一个 Run 的事实做机器核对。
 *
 * 回答的问题只有一个：**这个 Run 上记录的事实，可信吗？**
 * 它不决定 PASS/FAIL（那是 finalize 的事），只区分三类结果：
 *   - violations：事实不可信（谎报 / 投影被篡改 / 证据被改）→ finalize 判 INVALID
 *   - gaps：事实可信但不充分（证据不足 / 必需断言未求值）→ finalize 判 INCONCLUSIVE
 *   - 都没有：事实可信且充分，finalize 可据 Assertion 结果给出终局
 *
 * 🔒 **事实来源纪律（Release Gate 的核心）**：
 * 本模块的所有判定一律基于 `deriveRunFacts(events)` 重建出的事实，
 * **绝不信任 `run.json`** —— 后者只是可被手工编辑的投影。
 * 两者不一致时判 `PROJECTION_MISMATCH`（INVALID），因为那意味着有人在改账本。
 */
import {
  ASSERTION_STATUS,
  ATTEMPT_STATUS,
  CLAIM,
  CLAIM_CONSISTENCY,
  LEGACY_NO_ASSERTION,
  RUN_STATE,
} from './constants.mjs';
import { loadManifest, verifyEvidence } from './evidence-store.mjs';
import { evaluateEvidence, isFlaky, loadPolicy } from './policy.mjs';
import { deriveRunFacts, loadEvents, loadRun } from './run-store.mjs';

/** 最后一个已结束的 Attempt。仍在 RUNNING 的不算——它还没有结果。 */
function lastFinishedAttempt(facts) {
  const finished = facts.attempts.filter((a) => a.status !== ATTEMPT_STATUS.RUNNING);
  return finished.length ? finished[finished.length - 1] : null;
}

/** 由执行事实推导出的实际结果，与 Agent Claim 完全独立。 */
function actualResult(facts) {
  if (facts.blocked) return 'BLOCKED';
  const last = lastFinishedAttempt(facts);
  if (!last) return null;
  if (last.status === ATTEMPT_STATUS.BLOCKED) return 'BLOCKED';
  return last.status === ATTEMPT_STATUS.PASS ? 'PASS' : 'FAIL';
}

function summarizeAssertions(declared, facts) {
  const requiredIds = declared.filter((a) => a.required).map((a) => a.id);
  const byId = new Map(facts.assertions.map((a) => [a.assertion_id, a]));

  const evaluated = [];
  const notEvaluated = [];
  const failed = [];
  const passed = [];

  for (const id of requiredIds) {
    const result = byId.get(id);
    if (!result || result.status === ASSERTION_STATUS.NOT_EVALUATED) {
      notEvaluated.push(id);
      continue;
    }
    evaluated.push(id);
    if (result.status === ASSERTION_STATUS.FAIL) failed.push(id);
    else passed.push(id);
  }

  const declaredIds = new Set(declared.map((a) => a.id));
  const undeclared = facts.assertions
    .filter((a) => !declaredIds.has(a.assertion_id))
    .map((a) => a.assertion_id);

  return {
    declared: declared.length,
    required: requiredIds.length,
    evaluated,
    notEvaluated,
    passed,
    failed,
    undeclaredRecorded: undeclared,
  };
}

function checkState(run, facts) {
  const problems = [];
  if (!Object.values(RUN_STATE).includes(run.state)) {
    problems.push(`Run state 非法：${run.state}`);
  }
  const open = facts.attempts.filter((a) => a.status === ATTEMPT_STATUS.RUNNING);
  if (open.length > 1) {
    problems.push(`同时存在多个未结束 Attempt：${open.map((a) => a.attempt_id).join(', ')}`);
  }
  const sequences = facts.attempts.map((a) => a.sequence);
  const expected = sequences.map((_, i) => i + 1);
  if (JSON.stringify(sequences) !== JSON.stringify(expected)) {
    problems.push(`Attempt 序号不连续（事件流可能被删改）：[${sequences.join(', ')}]`);
  }
  return { valid: problems.length === 0, problems };
}

/**
 * 比对 `run.json` 投影与事件流事实。
 *
 * 任何不一致都是严重信号：要么有人手改了 projection，要么 Core 有 bug。
 * 两种情况都不该让 Run 通过——所以一律判为 violation。
 */
function reconcileProjection(run, facts) {
  const mismatches = [];
  const note = (field, expected, actual) => {
    mismatches.push(`${field}：事件流=${JSON.stringify(expected)}，run.json=${JSON.stringify(actual)}`);
  };

  if (run.attempts.length !== facts.attempts.length) {
    note('attempts 数量', facts.attempts.length, run.attempts.length);
  }

  const projected = new Map(run.attempts.map((a) => [a.attempt_id, a]));
  for (const fact of facts.attempts) {
    const p = projected.get(fact.attempt_id);
    if (!p) {
      note(`attempt ${fact.attempt_id}`, '存在', '缺失');
      continue;
    }
    if (p.status !== fact.status) note(`attempt ${fact.attempt_id}.status`, fact.status, p.status);
    if (p.sequence !== fact.sequence) note(`attempt ${fact.attempt_id}.sequence`, fact.sequence, p.sequence);
    if ((p.assertions || []).length !== fact.assertions.length) {
      note(`attempt ${fact.attempt_id}.assertions 数量`, fact.assertions.length, (p.assertions || []).length);
    }
    if ((p.evidence_refs || []).length !== fact.evidence_refs.length) {
      note(
        `attempt ${fact.attempt_id}.evidence_refs 数量`,
        fact.evidence_refs.length,
        (p.evidence_refs || []).length,
      );
    }
  }
  for (const id of projected.keys()) {
    if (!facts.attempts.some((a) => a.attempt_id === id)) {
      note(`attempt ${id}`, '不存在', '存在（事件流中无此 Attempt）');
    }
  }

  const factAssertions = new Map(facts.assertions.map((a) => [a.assertion_id, a.status]));
  const runAssertions = new Map((run.assertions || []).map((a) => [a.assertion_id, a.status]));
  for (const [id, status] of factAssertions) {
    if (!runAssertions.has(id)) note(`assertion ${id}`, status, '缺失');
    else if (runAssertions.get(id) !== status) note(`assertion ${id}.status`, status, runAssertions.get(id));
  }
  for (const [id, status] of runAssertions) {
    if (!factAssertions.has(id)) note(`assertion ${id}`, '不存在（事件流中无此断言）', status);
  }

  if ((run.agent_claim ?? null) !== (facts.agent_claim ?? null)) {
    note('agent_claim', facts.agent_claim, run.agent_claim);
  }
  if (Boolean(run.blocked) !== Boolean(facts.blocked)) {
    note('blocked', Boolean(facts.blocked), Boolean(run.blocked));
  }
  if ((run.evidence_refs || []).length !== facts.evidence_refs.length) {
    note('evidence_refs 数量', facts.evidence_refs.length, (run.evidence_refs || []).length);
  }

  // Case 契约（声明了哪些断言、是否 Legacy）同样不得被 projection 篡改
  if (facts.case_assertions) {
    const factIds = facts.case_assertions.map((a) => `${a.id}:${a.required}`).sort().join(',');
    const runIds = (run.case_assertions || []).map((a) => `${a.id}:${a.required}`).sort().join(',');
    if (factIds !== runIds) note('case_assertions', factIds, runIds);
  }
  if (facts.case_flags) {
    const a = [...facts.case_flags].sort().join(',');
    const b = [...(run.case_flags || [])].sort().join(',');
    if (a !== b) note('case_flags', a, b);
  }

  return mismatches;
}

/**
 * 核对 Agent Claim 与执行事实。
 *
 * 三层严格分离：Agent Claim / Actual Execution Result / Final Harness Result。
 * 本函数只处理前两层的关系，第三层由 finalize 决定。
 */
function checkClaim(claim, actual, assertions, hasFacts) {
  const reasons = [];

  if (!claim) {
    return { claim: null, consistency: CLAIM_CONSISTENCY.NOT_CLAIMED, reasons };
  }
  if (!hasFacts) {
    reasons.push('Claim 已记录，但事件流中没有任何执行事实事件（未真实执行）');
    return { claim, consistency: CLAIM_CONSISTENCY.UNVERIFIABLE, reasons };
  }
  if (actual === null) {
    reasons.push('没有已结束的 Attempt，无法与 Claim 比对');
    return { claim, consistency: CLAIM_CONSISTENCY.UNVERIFIABLE, reasons };
  }
  if (claim === CLAIM.PASS && assertions.failed.length > 0) {
    reasons.push(`Claim=PASS 但必需断言失败：${assertions.failed.join(', ')}`);
    return { claim, consistency: CLAIM_CONSISTENCY.CONTRADICTED, reasons };
  }
  if (claim === CLAIM.PASS && actual === 'FAIL') {
    reasons.push('Claim=PASS 但最后一个 Attempt 的执行结果为 FAIL');
    return { claim, consistency: CLAIM_CONSISTENCY.CONTRADICTED, reasons };
  }
  if (claim === CLAIM.FAIL && actual === 'PASS' && assertions.failed.length === 0) {
    reasons.push('Claim=FAIL 但执行事实与断言均为通过');
    return { claim, consistency: CLAIM_CONSISTENCY.CONTRADICTED, reasons };
  }

  return { claim, consistency: CLAIM_CONSISTENCY.CONSISTENT, reasons };
}

/**
 * 校验一个 Run。纯读取，不修改任何持久化状态。
 */
export function verifyRun(runId, opts = {}) {
  const run = loadRun(runId, opts);
  const events = loadEvents(runId, opts);
  const facts = deriveRunFacts(events);
  const policy = opts.policy || loadPolicy(opts);
  const manifest = loadManifest(runId, opts);

  const warnings = [];

  // Case 契约优先取事件流；旧版本事件没有该字段时降级到 run.json 并告警
  let declared = facts.case_assertions;
  if (!declared) {
    declared = run.case_assertions || [];
    warnings.push('RUN_CREATED 事件未记录 Case 契约（旧 schema），已降级使用 run.json 的声明');
  }
  const legacyFlags = facts.case_flags || run.case_flags || [];

  const hasFacts = events.some((e) =>
    ['ATTEMPT_STARTED', 'STEP_COMPLETED', 'ASSERTION_RECORDED', 'EVIDENCE_REGISTERED', 'ATTEMPT_FINISHED']
      .includes(e.type));

  const integrity = verifyEvidence(runId, opts);
  const evidencePolicy = evaluateEvidence(facts, manifest, policy, declared);
  const assertions = summarizeAssertions(declared, facts);
  const state = checkState(run, facts);
  const actual = actualResult(facts);
  const claim = checkClaim(facts.agent_claim, actual, assertions, hasFacts);
  const flaky = isFlaky(facts);
  const legacy = legacyFlags.includes(LEGACY_NO_ASSERTION) || declared.length === 0;
  const projectionMismatches = reconcileProjection(run, facts);

  /* ---- violations：事实不可信 → INVALID ---- */
  const violations = [];

  for (const m of projectionMismatches) {
    violations.push({
      code: 'PROJECTION_MISMATCH',
      message: `run.json 与事件流不一致（投影疑似被手工修改）—— ${m}`,
    });
  }
  if (facts.agent_claim === CLAIM.PASS && !hasFacts) {
    violations.push({
      code: 'NO_EXECUTION_FACTS',
      message: 'Agent Claim = PASS，但事件流中没有任何执行事实事件（ATTEMPT_STARTED / STEP_COMPLETED / '
        + 'ASSERTION_RECORDED / EVIDENCE_REGISTERED / ATTEMPT_FINISHED），无法证明测试真的执行过',
    });
  }
  for (const m of integrity.missing) {
    violations.push({
      code: 'EVIDENCE_FILE_MISSING',
      message: `证据文件缺失：${m.evidence_id}（${m.path}）`,
    });
  }
  for (const m of integrity.mismatched) {
    violations.push({
      code: 'EVIDENCE_TAMPERED',
      message: `证据 SHA256 不匹配（文件已被修改）：${m.evidence_id}（${m.path}）\n`
        + `    登记：${m.expected_sha256}\n    实际：${m.actual_sha256}`,
    });
  }
  for (const ref of evidencePolicy.dangling) {
    violations.push({
      code: 'EVIDENCE_REF_DANGLING',
      message: `断言 ${ref.assertionId} 引用了 Manifest 中不存在的证据：${ref.evidenceId}`,
    });
  }
  if (claim.consistency === CLAIM_CONSISTENCY.CONTRADICTED) {
    violations.push({ code: 'CLAIM_CONTRADICTED', message: claim.reasons.join('；') });
  }
  if (!state.valid) {
    for (const p of state.problems) {
      violations.push({ code: 'ILLEGAL_STATE', message: p });
    }
  }

  /* ---- gaps：事实可信但不充分 → INCONCLUSIVE ---- */
  const gaps = [];

  if (!hasFacts) {
    gaps.push({ code: 'NO_EXECUTION_FACTS', message: '没有任何执行事实事件，无法判定结果' });
  } else if (actual === null) {
    gaps.push({ code: 'NO_FINISHED_ATTEMPT', message: '存在执行事实，但没有已结束的 Attempt' });
  }
  if (legacy) {
    gaps.push({
      code: LEGACY_NO_ASSERTION,
      message: `Case ${run.case_id} 未定义任何 Assertion（历史遗留），无判据可证明"满足需求"，不得 FINALIZED_PASS`,
    });
  }
  if (policy.finalization.requireAllRequiredAssertionsEvaluated && assertions.notEvaluated.length) {
    gaps.push({
      code: 'REQUIRED_ASSERTION_NOT_EVALUATED',
      message: `必需断言未求值：${assertions.notEvaluated.join(', ')}`,
    });
  }
  if (policy.finalization.requireEvidencePolicy && !evidencePolicy.satisfied) {
    for (const m of evidencePolicy.missing) {
      gaps.push({ code: 'EVIDENCE_POLICY_UNSATISFIED', message: `${m.scope}：缺少 ${m.need}` });
    }
  }

  /* ---- warnings：不影响终局，但必须可见 ---- */
  if (assertions.undeclaredRecorded.length) {
    warnings.push(
      `记录了 Case 未声明的断言：${assertions.undeclaredRecorded.join(', ')}（不参与 Gate 判定）`,
    );
  }
  if (claim.consistency === CLAIM_CONSISTENCY.NOT_CLAIMED) {
    warnings.push('未记录 Agent Claim；终局仅依据执行事实判定');
  }

  return {
    run_id: runId,
    case_id: run.case_id,
    case_version: run.case_version,
    ok: violations.length === 0 && gaps.length === 0,
    trustworthy: violations.length === 0,
    execution: {
      hasFacts,
      eventCount: events.length,
      attempts: facts.attempts.length,
      finishedAttempts: facts.attempts.filter((a) => a.status !== ATTEMPT_STATUS.RUNNING).length,
      actualResult: actual,
      flaky,
      blocked: Boolean(facts.blocked),
    },
    evidence: { integrity, policy: evidencePolicy, count: manifest.evidence.length },
    assertions,
    state,
    claim,
    legacy,
    projectionMismatches,
    violations,
    gaps,
    warnings,
  };
}
