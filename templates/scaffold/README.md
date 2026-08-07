# 自动化测试（Playwright）

统一测试运行器：**Playwright**（E2E UI + API 接口）。数据库断言使用你项目的 DB 查询工具（如某个 MCP 工具）。
本目录由全局 `auto-test` skill 脚手架生成并增量维护，请勿整体覆盖。

## 目录结构

```
tests/
├── support/                 # 测试基建（登录态、加密、fixtures、env）
│   ├── env.ts               # 运行时配置读取（tests/.env.test → 进程变量 → 默认值），含 pageDocDir
│   ├── crypto.ts            # 示例密码加密（按你的前端加密方式替换）
│   ├── auth.setup.ts        # setup 项目：API 登录，产出 .auth/user.json（按你的登录接口调整）
│   ├── fixtures.ts          # apiClient / authedPage / gotoRoute 等 fixture
│   └── resolveActionNo.ts   # 动态业务标识解析（通用示例，按你的查询接口调整）
├── api/                     # 接口测试（*.api.spec.ts）
├── e2e/                     # UI 端到端测试（*.e2e.spec.ts）
├── .auth/                   # 登录态产物（不入库）
├── .env.test.example        # 运行时配置示例
└── README.md
```

配置文件在前端根：`playwright.config.ts`。

## 首次使用

1. 安装浏览器（若未装）：`npx playwright install chromium`
2. 复制配置：`cp tests/.env.test.example tests/.env.test`，填写：
   - 地址：`TEST_API_BASE` / `TEST_WEB_BASE`
   - 账号：`TEST_USERNAME` / `TEST_PASSWORD`（**测试环境账号**）
   - 页面文档目录：`TEST_PAGE_DOC_DIR`（默认 `docs/test-pages/`）
3. 按你的后端登录接口调整 `support/auth.setup.ts` 与 `support/crypto.ts`。
4. 确认依赖服务已启动（网关 / 数据库 / 目标服务等）；跑 E2E 还需前端 `npm run dev`。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run test` | 全量（先 setup 登录，再 api + e2e） |
| `npm run test:api` | 仅接口测试 |
| `npm run test:e2e` | 仅 UI 端到端 |
| `npm run test:report` | 打开 HTML 报告 |

> 若 package.json 尚无这些脚本，请添加：
> `"test": "playwright test"`, `"test:api": "playwright test --project=api"`,
> `"test:e2e": "playwright test --project=e2e"`, `"test:report": "playwright show-report playwright-report"`。

## 登录态机制

- 若 token 存于前端 sessionStorage，Playwright 的 storageState 不含 sessionStorage，故采用：
  `auth.setup.ts` 走 API 登录拿 token → 写 `.auth/user.json`；
  - API 测试：`apiClient` fixture 自动注入鉴权与业务请求头。
  - E2E 测试：`authedPage` 通过 `addInitScript` 在页面脚本执行前写入 `${TEST_APP_ID}_Cache`，恢复登录态。

## 安全约束

- 测试数据统一使用 `TEST_AUTO_*` 业务标识，测试后执行 Teardown 清理。
- 严禁指向生产库/生产环境；严禁无 WHERE 的 DELETE、DROP、TRUNCATE。
