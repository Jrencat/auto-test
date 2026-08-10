# test-data-rule —— 测试数据显式化、Test Data Matrix 与参数化驱动

对应主流程 **Step5 / Step6 / Step7**。

> **最终原则：Test Data Matrix 不是展示文档，而是自动化测试的真实输入来源。**

## 一、测试数据必须显式、具体、可执行

生成测试用例时（Human-in-the-Loop 下尤其强制，Full-Auto 同样适用）：

**严禁**使用抽象描述充当测试数据：

```
❌ 输入合法用户名
❌ 输入边界值
❌ 输入特殊字符
❌ 输入超长文本
```

**必须**给出具体、明确、可直接执行、可人工审核的数据：

```
✅ username = admin@example.com
✅ password = 12345                （低于最小长度 6）
✅ username = ' OR '1'='1          （SQL Injection）
✅ username = <script>alert(1)</script>（XSS Payload）
✅ name     = <256 个 A 的字符串，写清实际长度>
```

抽象类别（边界/超长/特殊字符…）只能出现在**「数据特征」列**，不能出现在**「具体测试输入」列**。

## 二、Test Data Matrix（用例正文必含章节）

```markdown
## 测试数据明细

| 数据组 ID | 字段名称 | 具体测试输入 | 数据类型 | 数据特征/类型 | 预期校验结果 |
|---|---|---|---|---|---|
| D001 | username | `admin@example.com` | string | 正常值 | 允许提交 |
| D002 | password | `12345` | string | 低于最小长度 | 提示密码至少 6 位 |
| D003 | username | `' OR '1'='1` | string | SQL Injection | 拒绝非法输入 |
| D004 | username | `<script>alert(1)</script>` | string | XSS Payload | 字符被转义，不执行脚本 |
```

六列语义（列名支持中英文别名，解析器按语义识别，不依赖列序）：

| 列 | 语义 | 别名示例 |
|----|------|---------|
| 数据组 ID | 一次完整参数化输入的分组键 | `数据组ID` / `group` |
| 字段名称 | 被赋值的字段/参数名 | `字段` / `field` |
| 具体测试输入 | **真实值**（可用 code span 包裹） | `输入值` / `取值` / `value` / `input` |
| 数据类型 | string / number / boolean / file … | `类型` / `type` |
| 数据特征/类型 | 正常值 / 边界 / 超长 / XSS … | `特征` / `trait` |
| 预期校验结果 | 该输入的期望系统行为 | `预期结果` / `预期` / `expected` |

## 三、Data Group 规则（最易出错，强制）

**同一个「数据组 ID」的多行 = 一次完整的参数化测试输入。**

```
| D001 | username | admin  | string | 正常值 | -        |
| D001 | password | 123456 | string | 正常值 | 登录成功 |
```

等价于一次输入：

```javascript
{ username: "admin", password: "123456" }
```

**禁止**把 `username=admin` 和 `password=123456` 拆成两个独立测试执行。

- 组内**预期结果**：取组内所有非空、非 `-` 的预期值，按出现顺序合并（通常最后一行给出整体期望）。
- 组内**数据特征**：合并去重，用于报告的极端数据覆盖统计。
- 组的执行顺序 = 数据组 ID 在表中的首次出现顺序。

## 四、🚫 禁止伪造测试数据

具体数据只能来自可靠来源：项目代码 / API 定义 / 数据库 / Fixture / Mock 数据 /
既有测试数据 / 项目文档 / 已有测试用例 / 明确的业务规则。

**禁止**凭空编造看似真实的业务数据，例如随手写出：

```
❌ compoundId=10001    ❌ deviceId=20001    ❌ sampleId=30001
```

缺少具体数据时的处理：

| 模式 | 处理 |
|------|------|
| **Full-Auto** | 可用：已知可靠 Fixture / 明确边界值 / 可安全构造的数据（如 `<dataIsolationPrefix>` 前缀数据）；<br>仍无法构造 → 该数据组标 `BLOCKED`，在报告**明确记录无法自动验证的原因**，禁止编造后跑通 |
| **Human-in-the-Loop** | 在「具体测试输入」写 `TODO` 或 `REQUIRED_INPUT` 作为待人工补充项，<br>并保持 `status: pending_review`，在审核指引里列出待补字段 |

含 `TODO` / `REQUIRED_INPUT` 的数据组**不得执行**；整条 Case 不得进入 `ready`
（解析器 `hasPlaceholder` 已标记，见 `caseStore.ts`）。

