---
name: auto-test
version: 1.1.0
description: 企业级自动化测试闭环编排（可移植全局引擎，Multi-Agent 架构）。当用户涉及自动化测试、测试用例、API 测试、E2E/UI 自动化、回归测试、测试报告、自动化测试修复，或提供页面集合/接口/流程/需求文档（如 docs/test-pages/**/页面.md）时使用。由 Orchestrator 调度 5 个专职 Sub-Agent（Preflight&Binding / Source Analyst / Case Designer / Script Engineer / Executor&Reporter），基于 Playwright（E2E+API）与数据库断言（项目自带的 DB 查询工具），完成"依赖预检→项目绑定解析→源码分析→维护 TestCase→维护脚本→真实执行→日志与数据库断言→回写状态→生成报告"的完整闭环。状态与产物全部落盘 .auto-test/，支持中断恢复（Resume）、HITL 真正挂起与 FAIL 诊断闭环。引擎本体零硬编码路径，项目信息从当前工作目录的绑定配置解析；默认追求"覆盖所有位置"的完备测试（主动识别多分支变体页面并全取值覆盖 + 每条输入做数据变体 + 充分性/中间态精确断言）并输出可直接交付客户的完备报告，无需用户逐次提示。
---

# auto-test —— 自动化测试闭环编排 Skill（全局可移植引擎）

本 Skill 是**编排层（Orchestration）**：负责路由、调度、规则引用与 Prompt 编排，
不承载具体业务逻辑。所有执行规范、模板、配置均外置于本目录，支持长期增量演进。

## 🏛 架构（v1.1.0 Multi-Agent）

```
用户 ──/auto-test 或自然语言测试意图──▶ Orchestrator（总指挥，只调度不干活）
                                          │
   ┌──────────────────────────────────────┴───────────────────────────────┐
   │ preflight-binding → source-analyst → case-designer                    │
   │        → script-engineer → executor-reporter                          │
   └──────────────────────────────┬───────────────────────────────────────┘
                                  ▼  Artifact（磁盘 = 唯一事实来源）
                   <cwd>/.auto-test/{state,analysis,cases,reports,diagnostics}/
                              + <frontend>/tests/（Playwright 脚本）
```

| 组件 | 职责 |
|------|------|
| **Orchestrator** | 调度 / Pipeline State / Resume / BLOCKED / HITL / Retry / Final Check Gate。**禁止**亲自分析源码、设计用例、写脚本、执行测试 |
| **Sub-Agent** | 各自加载**自己的 Allowed Rules**，在**独立上下文**中完成专业工作 |
| **Artifact** | Agent 间唯一通信载体：回执只带**路径 + 摘要**，不传完整正文 |

角色契约见 `agents/*.md`；调度流程见 `prompts/orchestrator.md`；
状态与契约规范见 `rules/pipeline-state-rule.md`；架构与 Dispatch Table 见 `rules/auto-test-agent.md`。

### Agent 调度机制（Dispatch Tier）

Claude Code 只从 `.claude/agents/` 与 plugin `agents/` 加载 Agent 定义，**不会**加载 Skill 目录下的
`agents/`。因此引擎提供两档调度，**运行时自动判定**：

| Tier | 条件 | 调度方式 |
|------|------|---------|
| **A** | 已执行 `node <skillDir>/scripts/install-agents.mjs` 并重启会话 | `Agent(subagent_type: "auto-test-<name>", ...)` 原生注册 Sub-Agent |
| **B**（默认） | 未安装，引擎解压即用 | `Agent(subagent_type: "general-purpose", prompt: "读取 <skillDir>/agents/<name>.md 并严格遵守；输入契约：…")` |

**两档都是真实的 Agent 工具调度**——Sub-Agent 在**独立上下文窗口**执行、独立持有工具结果、
只回传结构化契约；差异仅在于角色定义是「已注册」还是「运行时加载」。
**严禁**"读了 `agents/<name>.md` 然后 Orchestrator 自己干"的伪多 Agent 实现。

## 🌐 可移植定位

