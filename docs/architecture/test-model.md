# Test Model —— Case / Run / Attempt / Evidence / Assertion

> 本文件合并了 Test Case Model、Test Run Model、Evidence Model、Assertion Model。
> 合并理由：这四者是**同一条因果链上的相邻环节**，字段互相引用，拆成四份文档会导致
> 每次改动都要同步四处。它们共同回答一个问题：**"一次测试到底发生了什么，怎么证明。"**
>
> 现状依据见 `docs/architecture/agent-native-capability-matrix.md`。

---

## 一、核心因果链（所有模型都服务于这条链）

```
Requirement
     ↓
Assertion            ← 需求被翻译成可判定的命题（Case 上）
     ↓
Execution            ← 真的跑了（Attempt / Step 上）
     ↓
Evidence             ← 证明跑的时候发生了什么
     ↓
Verification         ← 机器核对：Evidence 够不够？Assertion 真的求值了吗？Claim 一致吗？
     ↓
FINAL RESULT
```

两条不可违反的原则，2.0 把它们从散文变成代码：

- **Evidence 不等于 PASS。** 有截图只能证明"截图存在"。
- **Agent Claim 不等于 FINAL RESULT。** Agent 说 PASS 只是一个待核对的输入。

---

## 二、Test Case —— "应该测什么"

### 2.1 与 v1.x 的关系

Case 模型是 v1.x **最成功**的部分：已实现（`caseStore.ts`）、已执行（22 个文件）、已验证。
2.0 **不推倒重来**，只做两处增量：

1. 新增 `assertions` 块（把散落在脚本里的断言提升为一等公民）；
2. 新增 `schemaVersion`。

`status` 状态机、Frontmatter 最小化回写、人工修改保护、去重规则——**全部原样保留**。

### 2.2 字段（★ = 2.0 新增）

```yaml
---
schemaVersion: "2.0"        # ★
id: TC-SOLUTIONCONFIG-002
title: 列表行 status 变体（继续填写/修改按钮）
status: ready               # 生命周期，见 2.3
version: 3                  # 内容版本，人工实质性修改时 +1
kind: e2e
module: solutionConfig
route: material-operate/solution-config/list
script: tests/e2e/solution-config.variant.e2e.spec.ts
tags: [variant, permission]
source: docs/test-pages/配制溶液/页面.md    # ★ 需求来源，可追溯
created_at: 2026-09-03T10:00:00+08:00
updated_at: 2026-09-03T15:31:00+08:00
last_run_id: RUN-20260903-152447
last_run_status: BLOCKED
---
```

正文保留 v1.x 全部章节（测试目标 / 前置条件 / 测试步骤 / **测试数据明细** / 断言 / 关联用例 / 备注）。

### 2.3 生命周期（保持 v1.x 不变）

```
pending_review ──人工审核──▶ ready ──开始执行──▶ running ──▶ completed / failed
                                ▲                              │
                                └──────── 重跑 ────────────────┘
```

**为什么不引入 DRAFT / PASSED / FAILED / BLOCKED / DEPRECATED？**

这是本次设计主动**拒绝**的一个"完整性"诱惑。逐条判定：

| 候选状态 | 判定 | 理由 |
|---------|:---:|------|
| `DRAFT` | **拒绝** | 与 `pending_review` 语义重合 |
| `PASSED` / `FAILED` | **拒绝——属于 Run** | Case 说"应该测什么"，不该记"某次测成了什么"。v1.x 的 `completed ≠ PASS` 判断是对的，2.0 继承 |
| `BLOCKED` | **拒绝——属于 Run** | 同上；BLOCKED 是本次执行的环境事实 |
| `RUNNING` | **保留** | 它标记的是"执行中断留下的脏状态"，有真实工程价值 |
| `DEPRECATED` | **接受，但用 tag 表达** | 加 `tags: [deprecated]` 即可，不值得新增状态与转换边 |

> 判定原则：**任何"某一次执行的结果"都不得进入 Case Status。**
> v1.x 已经守住了这条线（`completed ≠ PASS`），2.0 只需不破坏它。

### 2.4 ★ Assertion 提升为一等公民（P0）

