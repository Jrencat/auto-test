# execute-rule —— 执行、重试、失败归因与证据收集

对应主流程 Step7 / Step8。

> 命令与工作目录来自绑定 `project.json.commands`（cwd = `<frontend>`，见 runtime.local.json）。

## 零、执行前置：批次 ID 与状态置位

1. **生成批次 ID**：`RUN-YYYYMMDD-HHMMSS`（`node tests/support/caseStore.ts run-id`），
   通过环境变量 `AUTO_TEST_RUN_ID` 下发给 Playwright，使所有执行记录归入同一批次。
2. **状态置位**：把本次要执行的 Case 从 `ready → running`（最小化回写）。
   - 只有 `ready`（或上次中断残留的 `running`）能进入执行；
     **Repeat Run 例外**：`completed` / `failed` 用例经 `rules/case-store-rule.md §九 Cheap Reuse Gate`
     判定为 `REUSE` 后，按 §三"合法转换"置 `completed|failed → running` 进入执行（重跑）。
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
- **诊断探针即用即删**：为定位问题临时新建的探针脚本统一命名 `_diag-<caseId>.ignore.ts`
  （`.ignore.ts` 不匹配 `testMatch` 的 `*.api.spec.ts` / `*.e2e.spec.ts`，天然不会混入正式套件）。
  定位完成后按 `tests/**/_diag-*.ignore.ts` 一次性清理，不得留在 `<frontend>/tests/` 目录。

## 一点五、执行后状态回写（Step9）与失败类型区分（强制）

| 实际情况 | Case Status | Execution Result | Failure Type |
|---------|-------------|------------------|--------------|
| 用例跑完，断言全过（首次即过） | `completed` | `PASS` | — |
| **首次失败、retry 后转 PASS**（`results.json` 中 `status=flaky`） | `completed` | `PASS` | **`FLAKY`** |
| 用例跑完，**业务断言失败** | `completed` | `FAIL` | `Assertion Failure` |
| Playwright 启动失败 / 脚本语法错误 / 浏览器起不来 / 测试环境不可用 | `failed` | `ERROR` | `Automation Error` |
| 数据占位符未补 / 权限缺失 / 数据空档，未执行 | 保持原状态 | `BLOCKED` | `Blocked` |

- **`completed ≠ PASS`**：只要测试正常跑完，哪怕断言全红，Case Status 也是 `completed`。
- **`retries: 1` 是免费的 FLAKY 证据源，不得浪费**：retry 后转 PASS 说明该用例**不稳定**，
  Execution Result 记 `PASS`、Failure Type 必须记 `FLAKY`，并进 §二 TRIAGE 第 3 行；
  **严禁**当作稳定 PASS 静默略过（不稳定用例会掩盖真实竞态/时序缺陷）。
- **严禁**把业务断言失败写成 `status: failed`——那会把产品缺陷伪装成自动化故障，掩盖真实问题。
- 回写只改 `status` / `updated_at` / `last_run_id` / `last_run_status` 四个字段，
  正文与人工修改内容一律不动（见 `rules/case-store-rule.md §五`）。

## 二、失败诊断（重试仍失败才进入；PASS 一律不进入）

> **反馈回路已经存在**：该用例的 `npx playwright test <file> -g "<用例名>"` 就是本次诊断的红灯回路
> （已跑过、可复现、秒级、可无人值守），**不得另建回路、不得先读源码再建理论**。
> **Full-Auto 不因诊断增加任何人工确认点**；诊断全程连续执行，仅 BLOCKED 可暂停。

### 2.1 TRIAGE —— 先分流，再决定读什么（强制第一步）

逐行自上而下匹配，**命中即按该行执行**；未命中任何行 → 第 8 行 `UNKNOWN`。

