# Policy / Failure Diagnostic / Agent Evaluation / Quality Gate

> 本文件合并了 Policy Model、Failure Diagnostic Model、Agent Evaluation Model、Quality Gate Model。
> 合并理由：这四者都是**对同一个 Run 做判定**的规则，共享同一份输入（Run + Attempt + Evidence +
> Assertion），且 Quality Gate 就是三条 Policy 的组合应用。拆开会导致判定条件在多处重复并漂移
> ——这正是 v1.x 里 Final Check Gate 在 `report-rule.md` 与 `auto-test-agent.md` 两处维护所踩过的坑。
>
> 现状依据见 `docs/architecture/agent-native-capability-matrix.md`。

---

## 零、Policy 的形态：配置 + 纯函数，不是对象体系

**明确拒绝**：`PolicyEngine` / `PolicyRegistry` / `PolicyResolver` / `PolicyProvider` /
`PolicyFactory` / `PolicyContext` / `PolicyStrategy`。

理由：当前只有 3 条 Policy、每条 5–8 个字段、只有一个实现者。
引入策略体系的维护成本远高于收益，且当前代码里**不存在**任何需要该抽象的复杂度。

2.0 的 Policy 就是：

```
<cwd>/.auto-test/policy.json        ← 配置（可提交，项目级）
        +
Core 里的 3 个纯函数：
   evaluateEvidence(run, policy)      → { satisfied, missing[] }
   shouldRetry(attempt, policy)       → { retry, reason }
   finalize(run, policy)              → { status, reasons[] }
```

第一阶段**只做这三条**。`Execution Policy` / `Environment Policy` / `Tool Policy` /
`Evaluation Policy` 一律**不独立实现**——需要时作为 `policy.json` 的字段或 Core 内部常量。

---

## 一、policy.json（完整默认值）

```jsonc
{
  "schemaVersion": "2.0",

  "evidence": {
    "profiles": {
      "e2e-default": {
        "requiredPerAttempt":  ["screenshot", "console-log", "network-log"],
        "requiredOnFailure":   ["trace"],
        "requiredPerRequiredAssertion": 1,
        "optional":            ["video", "dom-snapshot"]
      },
      "api-default": {
        "requiredPerAttempt":  ["api-request", "api-response"],
        "requiredOnFailure":   ["stderr"],
        "requiredPerRequiredAssertion": 1
      },
      "db-assertion": {
        "requiredPerAttempt":  ["database-result"],
        "note": "操作前/后各一份快照，缺一不可"
      },
      "smoke": {
        "requiredPerAttempt":  ["screenshot"],
        "requiredPerRequiredAssertion": 0
      }
    },
    "default": "e2e-default",
    "onUnavailableTool": "mark_not_executed"
  },

  "retry": {
    "maxAttempts": 3,
    "retryableFailureTypes":    ["Environment", "Network", "Timeout"],
    "nonRetryableFailureTypes": ["Assertion Failure", "Test Data", "Blocked", "Automation Error"],
    "retryOnAssertionFailure": true,
    "retryOnAssertionFailureMaxAttempts": 2,
    "flakyWhen": "any_attempt_failed_and_final_passed",
    "diagnoseAfterAttempts": 2,
    "backoffMs": [0, 2000, 5000]
  },

  "finalization": {
    "mode": "strict",
    "requireEvidencePolicySatisfied": true,
    "requireAllRequiredAssertionsEvaluated": true,
    "requireClaimConsistency": true,
    "requireNoUnverifiedEvidenceRef": true,
    "flakyBlocksPass": true,
    "allowLenientForLegacyCases": true
  }
}
```

---

## 二、Evidence Policy

### 2.1 职责

回答一个问题：**这次 Run 留下的证据，够不够支撑一个可信结论？**

它**不判断结论对不对**（那是 Assertion 的事），只判断"证据完整性"。

### 2.2 判定

