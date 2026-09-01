# report-rule —— 测试报告、执行证据、Token 控制与最终 Gate

对应主流程 Step10 及收尾。模板见 `templates/run-report.md`（批次报告）与 `templates/report.md`（客户交付版）。

## 零、报告与 Case 解耦（强制架构要求）

- 每次执行生成**独立批次报告**：`<reportDir>/RUN-YYYYMMDD-HHMMSS.md`（默认 `<cwd>/.auto-test/reports/`）。
- **历史报告只增不改**：不得覆盖、不得删除、不得"合并成一份最新报告"。
  同一个 Case 被执行 N 次就有 N 份报告。
- **Case 文件只保存执行摘要**（`last_run_id` / `last_run_status`），详细结果一律进报告。
- 批次报告的数据来源**分两轨**，按项目实际情况取，且**必须在报告 Test Environment 声明用了哪一轨**：

  | 轨 | 前提 | 数据来源 | 证据等级 |
  |----|------|---------|---------|
  | **A（首选）** | 项目**已安装 case-store**（`<caseDir>` 存在且脚本已接入 `caseStore.ts`） | `<reportDir>/RUN-*.jsonl` 逐数据组真实记录 | 每个数据组含**实际输入数据**，追踪链完整 |
  | **B（降级）** | 未安装 case-store（无 `<caseDir>`、脚本未接入，`RUN-*.jsonl` 不存在） | `rules/execute-rule.md §三点一` 的投影输出 + spec 内结构化 `console.log` 行 | **无逐数据组实际输入**，追踪链止于 spec + test 标题 |

- 走 B 轨时：报告的"实际输入数据"列如实标 `N/A（未接入 case-store）`，**不得**从用例文档誊抄冒充实际输入；
  §Final Gate 中"每个数据组都有实际输入数据"一条相应标注为 B 轨降级，**不得伪装成已满足**。
- 两轨都**不得**凭 Case 文档内容"回忆"填写。

## 一、输出文件（Step10）

生成（本轮必产出）：
- `<reportDir>/RUN-YYYYMMDD-HHMMSS.md`（**批次报告**，见 `templates/run-report.md`）

最小化回写：
- `<caseDir>/TC-*.md` 的 `status` / `updated_at` / `last_run_id` / `last_run_status`

更新（模块汇总视图，兼容保留）：
- `<cwd>/docs/testcases/<module>/E2E_业务主流程用例.md`
- `<cwd>/docs/testcases/<module>/API_接口测试用例.md`
- `<cwd>/docs/testcases/<module>/IMPORT_专项测试用例.md`
- `<cwd>/docs/testcases/<module>/VARIANT_数据变体矩阵用例.md`（多分支页面时，见 `templates/testcase-variant.md`）
- `<cwd>/docs/testcases/<module>/自动化测试执行报告.md`（客户交付版最新快照，见 `templates/report.md`；
  该文件是**面向客户的汇总视图**，可覆盖更新，但**必须引用本轮 Run ID**，且不替代批次报告的留存）

> ⚠ **落盘基准（高频踩坑）**：上述路径一律相对 **`<cwd>`（仓库根）**，
> **不是** `<frontend>`。`commands.cwdKey: "frontend"` 只决定在哪跑测试命令，
> 不改变文档产物位置——写成 `<frontend>/docs/testcases/…` 属明确错误。
> 写盘前自查：目标绝对路径以 `<cwd>` 开头，且不含前端目录名。完整对照见 `rules/binding-rule.md §一 路径基准表`。

## 一点五、用例审查 HTML 视图（Step10 本轮必产出）

汇总统计回答"通过了多少"，**开发人员还需要知道"用了哪些参数、执行了哪些步骤"**。
故每轮除报告外，必须产出可点击的用例审查视图：

```bash
# 在 <frontend> 下执行（脚本会自动上溯定位 <cwd>，产物写到仓库根）
node tests/support/genCaseHtml.mjs        # 或 npm run test:cases-html
```

产出（`<cwd>/docs/testcases/<module>/html/`，目录可由绑定 `htmlDir` 覆盖）：

| 文件 | 内容 |
|------|------|
| `index.html` | 模块汇总表：Case ID / 标题 / 类型 / 状态 / **步骤数** / **数据组数** / 最近结果 / 测试脚本，含统计卡与搜索筛选 |
| `TC-<MODULE>-<NNN>.html` | 单条用例：测试目标 / 前置条件 / **完整测试步骤** / **参数矩阵（数据组 × 字段 × 具体输入 × 数据特征 × 预期）** / 断言 / 本轮执行结果 |

- 数据源是 `<caseDir>` 的 Case 文件（SSOT）与 `<reportDir>/RUN-*.jsonl`，**由脚本渲染，禁止手写 HTML**
  ——手写会与用例资产脱节，正是本机制要消除的不一致。