| # | 分类 | 最小充分证据（缺一即不得下此结论） | 允许读源码 | STOP 条件 |
|---|------|-----------------------------------|-----------|----------|
| 1 | `INFRASTRUCTURE_BUG` | 非零 Exit Code + stderr：浏览器缺失 / 脚本语法错误 / Runner 起不来 / setup 登录失败 | ❌ | 拿到命令级证据即结案 → `ERROR` + Case `failed` |
| 2 | `ENVIRONMENT_BUG` | 真实渲染探测失败（`body.innerText()` 长度异常）或依赖服务不可达或配置实测不符（如 `config.json` 404），见 `rules/environment-rule.md §真实渲染探测` | ❌ | 探测可复现即结案；**只改测试配置，不改应用源码** |
| 3 | `FLAKY` | 隔离重跑（见 2.4）结果不一致，或 retry 后转 PASS | ❌ | 结果不一致即结案；Execution Result 按实际记，**Failure Type 必须记 `FLAKY`**，不得静默当稳定 PASS（口径见 §一点五） |
| 4 | `TEST_DATA_BUG` | **先直接调用查询接口核实**数据确实不存在/状态确实不符（`rules/testcase-rule.md §9` 强制规则）。接口返回了预期数据 → **禁止**归入本类 | ❌ | 接口核实完成即结案 |
| 5 | `TEST_BUG` | 接口层数据正确 + 选择器/等待/断言口径与 `rules/script-rule.md §选择器手册` 不符（附实际 DOM 文本或表头聚合值） | ✅ 仅 `<frontend>/tests/` | 改脚本后重跑转绿即结案 |
| 6 | `PRODUCT_BUG` | 同时满足：①接口层数据正确 ②脚本口径正确（**含请求体必填字段与前端真实交互路径一致**）③隔离重跑稳定复现 ④已抓 `pageerror`/`console.error` 或后端异常响应 ⑤**已排除"仅自动化环境可复现"**（真实浏览器路径同样复现，或已排除 CDP/驱动差异等变量） | ✅ 按 `rules/source-analysis-rule.md §一` 链路，**只读到能定位 file:line 为止** | 定位到 file:line 即结案；缺 ⑤ → 归 8 并标注"疑似自动化环境专属"，**不得报为产品缺陷**；其余证据不足 → 转 8 |
| 7 | `SPECIFICATION_ERROR` | 用例预期与源码硬编码枚举分支/需求文档原文**并列可比对**，证明是预期写错而非实现错 | ✅ 仅相关分支代码 | **必须提请人工确认，不得自行修改用例 Expected/断言** |
| 8 | `UNKNOWN` | 以上证据均不足 | ❌ | **立即结案**，写明"下一步需要什么证据"，不得为凑结论继续扩大 Context |

**第 4 行与第 5/6 行的依赖（强制）**：判定第 4 行时**必须先做接口核实**。核实结果为
「数据存在且状态符合」则第 4 行未命中，**该结果即作为第 5/6 行「接口层数据正确」的证据**；
**未做核实不得进入第 5/6 行，也不得下 `TEST_DATA_BUG`。**

**与既有分类的映射**（不建第二套体系，报告仍按 `rules/testcase-rule.md §9` 口径呈现）：
`PRODUCT_BUG`→产品缺陷（可再注前端/后端/数据库层）｜`TEST_BUG`→自动化脚本问题｜
`TEST_DATA_BUG`→测试数据问题｜`ENVIRONMENT_BUG`→环境问题/配置问题｜
`INFRASTRUCTURE_BUG`→环境问题（基础设施）/第三方依赖/网络问题｜`FLAKY`/`SPECIFICATION_ERROR`/`UNKNOWN` 为新增。

### 2.2 Evidence Gate（强制）

**没有该行要求的证据，就不许写该行的结论。** 证据不足时唯一合法结论是 `UNKNOWN`。
禁止"看起来像 X"即下结论，禁止未核实就写"测试数据陈旧/标识已失效"（`testcase-rule §9` 记载的真实事故）。

### 2.3 HYPOTHESIS（仅第 5/6/7 类需要）

- 提出 **2–4 个**假设；已有强证据直接指向一个时可少于 2 个，**不得为凑数编低质量假设**。
- 每个假设必须写出**证伪条件**：「若 X 是原因，则改变 Y 后失败消失 / 改变 Z 后失败加重」。
- 写不出证伪条件的不算假设，直接丢弃。"可能是前端 / 可能是后端 / 可能是数据"**一律不算假设**。
- 验证时**一次只变一个变量**；怀疑某维度时用**正交维度对照数据**交叉验证（`testcase-rule §9.3`）。

### 2.4 REPRODUCE（所有 FAIL 通用，非仅单点登录场景）

