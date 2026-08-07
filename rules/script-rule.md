# script-rule —— 自动化脚本增量维护规范

对应主流程 Step6。运行器：**Playwright**（见 `<frontend>/playwright.config.ts`）。

> 脚本目录来自绑定 `project.json.scriptDir`（相对 `<frontend>`，绝对路径查 runtime.local.json）。
> 下文取值均为通用示例（选择器手册针对 Ant Design Vue + ag-Grid，按你的 UI 库调整）。

## 一、存放位置与命名

```
<frontend>/tests/
├── api/    *.api.spec.ts     # 接口测试（project=api）
├── e2e/    *.e2e.spec.ts     # UI 端到端（project=e2e）
└── support/                  # 基建：env / crypto / auth.setup / fixtures（勿随意改动）
```

命名：`<module>.<scenario>.{api|e2e}.spec.ts`，例如
`order-module.list.e2e.spec.ts`、`order-module.list.api.spec.ts`。

## 二、维护优先级（不得删除已有脚本）

1. 复用已有脚本；
2. 修改已有脚本（仅局部）；
3. 新增脚本。

所有**新增 TestCase 必须同步新增/更新对应脚本**；已存在脚本只输出 Diff。

## 三、编写约定（复用 support fixtures）

统一从 `../support/fixtures` 导入 `test` / `expect`，使用既有 fixture：

- `apiClient`：已注入鉴权与业务请求头的接口客户端，`baseURL` 为网关。
- `authedPage` + `gotoRoute(routePath)`：已注入登录态的页面；`gotoRoute('order-module/list')` 打开对应 hash 路由。
- `env` / `auth`：运行时配置与登录态。

登录态机制（勿绕过）：`auth.setup.ts` 走 API 登录产出 `tests/.auth/user.json`；
E2E 通过 `addInitScript` 注入 `sessionStorage` 恢复登录态。详见 `<frontend>/tests/README.md`。

### 骨架示例（API）

```ts
import { test, expect } from '../support/fixtures';

test('ORDER-API-001 列表分页查询', async ({ apiClient }) => {
  const resp = await apiClient.post('order/query-page-list', {
    data: { pageNum: 1, pageSize: 10 },
  });
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  expect(Number(body.code ?? 200)).toBe(200);
});
```

### 骨架示例（E2E）

```ts
import { test, expect } from '../support/fixtures';

test('ORDER-E2E-001 打开列表页并校验表格', async ({ gotoRoute, authedPage }) => {
  await gotoRoute('order-module/list');
  await authedPage.waitForLoadState('networkidle');
  await expect(authedPage.locator('.ag-root')).toBeVisible(); // 表格组件基于 ag-Grid
  // ⚠ 内容级校验（避免空容器假通过，见 environment-rule §真实渲染探测）：
  expect((await authedPage.locator('body').innerText()).length).toBeGreaterThan(0);
});
```

### 🧩 Ant Design Vue / ag-Grid 选择器手册（实测验证，按你的 UI 库调整）

写页面级断言前先核对下列已验证的选择器约定，避免"选择器找不到元素"被误判为功能缺陷：

| 目标元素 | 正确选择器 | 常见错误 |
|---------|-----------|---------|
| `a-auto-complete` / `a-select` 的可输入框 | `.ant-select-selection-search-input` | ❌ `input[placeholder="..."]`——该组件 placeholder 渲染在兄弟 `<span class="ant-select-selection-placeholder">`，**不在 input 属性上**，按 placeholder 选必然落空 |
| 下拉输入（页面通常首个 auto-complete） | `.ant-select-selection-search-input` 的 `.first()` | 同上 |
| 普通 `a-input` 输入框 | `input[placeholder="精确文案"]`（普通 input 的 placeholder 在属性上，可用） | — |
| ag-Grid 表头列文本（用于列集合断言） | `.ag-header-cell-text`，`allTextContents()` 后 `join('|')` 聚合比对 | ❌ 依赖具体列序——列序会变，按"包含某列名"断言更稳 |
| ag-Grid 表体行 | `.ag-row` / `.ag-root` | — |
| `a-form-item` 表单项标签（判断表单项显隐） | `.ant-form-item-label:has-text("标签文案")` | — |

**触发下拉查询的标准动作序列**（auto-complete 的 `@search` + `@keyup.enter`/`@pressEnter` 双绑定）：
```ts
const noInput = authedPage.locator('.ant-select-selection-search-input').first();
await expect(noInput, '下拉输入框未渲染').toBeVisible({ timeout: 10000 });
await noInput.click();
await noInput.fill(bizNo);
await authedPage.waitForTimeout(400); // 等 @search 建立候选
await noInput.press('Enter');         // 触发查询
await authedPage.waitForLoadState('networkidle');
await authedPage.waitForTimeout(500);
```

