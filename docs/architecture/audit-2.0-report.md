# Auto-Test 2.0 架构审计报告（第一阶段）

> 阶段：**READ → AUDIT → CAPABILITY MAP → GAP ANALYSIS → ARCHITECTURE DESIGN → MIGRATION DESIGN → REPORT**
> 审计日期：2026-09-07 ｜ 对象：`auto-test` v1.1.0（`026df6b`，tag `v1.1.0`，`main` 与 `origin/main` 一致）
> 真实项目样本：V-LIMS（22 条 Case、5 个 RUN 批次、40 余个 Playwright spec）
>
> **本阶段未修改任何生产代码，未重写 SKILL.md，未创建实现代码。**
> 本目录下 6 份文档是本阶段的全部产出。

---

## 1. Executive Summary

### 结论

**v1.x 是一套优秀的 Agent 引导规范，但它不是 Harness。**

审计发现的核心事实不是"某个功能没做好"，而是一个结构性问题：

> **v1.x 中几乎所有工程确定性都用自然语言表达，
> 因此它们的实际执行率等于模型的自觉率，而不是 100%。**

三条实证（全部可在磁盘上复核）：

| 规范 | 强制方式 | 真实执行率 |
|------|---------|----------|
| "逐数据组 recordResult" | Prompt | **0 / 40 个 spec** |
| "Test Data Matrix 必须驱动 Playwright" | Prompt | **0**（全部手抄字面量，spec 注释自认） |
| "证据轨 A/B 必须如实标注" | **代码** | **100%** |
| "非法状态转换必须报错" | **代码** | **100%** |

这不是模型不听话——恰恰相反，被审计的这些 Run 表现得相当诚实：
如实标注 B 轨降级、如实把 6 条标为 BLOCKED、拒绝把未完整覆盖的 Case 标为 completed。
问题在于**这些诚实每次都要重新发生一遍**，而系统没有任何机制保证下一次也如此。

### 2.0 的定位

```
把已经写清楚的规范，从 Prompt 强制改为代码强制。
不增加规范，不增加 Agent，不增加流程节点。
```

Auto-Test 2.0 = **Agent-Native Software Testing Harness**：
Agent 决定怎么测；Harness 保证测了、可验证、有证据、能诊断、可复现、可比较。

### 关键判断（三条）

1. **Multi-Agent 层应从 Core 移除。** 实证显示它未承重（5 个 Agent 只有 3 个留下回执，
   `analysis/` 产物从未生成，协议违反无任何检测机制），且是 Runtime 耦合的主要来源。
2. **CLI 是 P1 而非"以后再说"。** 它是把 Prompt 规范转成工程约束的最小成本手段。
   没有 CLI，2.0 只是换一套措辞的 v1.2。
3. **必须取消"证据不足仍给结论"的降级通道。** 证据轨 B 是 v1.x 最大的设计漏洞——
   它让规范可以被合理绕过，而且每一次真实运行都在绕。

### 现状打分

对照最终成功标准 17 项，**当前满足 2 项**（Agent 自由决定策略、Playwright 可靠执行）。
其余 15 项的差距全部指向同一个根因：**没有机器可验证的 Run / Evidence / Assertion 模型。**

---

## 2–10. 现状（详见 Capability Matrix）

| 报告章节 | 位置 |
|---------|------|
| 2. Current Architecture | `agent-native-capability-matrix.md` §一 |
| 3. Current Data Flow | 同上 §一、§三 |
| 4. Current Capability Matrix | 同上 §二 |
| 5. Declared vs Implemented vs Executed vs Verified | 同上 §三（8 条关键证据） |
| 6. Current Agent Responsibilities | 同上 §五 |
| 7. What Strong Agents Can Now Handle Natively | 同上 §5.1 |
| 8. What Should Be Removed From Auto-Test | 同上 §5.1 + `migration-plan.md` §2.3 |
| 9. What Auto-Test Capabilities Become MORE Valuable | 同上 §5.2、§5.3 |
| 10. Current Architecture Problems | 同上 §三、§四 |

### 现状问题速览（十条，按严重度）

