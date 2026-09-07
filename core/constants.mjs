/**
 * constants —— Auto-Test 2.0 Harness Core 的枚举、Schema 版本与退出码。
 *
 * 这里定义的取值是 Core 的**唯一事实来源**：CLI、Store、Verify、Finalize 一律从此引用，
 * 不得在别处另写字面量（v1.x 的教训：同一份清单维护在两个文件里必然漂移）。
 */

/** 持久化产物的 Schema 版本。读取时按此选择解析策略，历史产物必须永远可读。 */
export const SCHEMA_VERSION = '2.0';

/* ------------------------------------------------------------------ *
 * Case
 * ------------------------------------------------------------------ */

/**
 * Case 生命周期状态（磁盘取值，与 v1.x 完全一致，不做破坏性改名）。
 * `DRAFT` 是 `pending_review` 的对外别名，见 normalizeCaseStatus()。
 */
export const CASE_STATUS = {
  PENDING_REVIEW: 'pending_review',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const CASE_STATUSES = Object.values(CASE_STATUS);

/** 合法状态转换表（沿用 v1.x `case-store-rule` 的状态机，未变更）。 */
export const CASE_TRANSITIONS = {
  pending_review: ['ready'],
  ready: ['running'],
  running: ['completed', 'failed'],
  completed: ['ready', 'running'],
  failed: ['ready', 'running'],
};

/** 对外别名：DRAFT ≡ pending_review。允许调用方用 2.0 词汇，磁盘仍写 v1.x 取值。 */
const CASE_STATUS_ALIASES = {
  draft: CASE_STATUS.PENDING_REVIEW,
  DRAFT: CASE_STATUS.PENDING_REVIEW,
  READY: CASE_STATUS.READY,
  RUNNING: CASE_STATUS.RUNNING,
  COMPLETED: CASE_STATUS.COMPLETED,
  FAILED: CASE_STATUS.FAILED,
};

/** 把外部传入的状态词归一为磁盘取值；无法识别时原样返回，由调用方校验。 */
export function normalizeCaseStatus(status) {
  if (typeof status !== 'string') {
    return status;
  }
  return CASE_STATUS_ALIASES[status] || CASE_STATUS_ALIASES[status.trim()] || status.trim();
}

/**
 * Legacy 标记：Case 无任何 Assertion 定义。
 * 历史 Case 可读取 / 执行 / 迁移，但其 Run **永远不得** FINALIZED_PASS（见 finalize.mjs）。
 */
export const LEGACY_NO_ASSERTION = 'LEGACY_NO_ASSERTION';

/* ------------------------------------------------------------------ *
 * Run / Attempt / Assertion
 * ------------------------------------------------------------------ */

/** Run 生命周期（编排进度），与 FINAL_STATUS 是两个维度。 */
export const RUN_STATE = {
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  EXECUTED: 'EXECUTED',
  FINALIZED: 'FINALIZED',
};

/** 最终状态。只能由 finalizeRun() 写入，Agent 无法直接设置。 */
export const FINAL_STATUS = {
  FINALIZED_PASS: 'FINALIZED_PASS',
  FINALIZED_FAIL: 'FINALIZED_FAIL',
  INVALID: 'INVALID',
  INCONCLUSIVE: 'INCONCLUSIVE',
  FLAKY: 'FLAKY',
  BLOCKED: 'BLOCKED',
};

export const FINAL_STATUSES = Object.values(FINAL_STATUS);

/** 单次 Attempt 的执行结果。 */
export const ATTEMPT_STATUS = {
  RUNNING: 'RUNNING',
  PASS: 'PASS',
  FAIL: 'FAIL',
  ERROR: 'ERROR',
  BLOCKED: 'BLOCKED',
};

export const ATTEMPT_STATUSES = Object.values(ATTEMPT_STATUS);

/** Assertion 求值结果。NOT_EVALUATED 是显式取值，不是"缺省"。 */
export const ASSERTION_STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_EVALUATED: 'NOT_EVALUATED',
};

export const ASSERTION_STATUSES = Object.values(ASSERTION_STATUS);

/** Agent 自称的结果。只是 Verify 的输入，绝不等于 FINAL_STATUS。 */
export const CLAIM = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
};

