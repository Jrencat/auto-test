# pipeline-state-rule —— Pipeline State、Agent Contract 与 Artifact Store（v1.1.0）

> 本规则是**编排层**的状态与契约事实来源。仅 Orchestrator 与各 Sub-Agent 的「落盘/回传」环节需要加载。
>
> ⚠ **不得与 Case Status 混淆**：本文件定义的是 **Pipeline State（本次编排进度）**；
> **Case Status（`pending_review`/`ready`/`running`/`completed`/`failed`）仍然且只能由
> `rules/case-store-rule.md §三` 定义**，本文件不创建第二套业务状态机，也不得覆盖它。
> 两者冲突时：**磁盘上的 Case 文件永远优先**，Pipeline State 必须被修正为与 Case 现状一致。

## 一、Artifact Store 布局

```
<cwd>/.auto-test/
├── cases/                  # 【已有】测试用例资产（SSOT）—— case-store-rule
├── reports/                # 【已有】批次报告 RUN-*.md + RUN-*.jsonl —— report-rule
├── analysis/               # 【v1.1.0 新增】Source Analyst 产物
│   ├── AN-<MODULE>.md          # 人可读源码链路分析
│   ├── variants.json           # 变体维度矩阵
│   ├── api-map.json            # 页面 → API → Controller/Service/Mapper/SQL 映射
│   ├── assertion-map.json      # 三层断言点（UI / API / DB）
│   └── data-dependencies.json  # 动态标识、前置数据、权限前置
├── diagnostics/            # 【v1.1.0 新增】FAIL 诊断入口（execute-rule §二 的落盘投影）
│   └── DIAG-<RunId>.json / .md
├── state/                  # 【v1.1.0 新增】编排层状态（唯一事实来源 = 磁盘）
│   ├── pipeline.json           # 当前 Pipeline State
│   └── contracts/              # 每次 Agent 调度的结构化回执
│       └── <SEQ>-<agent>.json
└── .gitignore              # 【已有】默认忽略 reports/*.jsonl（v1.1.0 追加 state/ diagnostics/ 建议项）
```

- 目录基准一律为 **`<cwd>`（仓库根）**，可被 `project.json.caseStore.*` 覆盖；
  完整基准对照见 `rules/binding-rule.md §一 路径基准表`。
- **自动化脚本仍在 `<frontend>/tests/{api,e2e,support}/`，v1.1.0 不迁移**（迁移会破坏
  `playwright.config.ts` / `script-rule` / 既有脚本，属无价值改动）。
- 目录**只创建缺失项，绝不清空或覆盖已有文件**。

## 二、Pipeline State

### 2.1 状态取值

```
INIT
 ↓
PREFLIGHT_READY      # 预检通过 + 绑定解析完成 + 脚手架就绪
 ↓
ANALYSIS_READY       # analysis/* 产出（Reuse/Resume 路径可直接跳过并保持既有值）
 ↓
CASE_READY           # cases/* 已就绪且可执行（无 TODO / REQUIRED_INPUT）
 ↓
SCRIPT_READY         # 脚本存在且与 Case 一致
 ↓
EXECUTING            # 已置 running、Playwright 执行中
 ↓
REPORT_READY         # RUN-*.md + 客户交付版报告 + HTML 视图已产出
 ↓
FINALIZED            # 通过 Final Check Gate
```

异常/挂起状态（与上表正交，记录在同一字段）：

| 状态 | 含义 | 恢复方式 |
|------|------|---------|
| `WAITING_FOR_HUMAN` | HITL 已写盘 `pending_review`，**真正停止** | 人工改 Case `status: ready` 后重新触发 |
| `BLOCKED` | 依赖缺失/输入缺失/环境不可用/权限不足 | 消除 `blocked.reason` 后重新触发 |
| `RECOVERABLE` | 本轮有 FAIL/ERROR，但证据完整、有明确恢复入口 | 按 `diagnostics/DIAG-*` 的 `recoveryEntry` 重新触发 |
| `FAILED` | Agent 不可恢复失败且无恢复入口 | 需人工介入 |

### 2.2 `state/pipeline.json` Schema

