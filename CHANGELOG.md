# Changelog

本项目的所有重要变更都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

版本号约定：

- **MAJOR**：破坏性变更（绑定配置格式变更、目录结构调整、规范入口改名）
- **MINOR**：新增能力（新规则文件、新模板、新覆盖姿态）
- **PATCH**：缺陷修复、文档与措辞修订

## [Unreleased]

## [1.0.3] - 2026-09-01

用例审查视图与文档产物落盘基准修复。解决两个来自实际评审的反馈：
① 报告只给汇总统计，看不到每条用例**用了哪些参数、执行了哪些步骤**；
② 客户交付版报告被写进了前端项目目录，而非仓库根 `docs/testcases/`。

### 新增 — 用例审查 HTML 视图（`genCaseHtml.mjs`）

- 新增 `templates/scaffold/support/genCaseHtml.mjs`：**零依赖纯 Node ESM** 生成器，
  由用例资产 `.auto-test/cases/TC-*.md`（SSOT）+ `.auto-test/reports/RUN-*.jsonl`
  渲染出 `<cwd>/docs/testcases/<module>/html/`：
  - `index.html`：模块汇总表（Case ID / 标题 / 类型 / 状态 / **步骤数** / **数据组数** /
    最近结果 / 测试脚本）+ 统计卡 + 前端搜索与结果筛选。
  - `TC-<MODULE>-<NNN>.html`：单条用例的测试目标 / 前置条件 / **完整测试步骤** /
    **参数矩阵（数据组 × 字段 × 具体输入 × 数据类型 × 数据特征 × 预期）** / 断言 / 本轮执行结果。
- **不要求项目已安装 `caseStore.ts`**：脚本自带 Frontmatter / 章节 / Test Data Matrix 解析
  （列语义识别与 `caseStore.ts` 的 `parseDataMatrix` 对齐），B 轨项目同样可用。
- 自动判定证据来源轨并在页面显式标注：A 轨读 `RUN-*.jsonl` 逐数据组实录；
  B 轨（无 jsonl）回退 Frontmatter `last_run_*`，页面写明"无逐数据组实际输入"，
  **不得**手工改写成 A 轨措辞（对齐 `rules/report-rule.md §零`）。
- 输出目录从脚本位置**上溯定位 `.auto-test/`** 求得仓库根，故从前端目录调用也能正确落盘。
- 支持 `--module` / `--run` / `--out` / `--cases` / `--quiet`。
- `rules/report-rule.md` 新增 **§一点五**：该视图为每轮**必产出**；禁止手写 HTML
  （手写会与用例资产脱节）；非 Node 项目须标 Not Executed + 原因。

### 修复 — 文档产物落盘基准歧义（报告被写进前端项目）

- 根因：`project.json` 的 `testcaseDir` / `reportFile` 是相对路径却未声明基准，
  而同文件 `commands.cwdKey: "frontend"` 把执行方引向了前端项目根。
- `rules/binding-rule.md §一` 新增 **路径基准表**，逐字段明确 `<cwd>`（仓库根）与 `<frontend>` 两类基准，
  并强调 **`commands.cwdKey` 只决定执行测试命令的目录，不改变文档产物落盘位置**。
- `configs/project.schema.md` 新增「路径基准（易错点）」小节；
  `rules/report-rule.md §一` 输出清单路径统一加 `<cwd>/` 前缀 + ⚠ 落盘自查项。
- 新增绑定字段 `htmlDir`（默认 `docs/testcases/<module>/html/`）与 `moduleDirAlias`
  （Case 的 `module` 与既有目录名不一致时登记映射，使 HTML 视图与模块报告同目录）。

### 变更 — 报告必须呈现测试步骤

- `templates/report.md` §四表格新增「**测试步骤（简写）**」列，并新增
  **§4.0 用例明细索引**（链接 `html/index.html` 与各用例单页）；§九 输出清单加 HTML 产物。
- `rules/report-rule.md` §二第 4 条：「测试步骤」列**不得省略、不得写"见用例"**，
  至少给出编号化关键动作简写。