- 证据来源轨（§零 A/B 轨）由脚本自动判定并在页面显式标注；B 轨页面会写明"无逐数据组实际输入"，
  **不得**事后手工改成 A 轨措辞。
- 若项目非 Node 技术栈、脚本不适用：在报告中标注"HTML 视图 Not Executed + 原因"，不得静默跳过。

## 二、报告定位：默认输出「可直接交付客户」的完备报告

> 默认按 `templates/report.md` 的**完整客户交付版结构**输出（不是精简版）。语言要求：
> **专业、客观、严谨、基于真实执行结果**；**禁止**出现"我认为 / AI 推测 / 理论上 / 应该 /
> 可能 / 大概率"等主观表达；缺陷根因证据不足时用"【疑似原因】+ 仍需排查项"，不得编造。

报告**必含**下列章节（详见 `templates/report.md`）：

1. **Executive Summary**：测试背景 / 目标 / 总体结论 / **是否建议客户验收** / **是否建议上线**，
   并含统计表（总用例 / 实际执行 / Pass / Fail / Blocked / Not Executed / Pass Rate /
   极端数据覆盖率 / 新增测试 / 高风险问题数）。
2. **Test Environment**：环境 / 浏览器 / OS / Node / Playwright / 数据源 / 测试时间 /
   Git Commit（如可获取）/ 测试账号 / 关键配置（如路由 base）。
3. **Test Coverage**：按模块/脚本统计用例数·Pass·Fail·Blocked·覆盖率；说明覆盖范围 /
   **未覆盖范围** / 新增测试 / 极端数据策略 / **变体矩阵覆盖率（已覆盖取值 / 总取值）**。
4. **Detailed Test Results**：不省略任何用例（历史 PASS 用例可仅引用 ID+状态）；每条含
   ID / 名称 / 模块 / 目的 / 测试数据 / 数据变体 / 极端条件 / **测试步骤** / 预期 / 实际 /
   状态 / 响应时间(如适用) / 证据。
   - **「测试步骤」列不得省略、不得写"见用例"**：至少给出编号化的关键动作简写
     （如 `1 进入列表 → 2 填 D001 → 3 提交 → 4 断言提示`），使评审者不打开用例文件即可知道测了什么。
   - 本节开头必须放 **§4.0 用例明细索引**，链接 §一点五 生成的 `html/index.html` 与各用例单页，
     供开发人员查看完整步骤与参数矩阵。
5. **Edge Case & Boundary Analysis**：极端数据表现 / 容错 / Graceful Degradation /
   Robustness / 数据一致性 / 异常恢复 / 输入校验能力。
6. **Defects & Risk Assessment**：按 Blocker/Critical/Major/Minor 分类；每个缺陷含
   Bug ID / 严重程度 / 模块 / 复现步骤 / 预期 / 实际 / Root Cause（或【疑似原因】）/
   修复建议 / 风险影响；并给出**风险矩阵**（风险 / 影响范围 / 发生概率 / 是否阻断上线）。
7. **Conclusion & Recommendations**：稳定性 / 健壮性 / 剩余风险 / 后续建议 /
   是否建议验收 / 是否建议发布。

## 二点二、数据追踪链（批次报告强制，缺一即不合格）

每条执行记录必须能还原：

```
Run ID → Case ID → Case Title → Data Group ID → 实际输入数据 → 预期结果
       → Playwright 实际执行 → 实际结果 → PASS/FAIL/ERROR/BLOCKED → Failure Type → 错误信息
       → 执行时间 → 测试脚本/测试文件
```

- **"实际输入数据"必须是执行时真实使用的值**（A 轨来自 `RUN-*.jsonl`；B 轨无此项，标 `N/A（未接入 case-store）`，
  见 §零双轨表），禁止从用例文档誊抄冒充实际输入——那正是本次重构要杜绝的数据不一致。
- Case Status 变更（执行前 → 执行后）单列一表，与 Execution Result **分开呈现**。
- 结构见 `templates/run-report.md`。

## 二点五、结果统计与归因（所有报告都要）

- 结果统计：PASS / FAIL / **ERROR** / BLOCKED / **Not Executed** 数量与**通过率**（分母为实际执行数据组数）。
- **FLAKY 单独列出**：取投影输出的 `stats.flaky` 与 Failure Type = `FLAKY` 的条目，
  逐条列明用例与 retry 次数。FLAKY 计入 PASS 数，但**必须显式呈现**，不得并入稳定 PASS 掩盖不稳定性。
- **FAIL 与 ERROR 必须分列**：FAIL = 业务断言失败（Assertion Failure）；
  ERROR = 自动化脚本/基础设施异常（Automation Error）。合并统计视为不合格。