- 引擎本体（本目录）**不含任何机器/分支绝对路径、不含任何具体项目信息**，可安装到全局
  `~/.claude/skills/auto-test/`，或打包分发解压即用。
- **项目特定信息**（前后端路径/端口/数据库工具/领域字段/页面文档目录）在**运行时从当前工作目录**解析：
  - 每项目绑定：`<cwd>/.claude/auto-test/project.json`（可提交，项目画像）
  - 每机器运行时：`<cwd>/.claude/auto-test/runtime.local.json`（gitignore，前后端**绝对路径 + 当前分支**）
  - 测试资产：`<cwd>/.auto-test/cases/`（用例，SSOT）与 `<cwd>/.auto-test/reports/`（每次执行独立报告）
  - 前端脚手架：`<frontend>/tests/`（support / playwright.config.ts / .env.test.example）
- 首次在某文件夹运行时，若无绑定 → 自动探测；探测不到 → 交互询问前后端路径（见 `rules/binding-rule.md`）。
- 引擎自带一份**通用示例 profile**（`templates/binding/project.template.json`），首次运行后按你的项目替换。

## 何时触发

- 关键词：自动化测试、测试用例、回归测试、E2E、UI 自动化、API 测试、测试报告、自动化修复
- 框架词：Playwright、Cypress、Pytest、JUnit、Newman、Postman
- 输入文档：用户提供 `页面.md` / `接口.md` / `流程.md` / `需求.md`（如 `docs/test-pages/订单模块/页面.md`）

## 唯一执行规范（Single Source of Truth）

本 Skill 内置执行规范，运行时**只依赖本目录 + `<cwd>/.claude/auto-test/` 绑定**：

- 主入口：`rules/auto-test-agent.md`
- 该主规范按职责引用子规范（`rules/*.md`）。

## 输入 / 输出

**输入（任选其一即可启动，缺失则输出 BLOCKED）**
- 业务描述文档（页面/接口/流程/需求）——**路径由用户指定，可传多个，不写死文件夹**
- 对应模块的前后端源码（Skill 依绑定 `runtime.local.json` 的前后端路径自动定位，**禁止要求用户提供源码路径**）

**测试页面来源**（详见 `prompts/orchestrator.md` §输入来源解析）：
- 若命令已带路径 → 直接用（可多个，文件 / 目录 / glob）
- 若未带路径 → **启动后交互二选一**：
  - **A** 手动输入多个文件路径
  - **B** 使用默认页面文档目录（`TEST_PAGE_DOC_DIR`，默认 `docs/test-pages/`，**不写死，从 `.env.test` 解析**）下的文件

**输出**
- 〔v1.1.0〕源码分析 Artifact：`<cwd>/.auto-test/analysis/`（`AN-<MODULE>.md` + `variants.json` /
  `api-map.json` / `assertion-map.json` / `data-dependencies.json`）
- 〔v1.1.0〕编排状态：`<cwd>/.auto-test/state/pipeline.json` + `state/contracts/*.json`（Agent 回执存档）
- 〔v1.1.0〕FAIL 诊断入口：`<cwd>/.auto-test/diagnostics/DIAG-<RunId>.json` / `.md`（含 `recoveryEntry`）
- 持久化测试用例资产：`<cwd>/.auto-test/cases/TC-*.md`（**SSOT**，YAML Frontmatter + Test Data Matrix）
- 增量维护的模块汇总视图：`docs/testcases/<module>/`（含多分支页面的 `VARIANT_数据变体矩阵用例.md`）
- 增量维护的自动化脚本：`<frontend>/tests/{api,e2e}/`（含参数化变体矩阵脚本；`<frontend>` 来自绑定）
- 每次执行独立的批次报告：`<cwd>/.auto-test/reports/RUN-YYYYMMDD-HHMMSS.md`（+ 同名 `.jsonl` 机器记录）
- 真实执行的**客户交付版**测试报告：`<cwd>/docs/testcases/<module>/自动化测试执行报告.md`
- **用例审查 HTML 视图**：`<cwd>/docs/testcases/<module>/html/`（`index.html` 汇总 + 每条用例单页，
  含完整**测试步骤**与**参数矩阵**，由 `tests/support/genCaseHtml.mjs` 从用例资产渲染，供开发人员审查）

