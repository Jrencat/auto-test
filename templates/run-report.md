# Test Run Report —— <RUN-YYYYMMDD-HHMMSS>

> 单次执行批次报告，保存于 `<reportDir>/RUN-YYYYMMDD-HHMMSS.md`，与 Case 解耦：
> **一个 Case 可被多次执行，每次执行有独立报告**，历史报告不得删除或覆盖。
> 数据来源：`<reportDir>/RUN-YYYYMMDD-HHMMSS.jsonl`（Playwright 执行时逐条写入，见 `caseStore.recordResult`）。
> 面向客户交付的完整章节版报告见 `templates/report.md`（模块级汇总），本模板是**按批次的可追踪执行记录**。

## Run Information

| 项 | 值 |
|----|----|
| Run ID | RUN-20260810-151530 |
| Execution Mode | full-auto / human-in-the-loop |
| Started At | <YYYY-MM-DD HH:mm:ss> |
| Finished At | <YYYY-MM-DD HH:mm:ss> |
| Duration | <Ns> |
| Test Runner | Playwright（workers=1, retries=1, trace=retain-on-failure） |
| Command | <实际执行命令> |
| Exit Code | <N> |
| 前端分支 / 后端分支 | <frontendBranch> / <backendBranch> |
| 环境 | <local / test / uat>，<webBaseURL> / <apiBaseURL> |
| 测试账号 | <TEST_USERNAME> |

## Summary

| 指标 | 数值 |
|------|------|
| 参与执行的 Case 数 | N |
| 数据组（Data Group）总数 | N |
| PASS | N |
| FAIL（Assertion Failure） | N |
| ERROR（Automation Error） | N |
| BLOCKED | N |
| Pass Rate（分母＝实际执行数据组数） | NN% |
| 跳过（pending_review 未审核） | N ← 逐条列出，标 Not Executed |

## Case Status 变更

| Case ID | 执行前 | 执行后 | last_run_status |
|---------|--------|--------|-----------------|
| TC-AUTH-001 | ready | completed | FAIL |
| TC-AUTH-002 | pending_review | pending_review | -（未审核，未执行） |

> 提醒：`completed ≠ PASS`。业务断言失败仍为 `completed`；只有自动化不可恢复异常才是 `failed`。

## Detailed Results

> 每个数据组一节，必须还原完整追踪链：
> Case ID → Data Group ID → 实际输入数据 → 预期结果 → 实际结果 → Result。

### TC-AUTH-001 用户名输入校验

- Case File: `.auto-test/cases/TC-AUTH-001.md`
- Spec File: `tests/e2e/auth.login.e2e.spec.ts`
- Case Status: completed

#### D001（数据特征：正常值）

- 实际输入：`username = admin@example.com`，`password = 123456`
- Expected：登录成功
- Actual：登录成功
- Result: **PASS**
- Duration：<Nms>

#### D002（数据特征：低于最小长度）

- 实际输入：`username = admin@example.com`，`password = 12345`
- Expected：提示密码至少 6 位
- Actual：<实际页面文案原文>
- Result: **FAIL**
- Failure Type: Assertion Failure
- Error：<断言错误信息，≤20 行>
- 证据：截图 `test-results/<...>/test-failed-1.png`；trace `test-results/<...>/trace.zip`
- 归因分类：<产品缺陷 / 自动化脚本 / 环境 / 配置 / 第三方 / 网络 / 测试数据> + 疑似源码 `file:line`

#### D006（数据特征：需人工补充）

- 实际输入：`username = TODO`
- Expected：REQUIRED_INPUT
- Actual：未执行
- Result: **BLOCKED**
- Failure Type: Blocked
- 原因：数据组含 `TODO` / `REQUIRED_INPUT` 占位符，待人工补充后方可执行

## 数据库断言（如适用）

| Case / Data Group | 字段 | 操作前 | 操作后 | 预期 | 结果 |
|-------------------|------|--------|--------|------|------|
| TC-ORDER-001 / D001 | available | 100 | 90 | -10 | ✅ |

> 无 DB 工具时整节标 **Not Executed** 并说明原因，禁止留空或伪造。

## 未执行清单（Not Executed / BLOCKED）

| Case ID | Data Group | 原因 |
|---------|-----------|------|
| TC-AUTH-002 | 全部 | status=pending_review，等待人工审核 |

## Teardown

- 测试数据清理：成功 / ⚠Warning（残留定位 + 精确 WHERE）
- 环境恢复：成功 / ⚠Warning

## Self Review

- [ ] 每个数据组都有真实输入数据记录（非"见用例"占位）
- [ ] Expected / Actual 均来自真实执行，未从用例文档直接誊抄
- [ ] FAIL 与 ERROR 已正确区分（Assertion Failure vs Automation Error）
- [ ] Case Status 与 Execution Result 未混用
- [ ] pending_review 用例均标 Not Executed，未被自动执行
- [ ] 统计数字与 Detailed Results 条目数一致
