# preflight-rule —— 运行前依赖预检

对应主流程 **Step-1**（最先执行）。目标：在做任何测试工作前，确认自动化测试所需插件/工具就位；
**缺失只提示安装命令，绝不自动安装**（安装可能改动 lockfile / 下载大体积浏览器，须用户知情）。

> 前端路径 `<frontend>` 来自 binding-rule 解析结果（`runtime.local.json.frontendDir`）。
> preflight 与 binding 可交叉：若尚未解析出 `<frontend>`，先做 binding-rule 再回来做前端相关检查。

## 一、检查项与判定

只读探测，逐项给出 ✅ / ❌，并汇总成清单表。

| # | 检查项 | 探测方法（只读） | 缺失处理 |
|---|--------|-----------------|---------|
| 1 | Node.js | `node -v` | ❌ 硬依赖 → BLOCKED，提示安装 Node LTS |
| 2 | 包管理器 | `npm -v`（或 pnpm/yarn，按 lockfile） | ❌ 硬依赖 → BLOCKED |
| 3 | 前端依赖已装 | `<frontend>/node_modules` 是否存在 | ❌ 提示 `cd <frontend> && npm install` |
| 4 | Playwright 测试库 | `<frontend>/package.json` 含 `@playwright/test` 且 `node_modules/@playwright/test` 存在 | ❌ 提示 `cd <frontend> && npm install`（若 package.json 都没有则提示 `npm i -D @playwright/test`） |
| 5 | Chromium 浏览器二进制 | `cd <frontend> && npx playwright install --dry-run`（或尝试 `npx playwright --version` + 检查缓存目录） | ❌ 提示 `cd <frontend> && npx playwright install chromium` |
| 6 | 依赖服务可达 | 见 `rules/environment-rule.md`（网关/Nacos/Redis/MySQL/前端 dev） | ❌ 按 environment-rule 判 BLOCKED |
| 7 | DB 断言工具（可选） | 目标项目的 DB 查询工具（如某个 MCP 工具）是否可用 | ⚠ 不可用 → DB 断言标 Not Executed，不阻断 |

> 检查 3/4/5 需先有 `<frontend>`；若 binding 尚未完成，本步骤对这些项标"待 binding 后复检"。

## 二、输出（预检清单，编排开头展示给用户）

```
[auto-test 预检]
✅ Node v20.x   ✅ npm 10.x
✅ 前端依赖已安装   ✅ @playwright/test 1.62.x
❌ Chromium 未安装 → 请运行：cd <frontend> && npx playwright install chromium
⚠ DB 查询工具不可用 → 本轮数据库断言将标 Not Executed
✅ 网关/API 服务可达
```

## 三、门禁规则

- **硬依赖缺失**（Node / npm / 前端依赖 / @playwright/test / Chromium / 关键服务）→ 输出 BLOCKED，
  给出**逐条可复制的安装命令**，等待用户安装后重跑；**不自动执行安装**。
- **可选项缺失**（DB 工具）→ 不阻断，记录降级说明，报告中对应断言标 Not Executed。
- 全部硬依赖 ✅ → 继续 Step0 绑定（若未做）/ Step1 输入检查。

## 四、安装命令参考（提示用，用户自行执行）

| 缺失 | 建议命令 |
|------|---------|
| 前端依赖 | `cd <frontend> && npm install` |
| Playwright 测试库 | `cd <frontend> && npm i -D @playwright/test` |
| 浏览器二进制 | `cd <frontend> && npx playwright install chromium`（含系统依赖用 `--with-deps`） |
| Node.js | 安装 Node LTS（nvm / 官网），重开终端后重试 |

> 用户可用会话内 `! <命令>` 直接执行（如 `! cd <frontend> && npx playwright install chromium`），
> 输出会回到会话，便于确认安装成功后继续。
