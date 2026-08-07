# 绑定配置 Schema —— `<cwd>/.claude/auto-test/project.json`

> 引擎本体**不含**硬编码的项目实例。真实实例由首次运行时 `rules/binding-rule.md` 依据
> `templates/binding/project.template.json`（通用示例 profile）生成到 `<cwd>/.claude/auto-test/project.json`（可提交），
> 机器/分支相关的绝对路径另存 `runtime.local.json`（gitignore）。本文件说明各字段含义。

## project.json 字段

| 字段 | 说明 | 示例默认 |
|------|------|----------|
| `project` | 项目名 | `<your-project>` |
| `architecture.type` | 架构类型 | `monorepo` |
| `architecture.frontendDirName` | 前端目录名（相对，绝对路径在 runtime.local.json） | `frontend` |
| `architecture.backendDirName` | 后端目录名（相对） | `backend` |
| `architecture.frontendStack` | 前端技术栈描述 | `Vue3+TS+Ant Design Vue+ag-Grid` |
| `architecture.backendStack` | 后端技术栈描述 | `<你的后端技术栈>` |
| `input.docKinds` | 描述文档类型 | `["页面","接口","流程","需求"]` |
| `input.pageDocDirEnvKey` | 页面文档目录的 env 变量名（不写死目录） | `TEST_PAGE_DOC_DIR` |
| `input.moduleFrom` | `<module>` 取值规则 | 取描述文件所在目录名或文件内模块前缀 |
| `runner.name` | 运行器 | `playwright` |
| `runner.configRel` | 配置文件（相对前端根） | `playwright.config.ts` |
| `runner.projects` | project 列表 | `["setup","api","e2e"]` |
| `runner.browserInstall` | 浏览器安装命令 | `npx playwright install chromium` |
| `commands.cwdKey` | 命令工作目录（`frontend`/`backend`，实际路径查 runtime.local.json） | `frontend` |
| `commands.all/api/e2e/report/frontendDev/lintCheckOnly` | 常用命令 | `npm run test` 等 |
| `endpoints.apiBaseURLEnvKey` | 网关地址 env 键 | `TEST_API_BASE` |
| `endpoints.webBaseURLEnvKey` | 前端地址 env 键 | `TEST_WEB_BASE` |
| `endpoints.webRouteBaseEnvKey` | 路由 base env 键 | `TEST_WEB_ROUTE_BASE` |
| `endpoints.swagger` | 接口文档地址（提示用） | `<你的接口文档地址>` |
| `auth.*` | 登录接口/加密方式/token 存储/请求头/env 文件/登录态产物 | 见模板 |
| `sourceLocate.order` | 源码定位链 | `["View","Router","API","Controller","Service","Mapper","XML/SQL","Database"]` |
| `sourceLocate.vueGlobRel` / `apiGlobRel` | 前端源码 glob（相对前端根） | `src/views/**/<module>/**/*.vue` / `src/api/**/*.ts` |
| `sourceLocate.note` | 定位说明 | 禁止要求用户提供源码路径；用前端 url 反查后端路由 |
| `assertLayers.frontend/api/database` | 三层断言字段 | 见模板 |
| `assertLayers.database.tool` | DB 断言工具 | `<你的 DB 查询工具，如某 MCP 工具>`（可为空 → DB 断言标 Not Executed） |
| `assertLayers.database.keyFields` | 关键数量/状态字段 | `<如 available / used / frozen>` |
| `testcaseDir` | 用例目录 | `docs/testcases/<module>/` |
| `reportFile` | 报告文件 | `docs/testcases/<module>/自动化测试执行报告.md` |
| `scriptDir.api/e2e/support` | 脚本目录（相对前端根） | `tests/api/` `tests/e2e/` `tests/support/` |
| `domain.businessFlow` | 业务流转链路（领域默认，可空） | `[]`（按你的领域填，如 `["stepA","stepB"]`） |
| `domain.importEntries` | 导入入口（领域默认，可空） | `[]` |
| `dataIsolationPrefix` | 测试数据隔离前缀 | `TEST_AUTO_` |
| `constraints.*` | 协作约束 | `noFrontendFormat`/`noBackendCompile`/DB 硬规则 |

## runtime.local.json 字段（gitignore，每机器/分支不同）

| 字段 | 说明 |
|------|------|
| `frontendDir` | 前端项目**绝对路径**（本机） |
| `backendDir` | 后端项目**绝对路径**（本机；无则空） |
| `frontendBranch` | 前端当前分支（`git -C <frontendDir> branch --show-current`，每次运行刷新） |
| `backendBranch` | 后端当前分支（每次运行刷新） |
| `generatedAt` | 生成/刷新时间（由 Agent 运行时写入真实时间） |

## 解析优先级

1. `<cwd>/.claude/auto-test/project.json` 存在 → 用其字段。
2. 机器/分支相关绝对路径永远读 `runtime.local.json`，不写进 `project.json`（保证 project.json 可提交共享）。
3. 端口/地址/账号/页面文档目录最终值取 `<frontend>/tests/.env.test`（`TEST_*`），env 缺省再回退 project.json/内置默认。