```
evaluateEvidence(run, policy) →
  对每个 attempt：
    ① profile.requiredPerAttempt 中的每个 kind，至少存在 1 条 → 否则 missing
    ② attempt 失败时，requiredOnFailure 中的每个 kind 至少 1 条 → 否则 missing
    ③ 每条 required 断言，关联 evidenceRefs 数量 ≥ requiredPerRequiredAssertion → 否则 missing
    ④ 每条 evidenceRef 指向的文件真实存在，且 sha256 匹配 → 否则 invalid
  返回 { satisfied: missing.length === 0 && invalid.length === 0, missing, invalid }
```

### 2.3 与 v1.x 的两处关键差异

| | v1.x | 2.0 |
|---|---|---|
| PASS 时的证据 | 无（`only-on-failure`） | **必须有**（见 `test-model.md` 5.4） |
| 证据不足时 | 报告里"B 轨降级"，**照常给结论** | **`INCONCLUSIVE`，不给 PASS** |

> "降级仍然通过"是 v1.x 最大的设计漏洞：它让规范可以被合理地绕过，
> 而且每一次真实运行都在绕。2.0 取消降级通道——不够就是不够。

### 2.4 工具不可用时（例如项目没有 DB 查询工具）

`onUnavailableTool: "mark_not_executed"`：
该断言标 `not_executed` + 原因。若它是 `required` → `INCONCLUSIVE`；若 `optional` → 不阻断但必须在报告列出。

**唯一正确的做法是在 Case 里把它标成 `optional`**，而不是让 Policy 网开一面。
这把"要不要严格"的决定权交还给写用例的人，而不是藏在执行期的降级逻辑里。

---

## 三、Retry Policy

### 3.1 判定

```
shouldRetry(attempt, run, policy) →
  若 attempts.length >= maxAttempts                     → { retry: false, reason: "budget_exhausted" }
  若 failureType ∈ nonRetryableFailureTypes
       且非（retryOnAssertionFailure 且 type=Assertion Failure
             且 attempts.length < retryOnAssertionFailureMaxAttempts)
                                                        → { retry: false, reason: "non_retryable" }
  若 failureType ∈ retryableFailureTypes                → { retry: true,  reason: "retryable_failure" }
  否则                                                   → { retry: false, reason: "unknown_failure_type" }
```

### 3.2 为什么允许对 Assertion Failure 重试一次

看起来矛盾（断言失败重试不会变对），但这正是 **FLAKY 检测的唯一手段**：
`[FAIL, PASS]` 这个序列本身就是"存在竞态/时序缺陷"的证据。
v1.x 的注释说得对——"`retries: 1` 是免费的 FLAKY 证据源，不得浪费"。
2.0 保留这个洞察，但把结论从"记一笔 FLAKY"升级为**"FLAKY 默认阻断 PASS"**。

### 3.3 FLAKY 判定

```
flakyWhen: "any_attempt_failed_and_final_passed"

[PASS]              → 稳定 PASS
[FAIL, PASS]        → FLAKY        ← 绝不允许压缩成 PASS
[FAIL, PASS, PASS]  → FLAKY
[FAIL, FAIL]        → FAIL
```

`finalization.flakyBlocksPass: true` 时，FLAKY 是**独立终局**，不计入 PASS。
项目可改为 `false`（此时 FLAKY 计入 PASS 但仍单列），但**默认必须是 true**：
不稳定用例会掩盖真实的竞态缺陷，这正是 auto-test 立项时要抓的那类 bug。

### 3.4 进入诊断的时机

`diagnoseAfterAttempts: 2` —— 重试仍失败才进诊断，避免为偶发抖动付出诊断成本。
（沿用 v1.x `execute-rule` 的判断，正确。）

---

## 四、Finalization Policy 与 Quality Gate

### 4.1 完整判定链

```
Agent Claim
     ↓
Execution Result（attempts 序列）
     ↓
Evidence Validation      ← evaluateEvidence()
     ↓
Assertion Validation     ← required 断言覆盖率
     ↓
Policy Validation        ← retry 预算 / flaky 判定
     ↓
Claim Consistency        ← agentClaim vs 实际
     ↓
FINAL RESULT
```

### 4.2 六个终局状态与准入条件（**唯一定义处**）

