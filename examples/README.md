# examples —— 三个代表 Spec 与 Harness 接线模式

```bash
node examples/run-specs.mjs                                  # 写到 <cwd>/.auto-test
AUTO_TEST_DIR=/tmp/demo/.auto-test node examples/run-specs.mjs
```

零依赖、无需浏览器与网络，任何机器上都能一键复现。

## 三个代表 Spec

| Spec | 场景 | 预期终局 |
|------|------|---------|
| `specs/01-login.spec.mjs` | 稳定 PASS | `FINALIZED_PASS` |
| `specs/02-solution-config.spec.mjs` | 真实 Product Bug（`fake-app.js` 里故意保留的分支缺失） | `FINALIZED_FAIL` |
| `specs/03-stock-flaky.spec.mjs` | Retry / Flaky / Evidence（被测系统首调真实抛错） | **`FLAKY`**（不是 PASS） |

被测对象是 `fake-app.mjs` —— 它真的会通过、真的会失败、真的会抖动，
因此产出的是**真实**的 Run / Attempt / Assertion / Evidence，而不是断言桩伪造的结果。

## 接线模式：v1.x → 2.0

### v1.x 的问题

```js
// 断言只存在于脚本里；跑绿了 = 通过。
// Harness 无从知道「A1 这条断言这次到底有没有被真的验证过」。
await expect(page.getByRole('button', { name: '继续填写' })).toBeVisible();
```

结果：报告只能从 `results.json` 投影出计数，拿不到逐条断言与逐组输入
——这正是 v1.x 报告里那句「证据轨 B 降级」的由来。

### 2.0 的接线

```js
import * as core from 'auto-test';   // 或相对路径 ../core/index.mjs

const runId = core.startRun({ caseId: 'TC-LOGIN-001', actor: 'agent', runtime: 'playwright' }).run_id;
const attemptId = core.startAttempt(runId).attempt_id;

core.recordStep(runId, attemptId, { name: '打开登录页' });

// 1) 证据先落盘（Playwright 的截图/trace 路径直接传进来即可）
const shot = await page.screenshot({ path: 'tmp/after-login.png' });
const ev = core.addEvidence(runId, attemptId, { type: 'screenshot', file: 'tmp/after-login.png' });

// 2) 断言用 Case 里声明的 Assertion ID 登记，并绑定证据
const actual = page.url();
core.recordAssertion(runId, attemptId, {
  assertionId: 'A1',                      // ← 来自 Case 的「断言定义」表
  status: actual.endsWith('/home') ? 'PASS' : 'FAIL',
  expected: '/home',
  actual,
  evidenceRefs: [ev.evidence_id],
});

core.finishAttempt(runId, attemptId, { status: 'PASS', exitCode: 0 });
core.recordClaim(runId, 'PASS');          // ← 只是 Claim，不是结论

const verdict = core.finalizeRun(runId);  // ← 结论在这里产生
```

### 三条必须记住的纪律

1. **断言输入取自 Case，不写字面量。**
   `core.loadCase(caseId).test_data` 给出 Data Group；脚本里再写一遍常量，
   就回到了 v1.x「文档写 X、脚本跑 Y」的老问题。

2. **PASS 也要留证据。**
   Evidence Policy 默认要求每条已求值的必需断言至少 1 份证据。
   `screenshot: only-on-failure` 会让通过的用例在磁盘上等于没发生过。

3. **脚本不宣布结论。**
   脚本只登记事实与 Claim；`FINALIZED_PASS` 只能由 `core.finalizeRun()` /
   `auto-test finalize` 给出。这是 Agent 无法绕过 Harness 的那道闸。

## 与 Playwright 的关系

Core 不感知 Playwright，Playwright 也不感知 Core——两者通过上面这几个调用接在一起。
换成 pytest、JUnit、Newman 或纯 HTTP 脚本，接线方式完全一样。

`retries` 的处理需要改一处：把 Playwright 的自动重试关掉（`retries: 0`），
改由脚本按 `core.shouldRetry()` 显式开启新的 Attempt。
否则 Playwright 会在 Core 看不见的地方把多次尝试折叠成一个 `flaky` 计数，
Attempt 1 的证据与错误就丢了——这正是 `03-stock-flaky.spec.mjs` 演示的差别。
