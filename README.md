# auto-test

> 面向 **Claude Code** 的企业级自动化测试**闭环编排 Skill**。
> 一次跑通：源码分析 → 维护用例 → 维护脚本 → 真实执行 → 日志/数据库断言 → 回写状态 → 生成客户交付版报告。

基于 **Playwright**（E2E + API）与数据库断言。引擎本体**零硬编码路径、零具体项目信息**，
可全局安装、打包分发；项目信息在首次运行时从工作目录自动解析/交互生成。

📖 **完整使用文档见 [USAGE.md](./USAGE.md)**

---

## 为什么用它

传统"页面能打开、接口能通"式自动化，抓不到反复反馈的一类 bug——**不报错、但期望值 ≠ 实际值**：

- 多分组交替操作后，"已处理 N 项 / 当前分组 M 项"计数错乱。
- 同一页面因隐藏判别字段取值不同渲染完全不同的列/表单/接口，其中某取值崩溃。

auto-test 把这些沉淀成**默认行为**：多分支变体矩阵全取值覆盖、每条输入做数据变体、
对数量/计数/状态类页面套用**精确断言模式库**，并输出可直接交付客户的完备报告——无需每次给提示词。

## 特性

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

## 快速上手

```bash
# 1) 安装到全局 skills 目录（或放进某仓库的 .claude/skills/）
cp -r auto-test ~/.claude/skills/

# 2) 在 Claude Code 里，进入你的项目工作目录后触发
/auto-test                              # 未指定模式时会询问一次
/auto-test --mode full-auto             # 全自动：生成 → 执行 → 报告
/auto-test --mode human-in-the-loop     # 生成用例与具体数据后挂起，等人工审核
```

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

Claude Code · Node.js + npm · `@playwright/test` · Chromium（`npx playwright install chromium`）·
被测系统依赖服务 · （可选）一个可查询业务库的工具用于数据库断言。

## 目录结构

见 [USAGE.md](./USAGE.md#目录结构)。核心：`prompts/`（编排）、`rules/`（执行规范）、
`templates/`（用例/报告/断言模式库/绑定/脚手架）、`configs/`（绑定字段说明）。

## 安全边界

禁止 DROP/TRUNCATE/无 WHERE 的 DELETE、禁改生产库/生产配置；测试数据统一 `TEST_AUTO_*` 前缀并清理；
测试账号务必用测试环境；依赖只提示安装不自动装。详见 `rules/environment-rule.md`。

## License

[MIT](./LICENSE)
