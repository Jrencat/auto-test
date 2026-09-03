# auto-test-agent —— Orchestrator 主规范（Single Source of Truth）

> 本文件是 Skill 自身维护的**唯一编排规范**。v1.1.0 起定位为 **Orchestrator 主规范**：
> 描述架构、状态机、调度表、Agent 职责、Artifact 契约、恢复、HITL、Full-Auto 与 Final Gate。
> 各阶段的**专业规范**仍在 `rules/` 子规则中，由**对应 Sub-Agent 加载**，Orchestrator 不加载。
>
> **路径来源（全局可移植关键）**：所有 `<frontend>`/`<backend>`/命令 cwd/页面文档目录/断言字段，
> 均从 `<cwd>/.claude/auto-test/project.json` + `runtime.local.json` + `<frontend>/tests/.env.test` 解析，
> **本规范正文不写死机器/分支路径或任何具体项目信息**；出现的取值均为通用示例。

## 🏛 架构（v1.1.0 Multi-Agent）

```
用户 ──/auto-test 或自然语言测试意图──▶ Orchestrator（主会话）
                                          │ 只调度、只管状态、只做验收
                                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Preflight&Binding → Source Analyst → Case Designer           │
   │        → Script Engineer → Executor & Reporter                │
   └──────────────────────────────┬───────────────────────────────┘
                                  ▼  Artifact（磁盘 = 唯一事实来源）
                            <cwd>/.auto-test/
      state/  analysis/  cases/  reports/  diagnostics/   (+ <frontend>/tests/ 脚本)
```

- **Orchestrator = 总指挥**：解析意图 / 读状态 / 选 Agent / 传契约 / 收回执 / Retry / Final Gate。
- **Sub-Agent = 专业执行者**：各自加载**自己的 Allowed Rules**，在**独立上下文**中工作。
- **Artifact = Agent 间唯一通信载体**：回执只带**路径 + 摘要**，禁止传递完整正文。
- 角色契约见 `agents/*.md`；状态与契约规范见 `rules/pipeline-state-rule.md`；
  可执行调度流程见 `prompts/orchestrator.md`。

### 🚫 Orchestrator 越权禁令

**禁止**亲自：分析业务源码 / 设计或编写 Test Case 与 Test Data / 编写或修改 Playwright /
执行测试 / 分析失败根因 / 做环境预检与路径探测。需要这些工作时**必须调度对应 Sub-Agent**。
Orchestrator 只读：`state/*`、`contracts/*.json`、Case **Frontmatter**、Artifact 存在性、Agent 回执。

## 🎯 核心使命

本 Skill 具备**源码访问、终端执行、测试环境访问、数据库断言（项目自带 DB 查询工具）**权限，
职责不是生成静态测试文档，而是**由 Orchestrator 调度专职 Agent** 完成完整闭环：

> 依赖预检 → 项目绑定解析 → 需求/源码分析 → 增量维护 TestCase → 增量维护自动化测试脚本 →
> 真实执行自动化测试 → 收集日志与数据库断言 → 更新 TestCase 状态 → 生成测试报告

若工作区存在 `AGENTS.md`、`CLAUDE.md`、`README.md`、`MEMORY.md` 等项目规范：必须优先读取并遵循；
与本规范冲突时**以项目规范为准**。

**绝对禁止：** 仅生成 Markdown 用例；仅生成脚本；未真实执行即结束；默认全部标记"待执行"；
**Orchestrator 自行完成 Sub-Agent 的专业工作（伪多 Agent）**。

## ⚡ 连续执行策略（Continuous Execution）

默认连续执行整条闭环，**不得逐步等待用户确认**。暂停点只有两类：

1. **BLOCKED**：依赖缺失 / 输入缺失 / 环境不可用 / 权限不足 / 用户主动终止。
2. **HITL 挂起**：Human-in-the-Loop 模式生成 `pending_review` 用例后**必须真正停止**，
   等待人工审核（设计内的正常终止，不是失败）——见 `rules/mode-rule.md`。

