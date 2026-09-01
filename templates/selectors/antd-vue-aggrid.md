# 选择器适配器 —— Ant Design Vue + ag-Grid

角色定义见 `README.md §一`。下表每行**均经实测验证**。

## 一、角色映射

| 角色 | 选择器 | 常见错误 |
|------|--------|---------|
| `APP_ROOT` | `#app` | — |
| `TABLE_ROOT` | `.ag-root` | — |
| `TABLE_HEADER_CELL` | `.ag-header-cell-text` | ❌ 依赖具体列序——列序会变，取 `allTextContents()` 后 `join('\|')` 聚合、按"包含某列名"断言更稳 |
| `TABLE_ROW` | `.ag-row` | — |
| `COMBO_INPUT` | `.ant-select-selection-search-input`（页面通常首个 auto-complete 取 `.first()`） | ❌ `input[placeholder="..."]` —— `a-auto-complete` / `a-select` 的 placeholder 渲染在兄弟节点 `<span class="ant-select-selection-placeholder">`，**不在 input 属性上**，按 placeholder 选必然落空 |
| `PLAIN_INPUT(placeholder)` | `input[placeholder="精确文案"]` | 仅适用于普通 `a-input`（其 placeholder 确实在属性上） |
| `FORM_ITEM_LABEL(text)` | `.ant-form-item-label:has-text("标签文案")` | — |
| `MESSAGE_TOAST` | `.ant-message` | — |
| `FORM_ERROR` | `.ant-form-item-explain` | — |

## 二、动作序列：触发下拉查询

`a-auto-complete` 的 `@search` 与 `@keyup.enter`/`@pressEnter` 是双绑定，必须走完整序列，
只 `fill()` 不回车不会触发查询：

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

## 三、列集合断言（聚合比对）

```ts
const headers = (await authedPage.locator('.ag-header-cell-text').allTextContents()).join('|');
for (const col of expectColumns) {
  expect(headers, `期望列"${col}"未出现，实际表头=${headers}`).toContain(col);
}
```

> 变体矩阵里"标识取不到导致表头回退默认分支"的归因纪律是**库无关**的，见
> `rules/script-rule.md` 变体骨架小节，本适配器不重复。