**当前问题**：断言只存在于两个地方——Case 正文的自然语言描述，和脚本里的 `expect(...)`。
两者没有 ID、没有关联、无法跨 Run 比较，**Harness 无法回答"这条 Case 的第 3 条断言上次是不是也通过了"**。

2.0 在 Case 正文新增结构化断言块：

```yaml
assertions:
  - id: A1
    layer: ui              # ui | api | db
    description: 行内出现「继续填写」按钮，不出现「修改」
    kind: text-contains
    required: true
  - id: A2
    layer: ui
    description: 点击后跳转 solution-config/edit
    kind: url-matches
    required: true
  - id: A3
    layer: db
    description: 库存守恒 available + freeze + used 不变
    kind: invariant
    required: false        # 无 DB 工具时可 Not Executed，不阻断 finalize
```

- `id` **在 Case 内稳定不变**，是跨 Run 比较的键。
- `required: true` 的断言**必须有求值结果**才允许 `FINALIZED_PASS`；
  没有结果 → `INCONCLUSIVE`（不是 FAIL，也绝不是 PASS）。
- `kind` 是给人和报告看的**分类**，Core 不解释语义、不执行断言——**求值由脚本做，Core 只登记结果**。

> 这条边界很重要：Core **不**变成断言引擎（那会重新发明 Playwright 的 expect）。
> Core 只保证"每条 required 断言都有一个带证据的求值结果"。

### 2.5 Test Data Matrix（保持，但必须真正接线）

表格结构、解析容错（`parseDataMatrix`）**全部保留**。
唯一变化是 P0 硬性要求：**脚本的输入必须来自 DataGroup，不得写字面量**（见 `harness-architecture.md` 6.2）。

---

## 三、Test Run —— "某一次真的发生了什么"

### 3.1 Case 与 Run 严格解耦

```
CASE-SOLUTIONCONFIG-002  version: 3
        │
        ├── RUN-20260903-102335   → FINALIZED_FAIL
        ├── RUN-20260903-152447   → BLOCKED
        └── RUN-20260907-101530   → FINALIZED_PASS
```

- **Run 永不覆盖 Case。** Case 只回写 4 个摘要字段（v1.x 已实现，保留）。
- **Run 一经 finalize 即不可变。** Core 对已 finalize 的 Run 的任何写入直接抛错。
- Run 记录 `caseVersion`：Case 改过之后，旧 Run 仍能说明"当时测的是哪一版"。

### 3.2 Run Schema

```jsonc
{
  "schemaVersion": "2.0",
  "runId": "RUN-20260907-101530",
  "caseId": "TC-SOLUTIONCONFIG-002",
  "caseVersion": 3,

  "status": "FINALIZED_PASS",        // 终局，只能由 finalize 写入
  "agentClaim": "PASS",              // Agent 自称，只是输入，绝不等于 status
  "claimConsistency": "CONSISTENT",  // CONSISTENT | CONTRADICTED | UNVERIFIABLE

  "startedAt": "2026-09-07T10:15:30+08:00",
  "finishedAt": "2026-09-07T10:16:02+08:00",

  "environment": {
    "webBase": "http://localhost:3004",
    "apiBase": "http://localhost:10110/vilims/",
    "frontendCommit": "2f8a6c1c…",
    "backendCommit": "…",
    "branch": "it20260903",
    "account": "TEST_USERNAME"
  },

  "actor": "agent",
  "runtime": "claude-code",
  "model": "claude-opus-5",
  "policy": { "evidence": "e2e-default", "retry": "default", "finalization": "strict" },

  "attempts": [ /* 见 3.3 */ ],

  "assertions": [                    // 跨 attempt 汇总，键为 Case 的 assertion id
    { "id": "A1", "required": true,  "result": "pass", "attemptId": 2 },
    { "id": "A2", "required": true,  "result": "pass", "attemptId": 2 },
    { "id": "A3", "required": false, "result": "not_executed", "reason": "无 DB 工具" }
  ],

  "evidenceRefs": [ /* 见第五节 */ ],
  "failures": [],
  "diagnosticsRef": null,
  "evaluationRef": null,

  "observability": {
    "toolCalls":  { "value": 42,   "availability": "available" },
    "agentTurns": { "value": null, "availability": "not_supported" }
  }
}
```