- `pending_review` 用例逐条列出并标 **Not Executed（待人工审核）**，严禁计入 Pass 或悄悄省略。
- 总耗时、新增/更新 TestCase 数、新增/更新脚本数。
- 失败分析：**每个 FAIL/BLOCKED 归入 testcase-rule §9 的分类**（产品缺陷/脚本/环境/配置/
  第三方/网络/测试数据）+ 疑似源码 file:line；**禁止一律归为产品Bug**。
- **Not Executed 必须逐项说明原因**（环境/权限/账号/框架/接口/依赖/服务/数据空档/时间未及扩展），
  严禁把未执行项标记为 Pass。
- 环境恢复情况（Teardown 是否成功；失败则 Warning + 残留定位）。

## 二点六、最终自检（Self Review，输出报告前必做，并写入报告末尾）

- [ ] 所有用例均已真实执行或说明未执行原因
- [ ] 所有新增测试已纳入统计
- [ ] Pass / Fail / Blocked / Not Executed 数量前后一致
- [ ] 所有 Fail/Blocked 均有证据 + 归因分类
- [ ] 所有 Not Executed 均说明原因
- [ ] 缺陷候选均标注严重程度 + 【疑似原因】（证据不足时）
- [ ] 报告无主观措辞，可直接交付客户

## 三、Execution Evidence（强制）

每次执行必须记录，不得仅报告 PASS：
- Test Runner（Playwright）
- Command（实际执行命令）
- Exit Code
- Duration

## 四、Token 控制

- 历史 PASS 用例仅**引用**（ID + 状态），不展开正文。
- 日志最多 20 行。
- 截图仅保留相对路径。
- 已存在 TestCase 仅输出**修改内容**。
- 已存在脚本仅输出 **Diff**。

## 五、🏁 Final Check Gate（完成前逐项确认，与 auto-test-agent §Gate 一致）

- [ ] 已声明本次 Execution Mode（full-auto / human-in-the-loop）
- [ ] 已生成独立批次报告 `RUN-YYYYMMDD-HHMMSS.md`，历史报告未被覆盖/删除
- [ ] 已声明证据来源轨（A/B，见 §零）；A 轨：每个数据组都有**实际输入数据**记录，追踪链完整
      （Case→DataGroup→输入→预期→实际→结果）；B 轨：如实标注降级，未伪装成已满足
- [ ] FLAKY 条目已单独列出（不并入稳定 PASS）
- [ ] 每个 FAIL 均已过 `rules/execute-rule.md §二` 的 TRIAGE 与 Evidence Gate；
      证据不足者标 `UNKNOWN` + 下一步所需证据，未编造根因
- [ ] 诊断探针已清理（`tests/**/_diag-*.ignore.ts` 无残留）
- [ ] FAIL（Assertion Failure）与 ERROR（Automation Error）已分开统计与呈现
- [ ] Case Status 与 Execution Result 未混用；无"业务断言失败被写成 failed"的情况
- [ ] `pending_review` 用例全部标 Not Executed，未被自动执行
- [ ] 已分析源码，**已识别多分支变体页面并构建变体矩阵**
- [ ] 已维护 TestCase（含 VARIANT 矩阵 + 数据变体）
- [ ] 已维护脚本（含参数化变体矩阵）
- [ ] **已做真实渲染探测**（确认非白屏假通过）
- [ ] 已真实执行测试（串行 + 隔离）
- [ ] 已完成数据库断言（无 DB 工具时标 Not Executed 并说明）
- [ ] 已回写 PASS/FAIL/BLOCKED/Not Executed（含归因分类）
- [ ] **变体矩阵每一行都有真实结果或 BLOCKED/Not Executed 说明**（无静默跳过）
- [ ] 已执行 Teardown
- [ ] **已生成用例审查 HTML 视图**（`docs/testcases/<module>/html/index.html` + 每条用例单页，见 §一点五）；
      非 Node 项目则已标 Not Executed + 原因
- [ ] 报告 Detailed Test Results **每条都有「测试步骤」**（非"见用例"占位），且含 §4.0 用例明细索引
- [ ] **所有文档产物落在 `<cwd>`（仓库根）**：路径不含 `<frontend>` 目录名（见 §一 落盘基准）
- [ ] 已生成**客户交付版**测试报告并通过 Self Review

任一未完成：不得输出"任务完成"，只能继续执行或输出 BLOCKED。

## 六、✅ 最终 Summary（统一输出）

- Run ID / Execution Mode：`RUN-YYYYMMDD-HHMMSS` / `full-auto | human-in-the-loop`
- Case 状态分布：pending_review / ready / running / completed / failed 各 N
- 源码分析：完成
- TestCase：新增/更新数量（复用 N 条，去重跳过 N 条）
- 自动化脚本：新增/更新数量
- PASS / FAIL / BLOCKED
- 数据库断言：结论
- 环境恢复：成功 / Warning
- 输出文件列表