确认当时无其它 playwright 进程后，用 `-g "<用例名>"` **完全隔离重跑**；隔离结果与首次不一致时
以隔离结果为准并在报告说明。可缩小到**单数据组 / 变体矩阵单行**重跑，
但**禁止**为缩小范围而删步骤、删断言、降覆盖（见 `rules/auto-test-agent.md §覆盖策略`）。

### 2.5 Diagnostic Budget（每次扩大 Context 前自问，答不上就 STOP）

缺什么信息？为什么需要？能区分哪几个假设？拿到后判断会怎样改变？仍判断不了的下一步是什么？
**新增信息不能区分假设 → 立刻 STOP 并结案为 `UNKNOWN`。**

### 2.6 ROOT CAUSE / FIX / RETEST / REGRESSION

- **默认仍为「仅定位与记录，不改业务代码」**；仅在用户明确要求、或项目规范允许时才修，且**最小范围**。
- 修改后必须 RETEST（重跑原用例）；影响范围不确定时**扩大**回归范围，不得为省成本缩小。
- **回归用例**：仅当项目**已安装 case-store**（存在 `<caseDir>` 且脚本已接入 `caseStore.ts`）时，
  才按 `rules/case-store-rule.md §六` 去重后新增回归 Case。
  **未安装 case-store 的项目：假设、证据、根因、回归建议一律只写入本轮 `RUN-*.md`，禁止创建 Case 资产。**
- 诊断产物（TRIAGE 分类 / 假设与证伪 / 证据 / 根因或 `UNKNOWN` + 下一步）写入本轮批次报告与最终报告；
  Case 文件仍只回写既有 4 个字段（`rules/case-store-rule.md §五`）。

### 2.7 〔v1.1.0〕诊断落盘 —— FAIL Feedback Loop 最小闭环

本轮存在 FAIL / ERROR 时，**必须**把上述诊断结论投影成结构化 Artifact：

```
<cwd>/.auto-test/diagnostics/DIAG-<RunId>.json   （机器可读，供下次 Resume 消费）
<cwd>/.auto-test/diagnostics/DIAG-<RunId>.md     （人可读，与批次报告互链）
```

每条 item 至少含：`caseId` / `dataGroupId` / `result` / `failureType` / `triage`（§2.1 八分类）/
`evidence[]`（证据文件路径）/ `hypotheses[]`（仅 5/6/7 类，含 `falsifiableBy`）/
`rootCause`（或 `null`）/ `nextEvidence`（`UNKNOWN` 时必填）/ **`recoveryEntry`**。

`recoveryEntry` 字段结构与完整示例见 `agents/executor-reporter.md §4`：

```
recoveryEntry: { agent: "script-engineer|case-designer|null", action: "...", command: "npx playwright test <file> -g \"<用例名>\"" }
```

**定位**：这是"可持久化的诊断与恢复**入口**"，**不是**自动 Debug 系统。
本版本**不**要求自动修改业务源码、不要求多轮自主修复、不要求无限 Retry；
§2.1~§2.6 的既有诊断能力**原样复用**，本节只增加"落盘 + 恢复入口"这一层。

## 三、证据收集（Step8）与 Token 控制

- **逐数据组写执行记录**（强制）：每个 Data Group 执行完立即 `recordResult()` 追加到
  `<reportDir>/<RunId>.jsonl`，字段含 Case ID / Data Group ID / **实际输入数据** / 预期 / 实际 /
  Result / Failure Type / 耗时 / spec 文件。报告阶段直接聚合该文件，杜绝"报告与实际执行对不上"。
- **日志仅保留最后 20 行**。
- **截图仅保留相对路径**（Playwright 失败自动截图，位于 `<frontend>/playwright-report/` / `test-results/`）。
- **数据库仅输出关键字段变化**：绑定 `assertLayers.database.keyFields` 指定的字段（操作前 → 操作后）。
- trace：`retain-on-failure`（失败时保留，供回溯）。

### 三点一、原始证据落盘 → 投影 → 入 LLM（强制，Context 准入）

原始证据**必须完整落盘、可追溯**，但**禁止整份进入 LLM**：

| 产物 | 处置 |
|------|------|
| `playwright-report/index.html` | 落盘，**永不入 LLM**（体量数百 KB，无结构化取值） |
| `playwright-report/results.json` | 落盘，**不整份入 LLM**；按下方命令投影后入 |
| `test-results/` 下 trace / 截图 / 视频 | 落盘，**只把相对路径入 LLM** |
| 终端 stdout | 只取最后 20 行（见上） |