export const CLAIMS = Object.values(CLAIM);

/** Agent Claim 与执行事实的一致性判定。 */
export const CLAIM_CONSISTENCY = {
  CONSISTENT: 'CONSISTENT',
  CONTRADICTED: 'CONTRADICTED',
  UNVERIFIABLE: 'UNVERIFIABLE',
  NOT_CLAIMED: 'NOT_CLAIMED',
};

/* ------------------------------------------------------------------ *
 * Failure / Evidence / Event
 * ------------------------------------------------------------------ */

/** 最小失败分类（Phase 1 只保留 7 类，不做几十种细分）。 */
export const FAILURE_TYPE = {
  PRODUCT_BUG: 'PRODUCT_BUG',
  TEST_BUG: 'TEST_BUG',
  ENVIRONMENT: 'ENVIRONMENT',
  DATA: 'DATA',
  TIMEOUT: 'TIMEOUT',
  ASSERTION: 'ASSERTION',
  UNKNOWN: 'UNKNOWN',
};

export const FAILURE_TYPES = Object.values(FAILURE_TYPE);

export const EVIDENCE_TYPE = {
  SCREENSHOT: 'screenshot',
  TRACE: 'trace',
  VIDEO: 'video',
  CONSOLE_LOG: 'console_log',
  NETWORK_LOG: 'network_log',
  API_RESPONSE: 'api_response',
  DB_SNAPSHOT: 'db_snapshot',
  STDOUT: 'stdout',
  STDERR: 'stderr',
  STRUCTURED_EVENT: 'structured_event',
};

export const EVIDENCE_TYPES = Object.values(EVIDENCE_TYPE);

/** 大体积二进制证据：入 Manifest（含 sha256），文件本身不入 Git。 */
export const BINARY_EVIDENCE_TYPES = [
  EVIDENCE_TYPE.SCREENSHOT,
  EVIDENCE_TYPE.TRACE,
  EVIDENCE_TYPE.VIDEO,
];

export const EVENT_TYPE = {
  RUN_CREATED: 'RUN_CREATED',
  RUN_RESUMED: 'RUN_RESUMED',
  RUN_BLOCKED: 'RUN_BLOCKED',
  ATTEMPT_STARTED: 'ATTEMPT_STARTED',
  STEP_COMPLETED: 'STEP_COMPLETED',
  ASSERTION_RECORDED: 'ASSERTION_RECORDED',
  EVIDENCE_REGISTERED: 'EVIDENCE_REGISTERED',
  ATTEMPT_FINISHED: 'ATTEMPT_FINISHED',
  CLAIM_RECORDED: 'CLAIM_RECORDED',
  RUN_VERIFIED: 'RUN_VERIFIED',
  RUN_FINALIZED: 'RUN_FINALIZED',
};

/**
 * **执行事实事件**——证明"测试真的跑过"的唯一依据。
 * Fake PASS 检测的核心：Claim=PASS 但这些事件一条都没有 → INVALID。
 *
 * 注意 RUN_CREATED / CLAIM_RECORDED 不在此列：它们只证明"有人建了个 Run 并声称通过"，
 * 不证明任何执行发生过。
 */
export const EXECUTION_FACT_EVENTS = [
  EVENT_TYPE.ATTEMPT_STARTED,
  EVENT_TYPE.STEP_COMPLETED,
  EVENT_TYPE.ASSERTION_RECORDED,
  EVENT_TYPE.EVIDENCE_REGISTERED,
  EVENT_TYPE.ATTEMPT_FINISHED,
];

/* ------------------------------------------------------------------ *
 * CLI 退出码
 * ------------------------------------------------------------------ */

/**
 * 退出码是 Harness 对 Agent 的**机械约束**：
 * Agent 可以用文字解释任何事，但改变不了非零退出码。
 */
export const EXIT = {
  /** 通过（verify: 事实可信；finalize: FINALIZED_PASS） */
  OK: 0,
  /** 未达成通过条件（FINALIZED_FAIL / FLAKY / BLOCKED / INCONCLUSIVE） */
  GATE_FAILED: 1,
  /** 事实不可信（INVALID：谎报、证据被篡改、状态非法） */
  INVALID: 2,
  /** 用法错误 / 内部错误 */
  USAGE: 3,
};
