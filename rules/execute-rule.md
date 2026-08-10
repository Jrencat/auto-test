# execute-rule —— 执行、重试、失败归因与证据收集

对应主流程 Step7 / Step8。

> 命令与工作目录来自绑定 `project.json.commands`（cwd = `<frontend>`，见 runtime.local.json）。

## 零、执行前置：批次 ID 与状态置位

1. **生成批次 ID**：`RUN-YYYYMMDD-HHMMSS`（`node tests/support/caseStore.ts run-id`），
   通过环境变量 `AUTO_TEST_RUN_ID` 下发给 Playwright，使所有执行记录归入同一批次。
2. **状态置位**：把本次要执行的 Case 从 `ready → running`（最小化回写）。
   - 只有 `ready`（或上次中断残留的 `running`）能进入执行。
   - `pending_review` 用例**一律不执行**，在报告标 Not Executed（待人工审核）。
   - 非法转换（如 `pending_review → running`）必须直接报错终止，不得放行。

## 一、执行（Step7）

优先执行项目已有命令（见绑定 `project.json.commands`）：

| 目的 | 命令（在 `<frontend>`） |
|------|------|
| 全量（先登录 setup，再 api+e2e） | `npm run test` |
| 仅接口 | `npm run test:api` |
| 仅 UI 端到端 | `npm run test:e2e` |
| 指定用例 | `npx playwright test <file> -g "<用例名>"` |
| 查看报告 | `npm run test:report` |

- 每次执行必须记录：Test Runner、Command、Exit Code、Duration。
- 失败允许**自动重试一次**（配置已设 `retries: 1`）。

### 🔴 串行 + 隔离执行（强制，见 environment-rule §并发执行安全）

- 同一测试账号同一时间**只允许一个 Playwright 进程**。用 `run_in_background` 跑测试时，
  **必须等上一个 playwright 进程结束**再启动下一个，绝不同时存在多个未结束的 playwright 调用
  （并发可能触发后端单点登录互踢 → 另一进程全量白屏/鉴权失效，极易误判为产品/环境缺陷）。
- **隔离重跑定案**：某用例失败且原因涉及"未登录/账号已在其他设备登录/页面空白/表头回退默认分支"时，
  先确认当时无其它 playwright 进程，再在完全隔离状态下单独重跑该用例（`-g "<用例名>"`）；
  隔离结果与首次不一致时以隔离结果为准，并在报告说明。
- **调试脚本即用即删**：为定位环境问题临时新建的 `_debug.*.spec.ts` 等文件，定位完成后必须删除，
  不得留在 `<frontend>/tests/` 目录污染正式套件。

## 一点五、执行后状态回写（Step9）与失败类型区分（强制）

| 实际情况 | Case Status | Execution Result | Failure Type |
|---------|-------------|------------------|--------------|
| 用例跑完，断言全过 | `completed` | `PASS` | — |
| 用例跑完，**业务断言失败** | `completed` | `FAIL` | `Assertion Failure` |
| Playwright 启动失败 / 脚本语法错误 / 浏览器起不来 / 测试环境不可用 | `failed` | `ERROR` | `Automation Error` |
| 数据占位符未补 / 权限缺失 / 数据空档，未执行 | 保持原状态 | `BLOCKED` | `Blocked` |

- **`completed ≠ PASS`**：只要测试正常跑完，哪怕断言全红，Case Status 也是 `completed`。
- **严禁**把业务断言失败写成 `status: failed`——那会把产品缺陷伪装成自动化故障，掩盖真实问题。
- 回写只改 `status` / `updated_at` / `last_run_id` / `last_run_status` 四个字段，
  正文与人工修改内容一律不动（见 `rules/case-store-rule.md §五`）。

## 二、失败归因（重试仍失败）

将失败归类为其一，并**定位疑似源码位置**（file:line）：

- 前端 Bug
- 后端 Bug
- 数据库 Bug
- 自动化脚本 Bug
- 数据问题
- 环境问题

归因写入对应 TestCase 与最终报告。（若项目规范限制改前端/后端，仅定位与记录，除非用户要求改。）

## 三、证据收集（Step8）与 Token 控制

- **逐数据组写执行记录**（强制）：每个 Data Group 执行完立即 `recordResult()` 追加到
  `<reportDir>/<RunId>.jsonl`，字段含 Case ID / Data Group ID / **实际输入数据** / 预期 / 实际 /
  Result / Failure Type / 耗时 / spec 文件。报告阶段直接聚合该文件，杜绝"报告与实际执行对不上"。
- **日志仅保留最后 20 行**。
- **截图仅保留相对路径**（Playwright 失败自动截图，位于 `<frontend>/playwright-report/` / `test-results/`）。
- **数据库仅输出关键字段变化**：绑定 `assertLayers.database.keyFields` 指定的字段（操作前 → 操作后）。
- trace：`retain-on-failure`（失败时保留，供回溯）。

## 四、数据库断言取值

用 DB 读工具（带精确 WHERE）在"操作前 / 操作后"分别取快照，只对比关键字段：

```
| 字段 | 操作前 | 操作后 | 预期 | 结果 |
|------|--------|--------|------|------|
| available | 100 | 90 | -10 | ✅ |
| frozen    | 0   | 10 | +10 | ✅ |
```

守恒校验：相关数量字段之和的变化符合业务恒等，否则判 ❌FAIL 并归因。
（数量充足性/扣减类用例的完整断言口径见 `templates/assertion-patterns.md` 模式A。）

## 五、执行纪律

- 连续执行，不逐步等待确认（仅 BLOCKED 暂停）。
- 终态只允许来自真实执行结果；不得仅报告 PASS 而无证据。
