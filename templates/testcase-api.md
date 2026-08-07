# API 接口测试用例 —— <模块名>

> 由 auto-test Skill 增量维护。终态只允许真实执行结果。
> 路径/断言字段来源：`<cwd>/.claude/auto-test/project.json`（下例为通用示例）。

## 用例索引

| ID | 接口 | Method | 状态 | 最近执行 |
|----|------|--------|------|---------|
| ORDER-API-001 | /order/query-page-list | POST | 🟡待执行 | - |

---

## ORDER-API-001 <接口场景>

- **URL**：/order/query-page-list
- **Method**：POST
- **Request**：`{ pageNum, pageSize, ... }`（List 参数走 body，避免 URL 长度限制）
- **前置**：登录态（apiClient 已注入鉴权与业务请求头）
- **断言**：
  - HTTP Status = 200
  - 业务 Code（按你的约定，如 `body.code === 200`）
  - Response 结构 / 关键字段：<…>
  - 异常场景：非法参数 / 越权 / 重复提交 → 期望错误码
  - 数据库（写接口）：绑定 `assertLayers.database.keyFields` 关键字段变化守恒
- **对应脚本**：`<frontendTestsDir>/api/order-module.list.api.spec.ts`
- **执行证据**：Runner / Command / ExitCode / Duration / 响应片段 / 字段变化表
- **状态**：🟡待执行 → 回写真实结果
- **失败归因**（如 FAIL）：分类 + 疑似源码 file:line
- **历史执行记录**：<保留>