> ⚠ 上述 `docs/` 类产物一律落在 **`<cwd>`（仓库根）**，不是前端项目内。
> `commands.cwdKey` 只决定执行测试命令的目录——见 `rules/binding-rule.md §一 路径基准表`。

**默认覆盖姿态（无需用户逐次提示）**
- 主动识别"同一页面因隐藏判别字段渲染不同内容"的多分支页面，枚举判别字段全部取值、构建变体矩阵、
  让矩阵每一行都有真实执行结果（见 `rules/source-analysis-rule.md §1.5`）。
- 每条可输入用例按数据变体检查清单设计多组数据（边界/超长/空/XSS/SQL/Emoji/多语言/负数/未登录等，
  见 `rules/testcase-rule.md §8`）。
- 对"数量充足性/多步计数/状态文本"类页面，套用**通用断言模式库**（`templates/assertion-patterns.md`）：
  充分性精确断言 + 多步中间态逐步断言。
- 报告按 `templates/report.md` 客户交付版结构输出（Executive Summary / Coverage / Detailed Results /
  Edge Case Analysis / Defects & Risk / Conclusion + Self Review）。

## 执行模式（每次触发二选一）

| 模式 | 行为 |
|------|------|
| **Full-Auto** | 生成 → 自动 `ready` → 自动执行 → 自动出报告，无人工介入（**原有行为保持不变**） |
| **Human-in-the-Loop** | 生成用例与**具体测试数据** → `pending_review` → 写盘 → 输出审核指引 → **真正退出 CLI**；<br>人工把 `status` 改为 `ready` 后再次触发即恢复执行 |

模式解析顺序：`--mode full-auto` / `--mode human-in-the-loop`（别名 `--full-auto` / `--hitl`）→
自然语言已明确 → 绑定 `execution.defaultMode` → 交互询问（**只问一次**）。详见 `rules/mode-rule.md`。

> ⚠ **执行模式 ≠ 用例状态**：模式属于本次执行上下文，禁止写入用例 Frontmatter；
> 用例状态（`pending_review`/`ready`/`running`/`completed`/`failed`）是持久化资产，见 `rules/case-store-rule.md`。

## 测试用例生命周期（**未变更**，v1.1.0 完全保持）

```
pending_review --人工审核--> ready --开始执行--> running --> completed / failed
```

- `completed ≠ PASS`：业务断言失败仍是 `completed`（Execution Result = FAIL）。
- `failed` 只用于自动化基础设施/脚本不可恢复异常（Execution Result = ERROR）。
- 磁盘上的 Case 文件是唯一事实来源；Skill 只做**最小化状态回写**，不覆盖人工修改。

## Pipeline State（v1.1.0 新增，**编排层**，与 Case Status 正交）

```
INIT → PREFLIGHT_READY → ANALYSIS_READY → CASE_READY → SCRIPT_READY
     → EXECUTING → REPORT_READY → FINALIZED
异常/挂起：BLOCKED | WAITING_FOR_HUMAN | RECOVERABLE | FAILED
```

落盘 `<cwd>/.auto-test/state/pipeline.json`。它只描述"本次编排走到哪一步"，
**不是第二套业务状态机**；与磁盘上的 Case 冲突时**永远以 Case 文件为准**。
定义见 `rules/pipeline-state-rule.md §二`。

## Resume（中断恢复）

任何阶段中断后重新运行 `/auto-test`，**只依据磁盘**恢复：
`state/pipeline.json` + `cases/`（Frontmatter）+ `analysis/` + `reports/` + `diagnostics/`。
**禁止依赖对话记忆**（"上一轮已经跑到 Script Engineer" ❌）。
`pipeline.json` 缺失或与磁盘矛盾时，一律以磁盘 Artifact 为准重建。

> ⚠ 发现 `ready` 用例时**不得直连执行**：必须先经 `script-engineer` 做
> Case↔Script 一致性检查（脚本可能不存在或已过期）；一致时该 Agent 零改动返回 `SCRIPT_READY`。

