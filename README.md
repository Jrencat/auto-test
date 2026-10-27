# auto-test

> 面向 **Agent Skills 宿主**的企业级自动化测试**闭环编排 Skill**；各宿主验证状态见下方安装说明。
> 一次跑通：源码分析 → 维护用例 → 维护脚本 → 真实执行 → 日志/数据库断言 → 回写状态 → 生成客户交付版报告。

基于 **Playwright**（E2E + API）与数据库断言。引擎本体**零硬编码路径、零具体项目信息**，
可全局安装、打包分发；项目信息在首次运行时从工作目录自动解析/交互生成。

📖 **完整使用文档见 [USAGE.md](./USAGE.md)** ｜ 📋 **版本变更见 [CHANGELOG.md](./CHANGELOG.md)**

---

## 为什么用它

传统"页面能打开、接口能通"式自动化，抓不到反复反馈的一类 bug——**不报错、但期望值 ≠ 实际值**：

- 多分组交替操作后，"已处理 N 项 / 当前分组 M 项"计数错乱。
- 同一页面因隐藏判别字段取值不同渲染完全不同的列/表单/接口，其中某取值崩溃。

auto-test 把这些沉淀成**默认行为**：多分支变体矩阵全取值覆盖、每条输入做数据变体、
对数量/计数/状态类页面套用**精确断言模式库**，并输出可直接交付客户的完备报告——无需每次给提示词。

## 特性

- 🤖 **Multi-Agent 架构**（v1.1.0）：Orchestrator 只负责调度、状态与验收，
  5 个专职 Sub-Agent（Preflight&Binding / Source Analyst / Case Designer / Script Engineer /
  Executor&Reporter）**各自在独立上下文中只加载自己的规则**，通过磁盘 Artifact 通信。
- 💾 **状态持久化 + Resume**（v1.1.0）：Pipeline State 落盘 `.auto-test/state/`，
  中断后重新触发**只依据磁盘恢复**，不依赖对话记忆。
- 🔬 **FAIL 诊断闭环**（v1.1.0）：失败时证据 + TRIAGE 分类 + 假设 + **恢复入口**
  落盘 `.auto-test/diagnostics/DIAG-*.json`，可被下一轮消费。
- 🔌 **位置无关引擎**：全局安装或项目内均可，解压即用。
- 🧭 **三层配置**：全局引擎 + 可提交的项目画像 + gitignore 的本机运行时（含**分支自动对准**）。
- ✅ **依赖预检**：node / Playwright / Chromium / 服务 / DB 工具，缺失只提示不自动装。
- 🧩 **自动绑定**：首次运行探测前后端路径，探测不到则交互询问；幂等生成前端测试脚手架。
- 🎯 **完备覆盖**：多分支变体矩阵 + 数据变体清单 + 动态取号 + 真实渲染探测 + 串行隔离执行。
- 🧪 **通用断言模式库**：数量充足性精确断言、多步中间态逐步断言（可持续增长）。
- 🕹 **双执行模式**：Full-Auto 全自动闭环；Human-in-the-Loop 生成后**真正挂起**等人工审核。
- 🗂 **用例资产化**：`.auto-test/cases/` 一个 Case 一个文件（Frontmatter + 生命周期状态机），
  可中断、可恢复、可追踪；磁盘上的人工修改优先，重复运行不生成重复用例。
- 🧾 **测试数据显式化**：Test Data Matrix 写具体真实值（禁止"输入合法用户名"式抽象、禁止编造业务数据），
  数据组**真正驱动** Playwright 参数化执行。
- 📄 **报告与用例解耦**：每次执行一份 `.auto-test/reports/RUN-YYYYMMDD-HHMMSS.md`，
  历史报告只增不改；客户交付版报告含 Executive Summary / Coverage / Detailed Results / Edge Case / Defects & Risk / Conclusion。

## Harness Core 与 CLI（2.0 Phase 1）

Agent 决定「怎么测试」，Harness 决定「什么才算真的测试过」。正式 CLI 名称：**`auto-test`**。

```bash
auto-test case ready TC-X-001     # 新 Case 无 Assertion → 拒绝，退出码 1
auto-test verify   <runId>        # 0 可信充分 ｜ 1 不充分 ｜ 2 INVALID
auto-test finalize <runId>        # 0 FINALIZED_PASS ｜ 1 其它终局 ｜ 2 INVALID
auto-test resume   <runId>        # Run 级恢复，run_id 不变
```

终局 6 态：`FINALIZED_PASS` / `FINALIZED_FAIL` / `FLAKY` / `BLOCKED` / `INCONCLUSIVE` / `INVALID`。
Agent 无法绕过 Harness 直接宣布 `FINALIZED_PASS`——谎报、证据篡改、断言未求值
都会被 `verify` / `finalize` 机械拦下并返回非零退出码。

零依赖示例：`node examples/run-specs.mjs`（三个代表 Spec，分别产出 PASS / FAIL / FLAKY）。

## 快速上手

无需先克隆仓库。准备 **Node.js >=22.20 和 Git**，在业务仓库打开终端：

```powershell
npx.cmd skills@1.7.4 add Jrencat/auto-test --skill auto-test --agent codex --copy
```

这是 Windows PowerShell 可直接使用的命令；macOS/Linux 使用 `npx`。
Claude Code 将 `codex` 替换成 `claude-code`；追加 `--global` 安装到个人范围。
默认项目安装位置：Codex 为 `.agents/skills/auto-test/`，Claude 为
`.claude/skills/auto-test/`；个人范围对应 `~/.agents/skills/auto-test/` 和
`~/.claude/skills/auto-test/`（自定义宿主配置可能改变路径）。

### 更新与卸载