### 3.3 ★ Attempt —— 修复 v1.x 最严重的语义丢失（P0）

**当前问题**：Playwright `retries: 1` 把多次尝试折叠成一个 `flaky` 标记。
`Attempt 1 FAIL / Attempt 2 PASS / Attempt 3 PASS` 在磁盘上只剩一个数字。

2.0：**每个 Attempt 是独立的一等对象，各自持有完整执行、证据、结果、失败。**

```jsonc
"attempts": [
  {
    "attemptId": 1,
    "startedAt": "…", "finishedAt": "…",
    "result": "FAIL",
    "trigger": "initial",
    "steps": [ /* 见 3.4 */ ],
    "assertionResults": [ { "id": "A1", "result": "fail", "expected": "继续填写", "actual": "修改" } ],
    "evidenceRefs": ["ev_a1b2", "ev_c3d4"],
    "failure": { "type": "Assertion Failure", "message": "…", "triage": null }
  },
  {
    "attemptId": 2,
    "result": "PASS",
    "trigger": "retry",
    "retryReason": "policy:auto-retry-on-assertion-failure",
    "steps": [ /* … */ ],
    "assertionResults": [ { "id": "A1", "result": "pass" } ],
    "evidenceRefs": ["ev_e5f6"]
  }
]
```

**硬性规则：**

- **历史绝不压缩。** `[FAIL, PASS, PASS]` 不得被写成 `PASS`。
- Run 的 `status` 由 **Finalization Policy** 依据完整 attempt 序列判定，
  而不是取"最后一次结果"——`[FAIL, PASS]` 在默认 Policy 下判 **FLAKY**，不是 PASS。
- `trigger` 区分 `initial` / `retry` / `manual` / `resume`，使"为什么会有第二次"可追溯。

### 3.4 Step —— Resume 的最小单位

v1.x 的 Resume 之所以不可靠，是因为**最小可恢复单位是一整次 playwright 调用**。
2.0 引入 step 级记录：

```jsonc
"steps": [
  { "index": 1, "name": "登录",              "status": "PASS",        "reentrant": true,  "at": "…" },
  { "index": 2, "name": "打开列表页",        "status": "PASS",        "reentrant": true,  "at": "…" },
  { "index": 3, "name": "提交配制溶液",      "status": "RUNNING",     "reentrant": false, "at": "…" },
  { "index": 4, "name": "断言库存扣减",      "status": "NOT_STARTED", "reentrant": true }
]
```

- **`reentrant` 是唯一新增的语义负担，但它不可省略**：
  `reentrant: true` 的步骤（导航、查询、断言）可安全重跑；
  `reentrant: false` 的步骤（提交、扣减、审批）重跑会污染数据。
- `auto-test resume <runId>` 的输出是**一份事实报告**，不是自动决策：

  ```
  RUN-… / TC-… attempt 2
    step 1 登录            PASS         可跳过
    step 2 打开列表页       PASS         可跳过
    step 3 提交配制溶液     RUNNING      ⚠ 不可重入 —— 需人工/Agent 确认业务侧是否已生效
    step 4 断言库存扣减     NOT_STARTED  待执行
  已有证据：ev_a1b2(screenshot, step2) …
  ```

- **决定怎么恢复的是 Agent，Harness 只负责把状态讲清楚。**
  这正是"不和模型竞争智能"的具体体现：判断"提交到底成没成功"需要业务理解，交给 Agent；
  但"step 3 处于 RUNNING 且不可重入"这个事实必须由 Harness 保证准确。

### 3.5 events.jsonl —— 崩溃安全的事实来源

`run.json` 是**投影**，`events.jsonl` 是**事实**。所有写入先追加到 events：

```
{"t":"run.start","runId":"…","caseId":"…","at":"…"}
{"t":"attempt.start","attemptId":1,"trigger":"initial"}
{"t":"step","attemptId":1,"index":1,"name":"登录","status":"PASS"}
{"t":"evidence","attemptId":1,"id":"ev_a1b2","kind":"screenshot","path":"evidence/…png","sha256":"…"}
{"t":"assert","attemptId":1,"id":"A1","result":"fail","expected":"继续填写","actual":"修改"}
{"t":"attempt.end","attemptId":1,"result":"FAIL"}
{"t":"run.claim","claim":"FAIL"}
{"t":"run.verdict","status":"FINALIZED_FAIL","by":"finalize"}
```