## 执行入口

统一入口：`/auto-test [--mode <full-auto|human-in-the-loop>] [路径...]`（或直接描述测试意图触发本 Skill）。
**v1.1.0 完全向后兼容，入口与参数未变。**
- 不带路径：启动后交互二选一（A 手动输入多路径 / B 用默认页面文档目录 `TEST_PAGE_DOC_DIR`）。
- 带路径（可多个）：`/auto-test docs/test-pages/订单模块/页面.md docs/test-pages/库存管理/`
- 已存在 `ready` 用例时：跳过分析与生成，经 `script-engineer` 一致性检查后恢复执行（可中断、可恢复）。

编排流程见 `prompts/orchestrator.md`，它负责：判定 Dispatch Tier → 读取并校正 Pipeline State →
解析输入来源与模式 → **调度 Sub-Agent** → 校验回执 → 处理 SUCCESS/BLOCKED/WAITING_FOR_HUMAN/FAILED →
有界 Retry → Final Check Gate。

可选一次性安装（启用 Tier A 原生 Sub-Agent，非必需）：

```bash
node <skillDir>/scripts/install-agents.mjs --check   # 先看会装什么
node <skillDir>/scripts/install-agents.mjs           # 装到 ~/.claude/agents/，重启会话生效
```

## 目录导航