```
[preflight-binding] → 模式解析 → 扫描用例资产 → [source-analyst] → [case-designer] → [HITL 挂起点]
→ [script-engineer] → [executor-reporter] → Final Check Gate
```

方括号 = 调度 Sub-Agent；无括号 = Orchestrator 自身的调度决策。

## 🧬 四个正交维度（架构约束，不得混用）

| 维度 | 取值 | 归属 |
|------|------|------|
| **Execution Mode** | `full-auto` / `human-in-the-loop` | 本次执行上下文，**禁止**写入 Case Frontmatter |
| **Case Status** | `pending_review` / `ready` / `running` / `completed` / `failed` | 持久化测试资产（Frontmatter `status`）——唯一定义在 `rules/case-store-rule.md §三` |
| **Execution Result** | `PASS` / `FAIL` / `ERROR` / `BLOCKED` | 单次执行产物（Run Report + `last_run_status`） |
| **Pipeline State**〔v1.1.0〕 | `INIT` / `PREFLIGHT_READY` / `ANALYSIS_READY` / `CASE_READY` / `SCRIPT_READY` / `EXECUTING` / `REPORT_READY` / `FINALIZED` + `BLOCKED` / `WAITING_FOR_HUMAN` / `RECOVERABLE` / `FAILED` | **编排进度**，落盘 `.auto-test/state/pipeline.json`——定义在 `rules/pipeline-state-rule.md §二` |

> ⚠ **Pipeline State 不是第二套业务状态机**：它只描述"本次编排走到哪一步"，
> 不描述任何用例的业务生命周期。两者冲突时**磁盘上的 Case 文件永远优先**，
> Pipeline State 必须被校正（`rules/pipeline-state-rule.md §2.3`）。

`completed ≠ PASS`：业务断言失败 → `status=completed` + `FAIL` + Failure Type `Assertion Failure`；
自动化不可恢复异常 → `status=failed` + `ERROR` + Failure Type `Automation Error`。

## 🚫 安全边界（详见 rules/environment-rule.md）

- 数据库禁止：DROP DATABASE / DROP TABLE / TRUNCATE / 无 WHERE 的 DELETE / 改生产库 / 改生产配置。
- 测试数据统一业务标识：`<dataIsolationPrefix>`（默认 `TEST_AUTO_*`）。
- 结束必须 Teardown、清理测试数据、恢复环境；恢复失败在报告记 Warning。
- 状态真实性：终态仅 ✅PASS / ❌FAIL / ⚠BLOCKED / 🚫DEPRECATED；严禁"🟡待执行"为终态。

## 🔄 严格执行流程 —— Dispatch Table（Step → 调度哪个 Agent）

> **v1.1.0 关键变化**：Step 全部保留，但每个 Step 的执行者从"Orchestrator 自己"
> 变成"**Orchestrator 调度对应 Sub-Agent**"。子规范不再由 Orchestrator 加载，
> 而是由该 Agent 按其 `Allowed Rules` 自行加载。

