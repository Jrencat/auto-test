# E2E 业务主流程用例 —— <模块名>

> 由 auto-test Skill 增量维护。ID 一经分配不得复用/重排；终态只允许真实执行结果。
> 路径/路由前缀/断言字段来源：`<cwd>/.claude/auto-test/project.json`（下例为通用示例）。

## 用例索引

| ID | 场景 | 状态 | 最近执行 |
|----|------|------|---------|
| ORDER-E2E-001 | <场景一句话> | 🟡待执行 | - |

---

## ORDER-E2E-001 <场景标题>

- **模块 / 路由**：order-module/list
- **前置条件**：登录态；依赖服务已启动；测试数据 `TEST_AUTO_*`
- **测试步骤**：
  1. 打开页面 `gotoRoute('order-module/list')`
  2. <操作…>
  3. <提交…>
- **断言**：
  - 前端：<字段校验/按钮禁用/状态切换/权限>
  - API：<url / method / code=200 / response 关键字段>
  - 数据库：绑定 `assertLayers.database.keyFields` 指定的关键字段变化符合守恒
- **对应脚本**：`<frontendTestsDir>/e2e/order-module.list.e2e.spec.ts`
- **执行证据**：Runner / Command / ExitCode / Duration / 截图路径 / 日志(≤20行) / 字段变化表
- **状态**：🟡待执行 → 执行后回写 ✅PASS / ❌FAIL / ⚠BLOCKED / 🚫DEPRECATED
- **失败归因**（如 FAIL）：分类 + 疑似源码 file:line
- **历史执行记录**：<保留，勿删>