| 路径 | 用途 |
|------|------|
| `agents/orchestrator.md` | **总指挥角色契约**：职责边界与越权禁令（通常由主会话承担） |
| `agents/preflight-binding.md` | 环境预检 + 项目绑定 + 幂等脚手架 Agent |
| `agents/source-analyst.md` | 源码链路分析 + 变体矩阵 + 三层断言 Agent → `analysis/*` |
| `agents/case-designer.md` | 去重/增量 Case + Test Data Matrix + HITL 挂起 Agent → `cases/*` |
| `agents/script-engineer.md` | Case→Script + 数据/变体驱动 + 一致性检查 Agent → `<frontend>/tests/*` |
| `agents/executor-reporter.md` | 真实执行 + 证据 + TRIAGE 诊断 + 报告 Agent → `reports/*` `diagnostics/*` |
| `scripts/install-agents.mjs` | 把 Agent 注册到 `.claude/agents/`（幂等，启用 Tier A；`--check`/`--project`/`--uninstall`） |
| `scripts/validate-structure.mjs` | 引擎结构自检：frontmatter / 必需章节 / 交叉引用 / 硬编码路径 / JSON 块 |
| `prompts/orchestrator.md` | **调度 Prompt**：Tier 判定 / 状态校正 / 输入契约 / 回执处理 / Final Gate |
| `rules/auto-test-agent.md` | **Orchestrator 主规范**：架构 / 四维度 / Dispatch Table / Agent 职责 / Artifact 契约 / Gate |
| `rules/pipeline-state-rule.md` | **Pipeline State / Agent Contract / Artifact 布局 / 有界 Retry / Dispatch Tier** |
| `rules/preflight-rule.md` | **运行前依赖预检**（node/npm/@playwright/test/chromium/服务/DB工具），缺失提示安装不自动装 |
| `rules/mode-rule.md` | **执行模式解析**（Full-Auto / Human-in-the-Loop）与"真正暂停"约束 |
| `rules/case-store-rule.md` | **用例资产化**：`.auto-test/cases/` 布局、Frontmatter Schema、生命周期状态机、人工修改保护、去重 |
| `rules/test-data-rule.md` | **测试数据显式化**：Test Data Matrix、Data Group、禁止伪造、参数化真正驱动 Playwright |
| `rules/binding-rule.md` | **项目绑定解析/探测/交互 + 运行时路径与分支记录 + 前端脚手架生成** |
| `rules/environment-rule.md` | 环境探测、真实渲染探测、并发安全、安全边界、数据隔离与环境恢复 |
| `rules/source-analysis-rule.md` | 源码定位顺序与三层断言（前端/API/数据库）+ 变体维度识别/矩阵 + 动态取号 |
| `rules/testcase-rule.md` | TestCase 增量维护规范（含数据变体清单 + 通用断言模式库引用） |
| `rules/script-rule.md` | 自动化脚本增量维护规范（**UI 库无关**：只引用语义角色 + 参数化变体矩阵骨架） |
| `templates/selectors/README.md` | **选择器适配器索引**：语义角色表（`TABLE_ROOT`/`COMBO_INPUT`…）与自行探测流程 |
| `templates/selectors/<库名>.md` | 各 UI 库的角色→选择器映射（可插拔，经 `ui.selectorProfile` 选用） |
| `rules/execute-rule.md` | 执行、重试、失败归因、证据收集 |
| `rules/report-rule.md` | 客户交付版报告结构、归因分类、执行证据、Token 控制、最终 Gate、Self Review |
| `templates/case.md` | **单条 Case 资产模板**（Frontmatter + Test Data Matrix），落到 `.auto-test/cases/` |
| `templates/run-report.md` | **单次执行批次报告模板**（Case→DataGroup→输入→结果 全链路追踪） |
| `templates/testcase-e2e.md` / `testcase-api.md` / `testcase-import.md` | 各类 TestCase 模板（模块汇总视图） |
| `templates/testcase-variant.md` | **多分支页面变体矩阵**用例模板 |
| `templates/assertion-patterns.md` | **通用断言模式库**（充分性精确断言 / 多步中间态断言，可增长） |
| `templates/report.md` | **客户交付版**测试报告模板（完整章节结构） |
| `templates/binding/project.template.json` | 每项目绑定模板（技术栈/相对结构/端口/DB工具/断言字段，通用示例） |
| `templates/binding/runtime.local.template.json` | 每机器运行时模板（前后端绝对路径 + 分支） |
| `templates/scaffold/` | 前端测试脚手架（support/*、playwright.config.ts、.env.test.example、README） |
| `templates/scaffold/support/caseStore.ts` | **Case 资产读写运行时**：Frontmatter 解析/最小化回写、Test Data Matrix 解析、Run 记录（也可 `node` 直接当 CLI 用） |
| `templates/scaffold/support/genCaseHtml.mjs` | **用例审查 HTML 生成器**：由 Case 资产 + RUN-*.jsonl 渲染 `docs/testcases/<module>/html/`（步骤 + 参数矩阵），零依赖纯 Node |
| `configs/project.schema.md` | 绑定配置字段说明（真实实例由首次运行生成到 `<cwd>/.claude/auto-test/`） |

## 项目规范优先

执行前必须遵循目标项目既有规范（冲突时项目规范优先）：
`CLAUDE.md`、`.claude/rules/*`、`MEMORY.md`（如存在）。例如某些项目禁止前端格式化、禁止改后端后编译等。

## 增量维护与自升级

- **测试用例是持久化资产**：`.auto-test/cases/` 中的 `pending_review` / `ready` 用例，
  磁盘内容优先于重新生成的内容；重复运行不得生成重复 Case、不得覆盖人工修改。
- 若本 Skill 已存在：**增量维护**，保留已有 Prompt/模板/配置/脚本，严禁整体覆盖或重建。
- 生成脚手架/绑定文件时**幂等**：只补缺失文件，已存在文件不覆盖（尤其 `.env.test`）。
- 新增测试框架/规则/模板/业务模块时：优先**新增独立文件**，而非膨胀 `SKILL.md` 或单个大 Prompt。
- 〔v1.1.0〕**各阶段幂等**：Preflight / Binding / Source Analysis / Case Generation /
  Script Generation / Report Generation 重复执行不得产生重复产物——
  重复分析同一 module 覆盖同名 Artifact（不生成 `AN-X-2.md`）、重复生成 Case 必须先去重
  （`rules/case-store-rule.md §六`）、已一致的脚本零改动、报告按新 `RunId` 只增不改。
- 〔v1.1.0〕改动引擎后运行 `node <skillDir>/scripts/validate-structure.mjs` 做结构自检。