在同一业务仓库、用同一管理器操作；个人安装在下列命令中追加 `--global`。
先将手动修改及额外文件备份到安装目录外，检查目标和覆盖提示后再确认：

```powershell
npx.cmd skills@1.7.4 check
npx.cmd skills@1.7.4 update auto-test
npx.cmd skills@1.7.4 remove auto-test
```

标准 CLI 管理下载、锁记录和替换/移除；其锁文件不提供本地修改保护或回滚保证。
卸载按 Skill 名称移除当前作用域的共享安装；不要仅指定 `--agent codex`，该 CLI
版本在实测中可能保留共享目录。其他宿主若共用该目录，也会失去这个 Skill。
不要混用标准 CLI 与本项目离线安装器。需要保护式更新、Node 18/20 或手动审阅时，
使用 [INSTALL.md 的压缩包与离线安装流程](INSTALL.md#reviewed-archive-and-protected-offline-installation)。
明确分支、标签和完整 commit SHA 的安装方式也见该文档。

### 安装后调用

安装不会初始化业务项目。重开 Agent 会话，在业务仓库中使用 Codex `$auto-test`
或 Claude Code `/auto-test`。缺少独立子 Agent 时可按宿主适配规则使用明确标记的
Tier C 串行角色模式；上下文隔离受限，真实执行、证据及 Harness 验收要求不变。
首次初始化仍由已有 preflight/binding 流程独立完成。

Windows 已验证 Codex 目录的真实网络安装，以及实际 Codex 会话发现 Skill 并调用
Harness CLI；完整业务测试流程尚未验证。
Claude 的离线路径/复制有测试，实际宿主会话仍为 **UNVERIFIED**。Gemini CLI、Cursor、
Copilot、OpenCode、Windsurf、Cline、Roo 的标准安装目标已核对，但本项目宿主调用
均为 **UNVERIFIED**，不能据此宣称全部兼容。详见 [路径与状态表](INSTALL.md#agents-locations-and-verification)
和 [验证记录](docs/installation-validation.md)。

```text
/auto-test                              # 未指定模式时会询问一次
/auto-test --mode full-auto             # 全自动：生成 → 执行 → 报告
/auto-test --mode human-in-the-loop     # 生成用例与具体数据后挂起，等人工审核
```

以上为 Claude 调用示例；Codex 使用 `$auto-test`，其他宿主通过其 Skill 选择器加载。
PowerShell 若阻止 `npx.ps1`，用 `npx.cmd` 即可，无需管理员权限或修改执行策略。
网络错误、Skill 未显示、已有目录冲突的处理见 [常见问题](INSTALL.md#troubleshooting)。

Human-in-the-Loop 的两段式节奏：

```
第 1 次运行 → 生成 .auto-test/cases/TC-*.md（status: pending_review）→ 输出审核指引 → 退出
人工审核    → 检查测试逻辑与「测试数据明细」→ 把 status 改成 ready
第 2 次运行 → 检测到 ready → 确认后执行 → 回写状态 → 生成 RUN-*.md 批次报告
```

首次运行会：依赖预检 → 探测/询问前后端路径 → 生成 `<cwd>/.claude/auto-test/` 绑定 →
在前端 `tests/` 生成脚手架 → 提示复制 `.env.test.example` → `.env.test` 填地址与测试账号。
配好后再次运行 `/auto-test` 即开始完整闭环。

## 架构

```
全局引擎（可打包分发，零硬编码路径/项目信息）
  ~/.claude/skills/auto-test/
        │  运行时向当前工作目录解析
        ▼
每项目绑定  <cwd>/.claude/auto-test/project.json        （可提交，项目画像）
每机器运行时 <cwd>/.claude/auto-test/runtime.local.json  （gitignore，绝对路径+分支）
测试资产    <cwd>/.auto-test/cases/                     （用例 SSOT，建议入库）
执行报告    <cwd>/.auto-test/reports/RUN-*.md|.jsonl     （一次执行一份，只增不改）
前端脚手架  <frontend>/tests/{support,playwright.config.ts,.env.test.example}
```

## 用例生命周期

```
pending_review --人工审核--> ready --开始执行--> running --> completed / failed
```

`completed ≠ PASS`：业务断言失败仍是 `completed`（执行结果 FAIL / Assertion Failure）；
`failed` 只用于自动化本身的不可恢复异常（执行结果 ERROR / Automation Error）。
执行模式（Full-Auto / HITL）属于本次运行上下文，**不写入用例**，与用例状态严格分离。

## 适配到你的项目

引擎自带一份通用示例 profile。改 `<cwd>/.claude/auto-test/project.json` 的技术栈/端口/命令/
数据库工具/领域字段即可；脚手架里的登录接口与加密为示例，按你的后端调整。详见 [USAGE.md](./USAGE.md#适配到你的项目)
与 `configs/project.schema.md`。

## 环境要求

Claude Code 或具备独立子 Agent 工具的 Codex CLI · Node.js >=18 + npm · `@playwright/test` · Chromium（`npx playwright install chromium`）·
被测系统依赖服务 · （可选）一个可查询业务库的工具用于数据库断言。

## 目录结构

见 [USAGE.md](./USAGE.md#目录结构)。核心：`prompts/`（编排）、`rules/`（执行规范）、
`templates/`（用例/报告/断言模式库/绑定/脚手架）、`configs/`（绑定字段说明）。

## 安全边界

禁止 DROP/TRUNCATE/无 WHERE 的 DELETE、禁改生产库/生产配置；测试数据统一 `TEST_AUTO_*` 前缀并清理；
测试账号务必用测试环境；依赖只提示安装不自动装。详见 `rules/environment-rule.md`。

## License

[MIT](./LICENSE)