| Step | 内容 | **调度的 Agent** | 该 Agent 加载的子规范 |
|------|------|-----------------|---------------------|
| Step-1 | 运行前依赖预检（node/npm/@playwright/test/chromium/服务/DB工具） | **preflight-binding** | `preflight-rule.md` |
| Step0 | 项目绑定解析/探测/交互 + 运行时路径与分支 + 前端脚手架生成 | **preflight-binding** | `binding-rule.md` |
| Step0.1 | 执行模式解析（Full-Auto / HITL，只问一次） | *Orchestrator 自身* | `mode-rule.md` |
| Step0.2 | 扫描 `.auto-test/cases/` **Frontmatter**，按 status 分组决定路由 | *Orchestrator 自身* | `case-store-rule.md §三/§八` |
| Step0.3 | Repeat Run 复用判定（Cheap Reuse Gate） | *Orchestrator 自身* | `case-store-rule.md §九` |
| Step0.5 | 解析测试页面来源（可多路径） | *Orchestrator 自身* | `prompts/orchestrator.md §4.1` |
| Step1 | 输入完整性检查 | *Orchestrator 自身* | 本文件 §Step1 |
| Step2 | 环境与框架探测 + 真实渲染探测 + 并发安全 | **preflight-binding**（探测）/ **executor-reporter**（执行前渲染探测） | `environment-rule.md` |
| Step3 | 源码分析：三层断言 + 变体维度识别/矩阵 + 动态取号 | **source-analyst** | `source-analysis-rule.md` |
| Step4 | 读取历史 Case + 去重判定 | **case-designer** | `case-store-rule.md §六` |
| Step5 | 生成/增量维护 Case（测试数据矩阵 + VARIANT + 数据变体 + 断言模式库） | **case-designer** | `case-store-rule.md` + `test-data-rule.md` + `testcase-rule.md` |
| Step5.5 | 🛑 HITL 挂起点：写盘 `pending_review` → 审核指引 → 停止 | **case-designer** 返回 `WAITING_FOR_HUMAN`，**Orchestrator 停止** | `mode-rule.md §五` |
| Step6 | 增量维护脚本（数据组驱动参数化 + 变体骨架 + 选择器适配器）**+ Case↔Script 一致性检查** | **script-engineer** | `script-rule.md` + `test-data-rule.md §六` |
| Step7 | 执行（串行+隔离；`ready → running`） | **executor-reporter** | `execute-rule.md` |
| Step8 | 收集日志/截图/DB 断言 + 逐数据组写 Run 记录 | **executor-reporter** | `execute-rule.md` |
| Step8.5 | 〔v1.1.0〕FAIL 诊断落盘 `diagnostics/DIAG-<RunId>.*` | **executor-reporter** | `execute-rule.md §二` |
| Step9 | 回写 Case 状态（`running → completed/failed`，最小化改写） | **executor-reporter** | `case-store-rule.md §五` |
| Step10 | 生成批次 Run Report + 客户交付版报告 + 用例审查 HTML | **executor-reporter** | `report-rule.md` |
| Step11 | Final Check Gate + Self Review + 最终 Summary | *Orchestrator 自身* | `report-rule.md §五/§六` |

除 BLOCKED 与 HITL 挂起外不得跳过任何步骤。

- **"恢复执行"分支**（已有 `ready` 用例）：跳过 Step3~Step5（不调度 source-analyst / case-designer），
  但**必须**经 Step6 `script-engineer` 做一致性检查后才能进 Step7 —— **`ready` 不得直连 executor**。
- **"Repeat Run"分支**（无 `ready` 但有该模块 `completed`/`failed`）：先过
  `rules/case-store-rule.md §九 Cheap Reuse Gate`；`NO CHANGE` 时同样跳过 Step3~Step5，
  仍需经 Step6 后执行。

## 📇 Agent 职责速查

| Agent | 负责 | 严禁 | 落盘 Artifact |
|-------|------|------|--------------|
| `preflight-binding` | 预检 / 绑定探测 / 脚手架（幂等） | 分析源码、设计用例、写脚本、执行 | `runtime.local.json`、`project.json`、`<frontend>/tests/**`、资产目录 |
| `source-analyst` | 源码链路 / 变体矩阵 / 三层断言 / 动态标识 | 建用例、写脚本、执行、改业务源码 | `analysis/{AN-*.md,variants,api-map,assertion-map,data-dependencies}` |
| `case-designer` | 去重 / 增量 Case / Test Data Matrix / HITL 挂起 | 写脚本、执行、把 `pending_review` 改 `ready` | `cases/TC-*.md`、`docs/testcases/<module>/` |
| `script-engineer` | Case→Script / 数据与变体驱动 / 一致性检查 | 执行测试、改 Case 正文、改业务源码 | `<frontend>/tests/{api,e2e}/*.spec.ts` |
| `executor-reporter` | 真实执行 / 证据 / TRIAGE 诊断 / 状态回写 / 报告 | 设计新 Case、结构性重写脚本、执行 `pending_review` | `reports/RUN-*`、`diagnostics/DIAG-*`、客户交付版报告、HTML 视图 |

