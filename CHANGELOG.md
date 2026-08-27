# Changelog

本项目的所有重要变更都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

版本号约定：

- **MAJOR**：破坏性变更（绑定配置格式变更、目录结构调整、规范入口改名）
- **MINOR**：新增能力（新规则文件、新模板、新覆盖姿态）
- **PATCH**：缺陷修复、文档与措辞修订

## [Unreleased]

## [1.0.0] - 2026-08-27

首个正式发布版本。auto-test 是面向 Claude Code 的自动化测试闭环编排引擎，
基于 Playwright（E2E + API）与项目自带数据库查询工具，完成
「依赖预检 → 项目绑定解析 → 源码分析 → 维护 TestCase → 维护脚本 → 真实执行 →
日志与数据库断言 → 回写状态 → 生成报告」的完整闭环。

### 新增 — 全局可移植引擎

- 引擎本体零硬编码路径、零项目信息，可安装到 `~/.claude/skills/auto-test/` 或打包分发解压即用。
- 三层配置分离：引擎（本目录）／项目绑定 `<cwd>/.claude/auto-test/project.json`（可提交）／
  本机运行时 `<cwd>/.claude/auto-test/runtime.local.json`（gitignore，前后端绝对路径 + 当前分支）。
- 首次在某文件夹运行时自动探测项目绑定，探测不到则交互询问前后端路径（`rules/binding-rule.md`）。
- 依赖预检（`rules/preflight-rule.md`）与前端脚手架幂等生成（`<frontend>/tests/`）。
- 分支自动对准：运行时配置感知当前分支，避免跨分支误测。

### 新增 — 用例资产化

- `<cwd>/.auto-test/cases/TC-*.md` 一个 Case 一个文件，磁盘为唯一事实来源（SSOT）。
- YAML Frontmatter + 生命周期状态机：`pending_review` / `ready` / `running` /
  `completed` / `failed`，最小化状态回写，生成前强制去重（`rules/case-store-rule.md`）。
- `templates/scaffold/support/caseStore.ts`：Frontmatter 最小化回写 + Matrix 解析 +
  状态机校验 + 逐数据组执行记录，可直接作为 CLI 使用。

### 新增 — 双执行模式

- Full-Auto：全自动闭环执行。
- Human-in-the-Loop：生成 `pending_review` 用例后真正挂起退出，禁止「一键跳过人工审核」。
- 三维度严格分离：Execution Mode（本次上下文）／Case Status（持久化资产）／
  Execution Result（PASS/FAIL/ERROR/BLOCKED）；`completed != PASS`，
  业务断言失败与自动化异常严格区分（`rules/mode-rule.md`）。

### 新增 — 测试数据驱动

- Test Data Matrix 必须写具体真实值，禁止 `TODO` / `REQUIRED_INPUT` 占位伪造业务数据。
- 同一数据组多行合并为一次参数化输入，数据组真正驱动 Playwright 参数化执行（`rules/test-data-rule.md`）。
- 每条可输入用例按数据变体检查清单设计多组数据：边界／超长／空／XSS／SQL／Emoji／
  多语言／负数／未登录等（`rules/testcase-rule.md §8`）。

### 新增 — 完备覆盖姿态（默认开启，无需逐次提示）

- 主动识别「同一页面因隐藏判别字段渲染不同内容」的多分支页面，枚举判别字段全部取值、
  构建变体矩阵，并让矩阵每一行都有真实执行结果（`rules/source-analysis-rule.md §1.5`）。
- 通用断言模式库（`templates/assertion-patterns.md`）：数量充足性精确断言 +
  多步中间态逐步断言，覆盖「库存充足误报」「多步计数错乱」等高频误判场景。
- 动态取号与真实渲染探测，避免硬编码测试数据导致的假阳性。

### 新增 — 报告与用例解耦

- 每次执行独立生成 `<cwd>/.auto-test/reports/RUN-YYYYMMDD-HHMMSS.md`
  （+ 同名 `.jsonl` 机器记录），历史报告只增不改（`rules/report-rule.md`）。
- Case 仅保留 `last_run_id` / `last_run_status` 摘要。
- 客户交付版报告：`docs/testcases/<module>/自动化测试执行报告.md`。

### 新增 — 输入来源解析

- 命令带路径时直接使用（支持多个文件／目录／glob）。
- 未带路径时交互二选一：手动输入多个文件路径，或使用默认页面文档目录
  `TEST_PAGE_DOC_DIR`（默认 `docs/test-pages/`，从 `.env.test` 解析，不写死）。

### 文档

- `README.md` / `USAGE.md` / `configs/project.schema.md` / `LICENSE`（MIT）/ `.gitignore`。

[Unreleased]: https://github.com/Jrencat/auto-test/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Jrencat/auto-test/releases/tag/v1.0.0
