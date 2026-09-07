/**
 * Auto-Test Harness Core —— 公共 API 门面。
 *
 * CLI / MCP / SDK / Skill 一律通过本模块调用，**不得**绕过它直接读写磁盘。
 * 这样才能保证"无论谁来调，规则一样"——这正是 v1.x 靠 Prompt 无法做到的那件事。
 */
import { CASE_STATUS } from './constants.mjs';
import { caseFlags, isLegacyCase, loadCase, validateCase } from './case-store.mjs';
import { createRun } from './run-store.mjs';
import { attachEvidence } from './run-store.mjs';
import { registerEvidence } from './evidence-store.mjs';
import { fail } from './util.mjs';

export * from './constants.mjs';
export { layout, runLayout, resolveAutoTestDir } from './paths.mjs';

export {
  createCase,
  loadCase,
  listCases,
  addAssertion,
  setCaseStatus,
  canTransition,
  validateCase,
  assertValidCaseId,
  isLegacyCase,
  caseFlags,
  updateFrontmatter,
  parseCaseText,
  parseAssertions,
  parseDataMatrix,
} from './case-store.mjs';

export {
  loadRun,
  listRuns,
  runExists,
  loadEvents,
  hasExecutionFacts,
  deriveRunFacts,
  loadRunFacts,
  startAttempt,
  recordStep,
  finishAttempt,
  recordAssertion,
  recordClaim,
  recordDiagnostic,
  blockRun,
  resumeRun,
  appendEvent,
} from './run-store.mjs';

export {
  registerEvidence,
  verifyEvidence,
  loadManifest,
  findEvidence,
  resolveEvidencePath,
} from './evidence-store.mjs';

export { loadPolicy, DEFAULT_POLICY, evaluateEvidence, shouldRetry, isFlaky } from './policy.mjs';
export { verifyRun } from './verify.mjs';
export { finalizeRun, loadVerdict } from './finalize.mjs';

/**
 * 为一个 Case 开启新 Run。
 *
 * `pending_review`（DRAFT）的 Case **一律不得执行** —— 这是 v1.x 就守住的 HITL 边界，
 * 2.0 把它从 Prompt 约束变成代码约束。
 */
export function startRun({ caseId, actor, runtime, model, environment, runId }, opts = {}) {
  const testCase = loadCase(caseId, opts);

  if (testCase.status === CASE_STATUS.PENDING_REVIEW) {
    fail(
      `Case 处于 ${CASE_STATUS.PENDING_REVIEW}（DRAFT），不得执行：${testCase.case_id}。`
        + `请先通过 \`auto-test case ready ${testCase.case_id}\` 完成审核。`,
      'CASE_NOT_EXECUTABLE',
    );
  }

  return createRun(
    {
      testCase: { ...testCase, flags: caseFlags(testCase) },
      actor,
      runtime,
      model,
      environment,
      runId,
    },
    opts,
  );
}

/** 登记证据并挂到指定 Attempt 上（Manifest + Run 引用一次完成）。 */
export function addEvidence(runId, attemptId, spec, opts = {}) {
  const entry = registerEvidence(runId, { ...spec, attemptId }, opts);
  attachEvidence(runId, attemptId, entry, opts);
  return entry;
}

/** 汇总 Case 的可执行性问题（供 CLI `case validate` 使用）。 */
export function inspectCase(caseId, opts = {}) {
  const testCase = loadCase(caseId, opts);
  return {
    case: testCase,
    flags: caseFlags(testCase),
    legacy: isLegacyCase(testCase),
    problems: validateCase(testCase),
  };
}
