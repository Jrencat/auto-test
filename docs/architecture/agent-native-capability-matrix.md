# Agent-Native Capability Matrix —— Auto-Test v1.1.0 现状审计

> 审计日期：2026-09-07 ｜ 审计对象：`auto-test` v1.1.0（`026df6b`，tag `v1.1.0`，已 push）
> 真实项目样本：V-LIMS（前端 + 后端 monorepo），`.auto-test/` 中 22 条 Case、5 个 RUN 批次
>
> **本文件是 2.0 设计的唯一事实依据。** 所有结论必须能追溯到磁盘上的文件、代码调用点或执行产物。
> 凡"README/SKILL/Prompt 写了但磁盘上找不到证据"的能力，一律**不得**标为已实现。

---

## 零、审计口径

每项能力按四级判定，**逐级递进，后一级不能靠前一级推断**：

| 级别 | 判定标准 | 反例（不得据此判定） |
|------|---------|-------------------|
| **DECLARED** | SKILL.md / README / rules / agents 中有明确规范 | — |
| **IMPLEMENTED** | 存在**可执行代码**或**可机械校验的产物 schema** | "Prompt 里写了必须这么做" |
| **EXECUTED** | 真实项目磁盘上存在该能力产出的**具体文件/记录** | "Agent 回执说做了" |
| **VERIFIED** | 产出经**独立手段**核对，与声明一致 | "Agent 自己声明 outputsVerified 为真" |

> ⚠ 本引擎中绝大多数"实现"是**自然语言规范**，由 LLM 在运行时解释执行。
> 这类能力的正确定级是 `IMPLEMENTED = PROSE`——它可以工作，但**不具备确定性**，
> 不能与代码级实现混为一谈。矩阵中用 `PROSE` 显式标注。

---

## 一、引擎构成（代码 vs 规范的真实比例）

```
<skillDir>/
├── agents/         6 份 Agent 角色契约        ← 规范
├── prompts/        1 份调度 Prompt            ← 规范
├── rules/         12 份执行规范               ← 规范
├── templates/     14 份模板 + 选择器适配器     ← 规范
├── configs/        1 份绑定字段说明            ← 规范
├── scripts/        2 个 Node 脚本             ← 代码（引擎自检 + Agent 安装）
└── templates/scaffold/
    ├── support/caseStore.ts     579 行        ← 代码（唯一的持久化运行时）
    ├── support/genCaseHtml.mjs                ← 代码（唯一的证据轨校验器）
    ├── support/ env / crypto / auth.setup / fixtures / resolveActionNo  ← 代码（项目脚手架）
    └── playwright.config.ts                   ← 代码（Runner 配置）
```

**结论：Harness Core 目前约等于 `caseStore.ts` 加 `genCaseHtml.mjs`。**
其余全部是"教 Agent 怎么做"的规范文本。这正是 2.0 要反转的比例。

两个 `scripts/` 都**不参与测试执行**：

- `scripts/validate-structure.mjs`（133 行）——校验引擎自身文档结构（frontmatter / 章节 /
  交叉引用 / 硬编码路径 / JSON 块可解析）。它验证的是**规范的完整性**，不是**测试的真实性**。
- `scripts/install-agents.mjs`——把 `agents/` 下的角色契约复制到 Claude Code 的 agents 目录以启用 Tier A。纯安装器。

---

## 二、Capability Matrix

图例：是 = ✅ ｜ 否 = ❌ ｜ 部分 = ◐ ｜ `PROSE` = 仅自然语言规范