**投影命令**（在 `<frontend>` 执行；Playwright 的 json reporter 已在 `playwright.config.ts` 配好，无需新增依赖）：

```bash
node -e "
const fs=require('fs');const r=JSON.parse(fs.readFileSync('playwright-report/results.json','utf8'));
const out=[];const walk=s=>{(s.suites||[]).forEach(walk);(s.specs||[]).forEach(sp=>sp.tests.forEach(t=>{
  if(t.status==='expected'||t.status==='skipped')return;              // 只留 unexpected / flaky
  const res=(t.results||[]).slice(-1)[0]||{};
  out.push({file:sp.file,title:sp.title,project:t.projectName,status:t.status,
    ms:res.duration,retry:res.retry,
    err:(res.errors||[]).map(e=>String(e.message||'').split('\n').slice(0,8).join('\n'))});}));};
r.suites.forEach(walk);
console.log(JSON.stringify({stats:r.stats,failures:out},null,1));"
```

- 输出的 `stats` 用于结果统计，`failures[]` 用于 §二 TRIAGE 的入口证据。
- `status` 取 `unexpected`（失败）与 `flaky`（retry 后转 PASS，见 §一点五）；`expected`/`skipped` 不投影。
- 每条错误只取前 8 行（含断言消息与首层调用点），需要完整堆栈时按 `file` + `title` 回原始 json 取。
- **禁止**在没有先做投影的情况下把 `results.json`、`index.html` 或完整终端输出贴入上下文。
- **json 路径取 Playwright 配置的 reporter 输出**（`playwright.config.ts` 的 `reporter` → `json` → `outputFile`，
  默认 `playwright-report/results.json`）。文件不存在或解析失败时：**不得**改读 `index.html`、
  完整终端输出或整份 json；记 `UNKNOWN` 或 `INFRASTRUCTURE_BUG`，写明缺失的路径，进入 §二。

#### ⚠ 分批执行会覆盖 results.json —— 必须每批投影并落盘

`results.json` 由**每一次 `npx playwright test` 调用整体重写**。因此当本轮采用分批执行
（如 `--project=api` 与 `--project=e2e` 分开跑、或按文件分批重跑）时，
**最后一批会覆盖掉之前所有批次的结果**，`results.json` 只保留最后一批。

由此产生的真实事故：报告需要的总数（数据组数 / PASS / FAIL / FLAKY / duration）在
`results.json` 里根本不存在，于是被**人工逐条数出来**——既昂贵又不可复核。

**强制做法**（不新增脚本/CLI/Cache/Schema，只是把已有投影命令的时机与去向固定下来）：

1. **每批执行结束后、下一批开始之前**，立即运行上方投影命令；
2. 把该批投影结果**追加**（append，禁止覆盖）到本轮已定义的机器记录文件
   `<reportDir>/<RunId>.jsonl`（该文件在 `rules/case-store-rule.md §一` 已定义，非新增产物），
   每批一行，含 `batch`（命令）、`stats`、`failures[]`；
3. 报告阶段的统计**一律从该 `.jsonl` 聚合得出**：
   `PASS = Σ stats.expected`、`FAIL = Σ stats.unexpected`、`FLAKY = Σ stats.flaky`、
   `skipped = Σ stats.skipped`、`duration = Σ stats.duration`；
4. **禁止**为了统计而重新读取 `results.json`、`index.html` 或完整终端输出；
5. **禁止**由 LLM 手工清点数据组、PASS/FAIL 条数、文件字节数等可机械获得的数字。

```bash
# 每批执行后立即追加（<RunId> 取 AUTO_TEST_RUN_ID）
node -e "<上方投影命令>" | node -e "
const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const p=process.argv[1], line=JSON.stringify({batch:process.argv[2],...JSON.parse(s)});
  fs.appendFileSync(p,line+'\n');});" "<reportDir>/<RunId>.jsonl" "<本批命令>"
```

> **不改变证据轨定级**：本节只保证"机械统计不再靠人工清点"。
> 是否为 A 轨仍按 `rules/report-rule.md §零` 判定——投影里**没有逐数据组的实际输入数据**，
> 因此未接入 `caseStore.ts` 的项目**依然是 B 轨**，不得因为有了 `.jsonl` 就自称 A 轨。

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