真实标识（单号/编号等）优先**执行前动态查询**，不要写死历史快照值——
见 `rules/source-analysis-rule.md §1.6` 与 `tests/support/resolveActionNo.ts`。

## 五、Markdown 解析要求（容错但不改变语义）

解析优先复用 `templates/scaffold/support/caseStore.ts` 的 `parseDataMatrix()`。必须稳定处理：

- 单元格前后空格 → 去除；
- 整体被 code span 包裹（`` `value` ``）→ 去掉反引号，**内部内容原样保留**；
- 空单元格 → 空字符串（不丢弃整行）；
- 转义竖线 `\|` → 还原为 `|`，不破坏表结构；
- 特殊字符 / Emoji / 多语言 / HTML / SQL 片段 → 原样保留；
- 表头别名与列序变化 → 按语义识别；
- 缺少「数据组 ID」或「字段名称」的行 → 跳过该行，不影响其余数据；
- 表中空行 → 容忍；表结束（非表格行）→ 停止解析。

**容错不得改变测试数据的实际含义**：不做 trim 以外的清洗，不做大小写归一，
不去除数据内部空格，不"修正"看起来像错别字的值。

## 六、测试数据必须真正驱动 Playwright

必须建立并保持这条链路：

```
Case → Test Data Matrix → Data Group → Playwright 参数化输入 → 实际执行 → 实际结果
```

**禁止**出现文档写 `username = ' OR '1'='1`、脚本实际跑 `username = admin` 的数据不一致。

实现方式（优先复用现有 Playwright Test Runner，不重写测试框架）：

```ts
import { test, expect } from '../support/fixtures';
import { loadExecutableCases, recordResult, RUN_ID } from '../support/caseStore';

// 只取 status=ready（或中断残留 running）的用例，pending_review 天然不会被执行
for (const tc of loadExecutableCases().filter((c) => c.frontmatter.id.startsWith('TC-AUTH'))) {
  for (const g of tc.dataGroups) {
    test(`${tc.frontmatter.id} - ${g.id} - ${g.traits.join('/')}`, async ({ page }) => {
      const started = Date.now();
      let actual = '';
      try {
        // ⚠ 输入一律取自 g.input，禁止在脚本里另写字面量
        await page.fill('#username', g.input.username ?? '');
        await page.fill('#password', g.input.password ?? '');
        await page.click('button[type=submit]');
        actual = await page.locator('.result, .ant-message').innerText();
        expect(actual, `期望：${g.expected}`).toContain(g.expected);
        recordResult({ caseId: tc.frontmatter.id, caseTitle: tc.frontmatter.title, groupId: g.id,
          input: g.input, expected: g.expected, actual, result: 'PASS',
          durationMs: Date.now() - started, specFile: __filename });
      } catch (e) {
        // 业务断言失败 → FAIL/Assertion Failure；自动化异常 → ERROR/Automation Error
        const isAssertion = e instanceof Error && /expect|toContain|toBe/.test(String(e.message));
        recordResult({ caseId: tc.frontmatter.id, caseTitle: tc.frontmatter.title, groupId: g.id,
          input: g.input, expected: g.expected, actual, result: isAssertion ? 'FAIL' : 'ERROR',
          failureType: isAssertion ? 'Assertion Failure' : 'Automation Error',
          error: String(e), durationMs: Date.now() - started, specFile: __filename });
        throw e;
      }
    });
  }
}
```

要点：

- 数据组**逐组一条 test**，互不影响（单组失败不阻断其它组）。
- 测试标题必须含 **Case ID + Data Group ID**，使报告可反查。
- 若项目 Runner 已有 `test.each()` 等数据驱动机制 → **优先复用**，不必改用上述循环。
- `recordResult` 把每个数据组的真实输入/预期/实际/结果写入 `<reportDir>/<RunId>.jsonl`，
  报告阶段直接聚合，杜绝"报告与实际执行对不上"。

## 七、执行追踪链（报告必须能还原）

```
Case ID → Data Group ID → 实际输入数据 → 预期结果 → Playwright 实际执行 → 实际断言结果
```

示例：

```
TC-AUTH-001 → D003 → username = ' OR '1'='1 → 预期：拒绝非法输入
            → Playwright 实际输入同值 → 实际结果：PASS
```

任何一环缺失（尤其"实际输入数据"）即视为报告不合格，见 `rules/report-rule.md §Final Gate`。
