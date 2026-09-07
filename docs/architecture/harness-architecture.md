# Harness Architecture —— Auto-Test 2.0

> 定位：**Agent-Native Software Testing Harness**（不是 AI Test Case Generator，
> 不是 Claude Code Testing Skill，不是 Multi-Agent Testing Orchestrator）。
>
> 一句话：**Agent 负责思考"怎么测试"；Auto-Test 负责保证"真的执行了、结果可验证、
> 证据可追溯、失败可诊断、结果可复现"。**
>
> 现状依据见 `docs/architecture/agent-native-capability-matrix.md`。

---

## 一、为什么必须重构（不是为了更高级）

审计得出的唯一结论性事实：

> **在 v1.x 中，几乎所有"确定性"都是用自然语言规范表达的，
> 因此它们的执行率等于模型的自觉率，而不是 100%。**

三条实证：

| 规范 | 强制方式 | 真实执行率 |
|------|---------|----------|
| "逐数据组 recordResult" | Prompt | **0/40 spec** |
| "Test Data Matrix 必须驱动 Playwright" | Prompt | **0**（全部手抄字面量） |
| "证据轨 A/B 必须如实标注" | **代码**（`genCaseHtml.mjs`） | **100%** |
| "非法状态转换必须报错" | **代码**（`canTransition`） | **100%** |

2.0 不增加规范，而是**把已经写清楚的规范，改由代码强制**。

---

## 二、Agent 与 Harness 的边界

```
┌──────────────────────── Agent 负责（概率性，允许出错） ────────────────────────┐
│  理解需求 · 探索代码 · 制定测试策略 · 设计测试 · 生成 Test Case              │
│  编写测试 · 选择工具 · 执行工具 · 分析失败 · 提出 Hypothesis                 │
│  修复问题 · 决定是否 Retry · 决定下一步行动                                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │  只能通过 Core 接口写入
                                     ▼
┌──────────────────── Harness 负责（确定性，不允许出错） ───────────────────────┐
│  Test Case Lifecycle · Test Run · Attempt · Execution 记录                    │
│  Evidence 存储与完整性校验 · Assertion 求值与留痕 · Policy 判定               │
│  Persistence · Resume · Retry Tracking · Regression Diff                      │
│  Verification · Evaluation · Quality Gate · Observability                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

**判定一项能力归谁的唯一标准：**

> 这件事如果做错了，是"这次质量差一点"，还是"结论不可信"？
> 前者归 Agent，后者归 Harness。

据此，v1.x 中下列内容**必须移出 Core**（做错了只是质量差）：
源码定位顺序、选择器手册、假设写法教学、Diagnostic Budget、Token 控制、
Multi-Agent 调度协议、Dispatch Tier。

而下列内容**必须进入 Core**（做错了结论不可信）：
Attempt 是否被折叠、Evidence 是否存在、Assertion 是否真的求值过、
Run 是否被覆盖、FINALIZED_PASS 的准入条件。

---

## 三、目标架构

```
                         Human
                           │
              ┌────────────┼────────────┬──────────┐
              │            │            │          │
           Claude        Codex        Gemini    CI / CLI
              │            │            │          │
              └────────────┴─────┬──────┴──────────┘
                                 │   Client / Actor（可替换，Core 不感知）
                    ┌────────────┴────────────┐
                    │   CLI   │   MCP   │ SDK │   Adapter 层（薄，无业务逻辑）
                    └────────────┬────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │    Auto-Test Core      │
                    │                        │
                    │  TestCase  TestRun     │
                    │  Attempt   Step        │
                    │  Assertion Evidence    │
                    │  Policy    Verifier    │
                    │  Diagnostic Evaluation │
                    │  QualityGate  Store    │
                    └────────────┬───────────┘
                                 ▼
                    Filesystem + JSON / JSONL
                                 ▲
                                 │  执行时写入
                    ┌────────────┴───────────┐
                    │ Playwright / API / DB  │   外部 Runner（Core 不实现）
                    └────────────────────────┘