### 🧬 变体矩阵参数化 E2E 骨架（多分支页面通用）

对 `source-analysis-rule.md §1.5` 产出的变体矩阵，用**数据驱动**方式一次覆盖所有取值，
每个取值一条 test，互不影响（单个取值失败不阻断其它取值）：

```ts
import { test, expect } from '../support/fixtures';

interface Variant {
  id: string;              // ORDER-LIST-001 …
  discriminator: string;   // 判别字段取值（如类型 '6'）
  name: string;            // 人类可读（类型名…）
  bizNo: string;           // 驱动用真实标识（理想情况执行前动态取号替换）
  expectColumns: string[]; // 期望出现的专属列（按"包含"断言，不依赖列序）
  // 按页面追加：expectFormLabels / unexpectFormLabels / 某输入框显隐 等
}

const variants: Variant[] = [ /* 抄源码分支枚举，逐取值一行 */ ];

for (const v of variants) {
  test(`${v.id} <页面>类型[${v.name}]展示差异 标识=${v.bizNo}`, async ({ gotoRoute, authedPage }) => {
    await gotoRoute('order-module/<page>');
    await authedPage.waitForLoadState('networkidle');

    // —— 标准下拉查询动作序列（见上）——
    const noInput = authedPage.locator('.ant-select-selection-search-input').first();
    await expect(noInput, '下拉输入框未渲染').toBeVisible({ timeout: 10000 });
    await noInput.click(); await noInput.fill(v.bizNo);
    await authedPage.waitForTimeout(400); await noInput.press('Enter');
    await authedPage.waitForLoadState('networkidle'); await authedPage.waitForTimeout(500);

    // 未白屏/未崩溃
    await expect(authedPage.locator('#app')).toBeVisible();
    await expect(authedPage.locator('text=系统异常')).toHaveCount(0);

    // 列集合断言（聚合比对，稳）
    const headers = (await authedPage.locator('.ag-header-cell-text').allTextContents()).join('|');
    for (const col of v.expectColumns) {
      expect(headers, `期望列"${col}"未出现，实际表头=${headers}`).toContain(col);
    }
    console.log(`[${v.id}] discriminator=${v.discriminator} headers=${headers.slice(0, 250)}`);
  });
}
```

> **命名建议**：变体脚本按页面拆文件，如 `order-module.list-variant.e2e.spec.ts`，便于隔离重跑单个页面。
>
> **标识取不到 → 表头回退默认分支**：若某取值的真实标识已过期（查询无明细），页面会停留在
> 默认判别值，表头断言会失败。**先用 API 直接核实数据是否真的不存在**（见 testcase-rule §9
> 强制规则），确认数据确实不存在才归为测试数据问题；数据其实存在但页面仍未按预期渲染，
> 要转向怀疑前端缺陷（抓 pageerror + 交叉验证维度）。

### 🧪 断言模式库脚本骨架（模式A/B，见 templates/assertion-patterns.md）

- **模式A 充分性**：DB/接口预置已知数量 → 前端执行使用（需要量 ≤ 剩余量）→
  断言**无"不足"类 Toast/校验** + 提交成功；再 DB 快照断言关键数量字段精确变化且守恒。
- **模式B 中间态**：把多步操作写成有序数组，`for` 逐步执行，**每步后**断言页面上
  所有相关计数/状态文本，任一步不符即 FAIL 并记录该步骤上下文。

完整口径与数据变体见 `templates/assertion-patterns.md`。

### 🧰 复用工具：`tests/support/resolveActionNo.ts`（动态标识解析，通用示例）

对应 `source-analysis-rule.md §1.6`。封装了 `resolveIdCandidates(apiClient, listApi, query)` /
`resolveFirstId(...)`，调用你项目"查询当前有效业务单据列表"的接口动态取号。
新增变体矩阵脚本应优先复用该工具动态取号，不要再从文档抄静态标识。

## 四、数据隔离与清理

- 脚本创建的数据统一带 `<dataIsolationPrefix>`（默认 `TEST_AUTO_*`）业务标识。
- 在 `test.afterEach` / `test.afterAll` 或独立 teardown 中清理（逆向业务操作或 DB 写工具带精确 WHERE）。

## 五、格式约束

- 若项目规范禁止对脚本以外的前端源码做格式化：不运行 `npm run lint --fix`。
- 新增脚本自身遵循项目 ESLint 规则，但**仅改动目标文件**。