| # | Capability | Declared | Implemented | Executed | Verified | 当前可靠性 | 当前责任方 | 2.0 处理 | 多 Runtime |
|---|-----------|:---:|:---:|:---:|:---:|---|---|---|---|
| 1 | Requirement Analysis | ✅ | PROSE | ✅ | ❌ | 依赖模型 | Agent | **DELEGATE TO AGENT** | 无关 |
| 2 | Test Strategy | ✅ | PROSE | ✅ | ❌ | 依赖模型 | Agent | **DELEGATE TO AGENT** | 无关 |
| 3 | Test Case Generation | ✅ | PROSE | ✅ | ◐ | 中（产物可见） | Agent | **DELEGATE**，Harness 只管 Schema | 无关 |
| 4 | Project Discovery | ✅ | PROSE | ✅ | ✅ | 中 | preflight-binding | **REFACTOR** 为配置 + 探测脚本 | 中立 |
| 5 | Test Execution | ✅ | ✅ Playwright | ✅ | ✅ | **高** | Playwright | **KEEP**（外部 Runner） | 中立 |
| 6 | **Case Persistence** | ✅ | ✅ caseStore.ts | ✅ | ✅ | **高** | Harness | **KEEP + 扩展 Assertion** | 中立 |
| 7 | **Run Persistence** | ✅ | ✅ recordResult | ❌ | ❌ | **零** | 无 | **P0 必须真正接线** | 中立 |
| 8 | **Evidence** | ✅ | ◐ Playwright 内置 | ◐ 仅失败时 | ❌ | **低** | Playwright | **P0 重设计（Evidence Policy）** | 中立 |
| 9 | **Assertion** | ✅ | ❌ | ◐ 散落脚本内 | ❌ | **低** | 脚本字面量 | **P0 提升为一等公民** | 中立 |
| 10 | Policy | ◐ | ❌ | ❌ | ❌ | 零 | 无 | **P0 三条 Policy 落为配置** | 中立 |
| 11 | Failure Classification | ✅ TRIAGE 八分类 | PROSE | ❌（样本 0 FAIL） | ❌ | 未验证 | Agent | **KEEP 分类法，REMOVE 教学文** | 中立 |
| 12 | Failure Diagnosis | ✅ | PROSE | ❌ | ❌ | 未验证 | Agent | **DELEGATE + 保留 Evidence Gate** | 无关 |
| 13 | Retry | ✅ | ◐ Playwright retries=1 | ✅ | ❌ | **低**（attempt 被折叠） | Playwright | **P0 引入 Attempt 模型** | 中立 |
| 14 | Resume | ✅ | PROSE | ❌ 未真正中断验证 | ❌ | **低** | Agent 重读磁盘 | **P1 重设计到 step 粒度** | 中立 |
| 15 | Regression | ◐ | ❌ | ❌ | ❌ | **零** | 无 | **P1 新建（依赖 #7）** | 中立 |
| 16 | Agent Evaluation | ❌ | ❌ | ❌ | ❌ | 零 | 无 | **P2** | 中立 |
| 17 | Cost Tracking | ❌ | ❌ | ❌ | ❌ | 零 | 无 | **P2（仅记 Runtime 可提供项）** | Runtime 相关 |
| 18 | Model Routing | ❌ | ❌ | ❌ | ❌ | 零 | 无 | **P3 —— 不做** | 无关 |
| 19 | Multi-Agent | ✅ 5 Agent | PROSE | ◐ 仅 3 个留下回执 | ❌ | **低** | Claude Code | **REMOVE 出 Core** | **强耦合 Claude Code** |
| 20 | Reporting | ✅ | ◐ 模板 + PROSE | ✅ | ◐ | 中 | Agent 手写 | **REFACTOR** 为由 Run 渲染 | 中立 |
| 21 | **HTML 用例审查视图** | ✅ | ✅ genCaseHtml.mjs | ✅ | ✅ | **高** | Harness | **KEEP —— 唯一诚实性校验器** | 中立 |
| 22 | CLI | ❌ | ◐ caseStore 隐藏 CLI | ❌ | ❌ | 零 | 无 | **P1 —— 2.0 的关键杠杆** | 中立 |
| 23 | MCP | ❌ | ❌ | ❌ | ❌ | 零 | 无 | **P2 仅设计接口** | 中立 |
| 24 | Library / SDK | ❌ | ❌ | ❌ | ❌ | 零 | 无 | **P3 —— 暂不做** | 中立 |
| 25 | Skill Compatibility | ✅ | PROSE | ✅ | ✅ | 高 | SKILL.md | **REFACTOR 为 Thin Adapter** | Claude Code 专用 |