| 状态 | 准入条件（全部满足） |
|------|-------------------|
| **FINALIZED_PASS** | ① 至少 1 个 attempt 且最终 attempt 为 PASS<br>② 所有 `required` 断言 `result=pass`<br>③ Evidence Policy `satisfied=true`<br>④ 所有 evidenceRef 文件存在且 sha256 匹配<br>⑤ `claimConsistency=CONSISTENT`<br>⑥ 非 FLAKY（当 `flakyBlocksPass=true`） |
| **FINALIZED_FAIL** | 存在 `required` 断言 `result=fail`，且证据满足 Evidence Policy（失败结论同样需要证据支撑） |
| **FLAKY** | 存在失败 attempt 且最终 attempt PASS，其余条件同 PASS |
| **BLOCKED** | 未真实执行：环境不可用 / 权限缺失 / 前置数据空档 / 依赖服务不可达。**必须有说明与证据**，不得无理由 BLOCKED |
| **INCONCLUSIVE** | 执行了，但**证据或断言不足以下结论**：Evidence Policy 不满足 ／ `required` 断言 `not_executed` 或 `error` ／ `claimConsistency=UNVERIFIABLE` |
| **INVALID** | **Agent 结果不可信**：Claim 为 PASS 但无 attempt/step 记录 ／ Claim 与 `required` 断言结果矛盾 ／ evidenceRef 指向不存在或 hash 不匹配的文件 ／ 试图写入已 finalize 的 Run |

### 4.3 关键原则：不得用总分掩盖关键失败

**Overall Score = 91 不能推出 FINALIZED_PASS。**

`finalize()` 的实现顺序是**硬编码的短路检查**，Evaluation 分数根本不参与：

```
1. 检查 INVALID 条件   → 命中即返回 INVALID，不再往下
2. 检查 BLOCKED 条件   → 命中即返回 BLOCKED
3. 检查 Evidence       → 不满足即 INCONCLUSIVE
4. 检查 required 断言   → 未求值即 INCONCLUSIVE；有 fail 即 FINALIZED_FAIL
5. 检查 Claim 一致性    → 不一致即 INVALID / INCONCLUSIVE
6. 检查 FLAKY          → 命中即 FLAKY
7. 全部通过            → FINALIZED_PASS
```

Evaluation（第六节）在这条链上**没有任何位置**。这是刻意设计的。

### 4.4 legacy 兼容

`allowLenientForLegacyCases: true` 时，`schemaVersion < 2.0`（无 `assertions` 块）的 Case
按 `lenient` 处理：跳过 4.2 的条件 ②，其余条件全部照常。

结论会带标记 `finalizationMode: "lenient"`，报告中显式呈现——**降级必须可见**。
这是给迁移期的过渡通道，不是永久后门（`migration-plan.md` 中安排了收口时间点）。

---

## 五、Failure Diagnostic Model

### 5.1 完整链路

```
Execution Failure
       ↓
Failure Classification    ← 分类法由 Harness 定义（保留 v1.x TRIAGE 八分类）
       ↓
Evidence Collection       ← Harness 保证（Evidence Policy）
       ↓
Hypothesis                ← Agent 产出
       ↓
Diagnostic                ← Agent 执行
       ↓
Action                    ← Agent 决定
       ↓
Retry / Repair
       ↓
Verification              ← Harness 保证（重跑 → 新 Run → finalize）
```

**分工**：分类法、证据、验证由 Harness 保证；假设、诊断、决策由 Agent 完成。
v1.x 的 `execute-rule` 花了大量篇幅**教 Agent 怎么提假设、怎么控制预算**——
这部分现在可以删掉（现代 Agent 原生具备），但**分类法和 Evidence Gate 必须留下并升级为代码**。

### 5.2 Failure Classification（沿用 v1.x 八分类，实证合理）

