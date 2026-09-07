/**
 * run-store —— Test Run / Attempt / Assertion Result / Execution Event 的持久化。
 *
 * 两个不可违反的约束：
 *   1. **Attempt 历史永不覆盖**：Retry 追加新的 Attempt，旧 Attempt 原样保留。
 *   2. **已 FINALIZED 的 Run 不可写**：任何写入尝试直接抛错。
 *
 * 事实来源是 `events.jsonl`（只追加），`run.json` 是它的投影。
 * 进程崩溃时 events 已落盘，Resume 可据此重建——这是 v1.x 完全不具备的能力。
 */
import { existsSync, readdirSync } from 'node:fs';
import {
  ASSERTION_STATUSES,
  ATTEMPT_STATUS,
  ATTEMPT_STATUSES,
  CLAIMS,
  EVENT_TYPE,
  EXECUTION_FACT_EVENTS,
  RUN_STATE,
  SCHEMA_VERSION,
} from './constants.mjs';
import { layout, runLayout } from './paths.mjs';
import {
  appendJsonl,
  assertOneOf,
  ensureDir,
  fail,
  makeAttemptId,
  makeRunId,
  nowIso,
  readJson,
  readJsonl,
  requireString,
  shortId,
  writeJson,
} from './util.mjs';

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

export function runExists(runId, opts = {}) {
  return existsSync(runLayout(runId, opts).run);
}

export function loadRun(runId, opts = {}) {
  const paths = runLayout(runId, opts);
  const run = readJson(paths.run);
  if (!run) {
    fail(`Run 不存在：${runId}`, 'RUN_NOT_FOUND');
  }
  return run;
}

export function loadEvents(runId, opts = {}) {
  return readJsonl(runLayout(runId, opts).events);
}

export function listRuns(opts = {}) {
  const dir = layout(opts).runs;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(runLayout(d, opts).run))
    .sort()
    .map((d) => loadRun(d, opts));
}

/** 该 Run 是否存在真实执行事实（Fake PASS 检测的基础）。 */
export function hasExecutionFacts(runId, opts = {}) {
  return loadEvents(runId, opts).some((e) => EXECUTION_FACT_EVENTS.includes(e.type));
}

/* ------------------------------------------------------------------ *
 * 事件流 → 事实重建（Projection 防伪的基础）
 * ------------------------------------------------------------------ */

/**
 * 只依据 `events.jsonl` 重建这次 Run 的全部事实。
 *
 * **这是 Harness 可信性的支点**：`run.json` 只是投影，可以被手工编辑；
 * 事件流是只追加的事实。凡是要做判定的地方，都必须用本函数的结果，
 * 而不是直接读 `run.json`——否则改一行 JSON 就能伪造 FINALIZED_PASS。
 *
 * @param {Array} events  loadEvents() 的输出
 * @returns 与 run.json 同构的事实子集
 */