---

## 三、Declared vs Implemented vs Executed vs Verified —— 关键证据

以下 8 条是 2.0 的直接动因。每条都附**可复核的磁盘证据**。

### 3.1 🔴 Run Persistence：实现了，但从未接线

- **Declared**：`rules/test-data-rule.md`、`rules/execute-rule.md`、`agents/executor-reporter.md`
  三处均强制要求"逐数据组 recordResult"。
- **Implemented**：`caseStore.ts` 第 504 行 `recordResult()` 完整可用，`RunRecord` 含
  `input` / `expected` / `actual` / `result` / `failureType` / `durationMs` / `specFile`。
- **Executed：❌**
  - 全项目 40 余个 spec 文件中，**0 个调用 `recordResult()`**。
  - 仅 2 个 spec 提到 caseStore，且都是注释：
    "Track B（本项目未接入 caseStore.ts）：字面量与 Case 文件的 Test Data Matrix 手工保持一致"。
  - 磁盘上的 `RUN-*.jsonl` **不是** RunRecord，而是 Playwright `results.json` 的投影汇总：
    单行、含 batch / stats / failures / skipped_detail，**无 caseId、无 input**。
  - 5 个 RUN 批次中有 2 个（RUN-20260828、RUN-20260831）**连 `.jsonl` 都没有**。

> **影响**：`rules/report-rule.md` 要求的追踪链
> 「Run → Case → DataGroup → 实际输入 → 实际结果」**在真实项目中根本不存在**。
> 规范用"证据轨 B 降级"给自己开了后门，且**每一次真实运行都走的是 B 轨**。
> 一个从未被走过的 A 轨，等于没有 A 轨。

### 3.2 🔴 Test Data 并未驱动 Playwright

- **Declared**：`rules/test-data-rule.md`「禁止出现文档写 X、脚本实际跑 Y 的数据不一致」。
- **Implemented**：`caseStore.ts` 的 `parseDataMatrix()` / `loadExecutableCases()` 完整可用。
- **Executed：❌** —— 脚本内是**手工誊抄的字面量**，spec 注释自认：
  "以下字面量与 Case 文件的 Test Data Matrix 手工保持一致，修改任一处务必同步修改另一处。"
- **后果**：规范要防的"文档与实际不一致"，正是当前实现的默认状态——只不过靠人工纪律维持。

### 3.3 🔴 Analysis Artifact 从未产出

- **Declared**：`rules/pipeline-state-rule.md` 定义了 analysis 目录下的 `AN-<MODULE>.md`、
  `variants.json`、`api-map.json`、`assertion-map.json`、`data-dependencies.json`；
  `agents/executor-reporter.md` 把 `assertion-map.json` 列为输入。
- **Executed：❌** —— `.auto-test/analysis/` **目录不存在**。
- 但 22 条 Case 已经生成、脚本已经写好、报告已经产出。
- **结论**：整条「source-analyst 产出 analysis 供下游消费」的链路是**空转的**。
  下游 Agent 声明依赖它，实际上从未读到过它。

### 3.4 🔴 Pipeline State 是 LLM 手写散文，不是机器状态

`.auto-test/state/pipeline.json` 当前内容自相矛盾：

- 顶层 `state` 写 `FINALIZED`，同文件 `note` 写"Pipeline 进入 REPORT_READY"——**同一文件内两个结论打架**。
- `stages.analysis` 与 `stages.cases` 标 `PENDING`，但磁盘上有 22 条 Case——**状态与磁盘矛盾**，
  而 `rules/pipeline-state-rule.md` 明令"必须先用磁盘现状校正"。
