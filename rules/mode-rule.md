# mode-rule —— 执行模式（Execution Mode）解析与约束

对应主流程 **Step0.1**。目标：每次触发明确当次 CLI Invocation 用哪种执行策略，
并保证 Human-in-the-Loop **真正暂停**，而不是"询问一下然后继续跑"。

## 一、两种模式

| 模式 | 标识 | 含义 |
|------|------|------|
| Full-Auto | `full-auto` | 生成 → 自动 `ready` → 自动执行 → 自动出报告，全程无人工介入（**保持本 Skill 原有行为**） |
| Human-in-the-Loop | `human-in-the-loop` | 生成用例与**具体测试数据** → `pending_review` → 写盘 → 输出审核指引 → **退出 CLI** |

## 二、⚠ 执行模式 ≠ 用例状态（强制架构约束）

- **Execution Mode** 属于**本次执行上下文**，只在本次运行内有效，**禁止写入 Case Frontmatter**。
  严禁出现 `mode: human-in-the-loop` 这类会污染用例生命周期的持久化字段。
- **Case Status** 属于**持久化测试资产**（`pending_review` / `ready` / `running` / `completed` / `failed`），
  见 `rules/case-store-rule.md`。
- 判断"某个用例这次能不能执行"只看 **Case Status**；判断"这次生成的新用例落到什么状态"才看 **Mode**。

## 三、模式解析顺序（命中即停，禁止重复询问）

1. **显式参数**：命令行带 `--mode full-auto` / `--mode human-in-the-loop`
   （别名：`--full-auto` / `--hitl`）→ 直接采用。
2. **自然语言已明确**：用户说了"全自动跑""不用我审核""自动执行完出报告" → `full-auto`；
   说了"先给我看用例""我要审核""生成后先停" → `human-in-the-loop`。
3. **项目默认**：绑定 `project.json.execution.defaultMode`（如配置）。
4. **交互询问**（前三条都未命中时，用 AskUserQuestion 问一次）：

```
请选择 Auto-Test 执行模式：

1. Full-Auto
   自动生成、自动执行，无需人工审核。

2. Human-in-the-Loop
   生成测试用例并暂停，人工审核后再次执行。

请输入 1/2：
```

> **只问一次**。用户已在任一层明确模式时，**不得**再次询问。
> 解析结果在编排开头 `log` 一行（`Mode: full-auto`），并写入报告 Test Environment 章节。

## 四、Full-Auto 行为约束

```
触发 → 扫描 <caseDir> → 存在 ready？
  ├─ 是 → 直接执行 ready 用例（优先，不重复生成）
  └─ 否 → 存在该模块 completed / failed？（Repeat Run）
           ├─ 是 → Cheap Reuse Gate（case-store-rule §九）
           │        ├─ NO CHANGE        → completed|failed → running → 执行（跳过分析与生成）
           │        ├─ IMPACTED         → 局部重分析受影响项，其余复用 → 执行
           │        └─ MAJOR STRUCTURAL → 转下一行全量路径
           └─ 否 → 分析目标 → 去重后生成用例 → status=ready → 执行 → 回写 → 生成 Run Report
```

- 不触发 CLI 挂起、不要求人工修改用例。
- 新生成用例直接 `ready`（Full-Auto 下"自动审核"即视为已审核）。
- **但**：磁盘上已存在的 `pending_review` 用例，Full-Auto **也不得**擅自改成 `ready` 执行——
  那是别人挂起等审核的资产。Full-Auto 遇到 `pending_review` 只做一件事：在报告与终端
  列出这些用例并标 **Not Executed（待人工审核）**，然后继续跑 `ready` 的部分。
- Full-Auto 缺具体数据时的处理见 `rules/test-data-rule.md §禁止伪造`。

## 五、Human-in-the-Loop 行为约束

```
触发 → 扫描 <caseDir>
  ├─ 存在 pending_review → 展示待审核清单 + 测试数据摘要 + 审核指引 → 退出（不执行）
  ├─ 否则存在 ready       → 提示 "检测到 N 个已审核、待执行的测试用例。是否开始执行？[Y/n]"
  │                          └─ 用户确认 Y → 执行（见 §六）
  └─ 都不存在             → 分析目标 → 生成用例 + 具体测试数据 → status=pending_review
                            → 写盘 → 输出文件清单 + 审核指引 → 退出（不执行）
```

**强制**：Human-in-the-Loop 生成 `pending_review` 用例后，**禁止**继续自动执行测试，
禁止在同一次运行内"顺便把它们跑了"。

### 🚫 禁止一键跳过人工审核

- **禁止**提供"把所有 `pending_review` 自动置为 `ready` 并立即执行"的默认快捷路径。
- 禁止 Skill 自行修改 `pending_review → ready`：该转换**只能由人工修改磁盘文件完成**。
- 若用户在对话中明确要求批量置为 ready：必须逐条列出将被改动的用例 ID 与标题、
  要求用户主动确认，且**只改 `status` 一个字段**，绝不改动正文与测试数据内容；
  同时明确告知"这等同于跳过人工数据审核"。

### 审核指引输出模板（生成 pending_review 后）

```
已生成 N 个待人工审核的测试用例：

  <caseDir>/TC-XXX-001.md   <标题>   数据组 D001~D00N
  ...

请审核测试逻辑与「## 测试数据明细」中的具体数据（含 TODO / REQUIRED_INPUT 待补项）。
审核完成后，将 Frontmatter 的 status 修改为 ready，然后再次运行 auto-test。

  status: pending_review  →  status: ready
```

## 六、Human-in-the-Loop 的恢复执行（第二次及以后触发）

用户手工把 `status` 改为 `ready` 后再次触发：

```
读取 Case（以磁盘内容为准）→ 解析 Test Data Matrix → 参数化执行 Playwright
→ 记录每个 Data Group 的实际结果 → 状态 running → completed/failed → 生成 Run Report
```

- 恢复执行**必须读取人工修改后的内容**，禁止用重新生成的数据覆盖（见 `rules/case-store-rule.md §人工修改保护`）。
- 同时存在 `pending_review` 与 `ready` 时：**先提示 `pending_review` 清单**（不执行），
  再就 `ready` 部分询问是否执行；用户拒绝则退出。

## 七、两种模式共有的纪律

- 无论哪种模式，**已执行部分必须是真实执行**，终态不得凭空填写。
- 无论哪种模式，Run Report 都独立写入 `<reportDir>/RUN-YYYYMMDD-HHMMSS.md`（见 `rules/report-rule.md`）。
- 模式不改变覆盖姿态：变体矩阵、数据变体、断言模式库在两种模式下同样是默认要求。
