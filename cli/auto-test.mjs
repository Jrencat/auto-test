#!/usr/bin/env node
/**
 * auto-test CLI —— Harness Core 的机械约束入口。
 *
 * 设计纪律（`harness-architecture.md` §6.2）：
 *   本文件**只做参数解析、调用 Core、打印、返回退出码**，不含任何业务逻辑。
 *   业务判定全部在 core/ 中，使 CLI / MCP / SDK / Skill 调用时行为完全一致。
 *
 * 退出码是本 CLI 存在的理由：Agent 可以用文字解释任何事，但改变不了非零退出码。
 *   0 通过 ｜ 1 未达成通过条件 ｜ 2 事实不可信（INVALID） ｜ 3 用法/内部错误
 */
import { EXIT, FINAL_STATUS } from '../core/constants.mjs';
import * as core from '../core/index.mjs';
import { HarnessError } from '../core/util.mjs';

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

function need(flags, key, hint = '') {
  const value = flags[key];
  if (value === undefined || value === true) {
    throw new HarnessError(`缺少参数 --${key}${hint ? `（${hint}）` : ''}`, 'USAGE');
  }
  return String(value);
}

function list(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const out = (...args) => console.log(...args);
const json = (data) => console.log(JSON.stringify(data, null, 2));

/* ------------------------------------------------------------------ *
 * case
 * ------------------------------------------------------------------ */

function cmdCase(positional, flags) {
  const sub = positional[0];

  if (sub === 'new') {
    const created = core.createCase({
      case_id: need(flags, 'id', 'Case ID，如 TC-LOGIN-001'),
      name: need(flags, 'title'),
      kind: flags.kind === true ? undefined : flags.kind,
      module: flags.module === true ? undefined : flags.module,
      script_ref: flags.script === true ? undefined : flags.script,
      description: flags.description === true ? undefined : flags.description,
    });
    out(`已创建 Case ${created.case_id}（status: ${created.status}）`);
    out(`  ${created.file}`);
    out('  ⚠ 尚无 Assertion —— 进入 READY 前必须至少定义一条：');
    out(`    auto-test case assert-add ${created.case_id} --id A1 --description "..."`);
    return EXIT.OK;
  }

  if (sub === 'list') {
    let cases = core.listCases();
    if (flags.status && flags.status !== true) {
      const want = core.normalizeCaseStatus(String(flags.status));
      cases = cases.filter((c) => c.status === want);
    }
    const rows = cases.map((c) => ({
      case_id: c.case_id,
      status: c.status,
      version: c.case_version,
      assertions: c.assertions.length,
      legacy: core.isLegacyCase(c),
      title: c.name,
    }));
    if (flags.json) return json(rows), EXIT.OK;
    if (!rows.length) {
      out('（无 Case）');
      return EXIT.OK;
    }
    for (const r of rows) {
      out(
        `${r.case_id.padEnd(28)} ${r.status.padEnd(15)} v${String(r.version).padEnd(3)} `
          + `断言 ${String(r.assertions).padStart(2)}${r.legacy ? ' [LEGACY_NO_ASSERTION]' : ''}  ${r.title}`,
      );
    }
    return EXIT.OK;
  }

  if (sub === 'show') {
    const testCase = core.loadCase(positional[1]);
    if (flags.json) return json(testCase), EXIT.OK;
    out(`${testCase.case_id}  ${testCase.name}`);
    out(`  status      : ${testCase.status}`);
    out(`  version     : ${testCase.case_version}`);
    out(`  script_ref  : ${testCase.script_ref || '(none)'}`);
    out(`  steps       : ${testCase.steps.length}`);
    out(`  data groups : ${testCase.test_data.length}`);
    out(`  assertions  : ${testCase.assertions.length}`);
    for (const a of testCase.assertions) {
      out(`    ${a.id} [${a.layer}] ${a.required ? '必需' : '可选'} — ${a.description}`);
    }
    if (core.isLegacyCase(testCase)) out('  flags       : LEGACY_NO_ASSERTION');
    return EXIT.OK;
  }

  if (sub === 'assert-add') {
    const updated = core.addAssertion(positional[1], {
      id: need(flags, 'id', 'Assertion ID，如 A1'),
      layer: flags.layer === true ? undefined : flags.layer,
      description: flags.description === true ? '' : flags.description || '',
      required: !flags.optional,
    });
    out(`已为 ${updated.case_id} 新增断言 ${flags.id}（共 ${updated.assertions.length} 条）`);
    return EXIT.OK;
  }

  if (sub === 'ready') {
    const updated = core.setCaseStatus(positional[1], 'ready');
    out(`${updated.case_id}: ${core.CASE_STATUS.PENDING_REVIEW} → ${updated.status}`);
    return EXIT.OK;
  }

  if (sub === 'validate') {
    const report = core.inspectCase(positional[1]);
    if (flags.json) return json(report.problems), report.problems.length ? EXIT.GATE_FAILED : EXIT.OK;
    if (!report.problems.length) {
      out(`${report.case.case_id}: OK`);
      return EXIT.OK;
    }
    out(`${report.case.case_id}: ${report.problems.length} 个问题`);
    for (const p of report.problems) out(`  ✗ ${p}`);
    return EXIT.GATE_FAILED;
  }

  throw new HarnessError('用法：auto-test case <new|list|show|assert-add|ready|validate>', 'USAGE');
}

/* ------------------------------------------------------------------ *
 * run
 * ------------------------------------------------------------------ */

function cmdRun(positional, flags) {
  const sub = positional[0];
  const runId = positional[1];

  if (sub === 'start') {
    const run = core.startRun({
      caseId: need(flags, 'case'),
      actor: flags.actor === true ? undefined : flags.actor,
      runtime: flags.runtime === true ? undefined : flags.runtime,
      model: flags.model === true ? undefined : flags.model,
      runId: flags['run-id'] === true ? undefined : flags['run-id'],
    });
    if (flags.json) return json(run), EXIT.OK;
    out(run.run_id);
    return EXIT.OK;
  }

  if (sub === 'list') {
    const rows = core.listRuns().map((r) => ({
      run_id: r.run_id,
      case_id: r.case_id,
      state: r.state,
      final_status: r.final_status,
      attempts: r.attempts.length,
    }));
    if (flags.json) return json(rows), EXIT.OK;
    for (const r of rows) {
      out(
        `${r.run_id}  ${r.case_id.padEnd(26)} ${r.state.padEnd(10)} `
          + `${(r.final_status || '-').padEnd(17)} attempts=${r.attempts}`,
      );
    }
    return EXIT.OK;
  }

  if (sub === 'attempt-start') {
    const attempt = core.startAttempt(runId);
    if (flags.json) return json(attempt), EXIT.OK;
    out(attempt.attempt_id);
    return EXIT.OK;
  }

  if (sub === 'step') {
    const step = core.recordStep(runId, need(flags, 'attempt'), {
      name: need(flags, 'name'),
      status: flags.status === true ? 'PASS' : flags.status || 'PASS',
      detail: flags.detail === true ? null : flags.detail || null,
    });
    out(`${step.step_id} ${step.name} → ${step.status}`);
    return EXIT.OK;
  }

  if (sub === 'assert') {
    const result = core.recordAssertion(runId, need(flags, 'attempt'), {
      assertionId: need(flags, 'assertion', 'Case 中定义的 Assertion ID'),
      status: need(flags, 'status', 'PASS | FAIL | NOT_EVALUATED'),
      expected: flags.expected === true ? null : flags.expected ?? null,
      actual: flags.actual === true ? null : flags.actual ?? null,
      evidenceRefs: list(flags.evidence),
    });
    out(`${result.assertion_id} → ${result.status}${result.declared ? '' : '  ⚠ 未在 Case 中声明'}`);
    return EXIT.OK;
  }

  if (sub === 'evidence') {
    const entry = core.addEvidence(runId, need(flags, 'attempt'), {
      type: need(flags, 'type'),
      file: need(flags, 'file'),
      copy: !flags['no-copy'],
    });
    if (flags.json) return json(entry), EXIT.OK;
    out(`${entry.evidence_id}  ${entry.type}  sha256=${entry.sha256.slice(0, 16)}…  ${entry.size}B`);
    return EXIT.OK;
  }

  if (sub === 'attempt-finish') {
    const failureType = flags['failure-type'];
    const attempt = core.finishAttempt(runId, need(flags, 'attempt'), {
      status: need(flags, 'status', 'PASS | FAIL | ERROR | BLOCKED'),
      exitCode: flags['exit-code'] === undefined || flags['exit-code'] === true
        ? null
        : Number(flags['exit-code']),
      failure:
        failureType && failureType !== true
          ? {
            type: String(failureType),
            message: flags['failure-message'] === true ? '' : flags['failure-message'] || '',
          }
          : null,
    });
    out(`${attempt.attempt_id} → ${attempt.status}（${attempt.duration_ms}ms）`);
    return EXIT.OK;
  }

  if (sub === 'claim') {
    const run = core.recordClaim(runId, need(flags, 'status', 'PASS | FAIL | BLOCKED'));
    out(`已记录 Agent Claim = ${run.agent_claim}`);
    out('  ⚠ Claim 只是 Verify 的输入，不等于最终结果。终局由 auto-test finalize 判定。');
    return EXIT.OK;
  }

  if (sub === 'block') {
    const run = core.blockRun(runId, need(flags, 'reason'));
    out(`${run.run_id} 已标记 BLOCKED：${run.blocked.reason}`);
    return EXIT.OK;
  }

  if (sub === 'show') {
    const run = core.loadRun(runId);
    if (flags.json) return json(run), EXIT.OK;
    out(`${run.run_id}  case=${run.case_id} v${run.case_version}  state=${run.state}`);
    out(`  actor/runtime/model : ${run.actor} / ${run.runtime} / ${run.model || '-'}`);
    out(`  agent_claim         : ${run.agent_claim || '(none)'}`);
    out(`  final_status        : ${run.final_status || '(not finalized)'}`);
    out(`  attempts            : ${run.attempts.length}`);
    for (const a of run.attempts) {
      out(
        `    ${a.attempt_id} seq=${a.sequence} ${String(a.status).padEnd(8)} `
          + `steps=${a.steps.length} assertions=${a.assertions.length} evidence=${a.evidence_refs.length}`
          + `${a.failure ? `  failure=${a.failure.type}` : ''}`,
      );
    }
    return EXIT.OK;
  }

  throw new HarnessError(
    '用法：auto-test run <start|list|attempt-start|step|assert|evidence|attempt-finish|claim|block|show>',
    'USAGE',
  );
}

/* ------------------------------------------------------------------ *
 * verify / finalize / resume
 * ------------------------------------------------------------------ */

function cmdVerify(positional, flags) {
  const report = core.verifyRun(positional[0]);
  if (flags.json) {
    json(report);
  } else {
    out(`Run ${report.run_id}  case=${report.case_id} v${report.case_version}`);
    out(`  执行事实      : ${report.execution.hasFacts ? '存在' : '无'}`
      + `（events=${report.execution.eventCount}, attempts=${report.execution.attempts}, `
      + `finished=${report.execution.finishedAttempts}）`);
    out(`  实际结果      : ${report.execution.actualResult || '(无已结束 Attempt)'}`
      + `${report.execution.flaky ? '  [FLAKY 序列]' : ''}`);
    out(`  Agent Claim   : ${report.claim.claim || '(none)'} → ${report.claim.consistency}`);
    out(`  证据          : ${report.evidence.count} 份，完整性 `
      + `${report.evidence.integrity.ok ? 'OK' : '失败'}，Policy `
      + `${report.evidence.policy.satisfied ? '满足' : '不满足'}`);
    out(`  必需断言      : ${report.assertions.passed.length} 通过 / `
      + `${report.assertions.failed.length} 失败 / ${report.assertions.notEvaluated.length} 未求值`
      + `（共 ${report.assertions.required}）`);
    for (const w of report.warnings) out(`  ⚠ ${w}`);
    for (const v of report.violations) out(`  ✗ [${v.code}] ${v.message}`);
    for (const g of report.gaps) out(`  ! [${g.code}] ${g.message}`);
    out(`  → ${report.violations.length ? '事实不可信（INVALID）'
      : report.gaps.length ? '事实不充分（INCONCLUSIVE）' : '事实可信且充分'}`);
  }
  if (report.violations.length) return EXIT.INVALID;
  if (report.gaps.length) return EXIT.GATE_FAILED;
  return EXIT.OK;
}

function cmdFinalize(positional, flags) {
  const verdict = core.finalizeRun(positional[0]);
  if (flags.json) {
    json(verdict);
  } else {
    out(`${verdict.final_status}${verdict.already_finalized ? '（已终局，未重算）' : ''}`);
    for (const r of verdict.reasons) out(`  · ${r}`);
    out(`  claim=${verdict.claim || '(none)'} → ${verdict.claim_consistency}`);
    out(`  verdict: ${core.runLayout(verdict.run_id).verdict}`);
  }
  if (verdict.final_status === FINAL_STATUS.FINALIZED_PASS) return EXIT.OK;
  if (verdict.final_status === FINAL_STATUS.INVALID) return EXIT.INVALID;
  return EXIT.GATE_FAILED;
}

function cmdResume(positional, flags) {
  const { run, events, openAttempts } = core.resumeRun(positional[0]);
  if (flags.json) return json({ run, open_attempts: openAttempts, event_count: events.length }), EXIT.OK;
  out(`已恢复 Run ${run.run_id}（run_id 保持不变）`);
  out(`  case          : ${run.case_id} v${run.case_version}`);
  out(`  state         : ${run.state}`);
  out(`  已保留事件    : ${events.length}`);
  out(`  已保留 Attempt: ${run.attempts.length}`);
  for (const a of run.attempts) {
    out(`    ${a.attempt_id} ${String(a.status).padEnd(8)} steps=${a.steps.length} `
      + `assertions=${a.assertions.length} evidence=${a.evidence_refs.length}`);
  }
  out(`  已保留断言    : ${run.assertions.length}`);
  out(`  已保留证据    : ${run.evidence_refs.length}`);
  if (openAttempts.length) {
    out(`  ⚠ 未结束 Attempt：${openAttempts.map((a) => a.attempt_id).join(', ')}`);
    out('    Harness 只陈述状态，是否重跑由 Agent 判断（Step 级 Resume 为 Phase 2 范围）。');
  }
  return EXIT.OK;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const USAGE = `auto-test —— Agent-Native Testing Harness

  auto-test case new --id <id> --title <t> [--module m] [--script s] [--kind k]
  auto-test case list [--status <s>] [--json]
  auto-test case show <caseId> [--json]
  auto-test case assert-add <caseId> --id <A1> --description <d> [--layer ui] [--optional]
  auto-test case ready <caseId>
  auto-test case validate <caseId>

  auto-test run start --case <caseId> [--actor a] [--runtime r] [--model m] [--run-id id]
  auto-test run attempt-start <runId>
  auto-test run step <runId> --attempt <A001> --name <n> [--status PASS]
  auto-test run assert <runId> --attempt <A001> --assertion <A1> --status <PASS|FAIL|NOT_EVALUATED>
                                [--expected e] [--actual a] [--evidence id1,id2]
  auto-test run evidence <runId> --attempt <A001> --type <type> --file <path> [--no-copy]
  auto-test run attempt-finish <runId> --attempt <A001> --status <PASS|FAIL|ERROR|BLOCKED>
                                [--exit-code n] [--failure-type T] [--failure-message m]
  auto-test run claim <runId> --status <PASS|FAIL|BLOCKED>
  auto-test run block <runId> --reason <r>
  auto-test run show <runId> [--json]
  auto-test run list [--json]

  auto-test verify <runId> [--json]
  auto-test finalize <runId> [--json]
  auto-test resume <runId> [--json]

退出码：0 通过 ｜ 1 未达成通过条件 ｜ 2 事实不可信（INVALID） ｜ 3 用法/内部错误`;

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  if (!command || command === 'help' || flags.help) {
    out(USAGE);
    return command ? EXIT.OK : EXIT.USAGE;
  }

  switch (command) {
    case 'case':
      return cmdCase(positional, flags);
    case 'run':
      return cmdRun(positional, flags);
    case 'verify':
      return cmdVerify(positional, flags);
    case 'finalize':
      return cmdFinalize(positional, flags);
    case 'resume':
      return cmdResume(positional, flags);
    default:
      throw new HarnessError(`未知命令：${command}\n\n${USAGE}`, 'USAGE');
  }
}

try {
  process.exit(main());
} catch (e) {
  if (e instanceof HarnessError) {
    console.error(`错误[${e.code}] ${e.message}`);
    process.exit(e.code === 'USAGE' ? EXIT.USAGE : EXIT.GATE_FAILED);
  }
  console.error(e);
  process.exit(EXIT.USAGE);
}