- `state/contracts/` 只有 4 份回执：两份 preflight-binding、一份 script-engineer、
  一份 executor-reporter。**source-analyst 与 case-designer 从未留下回执**，但 Case 确实存在。

> **结论**：要么这两个 Agent 未按协议回执，要么 Orchestrator 自己写了用例
> （即 `prompts/orchestrator.md` 明令禁止的"伪多 Agent"）。
> 无论哪种，**Multi-Agent 协议不是承重结构**——它没有被强制，也没有被检测到违反。

### 3.5 🔴 Evidence 与 "Evidence First" 完全相反

`templates/scaffold/playwright.config.ts` 中：trace 为 retain-on-failure、
screenshot 为 only-on-failure、video 为 off。

**PASS 的用例产生零证据。** 当前架构下：

```
Agent 说 PASS  →  没有截图  →  没有 trace  →  没有 network log
              →  没有 RunRecord  →  无从核对
```

`rules/report-rule.md` 要求"不得仅报告 PASS"，但可核对的只有 `stats.expected` 这个**计数**。
**"某条 Case 的某个数据组在某时刻真的以某输入执行过"——当前系统无法证明。**

### 3.6 🟡 Retry 语义丢失

- `playwright.config.ts` 设 retries 为 1；`rules/execute-rule.md` 要求 retry 后转 PASS 必须记 FLAKY。
- 但 Harness **没有 Attempt 模型**：Playwright 把多次尝试折叠成一个 flaky 标记，
  「Attempt 1 FAIL / Attempt 2 PASS」的各自输入、证据、错误**不被分别保存**。
- FLAKY 的唯一来源是投影出的 `stats.flaky` 数字，而 `results.json` **每次 playwright 调用被整体覆写**
  （`rules/execute-rule.md` 自己承认了这个坑）。分批执行时 FLAKY 会静默丢失。

### 3.7 🟡 Resume 未经真实中断验证

- **Declared**：`SKILL.md`、`rules/pipeline-state-rule.md`、`prompts/orchestrator.md`。
- **Implemented：PROSE** —— 机制是"下次触发时 LLM 重读磁盘并重新推断"。
- **Executed：❌** —— 没有任何一次中断到恢复的记录。
- **结构性缺陷**：最小可恢复单位是**一整次 playwright 调用**。
  「Step 3 RUNNING / Step 4 NOT_STARTED」这种粒度**在当前模型里不存在**，
  因此 Resume 验证场景目前**不可能通过**。

### 3.8 🔴 执行层与证据层全部脱离版本控制

| 产物 | 位置 | 版本控制 |
|------|------|---------|
| Playwright 脚本（40 余个 spec） | 前端项目 tests 目录 | ❌ 前端 gitignore 整目录忽略 |
| 机器执行记录 | `.auto-test/reports/*.jsonl` | ❌ `.auto-test/.gitignore` |
| 编排状态与回执 | `.auto-test/state/` | ❌ `.auto-test/.gitignore` |
| FAIL 诊断 | `.auto-test/diagnostics/` | ❌ `.auto-test/.gitignore` |
| Case 资产 | `.auto-test/cases/*.md` | ✅ |
| 人读报告 | `.auto-test/reports/*.md` | ✅ |

> **结论**：**入库的全是人读散文，被忽略的全是机器事实。**
> 历史 Run 无法比较、Regression 无法计算、复现无从谈起——
> 这不是"还没做 Regression"，而是"当前存储策略在结构上排除了 Regression"。

---

## 四、真实执行样本核对（V-LIMS，5 个批次）

| Run ID | md | jsonl | 证据轨 | 结果 | 备注 |
|--------|:---:|:---:|---|---|---|
| RUN-20260828-170846 | ✅ | ❌ | 不可判定 | — | 无任何机器记录 |
| RUN-20260831-152556 | ✅ | ❌ | 不可判定 | — | 无任何机器记录 |
| RUN-20260901-151238 | ✅ | ✅ 1 行 | B | 2 expected | 仅 stats |
| RUN-20260903-102335 | ✅ | ✅ | B | — | — |
| RUN-20260903-152447 | ✅ | ✅ 1 行 | B | 2 PASS / 6 BLOCKED | 报告自标 B 轨降级 |

