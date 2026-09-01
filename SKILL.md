---
name: auto-test
version: 1.0.3
description: 企业级自动化测试闭环编排（可移植全局引擎）。当用户涉及自动化测试、测试用例、API 测试、E2E/UI 自动化、回归测试、测试报告、自动化测试修复，或提供页面集合/接口/流程/需求文档（如 docs/test-pages/**/页面.md）时使用。基于 Playwright（E2E+API）与数据库断言（项目自带的 DB 查询工具），完成"依赖预检→项目绑定解析→源码分析→维护 TestCase→维护脚本→真实执行→日志与数据库断言→回写状态→生成报告"的完整闭环。引擎本体零硬编码路径，项目信息从当前工作目录的绑定配置解析；默认追求"覆盖所有位置"的完备测试（主动识别多分支变体页面并全取值覆盖 + 每条输入做数据变体 + 充分性/中间态精确断言）并输出可直接交付客户的完备报告，无需用户逐次提示。
---

# auto-test —— 自动化测试闭环编排 Skill（全局可移植引擎）

本 Skill 是**编排层（Orchestration）**：负责路由、调度、规则引用与 Prompt 编排，
不承载具体业务逻辑。所有执行规范、模板、配置均外置于本目录，支持长期增量演进。

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

## 测试用例生命周期

```
pending_review --人工审核--> ready --开始执行--> running --> completed / failed
```

- `completed ≠ PASS`：业务断言失败仍是 `completed`（Execution Result = FAIL）。
- `failed` 只用于自动化基础设施/脚本不可恢复异常（Execution Result = ERROR）。
- 磁盘上的 Case 文件是唯一事实来源；Skill 只做**最小化状态回写**，不覆盖人工修改。

## 执行入口

统一入口：`/auto-test [--mode <full-auto|human-in-the-loop>] [路径...]`（或直接描述测试意图触发本 Skill）。
- 不带路径：启动后交互二选一（A 手动输入多路径 / B 用默认页面文档目录 `TEST_PAGE_DOC_DIR`）。
- 带路径（可多个）：`/auto-test docs/test-pages/订单模块/页面.md docs/test-pages/库存管理/`
- 已存在 `ready` 用例时：直接恢复执行，不重新生成（可中断、可恢复）。

编排流程见 `prompts/orchestrator.md`，它负责：依赖预检 → 绑定解析 → 解析输入来源 → 分析意图 →
调度对应规则 → 组织闭环执行。

## 目录导航

| 路径 | 用途 |
|------|------|
| `prompts/orchestrator.md` | 编排 Prompt：预检/绑定/意图分析与规则调度（Prompt 与规则解耦） |
| `rules/auto-test-agent.md` | 执行规范主入口（SSOT），索引全部子规范 |
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