```json
{
  "schemaVersion": "1.1.0",
  "state": "CASE_READY",
  "mode": "full-auto",
  "runId": "RUN-20260903-142530",
  "modules": ["deviceLog"],
  "inputs": ["docs/test-pages/设备管理/页面.md"],
  "dispatchTier": "A",
  "updatedAt": "2026-09-03T14:25:30+08:00",
  "stages": {
    "preflight": { "status": "SUCCESS", "at": "...", "contract": "state/contracts/001-preflight-binding.json" },
    "analysis":  { "status": "SUCCESS", "at": "...", "contract": "state/contracts/002-source-analyst.json" },
    "cases":     { "status": "SUCCESS", "at": "...", "contract": "state/contracts/003-case-designer.json" },
    "scripts":   { "status": "PENDING", "at": null,  "contract": null },
    "execution": { "status": "PENDING", "at": null,  "contract": null },
    "report":    { "status": "PENDING", "at": null,  "contract": null }
  },
  "blocked": null,
  "waitingForHuman": null,
  "retries": { "source-analyst": 0, "script-engineer": 0 }
}
```

- `dispatchTier`：`"A"`（已注册 Sub-Agent）或 `"B"`（`general-purpose` 承载，见 §五）。
- `blocked`：`{ "stage": "...", "reason": "...", "evidence": ["..."], "resumeCondition": "..." }`。
- `waitingForHuman`：`{ "stage": "case-designer", "caseIds": ["TC-X-001"], "guidance": "..." }`。
- **写盘时机**：每个 Agent 回执落地后立刻整文件覆写（原子：先写 `.tmp` 再 rename）。

### 2.3 状态真实性（强制）

- Pipeline State **只允许由真实发生的事件推进**，禁止预写、禁止乐观推进。
- 每次触发时，Orchestrator 必须**先用磁盘现状校正 `pipeline.json`**：
  - `cases/` 里存在 `pending_review` → 不得停留在 `SCRIPT_READY` 以后的状态；
  - `cases/` 里已无 `ready` 且全部 `completed/failed` → `analysis/`、`cases/` 阶段可判定为已完成；
  - `pipeline.json` 缺失/损坏 → 视为 `INIT`，**完全依据磁盘 Artifact 重建**，不得依赖对话记忆。

## 三、Agent Contract（结构化回执）

### 3.1 输入契约（Orchestrator → Agent）

Orchestrator 传给 Agent 的**只能是路径 + 元数据 + 摘要**，禁止把上游完整产物正文塞进 Prompt：

```json
{
  "agent": "source-analyst",
  "runId": "RUN-20260903-142530",
  "mode": "full-auto",
  "cwd": "<绝对路径，来自会话工作目录>",
  "skillDir": "<绝对路径，来自 Skill 安装位置>",
  "binding": {
    "projectJson": "<cwd>/.claude/auto-test/project.json",
    "runtimeLocal": "<cwd>/.claude/auto-test/runtime.local.json"
  },
  "inputs": ["<cwd>/docs/test-pages/设备管理/页面.md"],
  "modules": ["deviceLog"],
  "upstreamArtifacts": [],
  "task": "对 deviceLog 模块完成源码链路分析并产出 analysis/*"
}
```

### 3.2 输出契约（Agent → Orchestrator）