**值得肯定的诚实行为**（这些必须在 2.0 中保留并强化）：

- 报告如实写出"本项目未接入 case-store 的逐数据组记录，走 B 轨降级"，**没有伪装成 A 轨**。
- 6 条 BLOCKED 被如实标为 BLOCKED（权限缺失 / 测试数据空档），**没有算进 Pass Rate 分母**。
- 未达成完整数据组覆盖的 Case **保持 ready 而非误标 completed**。
- `genCaseHtml.mjs` 在**代码里**判定 A/B 轨并在页面显式标注降级——
  **这是全系统唯一一处"机器强制的诚实性"**，不依赖 LLM 自觉。

> **2.0 的核心洞察就在这里**：
> 前三条诚实是**模型自觉**（这次做到了，下次不保证）；
> 第四条诚实是**代码强制**（永远做到）。
> 2.0 要做的，就是把前三条从"自觉"迁移到"强制"。

---

## 五、能力重新归属（KEEP / REFACTOR / REMOVE / DELEGATE）

### 5.1 应当交还给 Agent（DELEGATE，从 Harness 删除）

| 当前位置 | 内容 | 理由 |
|---------|------|------|
| `rules/source-analysis-rule.md` | 八层源码定位顺序 | 现代 Agent 的代码库探索是原生能力，无需教学 |
| `rules/execute-rule.md` 的假设与预算小节 | HYPOTHESIS 写法、Diagnostic Budget 自问清单 | Agent 已具备假设-证伪推理 |
| `rules/script-rule.md` + `templates/selectors/` | 选择器手册与脚本骨架 | Agent 加 Playwright 可自行处理 |
| `rules/case-store-rule.md` 的 Cheap Reuse Gate | 约 100 行 git diff 启发式 | 这是 Impact Analysis，Agent 天然更强；Harness 只需**记录判定结果** |
| `rules/report-rule.md` 的 Token 控制小节 | 日志 20 行 / 截图只留路径 | Runtime 的上下文管理职责，非测试 Harness 职责 |
| `rules/pipeline-state-rule.md` 的 Dispatch Tier、`prompts/orchestrator.md` | Tier A/B、Agent 间通信纪律 | **Claude Code 专属**，出现在 Core 里即违反 Runtime 中立 |
| `agents/` 六份角色契约 | 五 Agent 协议 | 见 3.4：未被强制、未承重，降级为 Client 侧可选提示 |

### 5.2 必须保留并强化（KEEP）

| 内容 | 理由 |
|------|------|
| `caseStore.ts` 的 Frontmatter **最小化回写** | 人工修改保护，是真正的工程确定性 |
| Case 生命周期状态机 + 合法转换表 | 已实现、已执行、已验证，`canTransition()` 会抛错 |
| completed 不等于 PASS 的四维度正交模型 | 概念上正确，2.0 直接继承 |
| TRIAGE 八分类**分类法本身** | 是 Policy，不是教学；保留 taxonomy，删教学文 |
| **Evidence Gate**（证据不足唯一合法结论是 UNKNOWN） | 2.0 的核心原则，需从 prose 升级为代码 |
| `genCaseHtml.mjs` 的 A/B 轨机器判定 | 唯一的诚实性校验器，需推广到整个 Finalization |
| 数据隔离前缀 / DB 安全边界 / Teardown | 真实的安全约束 |

### 5.3 必须新建（NEW，Harness 独有价值）

