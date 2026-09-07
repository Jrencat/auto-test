/**
 * policy —— 三条最小 Policy：Evidence / Retry / Finalization。
 *
 * 形态刻意保持简单：**配置 + 纯函数**。
 * 明确不做 PolicyEngine / Registry / Resolver / Factory / DSL —— 当前只有 3 条策略、
 * 每条 4–6 个字段、一个实现者，引入策略体系的维护成本远高于收益。
 *
 * 项目可在 `<cwd>/.auto-test/policy.json` 覆盖默认值（浅合并到各分组）。
 */
import { ASSERTION_STATUS, ATTEMPT_STATUS, FAILURE_TYPE, SCHEMA_VERSION } from './constants.mjs';
import { layout } from './paths.mjs';
import { readJson } from './util.mjs';

export const DEFAULT_POLICY = {
  schema_version: SCHEMA_VERSION,

  evidence: {
    /** 每个已结束 Attempt 必须具备的证据类型 */
    requiredPerAttempt: [],
    /** Attempt 失败时额外必须具备的证据类型 */
    requiredOnFailure: [],
    /**
     * 每条**已求值的必需断言**至少需要几份证据。
     * 默认 1 —— 断言说"通过了"，就得有东西证明当时看到了什么。
     */
    minEvidencePerRequiredAssertion: 1,
  },

  retry: {
    maxAttempts: 2,
    retryOn: [FAILURE_TYPE.ASSERTION, FAILURE_TYPE.TIMEOUT, FAILURE_TYPE.ENVIRONMENT],
    stopOn: [FAILURE_TYPE.DATA, FAILURE_TYPE.TEST_BUG],
  },

  finalization: {
    /** [FAIL, PASS] 判 FLAKY 而非 PASS。默认 true：不稳定用例会掩盖真实竞态缺陷。 */
    flakyBlocksPass: true,
    requireEvidencePolicy: true,
    requireAllRequiredAssertionsEvaluated: true,
    requireClaimConsistency: true,
  },
};

/** 读取项目 Policy 并与默认值浅合并（按分组合并，未覆盖的字段保留默认）。 */
export function loadPolicy(opts = {}) {
  const file = layout(opts).policy;
  const custom = readJson(file, null);
  if (!custom) return structuredClone(DEFAULT_POLICY);
  return {
    ...DEFAULT_POLICY,
    ...custom,
    evidence: { ...DEFAULT_POLICY.evidence, ...(custom.evidence || {}) },
    retry: { ...DEFAULT_POLICY.retry, ...(custom.retry || {}) },
    finalization: { ...DEFAULT_POLICY.finalization, ...(custom.finalization || {}) },
  };
}

/* ------------------------------------------------------------------ *
 * Evidence Policy
 * ------------------------------------------------------------------ */

/**
 * 判定本次 Run 的证据是否满足 Policy。
 *
 * 只判断"证据够不够"，**不判断结论对不对**——后者是 Assertion 的职责。
 *
 * ⚠ 输入的 `facts` 必须来自 `deriveRunFacts(events)`，不得直接传 `run.json`。
 * 断言引用的 evidence id **必须在 Manifest 中真实存在**：只数引用个数的话，
 * 编造一个不存在的 id 就能满足"每条断言至少一份证据"。
 *
 * @returns {{satisfied: boolean, missing: Array, dangling: Array}}
 */
