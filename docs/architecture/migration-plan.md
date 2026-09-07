# Migration Plan —— v1.1.0 到 2.0

> 现状依据见 `docs/architecture/agent-native-capability-matrix.md`；
> 目标架构见 `docs/architecture/harness-architecture.md`。
>
> **原则：不一次性重写。** 每个阶段都必须能独立交付、独立验证、独立回滚。

---

## 一、迁移路径

```
Auto-Test v1.x（Claude Code Skill）
        │
        ├─ 保留：Case 资产、生命周期、Frontmatter 回写、TRIAGE 分类法、安全边界
        │
        ▼
Skill Compatibility Layer（瘦身后的 SKILL.md）
        │
        ▼
    auto-test CLI
        │
        ▼
   Harness Core（新）
        │
        ├─ P2: MCP Adapter（只设计）
        └─ P3: SDK（不做）
```

**用户可见的行为变化只有两处：**

1. 报告里的"证据轨 B 降级"消失——A 轨成为唯一轨，不满足即 `INCONCLUSIVE`。
2. 终局从 `PASS/FAIL/ERROR/BLOCKED` 扩为六态（新增 `INVALID` / `INCONCLUSIVE` / `FLAKY`）。

`/auto-test` 入口、参数、Full-Auto / HITL 双模式、Case 文件格式**全部不变**。

---

## 二、文件级处置

### 2.1 KEEP（原样保留）

| 文件 | 理由 |
|------|------|
| `templates/scaffold/support/caseStore.ts` | 唯一经实证的持久化运行时；2.0 在其上扩展 |
| `templates/scaffold/support/genCaseHtml.mjs` | 唯一的机器诚实性校验器 |
| `templates/scaffold/support/env.ts` / `crypto.ts` / `auth.setup.ts` / `fixtures.ts` / `resolveActionNo.ts` | 项目脚手架，与 Core 无关 |
| `templates/case.md` | Case 模板（加 `assertions` 块即可） |
| `templates/assertion-patterns.md` | 断言模式库（充分性 / 中间态），真实业务价值 |
| `templates/binding/*.json` | 绑定模板 |
| `configs/project.schema.md` | 绑定字段说明 |
| `LICENSE` / `CHANGELOG.md` | — |

### 2.2 REFACTOR（保留意图，重写形态）

| 文件 | 变成什么 | 理由 |
|------|---------|------|
| `SKILL.md`（234 行） | **约 80 行的 Thin Adapter**：何时触发 / 调哪些 CLI / 测试策略引导 | 规范正文移入 Core 与 policy.json |
| `rules/case-store-rule.md` | 拆两半：状态机与回写规则 → **Core 代码**；去重规则 → Agent 指南 | 状态机已有代码实现，规范应指向代码而非重述 |
| `rules/execute-rule.md` | 保留 TRIAGE 分类法 + Evidence Gate → **Core 代码**；删教学部分 | 见 `policy-and-diagnostics.md` 5.2 |
| `rules/report-rule.md` | 报告结构 → **渲染器模板**；Final Gate → **`finalize()` 代码** | 消除两处 checklist 漂移 |
| `rules/test-data-rule.md` | 解析规范 → 已在 `caseStore.ts`；"必须驱动 Playwright" → **CLI 强制** | — |
| `rules/preflight-rule.md` + `rules/binding-rule.md` | 合并为 `auto-test doctor` + `auto-test bind` | 探测是脚本工作，不是 Prompt 工作 |
| `rules/environment-rule.md` | 安全边界 + 真实渲染探测 → 保留为 Agent 指南；并发安全 → 脚手架配置 | 安全约束是真实的，但属指南 |
| `templates/report.md` / `run-report.md` | 由手写模板改为**渲染器输入模板** | 报告必须由 Run 渲染，不得手写 |
| `agents/*.md`（6 份） | 移到 `templates/agents/`，降级为 Claude Code 可选提示 | 见架构文档第五节：未承重 |
| `scripts/validate-structure.mjs` | 保留，扩展为同时校验 Core 的 schema 定义 | 引擎自检有价值 |

### 2.3 REMOVE（删除）