| 能力 | 为什么 Agent 做不了 |
|------|-------------------|
| **Attempt 模型** | Agent 会自然地把"重试后成功"叙述成"成功" |
| **Evidence Policy（含 PASS 时的证据）** | Agent 没有动机为成功的用例保存证据 |
| **Assertion 一等公民** | 断言散落在脚本里，Agent 无法跨 Run 比较 |
| **Finalization Gate（可执行）** | Agent 永远可以说服自己"够了" |
| **Run 不可变 + schemaVersion** | Agent 会覆盖、合并、美化历史 |
| **Regression Diff** | 需要跨 Run 的机械比较，不能靠回忆 |

---

## 六、Multi-Runtime 验证状态

| Runtime | 架构支持 | 实机验证 | 状态 |
|---------|:---:|:---:|---|
| Claude Code | ✅ | ✅（本次审计样本即为 Claude Code 产出） | **VERIFIED** |
| Codex | 理论上 | ❌ 本环境未接入 | **UNVERIFIED** |
| Gemini | 理论上 | ❌ | **UNVERIFIED** |
| Cursor | 理论上 | ❌ | **UNVERIFIED** |
| CI / 纯 CLI | ❌ 当前无 CLI 入口 | ❌ | **NOT SUPPORTED** |

**真正重要的判断不是"验证了几个 Runtime"，而是"Core 是否依赖某个 Runtime"。当前答案是：严重依赖。**

`rules/auto-test-agent.md`（主规范）中直接出现 Claude Code 的 API 概念：subagent_type、
general-purpose、Claude Code 的 agents 目录、AskUserQuestion、Dispatch Tier A/B。
换一个 Runtime 不是"加个 Adapter"，而是**要改主规范**——这正是 2.0 必须消除的耦合。

---

## 七、与「最终成功标准」的现状对照

| # | 标准 | 现状 | 差距 |
|---|------|:---:|---|
| 1 | Agent 可自由决定测试策略 | ✅ | 无（甚至过度自由） |
| 2 | Harness 可靠执行测试 | ✅ | Playwright 承担，可靠 |
| 3 | Harness 可证明测试真的发生 | ❌ | **仅有计数，无逐数据组事实** |
| 4 | Evidence 完整 | ❌ | **PASS 时零证据** |
| 5 | Assertion 正确 | ❌ | 无 Assertion 模型 |
| 6 | Agent Claim 可被验证 | ❌ | outputsVerified 由 Agent 自报 |
| 7 | Root Cause 有 Evidence 支撑 | ◐ | 规范强制，但从未执行（0 FAIL 样本） |
| 8 | Retry 语义明确 | ❌ | Attempt 被折叠 |
| 9 | Resume 可靠 | ❌ | 粒度过粗，未验证 |
| 10 | Regression 可追踪 | ❌ | 机器记录被 gitignore |
| 11 | Run 可复现和比较 | ❌ | 同上 |
| 12 | Evaluation 以客观指标为主 | ❌ | 无 Evaluation |
| 13 | 多 Runtime 共用同一 Core | ❌ | Core 与 Claude Code 耦合 |
| 14 | 旧 Skill 可迁移 | ◐ | 需设计 |
| 15 | 新 Runtime 无需改 Core | ❌ | 需改主规范 |
| 16 | Auto-Test 比 Agent 更确定 | ❌ | **当前几乎全部确定性都寄托在模型自觉** |
| 17 | 避免过度设计 | ◐ | v1.1.0 的 Multi-Agent 层即为过度设计（见 3.4） |

**17 项中当前满足 2 项。** 这不是失败——v1.x 成功地做出了一套高质量的 Agent 引导规范。
但它证明了一件事：

> **凡是靠 Prompt 强制的规则，在真实项目里都会以"合理降级"的方式被绕过；
> 凡是靠代码强制的规则（canTransition 抛错、genCaseHtml 判轨），从未被绕过。**

这就是 Auto-Test 2.0 的全部立论基础。

---

相关文档：`docs/architecture/harness-architecture.md`、`docs/architecture/test-model.md`、
`docs/architecture/policy-and-diagnostics.md`、`docs/architecture/migration-plan.md`、
`docs/architecture/audit-2.0-report.md`。