1. 🔴 **Run Persistence 从未接线** —— `recordResult()` 实现完整但 0 调用点，追踪链在真实项目中不存在
2. 🔴 **Test Data 未驱动 Playwright** —— 手抄字面量，规范要防的不一致就是当前默认状态
3. 🔴 **PASS 时零证据** —— `only-on-failure` 与 "Evidence First" 完全相反
4. 🔴 **无 Assertion 模型** —— 断言无 ID、无关联、无法跨 Run 比较
5. 🔴 **执行层与证据层全部 gitignore** —— Regression 在结构上不可能
6. 🔴 **Pipeline State 自相矛盾** —— LLM 手写散文（`state: FINALIZED` 与 `note: REPORT_READY` 并存）
7. 🔴 **Agent Claim 无独立验证** —— `outputsVerified: true` 由被验证方自报
8. 🟡 **Attempt 被折叠** —— FLAKY 语义丢失，`results.json` 分批被覆写
9. 🟡 **Resume 粒度过粗** —— 最小单位是一整次 playwright 调用，未经真实中断验证
10. 🟡 **Multi-Agent 未承重且 Runtime 耦合** —— 协议无强制、无检测、`analysis/` 空转

---

## 11–30. 2.0 设计（详见各设计文档）

| 报告章节 | 位置 |
|---------|------|
| 11. Proposed 2.0 Architecture | `harness-architecture.md` §三 |
| 12. Harness Core Boundary | 同上 §二、§四 |
| 13. Test Case Model | `test-model.md` §二 |
| 14. Test Run Model | 同上 §三（含 Attempt / Step / events.jsonl） |
| 15. Evidence Model | 同上 §五 |
| 16. Assertion Model | 同上 §六 |
| 17. Policy Model | `policy-and-diagnostics.md` §零–§四 |
| 18. Failure Diagnostic Model | 同上 §五 |
| 19. Agent Evaluation Model | 同上 §六 |
| 20. Quality Gate Model | 同上 §四、§八 |
| 21. Public Interface Design | `harness-architecture.md` §六 |
| 22. CLI Design | 同上 §6.3 |
| 23. MCP Design | 同上 §6.4（P2，只设计） |
| 24. SDK Design | 同上 §6.5（P3，不做） |
| 25. Skill Compatibility Layer | 同上 §6.6 |
| 26. Persistence Strategy | 同上 §七 |
| 27. Schema Strategy | 同上 §八 |
| 28. Multi-Agent Re-evaluation | 同上 §五 |
| 29. Multi-Runtime Validation Status | 同上 §九 + Matrix §六 |
| 30. Backward Compatibility Strategy | `test-model.md` §七 + `migration-plan.md` §一 |

### 2.0 一句话架构

```
Client（Claude / Codex / Gemini / CI / Human）
        ↓  只通过 CLI
   Harness Core
        ↓
Filesystem + JSON / JSONL
        ↑
Playwright / API / DB  →  Evidence  →  Assertion  →  Finalization
```

**Core 不知道 Claude 存在，也不知道 Playwright 存在。**
Core 里出现 `if (runtime === 'claude')` 一类分支，即为架构失败。

### 六个终局状态

`FINALIZED_PASS` · `FINALIZED_FAIL` · `FLAKY` · `BLOCKED` · `INCONCLUSIVE` · `INVALID`
（准入条件的**唯一定义处**是 `policy-and-diagnostics.md` §4.2，同时也是 `finalize()` 的实现）

### Scenario F 的机械解法

Agent 谎报 PASS 意味着 `events.jsonl` 里没有对应的 step / assert / evidence 事件。
`auto-test verify` 一定会发现 → `INVALID`。**不需要任何智能判断。**

---

## 31–35. 迁移（详见 migration-plan.md）

| 报告章节 | 位置 |
|---------|------|
| 31. Migration Plan | `migration-plan.md` §一、§四 |
| 32. Files to KEEP | 同上 §2.1 |
| 33. Files to REFACTOR | 同上 §2.2 |
| 34. Files to REMOVE | 同上 §2.3 |
| 35. Files to CREATE | 同上 §2.5 |

