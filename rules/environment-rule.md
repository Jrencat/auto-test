# environment-rule —— 环境探测、安全边界、数据隔离与环境恢复

对应主流程 Step2，以及贯穿全程的安全约束。

> 路径来源：`<frontend>`/`<backend>` 与地址端口来自 `<cwd>/.claude/auto-test/{project.json,runtime.local.json}`
> + `<frontend>/tests/.env.test`。下文取值均为通用示例。

## 一、环境与框架自动探测（Step2）

扫描以下文件判断技术栈与已有测试框架：
`package.json`、`pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`pom.xml`、
`build.gradle`、`pytest.ini`、`go.mod`。

**优先复用已有框架**（Playwright / Cypress / Pytest / JUnit / TestNG / Newman）。
若无框架，按技术栈选官方推荐且最轻量方案。

### 运行器结论（默认）

- 统一运行器：**Playwright**（E2E UI + API），配置见 `<frontend>/playwright.config.ts`。
- 数据库断言：项目自带的 DB 查询工具（如某个 MCP 工具）。
- 详细路径、命令、地址见绑定 `project.json` + `runtime.local.json` + `.env.test`。

### 依赖服务可用性检查（缺失 → BLOCKED；基础依赖预检见 rules/preflight-rule.md）

- 网关 / API 服务（地址见 `.env.test` 的 `TEST_API_BASE`）
- 注册中心 / 配置中心（如有）、缓存、数据库、目标服务
- 跑 E2E 需前端 dev server（`cd <frontend> && npm run dev`，地址见 `TEST_WEB_BASE`）
- 测试账号：`<frontend>/tests/.env.test` 的 `TEST_USERNAME` / `TEST_PASSWORD`
- 浏览器二进制：`npx playwright install chromium`

### 🔴 E2E 前必做：真实渲染探测（Content Smoke Check，强制，不可跳过）

**背景（真实教训）**：曾发生前端应用因运行时配置拉取 404 而**全站白屏**，但既有页面加载用例仅断言
根容器可见 + 无"系统异常"文案——这类断言对**空容器天然成立**，导致白屏持续多轮未被发现，
直到新增了内容级校验（`body.innerText()` 长度）才暴露。**端口/进程"能访问"不等于"渲染了真实内容"。**

**强制执行**（每次 Step2 环境探测的一部分，任何 E2E 用例编写/执行前）：
1. `gotoRoute('')`（站点根路由）或任一目标路由，等待 `networkidle`。
2. 断言 `await page.locator('body').innerText()` 长度显著大于 0（而非仅判断某容器 `toBeVisible()`）。
3. 若长度为 0 或异常短：
   - 检查浏览器 `console`（404/其他资源错误）与 `pageerror`（未捕获异常）；
   - 检查 `network` 中的 404/5xx 响应，尤其是应用引导阶段的运行时配置文件（如 `config.json`）；
   - **常见陷阱**：若前端构建的 `base` 为 `'./'`（未使用 publicPath），`npm run dev` 下应用实际以**站点根路径**
     提供服务；若测试配置 `tests/.env.test` 的 `TEST_WEB_ROUTE_BASE` 被设为非根路径（如 `/sub-path/#/`），
     会导致引导阶段相对路径资源（如 `./config.json`）请求 404、应用无法挂载（复现于**任意路由**）。
     **排查/确认方法**：直接探测 `{webBaseURL}/config.json`（应 200）与
     `{webBaseURL}{当前route前缀}/config.json`（若非 200 则确认是该问题）；
     **修复方法**：修正 `tests/.env.test`/`.env.test.example`/`tests/support/env.ts` 中
     `TEST_WEB_ROUTE_BASE`/`webRouteBase` 默认值为 `/#/`，**仅改测试配置，不改应用源码**（除非用户明确要求修复应用本身）。
4. 该探测通过后，才可信任后续所有 E2E 用例的"页面已渲染"前提；否则先修复环境问题，
   并在报告中将其列为 **Blocker 级发现**（可能影响全部 E2E 用例的有效性）。

### ⚠️ 并发执行安全（强制，防止误判为产品/环境缺陷）

**背景（真实教训）**：并行运行两个 `npx playwright test` / `npm run test` 进程（各自的
`[setup]` 项目都会重新 API 登录同一测试账号）可能触发后端单点登录互踢（"账号已在其他设备登录"），
导致另一进程后续所有请求鉴权失效、页面白屏——**极易被误判为产品缺陷或环境缺陷**。

**强制规则**：
- 同一测试账号（`TEST_USERNAME`）**同一时间只允许一个 Playwright 进程在运行**；
  Step7 执行阶段所有 `npx playwright test` / `npm run test` 调用必须**串行**，不得并行 `run_in_background`
  后同时存在多个未结束的 playwright 调用。
- 若某批用例失败且失败原因涉及"未登录/账号已在其他设备登录/页面空白"，**先确认当时是否有其他
  playwright 进程同时在跑**，在**完全隔离**状态下重跑一次，才能作为最终判定依据；
  隔离重跑结果与首次不一致时，以隔离重跑为准并在报告中说明。

## 二、安全边界（Hard Rules）

### 数据库安全（严禁执行）
- `DROP DATABASE` / `DROP TABLE` / `TRUNCATE TABLE`
- 无 `WHERE` 条件的 `DELETE`
- 修改生产数据库 / 修改生产环境配置

> 使用 DB 写工具前必须确认目标为**测试库**，且语句带精确 `WHERE`。

### 测试数据隔离
- 所有自动化测试数据统一使用 `<dataIsolationPrefix>`（默认 `TEST_AUTO_*`）作为业务标识（编码、名称、批次等）。
- 便于 Teardown 精确清理，避免污染真实数据。

## 三、环境恢复（Teardown）

测试结束后必须：
- 执行 Teardown；
- 清理本轮测试数据（带精确 WHERE 的 DELETE / 逆向业务操作）；
- 恢复数据库与测试环境状态（如支持）。

若恢复失败：**必须在最终报告记录 Warning**，并列出残留数据定位信息。

## 四、项目协作约束（来自目标项目规范，如存在）

- 若项目规范禁止对前端代码执行格式化：`npm run lint` 仅用于检查，不加 `--fix`。
- 若项目规范禁止改后端后编译：仅定位与记录，不擅自编译。
- 编辑组件前先核对目录名与功能名（若项目有目录消歧义表）。