- Final Gate 与 Self Review 各新增 3 条勾选：HTML 视图已生成 / 每条用例有测试步骤 /
  所有文档产物落在仓库根（路径不含前端目录名）。

### 变更 — 选择器手册降级为可插拔适配器（引擎去 UI 库耦合）

- `rules/script-rule.md` 原内嵌 **Ant Design Vue + ag-Grid 选择器手册**，使引擎隐含特定 UI 库假设。
  现拆分为：
  - 主规则新增 **§零**：只引用**语义角色**（`APP_ROOT` / `TABLE_ROOT` / `TABLE_HEADER_CELL` /
    `TABLE_ROW` / `COMBO_INPUT` / `PLAIN_INPUT` / `FORM_ITEM_LABEL` / `MESSAGE_TOAST` / `FORM_ERROR`），
    所有骨架里的选择器改为 `<角色>` 占位符。
  - 新增 `templates/selectors/README.md`：角色定义表、适配器索引、**没有现成适配器时的自行探测流程**、
    编写适配器的强制要求（每行必须实测、必须写「常见错误」列）。
  - 新增 `templates/selectors/antd-vue-aggrid.md`：原手册内容迁入，含下拉查询动作序列与列集合断言。
- 新增绑定字段 `ui.selectorProfile` 选用适配器；留空则现场探测并沉淀为新适配器文件。
- `architecture.frontendStack` 的示例值改为占位符，不再预设具体前端栈。
- 换 UI 库 = 换一个适配器文件，主规则一行不动。

### 变更 — 脚手架

- `rules/binding-rule.md §四` 幂等生成 `tests/support/genCaseHtml.mjs`（已存在不覆盖），
  并**仅当缺失时**向 `package.json` 追加 `"test:cases-html"` 一行（不重排、不格式化其余内容）。

## [1.0.2] - 2026-08-31

Repeat Run 与执行统计成本优化。**未新建 Skill、未新增文件、未改测试用例格式、未改覆盖策略与测试语义**；
`rules/execute-rule.md §二`（FAIL 诊断闭环）逐字未变。改动集中在 5 个既有文件：
`rules/case-store-rule.md`、`rules/execute-rule.md`、`rules/mode-rule.md`、
`prompts/orchestrator.md`、`rules/auto-test-agent.md`。

### 新增 — Cheap Reuse Gate（Repeat Run 复用判定）

- `rules/case-store-rule.md §九`：同一模块第二次触发、且已有 `completed`/`failed` Case 时，
  廉价判定是否可直接复用已完成的分析与生成工作，避免重新走一遍 Step3 八层源码分析 + Step4/Step5 生成。
- 判定只允许读取 Case Frontmatter 既有字段（`module`/`route`/`script`/`updated_at`）+ 逐仓库
  `git log --since` / `git status --porcelain` + 文件 `stat`（mtime），不读文件内容，不新增
  Frontmatter 字段，不建立 Cache/指纹库/新持久化产物。
- 未跟踪（`??`）文件按 mtime 与 Case `updated_at` 比较判定是否为"上轮执行产物本身"，避免把
  auto-test 自己生成、尚未提交的脚本误判为"发生了变化"（否则复用永远不会生效）。
- 三档判定：`NO CHANGE`（REUSE，跳过 Step3/4/5 直接执行）／`IMPACTED`（仅对受影响 Case/Script
  局部重分析）／`MAJOR STRUCTURAL`（回退全量分析，唯一允许全量的路径）。
- 复用时正文与测试数据零改动，只回写既有 4 个 Frontmatter 字段（`status`/`updated_at`/
  `last_run_id`/`last_run_status`）；不无理由重写脚本；覆盖能力（数据组数量/断言/变体矩阵/
  串行隔离）不变。
- `prompts/orchestrator.md`、`rules/mode-rule.md`、`rules/auto-test-agent.md` 同步补充
  Repeat Run 路由，First Run（无历史 Case）路径不受影响。

### 新增 — 分批执行结果投影落盘（Mechanical Statistics）