Agent / Runner 崩溃后，磁盘上仍有到崩溃点为止的全部事实——
这是 v1.x 完全不具备的能力（当时崩溃 = 什么都没有）。

---

## 四、Agent Claim vs Actual Result（Scenario F 的解法）

三个字段必须**物理分离**，绝不可互相覆盖：

| 字段 | 写入者 | 含义 |
|------|-------|------|
| `agentClaim` | Agent（`run finish --claim`） | Agent 自称的结果 |
| `attempts[].result` | 执行过程记录 | 实际执行发生了什么 |
| `status` | **只能由 `auto-test finalize` 写入** | 最终结论 |

`auto-test verify` 计算 `claimConsistency`：

| 组合 | claimConsistency | 最终 status |
|------|-----------------|------------|
| Claim PASS + 实际 PASS + 证据完整 + required 断言全 pass | `CONSISTENT` | `FINALIZED_PASS` |
| Claim PASS + **无任何 attempt / 无 step 记录** | `UNVERIFIABLE` | **`INVALID`** |
| Claim PASS + 证据不满足 Evidence Policy | `UNVERIFIABLE` | **`INCONCLUSIVE`** |
| Claim PASS + required 断言存在 fail | `CONTRADICTED` | **`INVALID`** |
| Claim PASS + required 断言未求值 | `UNVERIFIABLE` | **`INCONCLUSIVE`** |
| Claim FAIL + 实际 FAIL | `CONSISTENT` | `FINALIZED_FAIL` |

> **Scenario F（Agent 谎报 PASS）在 2.0 中的处理是机械的**：
> 谎报意味着 `events.jsonl` 里没有对应的 step / assert / evidence 事件。
> `verify` 一定会发现，并给出 `INVALID`——不需要任何智能判断。

---

## 五、Evidence Model

### 5.1 Evidence 的定义

> **Evidence 证明发生了什么，不判断是否满足需求。**

这条界线必须写进代码：Core 里**没有任何一处**会因为"存在某类 Evidence"而把结果判为 PASS。
Evidence 只参与两件事：① 满足 Evidence Policy（准入条件）；② 供人和 Agent 事后回溯。

### 5.2 Evidence 类型（按当前 Runner 真实可获得性分级）

| kind | 来源 | 当前可获得 | 默认何时收集 |
|------|------|:---:|---|
| `screenshot` | Playwright | ✅ | **每个 attempt 结束时（含 PASS）** ★ 与 v1.x 相反 |
| `trace` | Playwright | ✅ | 失败时 + 首次 PASS 时抽样 |
| `console-log` | Playwright | ✅ | 全程 |
| `network-log` | Playwright | ✅ | 全程（含 API 断言的请求/响应） |
| `api-request` / `api-response` | Playwright APIRequest | ✅ | API 类断言必收 |
| `database-result` | 项目 DB 工具 | ◐ 依赖项目 | DB 类断言必收（操作前/后快照） |
| `stdout` / `stderr` | Runner | ✅ | 全程（截断策略见下） |
| `dom-snapshot` | Playwright | ✅ | 可选 |
| `video` | Playwright | ✅ | 默认关（体积） |
| `agent-message` / `tool-call` | Runtime | ◐ 依赖 Runtime | 能拿到才记，拿不到标 `not_supported` |

**不要求每个测试产生所有 Evidence** —— 由 Evidence Policy 决定（见 `policy-and-diagnostics.md`）。

### 5.3 Evidence 记录格式

```jsonc
{
  "id": "ev_a1b2c3",
  "kind": "screenshot",
  "attemptId": 2,
  "stepIndex": 3,
  "assertionId": "A1",          // 可空：这份证据支撑哪条断言
  "path": "evidence/ev_a1b2c3.png",
  "sha256": "9f8e7d…",           // ★ 防止事后替换/伪造
  "bytes": 184320,
  "at": "2026-09-07T10:15:47+08:00"
}
```