```

**Core 不知道 Claude 存在，也不知道 Playwright 存在。**

- Core 对 Runtime 的全部认知，就是 Run 上的 4 个 metadata 字段：
  `actor` / `runtime` / `model` / `runtimeVersion`。**它们只被记录，不被分支。**
- Core 对 Runner 的全部认知，就是 Step 上的 `tool` 字段和 Evidence 的 `kind`。
  谁产生的证据 Core 不关心，只关心**证据是否满足 Policy**。

**硬性约束**：Core 代码中出现 `if (runtime === 'claude')` 一类分支，即为架构失败。

---

## 四、Harness Core 边界（P0 范围）

Core 只做六件事：

| 职责 | 输入 | 输出 | 失败时 |
|------|------|------|--------|
| **1. Case Store** | Case 文件 | 解析后的 Case + Assertion + DataGroup | 非法状态转换 → 抛错 |
| **2. Run Store** | 执行事件 | 不可变 Run + Attempt + Step 记录 | 写入已 finalize 的 Run → 抛错 |
| **3. Evidence Store** | 证据文件 | 带 hash 的 Evidence 引用 | 引用不存在的文件 → 抛错 |
| **4. Assertion Recorder** | 断言求值结果 | 结构化 AssertionResult | 声明 PASS 但无 Assertion → 判 INVALID |
| **5. Policy Engine（轻）** | Run + Policy 配置 | 三个判定：证据够不够 / 能不能重试 / 能不能 finalize | 不满足 → 非零退出 |
| **6. Verifier / Quality Gate** | Run | FINAL RESULT | Agent Claim 与实际不符 → INVALID |

**Core 不做的事**（明确排除，防止范围蔓延）：

- ❌ 不生成测试用例，不写脚本，不选选择器
- ❌ 不调度 Agent，不管理 Agent 上下文，不做 Multi-Agent 编排
- ❌ 不实现 Runner，不启动浏览器，不发 HTTP 请求
- ❌ 不做 Impact Analysis（Agent 做，Core 只记录结论）
- ❌ 不做上下文/Token 管理

---

## 五、Multi-Agent 重新评估（结论：从 Core 移除）

### 5.1 v1.1.0 的五 Agent 架构解决了什么

真实且合理的问题：**单个上下文加载 12 份 rules 会爆炸**。
Multi-Agent 是当时对"上下文预算"的合理工程回应。

### 5.2 为什么现在不该留在 Core

| 证据 | 说明 |
|------|------|
| **未承重** | 5 个 Agent 中只有 3 个留下过回执；`source-analyst` / `case-designer` 零回执但 Case 存在（见矩阵 3.4） |
| **未被检测** | 违反协议（伪多 Agent）没有任何机制会发现 |
| **产物空转** | `analysis/` 从未生成，下游声明的依赖是假的 |
| **强 Runtime 耦合** | Dispatch Tier A/B、subagent_type、install-agents 全是 Claude Code 概念，却写在主规范里 |
| **上下文压力已缓解** | 上下文窗口与 Agent 的规则遵循能力都已显著提升；分片加载的收益不再抵得上协议成本 |

### 5.3 2.0 的处理

```
Multi-Agent  ──从 Harness Core 移除──▶  Client 侧的可选优化
```

- **默认 Single Agent**：一个 Agent 直接调 CLI，完成整条闭环。
- 只有在下列真实场景才由 **Client 自行**拆分子 Agent，Core 不感知也不要求：
  专业化 / 权限隔离 / 上下文隔离 / **独立验证** / 高风险操作。
- `agents/*.md` 六份契约**不删除**，降级为 `templates/agents/`（Claude Code 用户的可选提示模板）。

> 值得保留的一个 Multi-Agent 用例：**独立验证**。
> 让一个不参与执行的 Agent 去核对另一个 Agent 的 Run——但这在 2.0 里由
> `auto-test verify` 这条**命令**完成，比再造一个 Agent 更确定。

---

## 六、公共接口设计

### 6.1 优先级（依审计结果调整）

| 优先级 | 接口 | 决策 | 理由 |
|-------|------|------|------|
| **P0** | **Harness Core** | 立即实现 | 没有 Core，其余全是空谈 |
| **P1** | **CLI** | 立即实现（与 Core 同期） | **CLI 不是便利封装，是强制手段**——见 6.2 |
| **P2** | MCP | 只设计接口，不实现 | 当前无真实调用方；Claude Code 已能跑 CLI |
| **P3** | SDK / Library | 不做 | 当前无第三方集成需求 |
| **P1** | Skill Compatibility Layer | 与 CLI 同期 | 现有唯一用户就在这条路径上 |

### 6.2 为什么 CLI 是 P1 而不是"以后再说"

这是本次设计最关键的一条判断：

> **一条规则只有在"绕过它需要主动撒谎"时，才算被强制。**

- Prompt 规则：Agent 不做 → 无事发生 → 规则名存实亡（实证：recordResult 0 次调用）。
- CLI 规则：`auto-test finalize` 返回非零 + 打印缺失项 → Agent 要么补齐，要么**必须显式伪造命令输出**才能宣称成功。

**CLI 是把 Prompt 规范转成工程约束的最小成本手段。** 没有它，2.0 只是换一套措辞的 v1.2。

### 6.3 CLI 设计（`auto-test`）

```
# —— Case ——
auto-test case list [--status ready] [--module M]     # 已有 caseStore CLI，升级即可
auto-test case show <caseId>
auto-test case validate <caseId>                      # 占位符 / Assertion 缺失 / Schema 校验

# —— Run 生命周期（Run 一旦 finalize 即不可变） ——
auto-test run start   --case <id> [--actor --runtime --model]   → runId
auto-test run attempt <runId> --case <id>                       → attemptId
auto-test step        <runId> <attemptId> --name ... --status ...
auto-test assert      <runId> <attemptId> --id A1 --expected ... --actual ... --result pass|fail
auto-test evidence    <runId> <attemptId> --kind screenshot --file <path>
auto-test run finish  <runId> <attemptId> --claim PASS|FAIL     # 记录 Agent Claim，不是结论

# —— 验证与终局（核心：这两条命令是 Harness 的存在理由） ——
auto-test verify   <runId>          # 证据完整性 + Assertion 覆盖 + Claim 一致性 → 非零退出
auto-test finalize <runId>          # 应用三条 Policy → FINALIZED_PASS/FAIL/INVALID/INCONCLUSIVE/FLAKY/BLOCKED

# —— 恢复 / 回归 / 报告 ——
auto-test resume <runId>            # 打印哪些 step 已完成、哪些可重入、哪些必须重跑
auto-test diff <runIdA> <runIdB>    # Regression：逐 Case × DataGroup 比较
auto-test report <runId> [--html]   # 由 Run 渲染，禁止手写
```

**设计纪律：**

- **每条命令都是 Core 的薄封装**，不含任何业务逻辑。
- `verify` 与 `finalize` **必须以退出码表达结论**（0 = 通过，非 0 = 未通过），
  使其可直接进 CI 与 pre-commit，且 Agent 无法"解释"过去。
- 所有命令支持 `--json` 输出，便于 Agent 与 MCP 消费。

### 6.4 MCP 设计（P2，只设计不实现）

若将来实现，MCP 工具面**必须与 CLI 一一对应**，不得新增语义：

| MCP Tool | 对应 CLI |
|----------|---------|
| `auto_test_case_list` / `auto_test_case_show` | `case list` / `case show` |
| `auto_test_run_record` | `step` / `assert` / `evidence` 合并写 |
| `auto_test_verify` / `auto_test_finalize` | 同名命令 |
| `auto_test_diff` | `diff` |

MCP 相对 CLI 的**唯一**增益：省掉 shell 转义与输出解析。
在这个增益出现真实痛点之前，**不实现**。

### 6.5 SDK（P3，不做）

暂无第三方集成方。若未来出现，SDK 就是把 Core 的 TypeScript 模块直接导出，
不需要额外设计——这正是"Core 优先"的红利。

### 6.6 Skill Compatibility Layer

```
Claude Code
    │
    ▼
SKILL.md（瘦身后：什么时候用、调哪些命令、Agent 该怎么思考）
    │
    ▼
auto-test CLI  ──▶  Harness Core
```

- `SKILL.md` 从 234 行的**规范总纲**，降为**调用指南 + 测试策略引导**。
- `/auto-test` 入口、Full-Auto / HITL 双模式、Case 生命周期语义**全部保持不变**。
- 用户看到的行为变化只有一个：报告里的"证据轨 B 降级"消失了，因为 A 轨成为默认且唯一。

---

## 七、持久化策略

### 7.1 基线：Filesystem + JSON / JSONL

**不引入 SQLite。** 判据：当前样本 5 个 Run、22 条 Case。
只有出现下列**实测**瓶颈才重新评估：Run 数量进入千级 / 历史查询成为瓶颈 /
复杂 Regression 查询 / 并发访问。

优先保证：简单 · 可读 · 可调试 · 可迁移 · Git-friendly · CLI-friendly · 无外部依赖。

### 7.2 目录（在现有结构上演进，不推倒）

```
<cwd>/.auto-test/
├── cases/              【保留】Case SSOT，一个 Case 一个 md（不动）
├── runs/               【新增】取代含义混乱的 reports/*.jsonl + state/ + diagnostics/
│   └── RUN-20260907-101530/
│       ├── run.json            # Run 主记录（含 schemaVersion / attempts / assertions 汇总）
│       ├── events.jsonl        # 追加写事件流（step / assert / evidence），崩溃安全
│       ├── verdict.json        # verify + finalize 的机器结论（唯一权威终局）
│       ├── diagnostics.json    # 有 FAIL 时才有（原 DIAG-*）
│       └── evidence/           # 本 Run 的证据文件（截图/trace/网络/DB 快照）
├── reports/            【保留】人读 md 报告，改为**由 run.json 渲染**，不再手写
├── policy.json         【新增】三条 Policy 的项目级配置
└── analysis/           【降级】Agent 的工作草稿，Core 不消费、不校验、可随时删
```

**关键变更及其理由：**

| 变更 | 理由 |
|------|------|
| `state/pipeline.json` **删除** | Pipeline 进度是 **Client 的编排状态**，不是 Harness 事实。见矩阵 3.4：它自相矛盾且不可信 |
| `state/contracts/` **删除** | Agent 回执是 Claude Code 协议产物，属 Client |
| `diagnostics/` 并入 `runs/<id>/` | 诊断天然属于某次 Run，独立目录没有价值 |
| `reports/*.jsonl` 并入 `runs/<id>/events.jsonl` | 消除"jsonl 到底是 RunRecord 还是投影"的当前歧义 |
| `analysis/` 保留但**降级** | 它从未被消费；作为 Agent 草稿保留无害，但不得再被声明为下游依赖 |

> ⚠ 目录方案属**待确认项**。逻辑模型（第八节 + `test-model.md`）先定，物理布局在实施 Phase 1 敲定。

### 7.3 版本控制（必须与目录同时修正）

当前 `.auto-test/.gitignore` 忽略 `state/`、`diagnostics/`、`reports/*.jsonl`——
**这直接导致 Regression 不可能实现**。2.0 的入库策略：

| 路径 | 入库 | 理由 |
|------|:---:|------|
| `cases/` | ✅ | 测试资产 |
| `runs/*/run.json` `verdict.json` `diagnostics.json` | ✅ | **历史 Run 必须可比较** |
| `runs/*/events.jsonl` | ✅ | 体积可控（纯文本事件），是复现的唯一依据 |
| `runs/*/evidence/` | ❌ | 二进制、体积大；只入库**路径 + hash**（存于 run.json） |
| `reports/*.md` | ✅ | 交付物 |
| `policy.json` | ✅ | 项目约定 |

**同时必须解决：前端 `tests/` 整目录被 gitignore。**
测试脚本是资产，脚本不入库则 Run 不可复现。这是 Phase 1 的前置修复项。

---

## 八、Schema 策略

- 每个持久化产物首字段为 `schemaVersion`（语义化版本）。
- Core 读取时按 `schemaVersion` 选择解析器；**旧版本 Run 必须永远可读**。
- 允许的演进：新增可选字段（minor）；禁止的演进：改字段含义、删字段（须 major + 迁移器）。
- 未知字段**原样保留**（沿用 `caseStore.ts` 已验证的 Frontmatter 容错策略）。

---

## 九、Runtime / Model 中立

Run 记录以下 metadata，**只记录、不分支**：

```jsonc
{
  "actor":   "agent",              // agent | human | ci
  "runtime": "claude-code",        // 自由字符串，Core 不枚举
  "model":   "claude-opus-5",
  "runtimeVersion": "…",
  "observability": {               // 只记 Runtime 真实提供的；拿不到就标注，禁止伪造
    "toolCalls":  { "value": 42,   "availability": "available" },
    "agentTurns": { "value": null, "availability": "not_supported" },
    "tokens":     { "value": null, "availability": "unavailable" }
  }
}
```

`availability` 三态（`available` / `unavailable` / `not_supported`）是硬性要求：
**拿不到的数据不允许写 0，也不允许省略字段**——省略会被下游误读为 0。

---

## 十、防过度设计清单（每项均已判定）

| 诱惑 | 判定 | 理由 |
|------|:---:|------|
| Plugin System | **P3 不做** | 无第二个实现者 |
| Event Bus | **P3 不做** | `events.jsonl` 追加写已够 |
| Distributed Architecture | **P3 不做** | 单机单项目 |
| Database Layer | **P2 后置** | 见 7.1 触发条件 |
| PolicyEngine / Registry / Resolver / Factory | **P3 不做** | Policy 是 `policy.json` + 三个纯函数 |
| Runtime Registry | **P3 不做** | Runtime 只是字符串 metadata |
| Model Router | **P3 不做** | 不属于测试 Harness 职责 |
| Multi-Agent Orchestrator | **REMOVE** | 见第五节，实证未承重 |

每个新抽象须回答的五问，已逐条应用于 `test-model.md` 与 `policy-and-diagnostics.md` 中的每个模型。

---

## 十一、这套架构如何满足七十节的成功标准

| 标准 | 2.0 中由什么保证 |
|------|----------------|
| Harness 能证明测试真的发生 | `events.jsonl` 逐 step / 逐 assertion 追加写 + evidence hash |
| Evidence 完整 | Evidence Policy + `auto-test verify` 非零退出 |
| Agent Claim 可被验证 | `run finish --claim` 与 `verdict.json` 分离，Verifier 比对二者 |
| Retry 语义明确 | Attempt 一等公民，历史不折叠 |
| Resume 可靠 | step 级状态 + `reentrant` 标记 |
| Regression 可追踪 | `runs/` 入库 + `auto-test diff` |
| Run 可复现和比较 | schemaVersion + 不可变 Run + 脚本入库 |
| 多 Runtime 共用同一 Core | Core 无 runtime 分支；CLI 是唯一入口 |
| 新 Runtime 无需改 Core | 新 Runtime 只需能跑 CLI |
| 避免过度设计 | 第十节逐项判定，P2/P3 全部后置 |

---

相关文档：`docs/architecture/test-model.md`（Case / Run / Attempt / Evidence / Assertion 模型）、
`docs/architecture/policy-and-diagnostics.md`（三条 Policy / 诊断 / 评估 / Quality Gate）、
`docs/architecture/migration-plan.md`（文件级处置与实施阶段）。