| 分类 | 最小充分证据（缺一即不得下此结论） |
|------|--------------------------------|
| `INFRASTRUCTURE_BUG` | 非零 exit code + stderr：浏览器缺失 / 脚本语法错误 / Runner 起不来 / 登录 setup 失败 |
| `ENVIRONMENT_BUG` | 真实渲染探测失败 或 依赖服务不可达 或 配置实测不符 |
| `FLAKY` | 隔离重跑结果不一致，或 retry 后转 PASS |
| `TEST_DATA_BUG` | **先直接调用查询接口核实**数据确实不存在/状态不符 |
| `TEST_BUG` | 接口层数据正确 + 选择器/等待/断言口径不符（附实际 DOM 文本） |
| `PRODUCT_BUG` | 接口数据正确 + 脚本口径正确 + 隔离重跑稳定复现 + 已抓 pageerror/异常响应 + 已排除"仅自动化环境可复现" |
| `SPECIFICATION_ERROR` | 用例预期与源码枚举分支/需求原文**并列可比对** |
| `UNKNOWN` | 以上证据均不足 |

映射到 2.0 的 `FailureType`（attempt 级）：`Assertion Failure` / `Automation Error` /
`Environment` / `Network` / `Timeout` / `Test Data` / `Blocked`。

### 5.3 ★ Evidence Gate 升级为代码（P0）

v1.x：*"没有该行要求的证据，就不许写该行的结论"* —— 一句 Prompt。
2.0：`auto-test diagnose set --triage PRODUCT_BUG` **校验该分类的最小证据集是否齐备，不齐备直接非零退出**。

```jsonc
// runs/<runId>/diagnostics.json
{
  "schemaVersion": "2.0",
  "runId": "RUN-…",
  "items": [{
    "caseId": "TC-…", "dataGroupId": "D003", "attemptId": 2,
    "result": "FAIL", "failureType": "Assertion Failure",
    "triage": "PRODUCT_BUG",
    "evidenceRefs": ["ev_a1b2", "ev_c3d4", "ev_e5f6"],   // 经 Gate 校验齐备
    "hypotheses": [
      { "text": "后端 getMaintained 未过滤 delFlg", "falsifiableBy": "改 SQL 后该分支应返回非空" }
    ],
    "rootCause": "DeviceServiceImpl.java:214",
    "nextEvidence": null,
    "recoveryEntry": {
      "actor": "agent",
      "action": "修复 Service 过滤条件后重跑",
      "command": "auto-test run start --case TC-… && npx playwright test <file> -g \"<用例名>\""
    }
  }]
}
```

- `rootCause` 非空时，`evidenceRefs` **必须**满足该 triage 的最小证据集 —— 否则拒写。
- `triage: UNKNOWN` 时，`nextEvidence` **必填**（"还需要什么证据"）。
- `recoveryEntry.actor` 用中立值（`agent` / `human`），**不写 Claude Code 的 agent 名**
  ——这是 v1.x `recoveryEntry.agent: "script-engineer"` 的 Runtime 耦合，2.0 消除。

### 5.4 Root Cause 必须有 Evidence —— 机器如何保证

不能只输出 `Root Cause: xxx`。2.0 的强制点在写入时：

```
auto-test diagnose set <runId> --triage PRODUCT_BUG --root-cause "File.java:214"
  → Core 检查 PRODUCT_BUG 的最小证据集：
      network-log / api-response（证明接口层数据正确）
      screenshot 或 dom-snapshot（证明脚本口径正确）
      console-log（证明抓了 pageerror）
  → 任一缺失 → 退出码 1 + 打印缺什么 → 拒绝写入 rootCause
```

Agent 此时只有两条路：补齐证据，或改判 `UNKNOWN`。**没有第三条路。**

---

## 六、Agent Evaluation Model

### 6.1 定位：客观优先，非阻断

Evaluation **不评价 Agent 聪不聪明**，评价的是**这次测试工作的工程质量**。
且它**永远不参与 Finalization**（见 4.3）。

### 6.2 客观指标（P2；全部从 Run 机械计算，零主观）