| 文件 / 章节 | 理由 |
|------------|------|
| `prompts/orchestrator.md`（全文） | 纯 Claude Code 调度逻辑；2.0 中 Client 直接调 CLI |
| `rules/pipeline-state-rule.md`（全文） | Pipeline State 是 Client 编排状态，不是 Harness 事实；且实证自相矛盾（矩阵 3.4） |
| `rules/auto-test-agent.md` 的 Dispatch Table / Multi-Agent 架构 / 越权禁令 | Runtime 耦合；Agent 职责由 Core 接口边界自然界定 |
| `rules/source-analysis-rule.md` 的八层定位顺序 | Agent 原生能力 |
| `rules/script-rule.md` + `templates/selectors/` | Agent + Playwright 自理（选择器语义角色表可作为可选参考保留） |
| `rules/case-store-rule.md` 的 Cheap Reuse Gate | Impact Analysis 交 Agent；Core 只记录结论 |
| `rules/report-rule.md` 的 Token 控制小节 | Runtime 职责 |
| `rules/execute-rule.md` 的 HYPOTHESIS / Diagnostic Budget 教学 | Agent 原生能力 |
| `scripts/install-agents.mjs` | Tier A/B 概念随 Multi-Agent 一起移除 |
| **证据轨 A/B 双轨机制** | 取消降级通道（见 `policy-and-diagnostics.md` 2.3） |

> ⚠ REMOVE 不等于立即删文件。执行顺序是：先让 2.0 路径可用 → 观察一个迭代 → 再删。
> 见第四节 Phase 8。

### 2.4 REPLACE（换实现）

| 旧 | 新 |
|----|----|
| `.auto-test/state/pipeline.json` + `contracts/` | `runs/<runId>/run.json`（Pipeline 状态不再持久化） |
| `.auto-test/reports/*.jsonl`（投影汇总） | `runs/<runId>/events.jsonl`（逐事件） |
| `.auto-test/diagnostics/DIAG-*.json` | `runs/<runId>/diagnostics.json` |
| Playwright `retries: 1` 隐式重试 | 显式 Attempt 模型 + Retry Policy |
| Final Check Gate（LLM 自查清单） | `auto-test verify` + `auto-test finalize`（退出码） |
| `screenshot: only-on-failure` | Evidence Policy 驱动（PASS 也留证据） |

### 2.5 NEW（新建）

| 模块 | 内容 | 优先级 |
|------|------|:---:|
| `core/model/` | Case / Run / Attempt / Step / Assertion / Evidence 类型与 schema | P0 |
| `core/store/` | CaseStore（扩展现有）· RunStore · EvidenceStore | P0 |
| `core/policy/` | `evaluateEvidence` · `shouldRetry` · `finalize` 三个纯函数 | P0 |
| `core/verify/` | Verifier（Claim 一致性 + 证据完整性 + hash 校验） | P0 |
| `cli/` | `auto-test` 命令 | P1 |
| `core/diff/` | Regression 比较 | P1 |
| `core/report/` | 由 Run 渲染 md + html | P1 |
| `.auto-test/policy.json` | 三条 Policy 的项目配置 | P0 |
| `core/eval/` | 客观指标计算 | P2 |
| `adapters/mcp/` | MCP 工具面 | P2（只设计） |

### 2.6 DEPRECATE（保留但标记弃用）

| 项 | 弃用期 | 收口条件 |
|----|-------|---------|
| `schemaVersion < 2.0` 的 Case（无 `assertions`） | 长期 | `finalize` 走 `lenient` 且报告显式标注；不强制迁移 |
| `.auto-test/analysis/` | 长期 | 保留为 Agent 草稿目录，但**从所有规范中删除"下游依赖"表述** |
| `docs/testcases/<module>/` 模块汇总视图 | 长期 | 客户交付需要，保留；改为由 Run 渲染 |

---

## 三、Scope 分级（P0 / P1 / P2 / P3）

### P0 —— 当前必须实现（没有它 2.0 不成立）

| # | 项 | 为什么是 P0 |
|---|---|---|
| 1 | Run / Attempt / Step / Assertion / Evidence 数据模型 + schemaVersion | 一切的基础 |
| 2 | RunStore（`events.jsonl` 追加写 + `run.json` 投影 + 不可变） | 修复"崩溃即无记录" |
| 3 | **脚本真正接线 `recordResult`**（Test Data Matrix 驱动 Playwright） | 修复矩阵 3.1 / 3.2 —— 最严重的缺口 |
| 4 | Evidence Policy + **PASS 时也留证据** | 修复矩阵 3.5 |
| 5 | Assertion 一等公民（Case `assertions` 块 + AssertionResult） | 无它则 finalize 无依据 |
| 6 | `finalize()` 六态判定（含 INVALID / INCONCLUSIVE） | Quality Gate 的本体 |
| 7 | Verifier（Claim 一致性 + evidence hash 校验） | 解决 Scenario F |
| 8 | `policy.json` 三条 Policy | 让判定可配置而非硬编码 |
| 9 | **修复版本控制**：`runs/` 与前端 `tests/` 入库 | 否则 Regression 结构上不可能 |

### P1 —— 2.0 应该实现

