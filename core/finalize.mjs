/**
 * finalize —— 终局判定。**这是 Harness 唯一有权写入 final_status 的地方。**
 *
 * Agent 可以 Claim、可以叙述、可以解释，但改变不了这里的判定结果与退出码。
 *
 * 判定顺序是刻意短路的，Evaluation 分数在这条链上没有任何位置：
 *   1. violations（事实不可信）           → INVALID
 *   2. blocked（未真实执行）              → BLOCKED
 *   3. 必需断言失败 / 执行结果为 FAIL      → FINALIZED_FAIL
 *   4. gaps（证据或断言不足）              → INCONCLUSIVE
 *   5. FLAKY（历史 Attempt 有失败）        → FLAKY
 *   6. 全部通过                           → FINALIZED_PASS
 *
 * ⚠ 关于第 3 步先于第 4 步：设计文档的原始排序是「证据不足 → INCONCLUSIVE」优先。
 * 实现时调整为「已确认的失败优先」，理由是：证据不足**不得**把一个已经确认的失败
 * 变成"待定"——那会让真实缺陷以 INCONCLUSIVE 的形式被推迟。
 * 证据不足仍然**绝对**阻止 FINALIZED_PASS（第 4 步），保守方向没有被削弱。
 */
import { FINAL_STATUS, RUN_STATE, SCHEMA_VERSION } from './constants.mjs';
import { loadPolicy } from './policy.mjs';
import { applyVerdict, appendEvent, loadRun } from './run-store.mjs';
import { EVENT_TYPE } from './constants.mjs';
import { runLayout } from './paths.mjs';
import { nowIso, readJson, writeJson } from './util.mjs';
import { verifyRun } from './verify.mjs';

function decide(report, policy) {
  const reasons = [];

  if (report.violations.length) {
    return {
      status: FINAL_STATUS.INVALID,
      reasons: report.violations.map((v) => `[${v.code}] ${v.message}`),
    };
  }

  if (report.execution.blocked || report.execution.actualResult === 'BLOCKED') {
    return {
      status: FINAL_STATUS.BLOCKED,
      reasons: ['执行被阻断，测试未真实完成'],
    };
  }

  const hasFailure =
    report.assertions.failed.length > 0 || report.execution.actualResult === 'FAIL';
  if (hasFailure) {
    if (report.assertions.failed.length) {
      reasons.push(`必需断言失败：${report.assertions.failed.join(', ')}`);
    }
    if (report.execution.actualResult === 'FAIL') {
      reasons.push('最后一个 Attempt 的执行结果为 FAIL');
    }
    // 证据不足不改变失败结论，但必须如实附在理由里
    for (const g of report.gaps) {
      reasons.push(`（证据完整性提示）[${g.code}] ${g.message}`);
    }
    return { status: FINAL_STATUS.FINALIZED_FAIL, reasons };
  }

  if (report.gaps.length) {
    return {
      status: FINAL_STATUS.INCONCLUSIVE,
      reasons: report.gaps.map((g) => `[${g.code}] ${g.message}`),
    };
  }

  if (report.execution.flaky && policy.finalization.flakyBlocksPass) {
    return {
      status: FINAL_STATUS.FLAKY,
      reasons: ['存在失败后重试转通过的 Attempt 序列；不稳定用例不计为稳定通过'],
    };
  }

  if (report.execution.actualResult !== 'PASS') {
    return {
      status: FINAL_STATUS.INCONCLUSIVE,
      reasons: [`执行结果不是 PASS：${report.execution.actualResult}`],
    };
  }

  return {
    status: FINAL_STATUS.FINALIZED_PASS,
    reasons: [
      `真实执行 ${report.execution.finishedAttempts} 个 Attempt`,
      `必需断言 ${report.assertions.passed.length}/${report.assertions.required} 全部通过`,
      `证据 ${report.evidence.count} 份，SHA256 校验全部匹配`,
    ],
  };
}

/**
 * 终局判定并落盘 `verdict.json`。
 *
 * 幂等：已 FINALIZED 的 Run 直接返回既有 verdict，不重算、不覆盖——
 * 终局一旦作出即为历史事实。
 */
export function finalizeRun(runId, opts = {}) {
  const existing = readJson(runLayout(runId, opts).verdict, null);
  const run = loadRun(runId, opts);
  if (run.state === RUN_STATE.FINALIZED && existing) {
    return { ...existing, already_finalized: true };
  }

  const policy = opts.policy || loadPolicy(opts);
  const report = verifyRun(runId, { ...opts, policy });
  const decision = decide(report, policy);

  const verdict = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    case_id: report.case_id,
    case_version: report.case_version,
    final_status: decision.status,
    reasons: decision.reasons,
    claim: report.claim.claim,
    claim_consistency: report.claim.consistency,
    execution: report.execution,
    assertions: {
      required: report.assertions.required,
      passed: report.assertions.passed,
      failed: report.assertions.failed,
      not_evaluated: report.assertions.notEvaluated,
    },
    evidence: {
      count: report.evidence.count,
      integrity_ok: report.evidence.integrity.ok,
      policy_satisfied: report.evidence.policy.satisfied,
    },
    projection_mismatches: report.projectionMismatches,
    violations: report.violations,
    gaps: report.gaps,
    warnings: report.warnings,
    finalized_at: nowIso(),
  };

  writeJson(runLayout(runId, opts).verdict, verdict);
  applyVerdict(
    runId,
    {
      finalStatus: decision.status,
      claimConsistency: report.claim.consistency,
      state: RUN_STATE.FINALIZED,
    },
    opts,
  );
  appendEvent(runId, EVENT_TYPE.RUN_FINALIZED, { final_status: decision.status }, opts);

  return verdict;
}

export function loadVerdict(runId, opts = {}) {
  return readJson(runLayout(runId, opts).verdict, null);
}