export function evaluateEvidence(facts, manifest, policy = DEFAULT_POLICY, declaredAssertions = null) {
  const cfg = policy.evidence;
  const missing = [];
  const dangling = [];

  const known = new Set((manifest.evidence || []).map((e) => e.evidence_id));
  const byAttempt = new Map();
  for (const entry of manifest.evidence || []) {
    const key = entry.attempt_id || '__run__';
    if (!byAttempt.has(key)) byAttempt.set(key, []);
    byAttempt.get(key).push(entry);
  }

  const declared = declaredAssertions || facts.case_assertions || [];
  const requiredIds = new Set(declared.filter((a) => a.required).map((a) => a.id));

  for (const attempt of facts.attempts) {
    // 仍在执行中的 Attempt 不参与证据判定（它还没结束，证据可能尚未产生）
    if (attempt.status === ATTEMPT_STATUS.RUNNING) continue;

    const items = byAttempt.get(attempt.attempt_id) || [];
    const types = new Set(items.map((e) => e.type));

    for (const need of cfg.requiredPerAttempt) {
      if (!types.has(need)) {
        missing.push({ scope: attempt.attempt_id, need: `evidence type "${need}"` });
      }
    }
    if (attempt.status !== ATTEMPT_STATUS.PASS) {
      for (const need of cfg.requiredOnFailure) {
        if (!types.has(need)) {
          missing.push({ scope: attempt.attempt_id, need: `evidence type "${need}"（失败时必需）` });
        }
      }
    }

    // 已求值的必需断言必须有证据支撑，且引用的证据必须真实存在于 Manifest
    for (const a of attempt.assertions) {
      const refs = a.evidence_refs || [];
      for (const ref of refs) {
        if (!known.has(ref)) {
          dangling.push({ assertionId: a.assertion_id, attemptId: attempt.attempt_id, evidenceId: ref });
        }
      }
      if (cfg.minEvidencePerRequiredAssertion <= 0) continue;
      if (!requiredIds.has(a.assertion_id)) continue;
      if (a.status === ASSERTION_STATUS.NOT_EVALUATED) continue;

      const valid = refs.filter((ref) => known.has(ref)).length;
      if (valid < cfg.minEvidencePerRequiredAssertion) {
        missing.push({
          scope: `${attempt.attempt_id}/${a.assertion_id}`,
          need: `至少 ${cfg.minEvidencePerRequiredAssertion} 份**有效**证据（当前有效 ${valid}`
            + `${refs.length !== valid ? `，另有 ${refs.length - valid} 个悬空引用` : ''}）`,
        });
      }
    }
  }

  return { satisfied: missing.length === 0 && dangling.length === 0, missing, dangling };
}

/* ------------------------------------------------------------------ *
 * Retry Policy
 * ------------------------------------------------------------------ */

/**
 * 是否应当再试一次。
 *
 * 注意：Harness **不自动重试**——它只回答"按 Policy 还允许不允许重试"。
 * 真正决定要不要重试、怎么重试的是 Agent（`harness-architecture.md` §二）。
 */
export function shouldRetry(run, policy = DEFAULT_POLICY) {
  const cfg = policy.retry;
  const finished = run.attempts.filter((a) => a.status !== ATTEMPT_STATUS.RUNNING);
  const last = finished[finished.length - 1];

  if (!last) {
    return { retry: false, reason: 'no_finished_attempt' };
  }
  if (last.status === ATTEMPT_STATUS.PASS) {
    return { retry: false, reason: 'last_attempt_passed' };
  }
  if (run.attempts.length >= cfg.maxAttempts) {
    return { retry: false, reason: 'budget_exhausted' };
  }

  const type = (last.failure && last.failure.type) || FAILURE_TYPE.UNKNOWN;
  if (cfg.stopOn.includes(type)) {
    return { retry: false, reason: `stop_on:${type}` };
  }
  if (cfg.retryOn.includes(type)) {
    return { retry: true, reason: `retry_on:${type}` };
  }
  return { retry: false, reason: `not_retryable:${type}` };
}

/* ------------------------------------------------------------------ *
 * FLAKY
 * ------------------------------------------------------------------ */

/** [FAIL, PASS] → true。历史 Attempt 永不压缩，这里只读不改。 */
export function isFlaky(run) {
  const finished = run.attempts.filter((a) => a.status !== ATTEMPT_STATUS.RUNNING);
  if (finished.length < 2) return false;
  const last = finished[finished.length - 1];
  if (last.status !== ATTEMPT_STATUS.PASS) return false;
  return finished.slice(0, -1).some((a) => a.status !== ATTEMPT_STATUS.PASS);
}