10. `auto-test` CLI 全部命令（与 Core 同期，见架构文档 6.2）
11. Attempt 级 Retry Policy + FLAKY 判定
12. Step 级 Resume（`reentrant` 标记 + `auto-test resume` 事实报告）
13. `auto-test diff` Regression 比较
14. 报告由 Run 渲染（`report` 命令），取消手写
15. Skill Compatibility Layer（SKILL.md 瘦身）

### P2 —— 可以后置

16. Agent Evaluation 客观指标
17. Observability（仅 Runtime 真实提供项）
18. MCP Adapter（设计已在架构文档 6.4，实现待真实需求）
19. SQLite（触发条件见架构文档 7.1）

### P3 —— 当前不需要（明确不做）

20. SDK / Library — 无第三方集成方
21. Plugin System / Event Bus / Distributed / Policy Engine 对象体系 / Runtime Registry / Model Router
22. LLM Evaluation 作为 Gate — 违反"客观优先"
23. Multi-Agent Orchestrator — **不是后置，是删除**

---

## 四、实施阶段

每个阶段：`Implement → Test → Review → 真实项目验证 → Next Phase`。
**真实项目 = V-LIMS**（已有 22 条 Case、5 个 RUN 批次可作为迁移与回归的真实基线）。

### Phase 1 —— Harness Foundation（P0 #1 #2 #8 #9）

- 数据模型 + schema + RunStore + policy.json
- **前置修复**：把前端 `tests/` 与 `.auto-test/runs/` 纳入版本控制
- 最小 CLI：`run start` / `step` / `assert` / `evidence` / `run finish`
- **目标：建立稳定 Core，而不是建立 Agent 智能**
- 验收：能手工用 CLI 完整记录一次 Run，`events.jsonl` 与 `run.json` 一致

### Phase 2 —— Execution Reliability（P0 #3，P1 #11 #12）

- **脚本接线**：用 `loadExecutableCases` + `dataGroups` 改造 V-LIMS 的 solution / device-log spec
- Attempt / Retry Policy / FLAKY
- Step 级 Resume
- 验收：Scenario D（FLAKY）与 Scenario E（Resume）**可真实通过**

### Phase 3 —— Evidence + Verification（P0 #4 #5 #6 #7）

- EvidenceStore（hash）+ Evidence Policy + PASS 时证据
- Assertion 模型 + `finalize()` 六态 + Verifier
- 验收：**Scenario F（Agent 谎报 PASS）必须得到 `INVALID`**

### Phase 4 —— Agent Evaluation（P2 #16 #17）

- 客观指标；LLM 定性评价可选、非阻断

### Phase 5 —— Regression（P1 #13）

- `auto-test diff`；Case / Suite / Release / Changed-code 四类回归

### Phase 6 —— Observability（P2）

- 只记录 Runtime 真实提供的数据，三态 availability

### Phase 7 —— Public Interfaces（P1 #10 #14 #15，P2 #18）

- CLI 收口；报告渲染器；SKILL.md 瘦身；MCP 视需求

### Phase 8 —— Migration / Compatibility（2.3 的删除动作）

- 观察一个完整迭代后，执行 REMOVE 清单
- CHANGELOG 记录破坏性变更；打 `v2.0.0`

---

## 五、真实项目验证计划（七个场景）

| 场景 | 内容 | 依赖 Phase | 当前可否通过 |
|------|------|:---:|---|
| **A 正常测试** | 需求 → Case → 执行 → Evidence → Assertion → PASS | 3 | ❌（无 Assertion 模型） |
| **B 真实 Product Bug** | FAIL → 证据 → 诊断 → Root Cause（有证据）→ 修复 → 验证 | 3 | ❌（样本 0 FAIL，未验证过） |
| **C Test Bug** | FAIL → 分类 TEST_BUG → 修脚本 → 重跑 PASS，不得误报 PRODUCT_BUG | 3 | ❌ |
| **D Flaky** | `[FAIL, PASS, PASS]` → 判 FLAKY 而非 PASS | 2 | ❌（attempt 被折叠） |
| **E Resume** | step 3 RUNNING 时强制中断 → resume → 不重复执行不可重入步骤 | 2 | ❌（无 step 状态） |
| **F 谎报 PASS** | Agent 声称 PASS 但未执行 → 必须 `INVALID` | 3 | ❌（无 Verifier） |
| **G Multi-Runtime** | 同一 Case 由不同 Client 执行，Run schema 与终局规则一致 | 7 | 部分（Claude Code VERIFIED，其余 UNVERIFIED） |

**Scenario G 的验证策略**：本环境只有 Claude Code 可用。
不为验证而强行安装其他 Runtime，不为适配某 Runtime 改 Core，不伪造结果。
真正的判据是**Core 是否含 runtime 分支**——这可由 `validate-structure.mjs` 扩展为静态检查
（grep `if.*runtime ===`），比实机验证更可靠。

