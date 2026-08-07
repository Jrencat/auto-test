# IMPORT 专项测试用例 —— <模块名>

> Excel/文件导入专项。由 auto-test Skill 增量维护。
> 路径来源：`<cwd>/.claude/auto-test/project.json`（下例为通用示例）。

## 覆盖矩阵（每种至少一条）

| ID | 导入场景 | 用例类型 | 状态 |
|----|---------|---------|------|
| ORDER-IMPORT-001 | 空文件 | 异常 | 🟡待执行 |
| ORDER-IMPORT-002 | 类型错误（非 xlsx） | 异常 | 🟡待执行 |
| ORDER-IMPORT-003 | 超限（超最大行数） | 异常 | 🟡待执行 |
| ORDER-IMPORT-004 | 表头错误 | 异常 | 🟡待执行 |
| ORDER-IMPORT-005 | 特殊字符 | 边界 | 🟡待执行 |
| ORDER-IMPORT-006 | 重复数据 | 业务 | 🟡待执行 |
| ORDER-IMPORT-007 | 部分成功 | 业务 | 🟡待执行 |
| ORDER-IMPORT-008 | 全部失败 | 业务 | 🟡待执行 |

---

## ORDER-IMPORT-00X <导入场景>

- **入口**：<导入入口标识，见绑定 domain.importEntries>
- **测试文件**：`<frontendTestsDir>/fixtures/import/<场景>.xlsx`（数据用 `TEST_AUTO_*`）
- **步骤**：打开导入弹窗 → 选择文件 → 上传 → 校验结果提示
- **断言**：
  - 前端：错误提示文案 / 成功条数 / 失败条数 / 下载失败明细
  - API：导入接口 code / 返回的成功失败统计
  - 数据库：仅成功行落库；失败行不落库；无脏数据
- **对应脚本**：`<frontendTestsDir>/e2e/order-module.import.e2e.spec.ts`
- **执行证据 / 状态 / 失败归因 / 历史记录**：同 E2E 模板