每个 Agent **必须**在正文末尾输出唯一一段 ` ```json ` 代码块，且只含该对象：

```json
{
  "agent": "source-analyst",
  "status": "SUCCESS",
  "state": "ANALYSIS_READY",
  "outputs": [
    ".auto-test/analysis/AN-DEVICELOG.md",
    ".auto-test/analysis/variants.json"
  ],
  "summary": "识别 2 个变体维度（logType×fileType），定位 4 个 API 与 3 处 DB 断言点",
  "metrics": { "variants": 6, "apis": 4, "dbAssertions": 3 },
  "errors": [],
  "next": "case-designer"
}
```

| 字段 | 必填 | 取值 / 说明 |
|------|------|------------|
| `agent` | ✅ | Agent 名，与 `agents/<name>.md` 的 `name` 一致 |
| `status` | ✅ | `SUCCESS` / `BLOCKED` / `WAITING_FOR_HUMAN` / `FAILED` |
| `state` | ✅ | 建议推进到的 Pipeline State（Orchestrator 有最终裁量权） |
| `outputs` | ✅ | **已真实落盘**的 Artifact 相对路径数组；未落盘不得列入 |
| `summary` | ✅ | ≤200 字，供 Orchestrator 做路由，**不承载完整结果** |
| `metrics` | 推荐 | 可核对的数量指标 |
| `errors` | ✅ | `BLOCKED`/`FAILED` 时必须含 `{ code, message, evidence[], resumeCondition }` |
| `next` | 推荐 | 建议的下一个 Agent；Orchestrator 可覆盖 |

- Orchestrator 收到回执后**原样存入** `state/contracts/<SEQ>-<agent>.json` 并更新 `pipeline.json`。
- **校验**：`outputs` 中任一路径不存在 → 该回执视为 `FAILED`（Agent 谎报产物），
  记录后按 §四 重试或转 `BLOCKED`；不得直接采信。

### 3.3 Agent 间通信纪律（Context Isolation 核心）

```
✅ Agent A → 落盘 Artifact → 回执只带路径 + summary → Orchestrator → 只把路径传给 Agent B → B 自行读取
❌ Agent A → 把完整分析正文塞进回执 → Orchestrator 转发给 B
```

- Orchestrator **禁止**为"了解情况"而读取业务源码、完整报告、全部 Case 正文。
  它只读：`pipeline.json`、`contracts/*.json`、Case **Frontmatter**、Artifact 的**存在性与元数据**。
- 需要细节时按 **Progressive Disclosure**：元数据 → summary → 必要片段 → 完整内容，逐级放开。

## 四、Retry / Recovery（有界）

| 情形 | 处置 |
|------|------|
| Agent 回执 `FAILED` 且 `outputs` 为空 | 同一 Agent **最多重试 1 次**（携带上次 `errors` 作为补充输入） |
| 重试仍 `FAILED` | 写 `pipeline.json.blocked` → 输出 BLOCKED → **停止**，不得跳过该阶段继续 |
| Agent 回执 `BLOCKED` | **不重试**（外部条件缺失，重试无意义）→ 直接落盘 BLOCKED 并停止 |
| Agent 回执缺失/非法 JSON | 视为 `FAILED`，计入同一 1 次重试预算 |
| 上游 Artifact 缺失但状态显示已完成 | 修正 `pipeline.json` → 重新调度该上游 Agent（计入重试预算） |
| 执行阶段 FAIL/ERROR | **不属于 Agent 失败**，走 `rules/execute-rule.md §二` 诊断 → `RECOVERABLE` |

- **每个 Agent 每次触发的重试预算固定为 1**，`retries` 计数写入 `pipeline.json`，**禁止无限重试**。
- 重试前必须说明「上次为何失败、这次补充了什么输入」；无补充信息则不重试，直接 BLOCKED。

## 五、Dispatch Tier（调度层级，运行时判定）

| Tier | 条件 | 调度方式 |
|------|------|---------|
| **A** | 会话可用 Agent 列表中存在 `auto-test-*` 类型（已执行 `scripts/install-agents.mjs`） | `Agent(subagent_type: "auto-test-<name>", prompt: <输入契约 JSON>)` |
| **B** | 未安装（默认，保证引擎零安装可移植） | `Agent(subagent_type: "general-purpose", prompt: "<角色引导> 读取 <skillDir>/agents/<name>.md 并严格遵守；输入契约：<JSON>")` |

- **两者都是真实的 Agent 工具调度**：Sub-Agent 在**独立上下文窗口**中执行、独立持有工具结果、
  只回传结构化契约。差异仅在于**角色定义是「已注册」还是「运行时加载」**。
- Claude Code 不从 Skill 目录加载 Agent 定义（只认 `.claude/agents/` 与 plugin `agents/`），
  因此 Tier A 需要一次性安装；Tier B 是**默认且始终可用**的路径。
- Tier 判定结果写入 `pipeline.json.dispatchTier`，并在最终 Summary 中如实声明。
- **无论哪个 Tier，Orchestrator 都不得自行执行 Sub-Agent 的专业工作**（见 `agents/orchestrator.md §Non-Responsibilities`）。

## 六、幂等

- `pipeline.json` / `contracts/` 重复写入同一阶段：**覆盖同名条目**，不追加重复阶段。
- `analysis/*`：同 module 重复分析 → 覆盖该 module 的 `AN-<MODULE>.md` 与其在 json 中的条目，
  **不得**为同一 module 生成 `AN-DEVICELOG-2.md` 这类副本。
- `cases/`：去重规则以 `rules/case-store-rule.md §六` 为唯一事实来源，本文件不重复定义。
- `diagnostics/`：按 `RunId` 命名，天然不冲突。