---

## 六、风险与对策

| # | 风险 | 对策 |
|---|------|------|
| 1 | **文档数量偏多** | 本次 11 个主题合并为 5 份文档 + 1 份总报告，见第七节 |
| 2 | **Policy 体系过重** | 只做三条；配置 + 纯函数；明确拒绝 7 种 Policy 对象抽象 |
| 3 | **持久化过度设计** | Filesystem + JSON/JSONL；SQLite 有明确触发条件才启用 |
| 4 | **Multi-Runtime 验证成本** | 只验证可用 Runtime；架构中立性改用静态检查保证 |
| 5 | **过度平台化** | Plugin / EventBus / Distributed / PolicyEngine / RuntimeRegistry / ModelRouter 全部 P3 或删除 |
| 6 | **迁移期双轨并存造成混乱** | legacy `lenient` 模式必须在报告显式标注；设定收口条件 |
| 7 | **Phase 2 改造既有脚本工作量** | 先改 2–3 个代表性 spec 验证模式，不一次性全改；旧脚本走 legacy 通道 |
| 8 | **前端 `tests/` 入库触及项目规范** | 需与项目负责人确认（见开放问题） |
| 9 | **收紧 Gate 后大量历史 Case 变 INCONCLUSIVE** | 这是**真实状况的暴露**，不是回归；用 legacy 模式给缓冲期 |

---

## 七、文档清单

### Created（本阶段新建，5 份 + 1 份总报告）

| 文件 | 覆盖的主题 |
|------|-----------|
| `docs/architecture/agent-native-capability-matrix.md` | Capability Matrix · Declared/Implemented/Executed/Verified · Agent 现职责 · 现状问题 |
| `docs/architecture/harness-architecture.md` | 2.0 架构 · Core 边界 · Multi-Agent 重评估 · 公共接口（CLI/MCP/SDK/Skill）· 持久化 · Schema · Runtime 中立 |
| `docs/architecture/test-model.md` | Test Case · Test Run · Attempt · Step · Evidence · Assertion · Claim vs Actual |
| `docs/architecture/policy-and-diagnostics.md` | Evidence/Retry/Finalization Policy · Failure Diagnostic · Agent Evaluation · Quality Gate · Regression |
| `docs/architecture/migration-plan.md` | 文件级处置 · Scope P0-P3 · 实施阶段 · 验证计划 · 风险 |
| `docs/architecture/audit-2.0-report.md` | 总报告（Executive Summary + 索引 + 开放问题） |

### Merged（合并，及理由）

| 原计划独立文档 | 合并去向 | 理由 |
|--------------|---------|------|
| Test Case Model / Test Run Model | `test-model.md` | 同一条因果链的相邻环节，字段互相引用 |
| Evidence Model / Assertion Model | `test-model.md` | 同上；且 Evidence 与 Assertion 的边界只有放在一起才说得清 |
| Policy Model / Failure Diagnostic / Agent Evaluation / Quality Gate | `policy-and-diagnostics.md` | 都是对同一个 Run 的判定，共享输入；Quality Gate 就是三条 Policy 的组合 |
| Public Interfaces / CLI / MCP / SDK / Skill Layer | `harness-architecture.md` | 都是 Adapter，无独立设计决策，篇幅各只有数十行 |
| Persistence Strategy / Schema Strategy | `harness-architecture.md` | 与 Core 边界强绑定，分开会导致重复描述目录结构 |
| Multi-Agent Re-evaluation / Multi-Runtime Status | `harness-architecture.md` + Matrix | 是**结论**而非独立设计，各占一节足够 |

### Deferred（推迟，及条件）

| 文档 | 推迟原因 | 何时创建 |
|------|---------|---------|
| `mcp-interface.md` | 当前无真实调用方；接口面已在架构文档定稿 | 出现 CLI 无法满足的真实场景时 |
| `sdk-design.md` | 无第三方集成需求 | 出现第一个集成方时 |
| `sqlite-migration.md` | 未达触发条件（当前 5 个 Run） | Run 进入千级或历史查询成瓶颈时 |
| `evaluation-rubric.md` | Evaluation 是 P2，且必须非阻断 | Phase 4 |
| 各 Runtime 适配文档 | 只有 Claude Code 可用 | 接入第二个 Runtime 时 |

**判定标准**（是否值得独立成文）：有独立设计决策？需被后续实施阶段单独引用？
有独立生命周期？复杂度是否足够？——四问全否即合并或推迟。

---

相关文档：`docs/architecture/audit-2.0-report.md`（总报告与开放问题）。