| 维度 | 计算方式 | 数据来源 |
|------|---------|---------|
| **Task Completion** | 目标 Case 中达到终局（非 INCONCLUSIVE/INVALID）的比例 | `verdict.json` |
| **Execution Validity** | 有真实 step/attempt 记录的 Run 比例 | `events.jsonl` |
| **Evidence Completeness** | `evaluateEvidence().satisfied` 为真的 attempt 比例 | Evidence Policy |
| **Assertion Coverage** | 已求值的 `required` 断言 / 全部 `required` 断言 | `run.json` |
| **Result Correctness** | `claimConsistency=CONSISTENT` 的 Run 比例 | Verifier |
| **Diagnostic Quality** | 有 `rootCause` 且证据齐备的 FAIL / 全部 FAIL | `diagnostics.json` |
| **Regression Safety** | 本次由 PASS 变 FAIL 的 Case 数 | `auto-test diff` |
| **Efficiency** | attempts 总数 / Case 数；总耗时 | `run.json` |

Runtime 若能提供，额外记录（**拿不到必须标 `unavailable` / `not_supported`，禁止伪造或写 0**）：
LLM Calls · Tokens · Context Size · Agent Turns · Tool Calls。

### 6.3 LLM Evaluation（可选、辅助、非 Gate）

可对 Test Design Quality / Diagnostic Quality / Reasoning Quality 做定性评价。约束：

- 必须写入独立的 `evaluation.json`，**绝不写入 `verdict.json`**；
- **不得**影响 `FINALIZED_PASS` / `FINALIZED_FAIL`；
- 报告中与客观指标**分区呈现**，明确标注"定性评价，非验收依据"。

第一阶段：**只设计，不实现**（P2）。

---

## 七、Regression（P1）

### 7.1 流程

```
Code Change
   ↓
Impact Analysis        ← Agent 做（Harness 不做，只记录结论到 run.json.impactAnalysis）
   ↓
Related Cases
   ↓
Execution              ← Harness 保证（新 Run，不覆盖旧 Run）
   ↓
Historical Comparison  ← auto-test diff <baseline> <current>
   ↓
Regression Result
```

### 7.2 Regression 状态

| 状态 | 条件 |
|------|------|
| `NEW_PASS` | 基线中无此 Case，本次 `FINALIZED_PASS` |
| `REGRESSION_PASS` | 基线 PASS，本次仍 PASS |
| `NEW_FAIL` | 基线中无此 Case，本次 FAIL |
| **`REGRESSION_FAIL`** | **基线 PASS，本次 FAIL —— 最高优先级信号** |
| `FLAKY` | 任一侧为 FLAKY |
| `BLOCKED` | 任一侧 BLOCKED |
| `INCONCLUSIVE` | 任一侧 INCONCLUSIVE / INVALID，无法比较 |

### 7.3 前置条件（必须先做，否则 Regression 不可能实现）

1. `runs/` 必须**入库**（当前 `.auto-test/.gitignore` 忽略了 `state/` 与 `diagnostics/`）；
2. 前端 `tests/` 必须**入库**（当前整目录 gitignore）——脚本不入库则 Run 不可复现；
3. Run 必须**不可变**（当前 `results.json` 每批被覆写）。

这三条是 Phase 1 的前置修复项，见 `migration-plan.md`。

---

## 八、Quality Gate 的唯一事实来源

**`finalize()` 的实现即 Quality Gate 的唯一定义。** 不再有第二份 checklist。

这解决了 v1.x 的一个具体问题：Final Check Gate 同时存在于
`rules/report-rule.md` 与 `rules/auto-test-agent.md` 两处，前者声明自己是"唯一事实来源"，
后者又补充了 8 条编排类条目——两份清单必然漂移，且都由 LLM 逐条自查。

2.0：**清单变成代码，自查变成退出码。**

```
$ auto-test finalize RUN-20260907-101530
INCONCLUSIVE
  ✗ evidence: attempt 1 缺少 console-log（profile e2e-default）
  ✗ assertion: A3 (required) result=not_executed —— 原因：无 DB 工具
  ✓ claim consistency: CONSISTENT
  ✓ evidence integrity: 6/6 文件存在，sha256 全部匹配
$ echo $?
1
```

Agent 看到这个输出，只能补齐或如实报告 INCONCLUSIVE。**它无法宣称任务完成。**

---

相关文档：`docs/architecture/harness-architecture.md`、`docs/architecture/test-model.md`、
`docs/architecture/migration-plan.md`。
