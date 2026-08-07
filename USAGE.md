# auto-test 使用文档

> 一个面向 **Claude Code** 的企业级自动化测试**闭环编排 Skill**。
> 基于 Playwright（E2E + API）与数据库断言，把「源码分析 → 维护用例 → 维护脚本 → 真实执行 →
> 日志/数据库断言 → 回写状态 → 生成客户交付版报告」做成一次可重复的完整闭环。
>
> **核心特点**：引擎本体零硬编码路径、零具体项目信息，可全局安装、打包分发；项目信息运行时从工作目录解析；
> 内置多分支变体矩阵覆盖、数据变体清单、以及通用**断言模式库**。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [环境要求](#环境要求)
- [安装](#安装)
- [快速上手](#快速上手)
- [架构：全局引擎 + 两层项目配置](#架构全局引擎--两层项目配置)
- [配置参考](#配置参考)
- [工作流程（闭环 12 步）](#工作流程闭环-12-步)
- [覆盖策略：默认追求完备](#覆盖策略默认追求完备)
- [通用断言模式库](#通用断言模式库)
- [适配到你的项目](#适配到你的项目)
- [安全边界](#安全边界)
- [目录结构](#目录结构)
- [常见问题 FAQ](#常见问题-faq)

---

## 它解决什么问题

传统"点开页面、接口能通"式的自动化，抓不到反复反馈的一类 bug——**不报错、但期望值 ≠ 实际值**：

- 多分组交替操作后，"已处理 N 项 / 当前分组 M 项"计数错乱。
- 同一页面因隐藏判别字段（如类型/分类）取值不同，渲染完全不同的列/表单/接口，其中某个取值崩溃。

auto-test 把这些沉淀为**默认行为**：多分支变体矩阵全取值覆盖、每条输入做数据变体、
对数量/计数/状态类页面套用**精确断言模式**，并输出可直接交付客户的完备报告——**无需每次给提示词**。

---

## 环境要求

| 依赖 | 说明 |
|------|------|
| **Claude Code** | 本项目是 Claude Code 的 Skill，需在 Claude Code 环境中使用 |
| **Node.js + npm** | 运行 Playwright |
| **@playwright/test** | 测试运行器（在被测前端项目里安装） |
| **Chromium** | `npx playwright install chromium` |
| 被测系统依赖服务 | 如网关 / 注册中心 / 缓存 / 数据库 / 前端 dev server（按你的项目而定） |
| 数据库断言工具（可选） | 一个可查询业务库的工具（如某个 MCP 工具）；没有则数据库断言标记为 Not Executed |

> 运行前 Skill 会自动做**依赖预检**，缺什么会给出安装命令——**只提示，不会自动安装**。

---

## 安装

auto-test 是一个"位置无关"的引擎，**放在哪都能跑**。两种方式任选：

### 方式一：全局安装（推荐，一次装好所有项目复用）

把整个 `auto-test/` 目录放到用户级 skills 目录：

- **Windows**：`C:\Users\<你>\.claude\skills\auto-test\`
- **macOS/Linux**：`~/.claude/skills/auto-test/`

```bash
git clone <this-repo> auto-test-skill
cp -r auto-test-skill/auto-test ~/.claude/skills/
```

同事拿到分享包后，解压到自己的 `~/.claude/skills/` 即可，**首次运行会自动生成本机配置**。

### 方式二：项目内安装

把 `auto-test/` 放到某个仓库的 `<repo>/.claude/skills/auto-test/`，仅该仓库可用。

> 无论哪种方式，引擎都**不含机器/分支绝对路径或具体项目信息**——项目特定信息在首次运行时生成到工作目录。

---

## 快速上手

1. 在 Claude Code 里进入你的项目工作目录。
2. 触发 Skill：

   ```
   /auto-test
   ```

   或直接描述意图 / 给出页面文档：

   ```
   /auto-test docs/test-pages/订单模块/页面.md docs/test-pages/库存管理/
   ```

3. 首次运行时 Skill 会自动：
   - **依赖预检**：检查 Node / Playwright / Chromium / 服务 / DB 工具，缺失给安装命令。
   - **项目绑定**：探测前后端项目路径；探测不到会**弹问**让你输入前后端项目绝对路径。
   - **生成配置**：在 `<cwd>/.claude/auto-test/` 生成 `project.json` + `runtime.local.json`（含当前分支）。
   - **生成脚手架**：在前端项目 `tests/` 下补齐 Playwright 基建，并提示你复制 `.env.test.example` → `.env.test`。
4. 配好 `.env.test`（地址、测试账号）后再次运行 `/auto-test`，即开始完整闭环并产出报告。

---

## 架构：全局引擎 + 两层项目配置

```
┌─────────────────────────────────────────────┐
│  全局引擎（可打包分发，零硬编码路径/项目信息）      │
│  ~/.claude/skills/auto-test/                  │
└──────────────────┬──────────────────────────┘
                   │  运行时向当前工作目录解析
                   ▼
   <cwd>/.claude/auto-test/project.json         项目画像（可提交，团队共享）
   <cwd>/.claude/auto-test/runtime.local.json   本机绝对路径 + 当前分支（gitignore）
   <frontend>/tests/…                           前端测试脚手架
```

- **全局引擎**：编排、规则、模板、脚手架生成器。不含任何绝对路径或具体项目信息。
- **项目画像 `project.json`**：技术栈、目录名、端口、命令、断言字段——相对信息，可提交给团队共享。
- **运行时 `runtime.local.json`**：前后端项目在**本机的绝对路径 + 当前分支**。随机器/分支不同而变，故 gitignore。
  - 👉 **分支自动对准**：每次运行都刷新分支字段，你在不同分支上开发前后端时，测试自动对准当前分支的代码。

---

## 配置参考

### `<frontend>/tests/.env.test`（本机运行时配置，不入库）

由 `.env.test.example` 复制而来，填你的测试环境值：

```ini
# 网关 / API 根地址
TEST_API_BASE=http://localhost:8080/api/
# 前端 dev server 地址
TEST_WEB_BASE=http://localhost:3000
# 前端 hash 路由 base
TEST_WEB_ROUTE_BASE=/#/
# 前端 storage 前缀
TEST_APP_ID=APP_CACHE
# 密码加密密钥词（如前端有加密登录）
TEST_PWD_ENC_KEY=changeme
# 测试账号（务必用测试环境账号，切勿指向生产）
TEST_USERNAME=
TEST_PASSWORD=
# 请求头
TEST_LANG=zh_CN
TEST_PLAT=backend
# auto-test 默认测试页面文档目录（选项 B 从此读取，不写死，可改）
TEST_PAGE_DOC_DIR=docs/test-pages/
```

### `<cwd>/.claude/auto-test/project.json`（项目画像，可提交）

字段完整说明见引擎内 `configs/project.schema.md`。关键项：

| 字段 | 用途 |
|------|------|
| `architecture.frontendDirName` / `backendDirName` | 前后端目录名（绝对路径在 runtime.local.json） |
| `runner.*` | 运行器与浏览器安装命令 |
| `commands.*` | `npm run test` / `test:api` / `test:e2e` / `test:report` 等 |
| `endpoints.*EnvKey` | 地址/端口对应的 env 变量名（值最终从 `.env.test` 取） |
| `sourceLocate.*` | 源码自动定位链与 glob |
| `assertLayers.database.tool` | 数据库断言工具（可空，空则 DB 断言标 Not Executed） |
| `assertLayers.database.keyFields` | 关键数量/状态字段 |
| `domain.*` | 领域默认（业务流转、导入入口等），可空 |
| `dataIsolationPrefix` | 测试数据隔离前缀（默认 `TEST_AUTO_`） |

### `<cwd>/.claude/auto-test/runtime.local.json`（本机，gitignore）

```json
{
  "frontendDir": "/path/to/your-frontend",
  "backendDir": "/path/to/your-backend",
  "frontendBranch": "main",
  "backendBranch": "main",
  "generatedAt": "2026-01-01 10:00:00+0800"
}
```

---

## 工作流程（闭环 12 步）

Skill 默认**连续执行**整条闭环，仅在缺依赖/输入/环境/权限或用户终止时暂停（BLOCKED）：

```
Step-1 依赖预检          缺 Playwright/Chromium/服务 → 给安装命令
Step0  项目绑定解析       探测/交互前后端路径 + 刷新分支 + 生成前端脚手架
Step0.5 解析测试页面来源   命令带路径直接用；未带 → 交互二选一（手输多路径 / 用 TEST_PAGE_DOC_DIR 目录）
Step1  输入完整性检查
Step2  环境探测 + 真实渲染探测 + 并发安全
Step3  源码分析：三层断言 + 变体维度识别/矩阵 + 动态取号
Step4  读取历史 TestCase
Step5  增量维护 TestCase（变体矩阵 + 数据变体 + 断言模式库）
Step6  增量维护脚本（参数化变体矩阵）
Step7  真实执行（串行 + 隔离）
Step8  收集日志/截图/数据库断言
Step9  回写用例状态（含失败归因分类）
Step10 生成客户交付版执行报告
Step11 最终 Gate + Self Review
```

**产物**：
- 用例：`docs/testcases/<module>/`（含多分支页面的变体矩阵用例）
- 脚本：`<frontend>/tests/{api,e2e}/`
- 报告：`docs/testcases/<module>/自动化测试执行报告.md`（客户交付版）

---

## 覆盖策略：默认追求完备

无需逐次提示，Skill 默认做四层覆盖：

1. **业务流转全链路**（按你的领域定义）：正向 / 逆向 / 并发 / 幂等 / 重复提交 / 超量 / 非法参数。
2. **多分支变体矩阵**（最易漏）：识别"同一页面因隐藏判别字段取值不同渲染不同内容"的页面，
   枚举判别字段**全部取值**建矩阵，每行都要真实执行结果；并做多维度**交叉验证**。
3. **数据变体**：每条输入用例做边界 / 超长 / 空 / Null / XSS / SQL / Emoji / 多语言 / 负数 / 超上限 /
   未登录 / 无效 token / 并发 / 文件异常 等，并观测 Console/Promise/JS/Network 错误、白屏、崩溃、数据一致性。
4. **通用断言模式库**（见下）。

> 两条实战护栏：① E2E 前做**真实渲染探测**（断言 `body.innerText()` 长度，避免"空容器假通过"）；
> ② 同账号 Playwright 进程**串行执行**（避免单点登录互踢被误判为缺陷）。

---

## 通用断言模式库

`templates/assertion-patterns.md` 收录"断言型缺陷"的可复用测试模式，是本 Skill 的一大亮点，**可持续增长**。

### 模式 A｜多步中间态逐步断言（防"多步操作后计数/状态错乱"）
适用：扫码接收 / 逐项汇总 / 购物车累加 / 状态徽标 / 步骤进度等随操作累积的页面。
- 把操作编码为有序步骤序列，**每一步**都断言全部相关计数/状态文本（不只终态）。
- 覆盖：分组切换、切回已处理分组、重复操作、跨分组归属、撤销/清空。

> 发现新的"断言型问题"时，按同结构往库里加一个模式即可，Skill 对匹配页面自动套用。

---

## 适配到你的项目

引擎自带一份**通用示例 profile**。适配到你的项目：

1. **首次运行让它自动生成**：`/auto-test` → 按提示输入前后端路径 → 生成 `project.json`。
2. **改 `project.json`**：把 `architecture` / `endpoints` / `commands` / `assertLayers.database.tool` /
   `domain` 等换成你项目的值。字段说明见 `configs/project.schema.md`。
3. **数据库断言工具**：把 `assertLayers.database.tool` 换成你项目可用的 DB 查询工具；没有就留空（DB 断言标 Not Executed）。
4. **登录接口/加密**：脚手架里 `support/auth.setup.ts` 与 `support/crypto.ts` 是**示例**，
   按你的后端登录接口与前端加密方式调整（明文登录可直接去掉加密）。
5. **前端非 Vue/Playwright 技术栈**：Skill 会跳过默认脚手架、改按 `environment-rule` 探测你已有的框架，并在报告说明。
6. **UI 选择器手册**：`script-rule.md` 里的选择器手册针对 Ant Design Vue + ag-Grid，用别的 UI 库时按需替换。

> 所有默认值都集中在 `templates/binding/project.template.json`，规则正文只按字段引用，方便整体替换而不散落硬编码。

---

## 安全边界

Skill 内置硬性约束（`rules/environment-rule.md`）：

- **数据库**：禁止 `DROP` / `TRUNCATE` / 无 `WHERE` 的 `DELETE` / 改生产库 / 改生产配置；写操作必须带精确 `WHERE`。
- **测试数据隔离**：统一用 `TEST_AUTO_*` 前缀，便于测试后精确清理。
- **环境恢复**：结束执行 Teardown，恢复失败在报告记 Warning。
- **不碰生产**：测试账号务必用测试环境；`.env.test` 不入库。
- **依赖安装**：只提示命令，**不自动安装**（避免擅自改 lockfile / 下载大体积浏览器）。

> 若接入了项目自身规范（`CLAUDE.md` / `.claude/rules/*`），冲突时**以项目规范为准**
> （例如某些项目禁止前端格式化、禁止改后端后编译）。

---

## 目录结构

```
auto-test/
├── SKILL.md                     # Skill 入口（触发条件 / 输入输出 / 导航）
├── README.md                    # 内部说明
├── USAGE.md                     # 本文档（面向使用者）
├── prompts/
│   └── orchestrator.md          # 编排：预检 + 绑定 + 意图分析 + 调度
├── rules/                       # 执行规范（模块化）
│   ├── auto-test-agent.md       # 主入口/索引
│   ├── preflight-rule.md        # 依赖预检
│   ├── binding-rule.md          # 项目绑定 + 运行时路径/分支 + 脚手架生成
│   ├── environment-rule.md      # 环境探测 + 真实渲染探测 + 并发安全 + 安全边界
│   ├── source-analysis-rule.md  # 源码定位 + 三层断言 + 变体矩阵 + 动态取号
│   ├── testcase-rule.md         # 用例维护 + 数据变体清单 + 断言模式库引用
│   ├── script-rule.md           # 脚本维护 + 选择器手册 + 参数化骨架
│   ├── execute-rule.md          # 执行/重试/失败归因/证据
│   └── report-rule.md           # 客户交付版报告 + Gate + Self Review
├── templates/
│   ├── testcase-*.md            # 用例模板（e2e/api/import/variant）
│   ├── assertion-patterns.md    # 通用断言模式库
│   ├── report.md                # 客户交付版报告模板
│   ├── binding/                 # 项目绑定 + 运行时模板
│   └── scaffold/                # 前端测试脚手架（support/*、config、.env.test.example）
└── configs/
    └── project.schema.md        # 绑定配置字段说明
```

---

## 常见问题 FAQ

**Q：一个测试用例会跑多少次、用多少数据？**
A：由用例的数据变体矩阵决定，是**有限枚举**（等价类 + 边界值），不是穷举。你列多少组就跑多少组。

**Q：能自动发现所有 bug 吗？**
A：不能。自动化只能验证**你事先写进断言的预期**（Oracle 问题）——它擅长**回归**（锁死已知正确的行为、防止改坏）和精确数值/状态断言，但**首次发现未知的显示错误仍依赖人工探索**。正确用法：人工发现一个，就固化成一条带精确断言的用例，让它永不复发。

**Q：没有数据库查询工具怎么办？**
A：数据库断言会标记为 Not Executed 并在报告说明，其余前端/API 断言照常。

**Q：我在不同分支开发前后端，测试会测错分支吗？**
A：不会。每次运行都会刷新 `runtime.local.json` 里的前后端当前分支，自动对准。

**Q：`.claude/auto-test/`（绑定）和 `.claude/skills/auto-test/`（引擎）有什么区别？**
A：`skills/auto-test/` 是引擎本体；`.claude/auto-test/` 是某个项目首次运行生成的绑定配置。前者可全局共享，后者随项目走（`runtime.local.json` 不入库）。

**Q：会不会误改我的业务代码？**
A：不会。Skill 只在测试目录新增/维护测试脚手架与用例；对业务源码仅做只读定位与断言，不做格式化、不擅自修改（除非你明确要求）。

---

> 本 Skill 采用编排层设计：规则、模板、配置全部外置，高内聚低耦合、自包含、位置无关可迁移、无具体项目信息。
> 欢迎按"新增独立文件、不膨胀单文件"的原则扩展新框架 / 新规则 / 新断言模式。