- `rules/execute-rule.md §三`：`results.json` 由每次 `npx playwright test` 整体重写，分批执行
  （如 `--project=api` 与 `--project=e2e` 分开跑）时最后一批会覆盖之前批次，此前只能靠人工
  逐条清点补齐总数。
- 现在：每批执行结束后立即运行已有投影命令，将该批结果**追加**到本轮
  `<reportDir>/<RunId>.jsonl`（该文件在 `case-store-rule.md §一` 中已定义，非新增产物），
  报告阶段的 PASS/FAIL/FLAKY/skipped/duration 统计一律从该 `.jsonl` 聚合求和，禁止为统计
  重新读取 `results.json`/`index.html`/完整终端输出，禁止由 LLM 手工清点。
- 不改变证据轨定级：未接入 `caseStore.ts` 的项目依然是 B 轨，不因新增 `.jsonl` 聚合而自称 A 轨。

### 真实项目验证（Repeat Run）

- 在真实业务项目某导出模块上真实触发第二次 `/auto-test`：Gate 判定 `NO CHANGE → REUSE`，
  Step3 源码分析与 Case/脚本生成均被真实跳过（有执行痕迹，非仅按 Prompt 推断）。
- 12 个既有 Case 全部复用（新增 0，正文改动 0，覆盖 0）；7 个既有 Playwright 脚本全部复用
  （新增 0，重写 0）。
- 50 个数据组全部真实执行（Playwright + 真实渲染探测 + API/DB 验证，串行隔离），结果与
  First Run 完全一致：49 PASS / 1 FAIL / 0 FLAKY / 0 skipped；唯一 FAIL 为已知问题的
  同一根因复现。

### 未采纳（有意拒绝，避免过度设计）

- Model Routing、Cache Framework、Subagent、新 CLI、新 State Machine、新 Frontmatter
  Schema、Case JSON 化、Playwright 并行执行：均未实施，判定复杂度高于当前可观测收益。

## [1.0.1] - 2026-08-27

在既有 FAIL 路径上增强诊断纪律与证据准入。**未新建 Skill、未新增文件、未改测试用例格式、
未改覆盖策略与测试语义**；改动集中在 4 个既有 rules 文件。

### 新增 — FAIL 诊断纪律

- `rules/execute-rule.md §二` 从「六选一失败归因」重构为**分级诊断闭环**：
  TRIAGE → REPRODUCE → EVIDENCE → HYPOTHESIS → VERIFY → ROOT CAUSE → [FIX] → RETEST → REGRESSION。
- **TRIAGE 分流表**（8 类）：每类规定**最小充分证据**、**是否允许读源码**、**STOP 条件**。
  `INFRASTRUCTURE_BUG` / `ENVIRONMENT_BUG` / `FLAKY` / `TEST_DATA_BUG` / `UNKNOWN` 默认禁止进入源码定位链，
  避免简单失败触发完整的「前端→Router→API→Controller→Service→Mapper→XML→DB」八层检索。
- **Evidence Gate**：没有该类要求的证据就不许写该类结论；证据不足时唯一合法结论是 `UNKNOWN` + 下一步所需证据。
- **第 4 行与第 5/6 行的依赖**：判定 `TEST_DATA_BUG` 必须先做接口核实；核实结果为「数据存在且状态符合」
  则该行未命中，且该结果即作为第 5/6 行「接口层数据正确」的证据。未核实不得进入第 5/6 行，
  也不得下 `TEST_DATA_BUG`。
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
- json 路径取 `playwright.config.ts` 中 reporter 配置的 `outputFile`（默认 `playwright-report/results.json`）。
  文件不存在或解析失败时记 `UNKNOWN` 或 `INFRASTRUCTURE_BUG` 并写明缺失路径，
  **不得**改读 `index.html`、完整终端输出或整份 json。

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

[Unreleased]: https://github.com/Jrencat/auto-test/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/Jrencat/auto-test/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Jrencat/auto-test/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Jrencat/auto-test/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Jrencat/auto-test/releases/tag/v1.0.0