- **`sha256` 是必填项。** 它把"证据存在"升级为"证据未被篡改"，
  也让 `runs/` 入库时可以只存引用、不存二进制。
- `path` **相对 Run 目录**，使整个 Run 目录可整体移动/归档。
- 引用不存在的文件 → `auto-test verify` 直接判 `INVALID`（这正是 v1.x
  `outputsVerified: true` 由 Agent 自报所缺失的那一环）。

### 5.4 ★ 最重要的一处反转：PASS 也要有证据

v1.x：`screenshot: only-on-failure` / `trace: retain-on-failure` → **PASS 零证据**。

2.0 默认 Evidence Policy 要求每个 attempt（**无论结果**）至少留下：

- 1 张 `screenshot`（E2E）或 1 组 `api-request` + `api-response`（API）
- 完整 `console-log` + `network-log`
- 每条 `required` 断言至少 1 份关联 Evidence

**理由**：如果 PASS 没有证据，那么"Harness 能证明测试真的发生了"这条核心承诺就是假的；
并且 Regression 时无法回答"上次 PASS 的时候页面到底长什么样"。

体积可控性已核实：单个 Run 通常 2–20 张截图，量级为 MB，且 evidence 目录不入库。

---

## 六、Assertion Model

### 6.1 职责划分

| 组件 | 做什么 | 不做什么 |
|------|-------|---------|
| **Case** | 声明断言（id / layer / description / required） | 不写实现 |
| **脚本 (Playwright)** | 求值，产出 expected / actual / result | 不决定终局 |
| **Core** | 登记 AssertionResult，校验覆盖率 | **不实现断言引擎** |
| **Policy** | 依据断言覆盖率决定能否 finalize | 不改断言结果 |

### 6.2 AssertionResult

```jsonc
{
  "id": "A1",
  "attemptId": 2,
  "result": "pass",             // pass | fail | not_executed | error
  "expected": "继续填写",
  "actual":   "继续填写",
  "evidenceRefs": ["ev_a1b2"],
  "at": "…"
}
```

### 6.3 断言覆盖率是 Finalization 的硬前置

```
required 断言全部 result=pass        → 允许 FINALIZED_PASS
required 断言存在 fail               → FINALIZED_FAIL（或 INVALID，若 Claim 为 PASS）
required 断言存在 not_executed/error → INCONCLUSIVE   ← 绝不允许 PASS
optional 断言 not_executed           → 不阻断，但必须在报告中列出
```

> 这条规则直接修复了 v1.x 的一类隐患：
> 报告里"数据库断言：Not Executed（无 DB 工具）"与"结论：建议验收"可以并存。
> 2.0 中，只要该断言被标 `required`，它未执行就**不可能**走到 `FINALIZED_PASS`。

---

## 七、与 v1.x 的兼容性

| v1.x 概念 | 2.0 处理 |
|-----------|---------|
| Case Frontmatter + 正文结构 | **完全保留**，加 `schemaVersion` / `assertions` / `source` |
| Case 生命周期五状态 | **完全保留**，转换表不变 |
| 最小化回写 4 字段 | **完全保留** |
| Test Data Matrix 表格 | **完全保留**（解析器复用） |
| `Execution Result` PASS/FAIL/ERROR/BLOCKED | 保留为 **attempt 级**结果；Run 级改用 6 态终局 |
| `RUN-*.jsonl`（投影汇总） | **替换**为 `events.jsonl`（逐事件） |
| `DIAG-*.json` | 并入 `runs/<id>/diagnostics.json`，字段基本沿用 |
| 证据轨 A/B | **消失**——A 轨成为唯一轨；不满足即 `INCONCLUSIVE`，不再"降级通过" |

**旧 Case 文件无需迁移**：缺 `schemaVersion` 视为 `1.x`，缺 `assertions` 时
`auto-test case validate` 给出 warning 并把该 Case 的 finalize 策略降为 `lenient`
（详见 `policy-and-diagnostics.md`），不阻断使用。

---

相关文档：`docs/architecture/harness-architecture.md`、
`docs/architecture/policy-and-diagnostics.md`、`docs/architecture/migration-plan.md`。