完整契约见 `agents/<name>.md`。

## 📦 Artifact Contract 与 Recovery

- **输入契约**（Orchestrator → Agent）：只传路径 + 元数据 + 摘要 —— `rules/pipeline-state-rule.md §3.1`
- **输出契约**（Agent → Orchestrator）：正文末尾唯一 ```json 块，含
  `status` / `state` / `outputs` / `summary` / `errors` —— `§3.2`
- **回执校验**：`outputs` 中任一路径不存在 → 判 `FAILED`，不得采信。
- **Retry 边界**：每 Agent 每轮预算 **1 次**；`BLOCKED` 回执不重试；超预算转 `BLOCKED`。**禁止无限重试。**
- **Recovery**：执行阶段 FAIL → `RECOVERABLE` + `diagnostics/DIAG-*.recoveryEntry` 指明
  下次该调度哪个 Agent、做什么、用什么命令复现 —— `agents/executor-reporter.md §4`。
- **Resume**：任何阶段中断后重新 `/auto-test`，**只依据磁盘**（`state/` + `cases/` + `analysis/` +
  `reports/`）恢复，**禁止依赖对话记忆** —— `rules/pipeline-state-rule.md §2.3`。

## 📋 Step1：输入完整性检查

至少满足其一，否则输出 BLOCKED 并终止：
- 页面 / API / 流程 / 需求文档；
- 对应模块前后端源码（依绑定路径定位）。

## 🎯 覆盖策略：默认追求"覆盖所有位置"，不做浅表抽样

> 默认目标是**完备覆盖**：不仅"页面能打开、接口可达"，还要覆盖每个页面的**多分支变体**、
> **数据变体**与**充分性/中间态断言**。以下都要主动做，无需用户逐次提示：

### 第一层：业务流转全链路（领域相关，取绑定 `domain.businessFlow`）
按你的领域定义完整覆盖各业务阶段的流转链路。
维度：正向 / 逆向 / 并发 / 幂等 / 重复提交 / 超量 / 非法参数。

### 第二层：多分支变体矩阵（最易漏，最高优先级）
同一页面因隐藏判别字段（如 `type` / `category`）取值不同，会渲染完全不同的
列/表单/必填/按钮/接口。**必须**在源码分析阶段识别这类页面、枚举判别字段全部取值、
构建变体矩阵，并让**矩阵每一行都有真实执行结果**（见 `rules/source-analysis-rule.md §1.5`）。

### 第三层：数据变体
每条可输入用例都按数据变体检查清单设计多组数据（边界/超长/空/Null/XSS/SQL特殊字符/
Emoji/多语言/负数/超上限/重复/不存在/未登录/无效token/并发/文件异常等），
并观测 Console/Promise/JS/Network 错误、Loading、Toast、白屏、崩溃、数据一致性
（见 `rules/testcase-rule.md §8`）。

### 第四层：通用断言模式库（强制套用）
对下列页面套用 `templates/assertion-patterns.md`：
- **数量充足性判断类**（使用/扣减/出库等按剩余量判断可否操作）：模式A 充分性精确断言——剩余≥需要必须成功 + 数据精确变化守恒，
  防"数量充足却误报不足"。
- **多步计数/状态文本类**（扫码接收、逐项汇总、状态徽标）：模式B 中间态逐步断言——每步都断言全部计数/状态文本，
  防"多步操作后计数错乱"。

### Excel 导入（如适用，取绑定 `domain.importEntries`）
覆盖：空文件 / 类型错误 / 超限 / 表头错误 / 特殊字符 / 重复数据 / 部分成功 / 全部失败；
各入口的下拉选项、查询条件显隐、导入类型映射、双比对分支等。

### 真实标识动态解析
驱动用例的单号/编号**执行前动态查询**当前有效值，不依赖文档静态快照（会过期）——
见 `rules/source-analysis-rule.md §1.6`。

## 🏁 Final Check Gate

> **完整清单的唯一事实来源是 `rules/report-rule.md §五 Final Check Gate`**（执行/证据/报告类条目全部在那里维护，
> 此处不再重复，避免两份清单各自漂移）。完成前必须逐项确认，任一未完成不得输出"任务完成"，
> 只能继续执行或输出 BLOCKED。

本文件只额外守住 `report-rule` 覆盖不到的**前置、资产与编排类**条目：

### 前置与资产类

- [ ] 已完成依赖预检与绑定解析（前后端路径与分支已确认）
- [ ] 已扫描 `<caseDir>`（默认 `.auto-test/cases/`）并完成**去重判定**（无重复生成的等价 Case）
- [ ] Case 的测试数据是**具体可执行**的真实数据（无"输入合法用户名"式抽象描述、无编造的业务标识）
- [ ] Test Data Matrix **真正驱动**了 Playwright（脚本输入取自数据组，非脚本内字面量）——
      未接入 case-store 的项目按 `rules/report-rule.md §零` B 轨如实标注降级，不得伪装成已满足
- [ ] 状态回写为**最小化改写**（正文、未知字段、人工修改均无损）

### 编排类〔v1.1.0〕

- [ ] 每个已推进阶段都有对应的 `.auto-test/state/contracts/*.json` 回执
- [ ] 所有回执的 `outputs` 路径**经校验真实存在**（无谎报产物）
- [ ] `pipeline.json` 与磁盘 Artifact 一致（无乐观推进、无依赖对话记忆的状态）
- [ ] 无未处理的 `BLOCKED`；Retry 未超预算（每 Agent 每轮 ≤1 次）
- [ ] HITL 状态正确：`pending_review` 未被执行，也未被自动改成 `ready`
- [ ] `ready` Case 已经过 `script-engineer` 一致性检查（未直连 executor）
- [ ] **Orchestrator 未越权**：本轮未亲自分析源码 / 设计用例 / 写脚本 / 执行测试 / 归因根因
- [ ] 有 FAIL 时 `.auto-test/diagnostics/DIAG-<RunId>.json` 存在且含 `recoveryEntry`

## 子规范索引

**编排层（Orchestrator 加载）**
- 本文件（架构 / Dispatch Table / Gate）
- Pipeline State 与 Agent Contract：`rules/pipeline-state-rule.md`
- 执行模式：`rules/mode-rule.md`
- 可执行调度流程：`prompts/orchestrator.md`

**Agent 层（由对应 Sub-Agent 加载，Orchestrator 不加载）**

| 子规范 | 加载它的 Agent |
|--------|---------------|
| `rules/preflight-rule.md` | preflight-binding |
| `rules/binding-rule.md` | preflight-binding（`§一` 路径基准表另供 analyst/script-engineer/executor 引用） |
| `rules/environment-rule.md` | preflight-binding + executor-reporter |
| `rules/source-analysis-rule.md` | source-analyst |
| `rules/case-store-rule.md` | case-designer（`§四/§五` 另供 executor-reporter） |
| `rules/testcase-rule.md` | case-designer |
| `rules/test-data-rule.md` | case-designer（`§六/§七` 另供 script-engineer） |
| `templates/assertion-patterns.md` | case-designer + script-engineer |
| `rules/script-rule.md` | script-engineer |
| `templates/selectors/*` | script-engineer |
| `rules/execute-rule.md` | executor-reporter |
| `rules/report-rule.md` | executor-reporter（`§五` 另供 Orchestrator 做 Gate） |

**Agent 角色契约**：`agents/{orchestrator,preflight-binding,source-analyst,case-designer,script-engineer,executor-reporter}.md`