export function deriveRunFacts(events) {
  const attempts = new Map();
  const facts = {
    case_id: null,
    case_version: null,
    case_flags: null,
    case_assertions: null,
    agent_claim: null,
    blocked: null,
    finalized: false,
    attempts: [],
    assertions: [],
    evidence_refs: [],
  };

  const ensureAttempt = (id, sequence) => {
    if (!attempts.has(id)) {
      attempts.set(id, {
        attempt_id: id,
        sequence: sequence ?? attempts.size + 1,
        status: ATTEMPT_STATUS.RUNNING,
        exit_code: null,
        steps: [],
        assertions: new Map(),
        evidence_refs: [],
        failure: null,
      });
    }
    return attempts.get(id);
  };

  for (const e of events) {
    switch (e.type) {
      case EVENT_TYPE.RUN_CREATED:
        facts.case_id = e.case_id ?? null;
        facts.case_version = e.case_version ?? null;
        // 旧版本事件可能没有这两个字段，保持 null 由调用方降级处理
        facts.case_flags = e.case_flags ?? null;
        facts.case_assertions = e.case_assertions ?? null;
        break;
      case EVENT_TYPE.ATTEMPT_STARTED:
        ensureAttempt(e.attempt_id, e.sequence);
        break;
      case EVENT_TYPE.STEP_COMPLETED:
        ensureAttempt(e.attempt_id).steps.push({
          step_id: e.step_id,
          name: e.name,
          status: e.status,
        });
        break;
      case EVENT_TYPE.ASSERTION_RECORDED:
        ensureAttempt(e.attempt_id).assertions.set(e.assertion_id, {
          assertion_id: e.assertion_id,
          attempt_id: e.attempt_id,
          status: e.status,
          expected: e.expected ?? null,
          actual: e.actual ?? null,
          evidence_refs: e.evidence_refs || [],
          declared: e.declared,
        });
        break;
      case EVENT_TYPE.EVIDENCE_REGISTERED: {
        const attempt = ensureAttempt(e.attempt_id);
        if (!attempt.evidence_refs.includes(e.evidence_id)) attempt.evidence_refs.push(e.evidence_id);
        if (!facts.evidence_refs.includes(e.evidence_id)) facts.evidence_refs.push(e.evidence_id);
        break;
      }
      case EVENT_TYPE.ATTEMPT_FINISHED: {
        const attempt = ensureAttempt(e.attempt_id);
        attempt.status = e.status;
        attempt.exit_code = e.exit_code ?? null;
        attempt.failure = e.failure ?? null;
        break;
      }
      case EVENT_TYPE.CLAIM_RECORDED:
        facts.agent_claim = e.claim;
        break;
      case EVENT_TYPE.RUN_BLOCKED:
        facts.blocked = { reason: e.reason };
        break;
      case EVENT_TYPE.RUN_FINALIZED:
        facts.finalized = true;
        break;
      default:
        break;
    }
  }

  facts.attempts = [...attempts.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((a) => ({ ...a, assertions: [...a.assertions.values()] }));

  // Run 级断言汇总：同一 id 以最后一个 Attempt 的结果为准（与 run-store 的投影口径一致）
  const latest = new Map();
  for (const attempt of facts.attempts) {
    for (const a of attempt.assertions) latest.set(a.assertion_id, a);
  }
  facts.assertions = [...latest.values()];

  return facts;
}

/** 直接从磁盘事件流重建事实。 */
export function loadRunFacts(runId, opts = {}) {
  return deriveRunFacts(loadEvents(runId, opts));
}

/* ------------------------------------------------------------------ *
 * 写入守卫
 * ------------------------------------------------------------------ */

function assertWritable(run) {
  if (run.state === RUN_STATE.FINALIZED) {
    fail(
      `Run 已 FINALIZED（${run.final_status}），不可再写入：${run.run_id}。`
        + '如需重测请创建新 Run。',
      'RUN_IMMUTABLE',
    );
  }
  return run;
}

function persist(run, opts = {}) {
  writeJson(runLayout(run.run_id, opts).run, run);
  return run;
}

/** 追加一条事件。事件是事实，写入后不可修改、不可删除。 */
export function appendEvent(runId, type, payload = {}, opts = {}) {
  // 保留字段放在展开之后：payload 里若恰好有 `type`（如证据类型），
  // 不得覆盖事件类型——否则该事件将不再被识别为执行事实，谎报检测会失效。
  const event = {
    ...payload,
    event_id: shortId('evt'),
    run_id: runId,
    type,
    timestamp: nowIso(),
  };
  appendJsonl(runLayout(runId, opts).events, event);
  return event;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

/**
 * 创建 Run。
 * `case_version` 与 `case_flags` 在此固化：Case 之后被修改，本 Run 仍能说明当时测的是哪一版。
 */
export function createRun({ testCase, actor, runtime, model, environment, policy, runId }, opts = {}) {
  layout({ ...opts, create: true });

  // Run ID 是秒级的（沿用 v1.x 可读格式）。同一秒内连续创建多个 Run 是真实场景，
  // 此时追加去重后缀而非报错——显式指定的 runId 冲突仍视为调用方错误。
  let id = runId || makeRunId();
  if (!runId) {
    const base = id;
    for (let n = 2; existsSync(runLayout(id, opts).run); n += 1) {
      id = `${base}-${n}`;
    }
  }
  const paths = runLayout(id, opts);
  if (existsSync(paths.run)) {
    fail(`Run 已存在：${id}`, 'RUN_EXISTS');
  }
  ensureDir(paths.dir);
  ensureDir(paths.evidence);

  const run = {
    schema_version: SCHEMA_VERSION,
    run_id: id,
    case_id: testCase.case_id,
    case_version: testCase.case_version,
    case_flags: testCase.flags || [],
    case_assertions: (testCase.assertions || []).map((a) => ({
      id: a.id,
      required: a.required !== false,
      layer: a.layer,
      description: a.description,
    })),

    state: RUN_STATE.CREATED,
    final_status: null,
    agent_claim: null,
    claim_consistency: null,

    started_at: nowIso(),
    finished_at: null,

    actor: actor || 'unknown',
    runtime: runtime || 'unknown',
    model: model || null,
    environment: environment || {},
    policy: policy || {},

    attempts: [],
    assertions: [],
    failures: [],
    diagnostics: [],
    evidence_refs: [],
    blocked: null,
  };

  persist(run, opts);
  // Case 契约（声明了哪些断言、是否 Legacy）必须进入事件流：
  // 只放在 run.json 里的话，篡改 projection 就能删掉"必需断言"从而绕过 Gate。
  appendEvent(
    id,
    EVENT_TYPE.RUN_CREATED,
    {
      case_id: run.case_id,
      case_version: run.case_version,
      case_flags: run.case_flags,
      case_assertions: run.case_assertions,
    },
    opts,
  );
  return run;
}

/**
 * Run-level Resume：加载已持久化的 Run 并继续。
 * **必须保持同一个 run_id** —— 新建 Run 冒充 Resume 是伪装，不是恢复。
 */
export function resumeRun(runId, opts = {}) {
  const run = loadRun(runId, opts);
  if (run.state === RUN_STATE.FINALIZED) {
    fail(`Run 已 FINALIZED（${run.final_status}），无法 resume：${runId}`, 'RUN_IMMUTABLE');
  }
  const open = run.attempts.filter((a) => a.status === ATTEMPT_STATUS.RUNNING);
  appendEvent(runId, EVENT_TYPE.RUN_RESUMED, { open_attempts: open.map((a) => a.attempt_id) }, opts);
  return {
    run,
    events: loadEvents(runId, opts),
    openAttempts: open,
  };
}

export function blockRun(runId, reason, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  run.blocked = { reason: requireString(reason, 'reason'), at: nowIso() };
  run.state = RUN_STATE.EXECUTED;
  persist(run, opts);
  appendEvent(runId, EVENT_TYPE.RUN_BLOCKED, { reason: run.blocked.reason }, opts);
  return run;
}

/** 记录 Agent Claim。它只是 Verify 的输入，**绝不等于** final_status。 */
export function recordClaim(runId, claim, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  run.agent_claim = assertOneOf(claim, CLAIMS, 'claim');
  persist(run, opts);
  appendEvent(runId, EVENT_TYPE.CLAIM_RECORDED, { claim: run.agent_claim }, opts);
  return run;
}

/* ------------------------------------------------------------------ *
 * Attempt
 * ------------------------------------------------------------------ */

function findAttempt(run, attemptId) {
  const attempt = run.attempts.find((a) => a.attempt_id === attemptId);
  if (!attempt) {
    fail(`Attempt 不存在：${attemptId}（${run.run_id}）`, 'ATTEMPT_NOT_FOUND');
  }
  return attempt;
}

/** 开始一次新 Attempt。Retry 走同一入口——序号递增，历史 Attempt 原样保留。 */
export function startAttempt(runId, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  const open = run.attempts.find((a) => a.status === ATTEMPT_STATUS.RUNNING);
  if (open) {
    fail(`存在未结束的 Attempt：${open.attempt_id}，请先 attempt-finish`, 'ATTEMPT_OPEN');
  }

  const sequence = run.attempts.length + 1;
  const attempt = {
    attempt_id: makeAttemptId(sequence),
    run_id: runId,
    sequence,
    started_at: nowIso(),
    finished_at: null,
    status: ATTEMPT_STATUS.RUNNING,
    exit_code: null,
    duration_ms: null,
    steps: [],
    assertions: [],
    evidence_refs: [],
    failure: null,
  };

  run.attempts.push(attempt);
  run.state = RUN_STATE.RUNNING;
  persist(run, opts);
  appendEvent(runId, EVENT_TYPE.ATTEMPT_STARTED, { attempt_id: attempt.attempt_id, sequence }, opts);
  return attempt;
}

export function recordStep(runId, attemptId, { name, status = 'PASS', detail = null }, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  const attempt = findAttempt(run, attemptId);
  const step = {
    step_id: `S${String(attempt.steps.length + 1).padStart(3, '0')}`,
    name: requireString(name, 'step name'),
    status,
    detail,
    at: nowIso(),
  };
  attempt.steps.push(step);
  persist(run, opts);
  appendEvent(runId, EVENT_TYPE.STEP_COMPLETED, { attempt_id: attemptId, ...step }, opts);
  return step;
}

/**
 * 结束 Attempt 并写入结果。
 * `failure` 仅在非 PASS 时有意义，结构为 { type, message }。
 */
export function finishAttempt(runId, attemptId, { status, exitCode = null, failure = null }, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  const attempt = findAttempt(run, attemptId);
  if (attempt.status !== ATTEMPT_STATUS.RUNNING) {
    fail(`Attempt 已结束：${attemptId}（${attempt.status}）`, 'ATTEMPT_CLOSED');
  }

  assertOneOf(status, ATTEMPT_STATUSES.filter((s) => s !== ATTEMPT_STATUS.RUNNING), 'attempt status');
  attempt.status = status;
  attempt.exit_code = exitCode;
  attempt.finished_at = nowIso();
  attempt.duration_ms = Math.max(0, Date.parse(attempt.finished_at) - Date.parse(attempt.started_at));
  attempt.failure = failure;

  if (failure) {
    run.failures.push({ attempt_id: attemptId, ...failure });
  }
  run.state = RUN_STATE.EXECUTED;
  run.finished_at = attempt.finished_at;
  rebuildAssertionSummary(run);
  persist(run, opts);
  appendEvent(
    runId,
    EVENT_TYPE.ATTEMPT_FINISHED,
    { attempt_id: attemptId, status, exit_code: exitCode, failure },
    opts,
  );
  return attempt;
}

/* ------------------------------------------------------------------ *
 * Assertion Result
 * ------------------------------------------------------------------ */

/** Run 级断言汇总：同一 assertion id 以**最后一次** Attempt 的结果为准（Retry 后以新结果覆盖汇总）。 */
function rebuildAssertionSummary(run) {
  const latest = new Map();
  for (const attempt of run.attempts) {
    for (const a of attempt.assertions) {
      latest.set(a.assertion_id, { ...a, attempt_id: attempt.attempt_id });
    }
  }
  run.assertions = [...latest.values()];
  return run.assertions;
}

/**
 * 记录一条断言求值结果。
 *
 * Core **不执行断言**——求值由测试脚本完成，Core 只登记事实。
 * 这条边界很重要：否则 Core 会重新发明一个断言引擎。
 */
export function recordAssertion(
  runId,
  attemptId,
  { assertionId, status, expected = null, actual = null, evidenceRefs = [] },
  opts = {},
) {
  const run = assertWritable(loadRun(runId, opts));
  const attempt = findAttempt(run, attemptId);
  const id = requireString(assertionId, 'assertionId');
  assertOneOf(status, ASSERTION_STATUSES, 'assertion status');

  const declared = run.case_assertions.some((a) => a.id === id);
  const result = {
    assertion_id: id,
    attempt_id: attemptId,
    status,
    expected,
    actual,
    evidence_refs: evidenceRefs,
    declared,
    at: nowIso(),
  };

  const existing = attempt.assertions.findIndex((a) => a.assertion_id === id);
  if (existing === -1) {
    attempt.assertions.push(result);
  } else {
    // 同一 Attempt 内重复记录同一断言：以后写为准，但事件流保留两条记录
    attempt.assertions[existing] = result;
  }

  rebuildAssertionSummary(run);
  persist(run, opts);
  appendEvent(runId, EVENT_TYPE.ASSERTION_RECORDED, { attempt_id: attemptId, ...result }, opts);
  return result;
}

/* ------------------------------------------------------------------ *
 * Evidence 引用（文件与 Manifest 由 evidence-store 负责）
 * ------------------------------------------------------------------ */

export function attachEvidence(runId, attemptId, evidence, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  const attempt = findAttempt(run, attemptId);
  if (!attempt.evidence_refs.includes(evidence.evidence_id)) {
    attempt.evidence_refs.push(evidence.evidence_id);
  }
  if (!run.evidence_refs.includes(evidence.evidence_id)) {
    run.evidence_refs.push(evidence.evidence_id);
  }
  persist(run, opts);
  appendEvent(
    runId,
    EVENT_TYPE.EVIDENCE_REGISTERED,
    {
      attempt_id: attemptId,
      evidence_id: evidence.evidence_id,
      evidence_type: evidence.type,
      sha256: evidence.sha256,
    },
    opts,
  );
  return run;
}

/* ------------------------------------------------------------------ *
 * 诊断（Phase 1：Harness 只负责保存，不自动诊断）
 * ------------------------------------------------------------------ */

/**
 * 保存一条诊断记录。
 * 假设 / 结论 / 行动由 Agent 提出，Harness 的职责是**把它和执行事实绑定在一起持久化**，
 * 使其可被复核——而不是替 Agent 推理。
 */
export function recordDiagnostic(runId, diagnostic, opts = {}) {
  const run = assertWritable(loadRun(runId, opts));
  const entry = {
    diagnostic_id: shortId('dg'),
    attempt_id: diagnostic.attemptId || null,
    classification: diagnostic.classification,
    hypothesis: diagnostic.hypothesis || null,
    diagnostic: diagnostic.diagnostic || null,
    action: diagnostic.action || null,
    evidence_refs: diagnostic.evidenceRefs || [],
    at: nowIso(),
  };
  run.diagnostics.push(entry);
  persist(run, opts);
  return entry;
}

/** 由 verify / finalize 写回结论。这是唯一允许设置 final_status 的路径。 */
export function applyVerdict(runId, { finalStatus, claimConsistency, state }, opts = {}) {
  const run = loadRun(runId, opts);
  if (claimConsistency !== undefined) run.claim_consistency = claimConsistency;
  if (finalStatus !== undefined) run.final_status = finalStatus;
  if (state !== undefined) run.state = state;
  persist(run, opts);
  return run;
}