**用户可见的行为变化只有两处**：证据轨 B 降级消失；终局从 4 态扩为 6 态。
`/auto-test` 入口、参数、双执行模式、Case 文件格式全部不变。

---

## 36. Risks

见 `migration-plan.md` §六（9 条）。四条被点名的风险已逐条对策：

| 风险 | 对策 |
|------|------|
| 文档数量偏多 | 11 个主题合并为 5 份 + 1 份总报告，合并理由逐条说明 |
| Policy 体系过重 | 只做三条；配置 + 纯函数；**明确拒绝** 7 种 Policy 对象抽象 |
| 持久化过度设计 | Filesystem + JSON/JSONL；SQLite 有明确触发条件 |
| Multi-Runtime 验证成本 | 只验证可用 Runtime；中立性改用**静态检查**保证，比实机验证更可靠 |

---

## 37. Over-engineering Risks（逐项判定）

| 诱惑 | 判定 | 理由 |
|------|:---:|------|
| Plugin System | **P3 不做** | 无第二个实现者 |
| Event Bus | **P3 不做** | `events.jsonl` 追加写已够 |
| Distributed Architecture | **P3 不做** | 单机单项目 |
| Database Layer | **P2 后置** | 当前 5 个 Run |
| Policy Engine 对象体系 | **P3 不做** | 3 条 Policy、每条 5–8 字段、1 个实现者 |
| Runtime Registry | **P3 不做** | Runtime 只是字符串 metadata |
| Model Router | **P3 不做** | 不属于测试 Harness 职责 |
| Multi-Agent Orchestrator | **REMOVE** | 实证未承重（Matrix §3.4） |

**自我检查**：本次设计中，是否有为"架构完整性"而提前引入的抽象？

逐一复核后，唯一有此嫌疑的是 **Step 的 `reentrant` 标记**——它增加了写脚本的负担。
保留理由：没有它，Resume 只能全量重跑，而 Scenario E 是明确的验证目标，
且真实项目（V-LIMS 有提交/扣减/审批类操作）确实存在不可重入步骤。**判定：保留，非过度设计。**

---

## 38. Scope Classification P0/P1/P2/P3

见 `migration-plan.md` §三。摘要：

- **P0（9 项）**：数据模型 · RunStore · **脚本真正接线** · Evidence Policy（含 PASS 证据）·
  Assertion 一等公民 · `finalize()` 六态 · Verifier · policy.json · **修复版本控制**
- **P1（6 项）**：CLI · Attempt/Retry/FLAKY · Step 级 Resume · `diff` · 报告渲染 · SKILL 瘦身
- **P2（4 项）**：Evaluation · Observability · MCP · SQLite
- **P3（4 项）**：SDK · 各类平台化抽象 · LLM Gate · Multi-Agent Orchestrator（删除而非后置）

---

## 39. Implementation Complexity

| Phase | 内容 | 复杂度 | 主要风险 |
|-------|------|:---:|---------|
| 1 Harness Foundation | 模型 + Store + 最小 CLI + 版本控制修复 | 中 | 版本控制变更需项目方确认 |
| 2 Execution Reliability | 脚本接线 + Attempt + Resume | **高** | 需改造既有 40 余个 spec（分批做） |
| 3 Evidence + Verification | Evidence/Assertion/finalize/Verifier | 中 | 收紧 Gate 后大量 Case 变 INCONCLUSIVE |
| 4 Agent Evaluation | 客观指标 | 低 | — |
| 5 Regression | diff | 低 | 依赖 Phase 1 的版本控制修复 |
| 6 Observability | 三态记录 | 低 | Runtime 能力差异 |
| 7 Public Interfaces | CLI 收口 + 报告渲染 + SKILL 瘦身 | 中 | 向后兼容 |
| 8 Migration | 执行 REMOVE 清单 | 低 | 需观察一个迭代后再删 |

**关键路径：Phase 1 → 2 → 3。** 这三个阶段完成后，17 项成功标准可满足约 12 项。
Phase 2 是工作量最大的一环，因为它要真正改造既有脚本——但这也正是 v1.x 一直回避、
用"证据轨 B 降级"绕过去的那件事。**绕不过去，只能做。**

