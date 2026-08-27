# Changelog

本项目的所有重要变更都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

版本号约定：

- **MAJOR**：破坏性变更（绑定配置格式变更、目录结构调整、规范入口改名）
- **MINOR**：新增能力（新规则文件、新模板、新覆盖姿态）
- **PATCH**：缺陷修复、文档与措辞修订

## [Unreleased]

### 新增 — FAIL 诊断纪律

- `rules/execute-rule.md §二` 从「六选一失败归因」重构为**分级诊断闭环**：
  TRIAGE → REPRODUCE → EVIDENCE → HYPOTHESIS → VERIFY → ROOT CAUSE → [FIX] → RETEST → REGRESSION。
- **TRIAGE 分流表**（8 类）：每类规定**最小充分证据**、**是否允许读源码**、**STOP 条件**。
  `INFRASTRUCTURE_BUG` / `ENVIRONMENT_BUG` / `FLAKY` / `TEST_DATA_BUG` / `UNKNOWN` 默认禁止进入源码定位链，
  避免简单失败触发完整的「前端→Router→API→Controller→Service→Mapper→XML→DB」八层检索。
- **Evidence Gate**：没有该类要求的证据就不许写该类结论；证据不足时唯一合法结论是 `UNKNOWN` + 下一步所需证据。
- **可证伪假设**：第 5/6/7 类需 2–4 个假设，每个必须写出证伪条件；"可能是前端/后端/数据"不算假设。
- **Diagnostic Budget**：每次扩大 Context 需回答五问；新增信息不能区分假设则立即 STOP。
- `PRODUCT_BUG` 增加两条护栏（源自真实误判回放）：②脚本口径须含请求体必填字段与前端真实交互路径一致；
  ⑤须排除"仅自动化环境可复现"，缺 ⑤ 归 `UNKNOWN` 并标「疑似自动化环境专属」，不得报为产品缺陷。
- 诊断探针统一命名 `_diag-<caseId>.ignore.ts`（不匹配 `testMatch`，天然不入正式套件），按 glob 一次清理。
- **PASS 路径不变**：PASS 不进入诊断，不产生额外根因分析成本；Full-Auto 未新增任何人工确认点；
  默认仍为「仅定位与记录，不改业务代码」。

### 新增 — 证据准入（Context Admission）

- `rules/execute-rule.md §三点一`：原始证据完整落盘、可追溯，但**禁止整份进入 LLM**。
  `index.html` 永不入 LLM；`results.json` 必须先经**投影命令**（复用已配置的 json reporter，零新增依赖）
  提取 `unexpected` / `flaky` 子集与前 8 行错误后再入 LLM；trace/截图只入相对路径。

### 变更

- **FLAKY 语义化**：`retries: 1` 的 retry-转-PASS 不再静默当稳定 PASS ——
  Execution Result 记 `PASS`、Failure Type 记 `FLAKY`，进 TRIAGE 并在报告单独列出（`execute-rule §一点五`、`report-rule §二点五`）。
- **报告证据来源双轨化**（`report-rule §零`）：A 轨（已接入 case-store）用 `RUN-*.jsonl`；
  B 轨（未接入）用投影输出 + spec 结构化日志，"实际输入数据"如实标 `N/A（未接入 case-store）`，
  Final Gate 相应标注降级，不得伪装成已满足。消除了「规则要求聚合 `RUN-*.jsonl`，而未接入项目根本不存在该文件」的矛盾。
- **Final Check Gate 去重**：唯一事实来源改为 `report-rule §五`（19 条）；
  `auto-test-agent §Gate` 只保留 5 条前置/资产类条目并指向前者，消除两份清单各自漂移。
- **`TEST_PAGE_DOC_DIR` 默认值统一**为 `docs/test-pages/`（此前 `binding-rule` 两处写作 `docs/测试/`，与
  SKILL / orchestrator / 脚手架 example 不一致）。

### 未采纳（有意拒绝，避免过度设计）

- Cache、独立 filter CLI、Subagent 拆诊断、新增 Case 状态/Frontmatter 字段、Progressive Disclosure 重建：
  均无可观测的真实浪费证据，或复杂度高于收益。
- **Model Routing：不实施** —— Skill 层无阶段级模型选择原语，无法实证 Total Cost 下降，且无 Fallback 设计。
- Case Store 迁移（安装 `caseStore.ts` + 改造既有 spec 为数据驱动）：收益真实但改动大、触碰在役测试脚本，**延期**。

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
