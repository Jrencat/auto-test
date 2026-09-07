#!/usr/bin/env node
/**
 * 示例 Spec 运行器 —— 演示"测试脚本如何接入 Harness Core"。
 *
 * 这段代码就是 v1.x 迁移到 2.0 的**核心接线模式**：
 * 脚本不再只是"跑完不报错就算过"，而是把每一步、每条断言、每份证据
 * 都登记进 Harness，最终由 `finalize` 而不是脚本自己决定结论。
 *
 * 用法：
 *   node examples/run-specs.mjs                # 默认写到 <cwd>/.auto-test
 *   AUTO_TEST_DIR=/tmp/demo/.auto-test node examples/run-specs.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '../core/index.mjs';

const SPECS = [
  (await import('./specs/01-login.spec.mjs')).spec,
  (await import('./specs/02-solution-config.spec.mjs')).spec,
  (await import('./specs/03-stock-flaky.spec.mjs')).spec,
];

const scratch = mkdtempSync(join(tmpdir(), 'autotest-artifacts-'));

/** 确保 Case 存在、断言齐备、已进入 ready。 */
function ensureCase(spec) {
  let testCase;
  try {
    testCase = core.loadCase(spec.caseId);
  } catch {
    testCase = core.createCase({
      case_id: spec.caseId,
      name: spec.title,
      script_ref: spec.script_ref,
    });
  }

  const have = new Set(testCase.assertions.map((a) => a.id));
  for (const a of spec.assertions) {
    if (!have.has(a.id)) core.addAssertion(spec.caseId, a);
  }

  testCase = core.loadCase(spec.caseId);
  if (testCase.status === core.CASE_STATUS.PENDING_REVIEW) {
    // Assertion Gate 在这里生效：断言不齐会直接抛错，Case 进不了 ready
    testCase = core.setCaseStatus(spec.caseId, 'ready');
  }
  return testCase;
}

/** 构造一次 Attempt 的执行上下文。 */
function makeContext(runId, attemptId) {
  const failed = [];
  const evaluated = [];

  return {
    ctx: {
      core,
      runId,
      attemptId,

      step(name) {
        core.recordStep(runId, attemptId, { name });
      },

      /** 写一份证据文件并登记，返回 evidence_id。 */
      evidence(type, filename, content) {
        const file = join(scratch, `${runId}-${attemptId}-${filename}`);
        writeFileSync(file, content, 'utf-8');
        return core.addEvidence(runId, attemptId, { type, file }).evidence_id;
      },

      /**
       * 登记一条断言求值结果。
       * **不抛错**：一次 Attempt 内所有断言都要被求值，否则覆盖率会被首个失败截断。
       */
      assert(assertionId, ok, { expected, actual, evidence = [] } = {}) {
        core.recordAssertion(runId, attemptId, {
          assertionId,
          status: ok ? core.ASSERTION_STATUS.PASS : core.ASSERTION_STATUS.FAIL,
          expected: String(expected ?? ''),
          actual: String(actual ?? ''),
          evidenceRefs: evidence,
        });
        evaluated.push(assertionId);
        if (!ok) failed.push(assertionId);
      },
    },
    failed,
    evaluated,
  };
}

async function runSpec(spec) {
  ensureCase(spec);
  const run = core.startRun({
    caseId: spec.caseId,
    actor: 'agent',
    runtime: 'example-runner',
    model: null,
  });

  let lastFailed = [];

  for (;;) {
    const attempt = core.startAttempt(run.run_id);
    const { ctx, failed } = makeContext(run.run_id, attempt.attempt_id);

    let thrown = null;
    try {
      await spec.execute(ctx);
    } catch (e) {
      thrown = e;
    }

    lastFailed = failed;

    if (thrown) {
      core.finishAttempt(run.run_id, attempt.attempt_id, {
        status: core.ATTEMPT_STATUS.FAIL,
        exitCode: 1,
        failure: {
          type: thrown.failureType || core.FAILURE_TYPE.UNKNOWN,
          message: thrown.message,
        },
      });
    } else if (failed.length) {
      core.finishAttempt(run.run_id, attempt.attempt_id, {
        status: core.ATTEMPT_STATUS.FAIL,
        exitCode: 1,
        failure: { type: core.FAILURE_TYPE.ASSERTION, message: `断言失败：${failed.join(', ')}` },
      });
    } else {
      core.finishAttempt(run.run_id, attempt.attempt_id, {
        status: core.ATTEMPT_STATUS.PASS,
        exitCode: 0,
      });
    }

    // 是否重试由 Retry Policy 回答，由脚本（Agent 侧）决定是否照做
    const decision = core.shouldRetry(core.loadRun(run.run_id));
    if (!decision.retry) break;
  }

  // Agent 侧的诊断（仅在有断言失败时）
  if (lastFailed.length && typeof spec.diagnose === 'function') {
    const diag = spec.diagnose({ failedAssertions: lastFailed });
    if (diag) {
      const loaded = core.loadRun(run.run_id);
      const last = loaded.attempts.at(-1);
      core.recordDiagnostic(run.run_id, {
        attemptId: last.attempt_id,
        evidenceRefs: last.evidence_refs,
        ...diag,
      });
    }
  }

  // Agent Claim：脚本按"最后一次跑绿了没有"自称结果。
  // 注意 Spec 03 会 claim PASS，但 Harness 依据完整 Attempt 序列判为 FLAKY。
  const finalAttempt = core.loadRun(run.run_id).attempts.at(-1);
  core.recordClaim(
    run.run_id,
    finalAttempt.status === core.ATTEMPT_STATUS.PASS ? core.CLAIM.PASS : core.CLAIM.FAIL,
  );

  return core.finalizeRun(run.run_id);
}

const results = [];
for (const spec of SPECS) {
  results.push({ spec, verdict: await runSpec(spec) });
}

console.log('\n================ Harness 终局 ================');
for (const { spec, verdict } of results) {
  console.log(`\n${verdict.run_id}  ${spec.caseId}`);
  console.log(`  Agent Claim  : ${verdict.claim}  (${verdict.claim_consistency})`);
  console.log(`  FINAL STATUS : ${verdict.final_status}`);
  console.log(`  attempts     : ${verdict.execution.attempts}  flaky=${verdict.execution.flaky}`);
  console.log(
    `  assertions   : pass=[${verdict.assertions.passed}] fail=[${verdict.assertions.failed}] `
      + `not_evaluated=[${verdict.assertions.not_evaluated}]`,
  );
  console.log(`  evidence     : ${verdict.evidence.count} 份，完整性 ${verdict.evidence.integrity_ok ? 'OK' : 'FAILED'}`);
  for (const r of verdict.reasons) console.log(`    · ${r}`);
}

const claimedPass = results.filter((r) => r.verdict.claim === core.CLAIM.PASS).length;
const actuallyPass = results.filter(
  (r) => r.verdict.final_status === core.FINAL_STATUS.FINALIZED_PASS,
).length;
console.log(`\nAgent 自称 PASS：${claimedPass} ／ Harness 判定 FINALIZED_PASS：${actuallyPass}`);