---

## 40. Real Project Validation Plan

见 `migration-plan.md` §五。七个场景 A–G，当前**全部不通过**（G 部分通过）。

V-LIMS 作为验证项目的优势：已有 22 条 Case 与 5 个 RUN 批次作为迁移基线；
已知的真实 BLOCKED 场景（`v-acl` 权限缺失、pH 计分类无可用设备）可直接用于验证
BLOCKED 与 INCONCLUSIVE 的区分是否正确。

---

## 41. Open Questions（需要你确认才能进入实施）

### Q1 —— 前端 `tests/` 目录是否可以纳入版本控制？🔴 阻断项

当前 `vilims-admin/.gitignore` 整目录忽略 `/tests/`（40 余个 spec + fixtures + support）。

- **不入库的后果**：Run 不可复现，Regression 无法成立，`caseVersion` 对不上脚本版本。
- **入库的顾虑**：`tests/.env.test`（含测试账号）与 `tests/.auth/` 必须继续排除；
  `fixtures/import/*.xlsx` 约 30 个二进制文件是否入库需另行决定。
- **建议**：入库 `tests/{api,e2e,support}/**/*.ts`，继续排除 `.env.test` / `.auth/` / `fixtures/`。

**这是 Phase 1 的前置条件，不解决则 P0 #9 无法完成。**

### Q2 —— `.auto-test/runs/` 是否入库？

同理，`state/` 与 `diagnostics/` 当前被忽略。建议入库 `run.json` / `verdict.json` /
`diagnostics.json` / `events.jsonl`，排除 `evidence/`（二进制，只存 hash 引用）。
需确认团队对仓库体积的容忍度。

### Q3 —— 收紧 Gate 后，历史 Case 的过渡策略？

Phase 3 上线后，无 `assertions` 块的 22 条 Case 会走 `lenient` 模式。
- 选项 A：长期保留 lenient（迁移压力小，但双轨长期并存）
- 选项 B：设定收口时间点，逾期未补 `assertions` 的 Case 一律 `INCONCLUSIVE`
- **倾向 B**，但收口时间需你定。

### Q4 —— Phase 2 的脚本改造范围？

40 余个 spec 全部改造成本高。建议先改 3 个代表性 spec（一个 e2e 变体矩阵、一个 API、
一个含 DB 断言）验证模式，其余渐进迁移，未迁移的走 legacy 通道。
**需确认是否接受"新老脚本并存一段时间"。**

### Q5 —— `docs/testcases/<module>/` 客户交付版报告的归属？

它当前由 Agent 手写。2.0 改为由 Run 渲染后，客户交付所需的叙述性内容
（Executive Summary 的结论与建议、Defects 的风险评估）**仍然需要 Agent 撰写**。
建议：结构化部分由渲染器生成，叙述性部分留 Agent 填充的占位区。
**需确认这个分工是否符合你的交付习惯。**

### Q6 —— 是否真的需要 Multi-Runtime？

架构中立本身有价值（它强制了更干净的边界），但如果实际上只会用 Claude Code，
那么"Runtime 中立"的部分成本（CLI 而非直接函数调用、metadata 而非分支）可以简化。

**我的判断是不应简化**——因为中立性带来的最大收益不是"支持 Gemini"，
而是"Core 无法依赖 Agent 的自觉"，这恰恰是本次重构的核心目的。
但这个判断需要你确认。

### Q7 —— 引擎仓库是否接受新增 `docs/` 目录？

本阶段 6 份文档已写入 `<skillDir>/docs/architecture/`。
`scripts/validate-structure.mjs` 会遍历所有 md 做交叉引用与硬编码路径检查——
本次文档已按其约束编写（无绝对路径、无失效引用），但**建议在合入前跑一次自检确认**。

---

## STOP —— 等待确认

第一阶段到此结束。**未修改任何生产代码，未重写 SKILL.md，未创建实现代码。**

进入实施阶段前需要你回答的是 §41 的 7 个开放问题，其中 **Q1 是阻断项**。

确认后的第一步是 **Phase 1（Harness Foundation）**，而不是一次性重写。
