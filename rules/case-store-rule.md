# case-store-rule —— 测试用例资产化（Case Store）、生命周期与人工修改保护

对应主流程 **Step0.2 / Step4 / Step5 / Step9**。

> **最终原则：测试用例是持久化资产；磁盘中的人工修改内容优先于重新生成的内容。**

## 一、存放位置

```
<cwd>/.auto-test/
├── cases/                       # 测试用例资产（SSOT，一个 Case 一个文件）
│   ├── TC-AUTH-001.md
│   └── TC-ORDER-LIST-003.md
└── reports/                     # 执行报告（与 Case 解耦，一次执行一份）
    ├── RUN-20260810-151530.md
    ├── RUN-20260810-151530.jsonl   # 机器可读执行记录（由 Playwright 写入）
    └── RUN-20260810-160200.md
```

- 目录可在绑定 `project.json.caseStore.casesDir` / `reportsDir` 覆盖，默认即上表
  （引擎不写死具体项目路径；`<cwd>` = 触发 `/auto-test` 的工作目录）。
- 首次运行时创建缺失目录；**已存在的文件一律不动**。
- `.auto-test/cases/` **建议提交入库**（测试资产随代码演进）；`.auto-test/reports/` 视团队约定，
  binding 阶段在 `<cwd>/.auto-test/.gitignore` 里默认忽略 `reports/*.jsonl`。

### 与 `docs/testcases/<module>/` 的关系（兼容）

- 历史版本把用例写在 `docs/testcases/<module>/*.md` 聚合文档里。**该目录继续保留**，
  定位调整为：**面向客户/评审的模块级汇总视图**（可读性优先）。
- **状态与测试数据的唯一事实来源（SSOT）是 `.auto-test/cases/<CASE-ID>.md`。**
  两处不一致时以 `.auto-test/cases/` 为准。
- 不强制迁移历史用例：老项目可继续用聚合文档；本轮新增/改动的用例落到 `.auto-test/cases/`。
  需要迁移时**逐条另存为新文件**，不删除原文件。

## 二、Case 文件格式

一个 Markdown 文件 = 一个测试用例，文件名即 Case ID（`TC-AUTH-001.md`）。模板见 `templates/case.md`。

### Frontmatter Schema

```yaml
---
id: TC-AUTH-001
title: 用户名输入校验
status: pending_review
version: 1
created_at: 2026-08-10T15:00:00+08:00
updated_at: 2026-08-10T15:00:00+08:00
last_run_id: null
last_run_status: null
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | Case ID，与文件名一致，一经分配不得复用/重排 |
| `title` | ✅ | 一句话说明测试目标 |
| `status` | ✅ | 生命周期状态，取值见 §三 |
| `version` | 推荐 | 用例内容版本，人工实质性修改时 +1 |
| `created_at` / `updated_at` | 推荐 | 本地 ISO 时间（含时区偏移） |
| `last_run_id` | 推荐 | 最近一次执行批次 ID（`RUN-YYYYMMDD-HHMMSS`） |
| `last_run_status` | 推荐 | 最近一次**执行结果**（`PASS`/`FAIL`/`ERROR`/`BLOCKED`），**不是** status |
| 其它自定义字段 | — | 允许，且**必须原样保留**（如 `owner` / `tags` / `module` / `script`） |

### Frontmatter 解析容错要求

- 支持标准 YAML Frontmatter（`---` 包裹），容忍 BOM、CRLF、键值间多余空格、行内注释行。
- **不因未知字段失败**，**不删除**用户手工新增的字段。
- 无法识别的行忽略即可，不得因此判定整个文件无效。
- 参考实现：`templates/scaffold/support/caseStore.ts`（`parseFrontmatter` / `updateFrontmatter`）。

## 三、生命周期状态机（Case Status）

```
pending_review
      │ 人工审核（人工修改磁盘文件）
      ↓
    ready
      │ 开始执行
      ↓
   running
      │
      ├───────────────┐
      ↓               ↓
 completed          failed
```

| 状态 | 含义 | 约束 |
|------|------|------|
| `pending_review` | 已生成，尚未完成人工审核 | **禁止自动执行**；Skill 不得覆盖正文、不得自动改为 `ready` |
| `ready` | 已审核完成，可执行 | 测试目标/步骤/**测试数据**/预期结果齐备，无 `TODO`/`REQUIRED_INPUT` |
| `running` | 正在执行 | 执行前置位；进程异常中断时会残留，下次运行可重跑并重新置位 |
| `completed` | 已完成一次自动化执行 | **`completed ≠ PASS`**：业务断言失败仍是 `completed` |
| `failed` | 自动化基础设施/脚本不可恢复异常 | 仅用于 Playwright 启动失败、脚本语法错误、浏览器起不来、测试环境不可用等 |

**合法转换**：`pending_review → ready`、`ready → running`、`running → completed`、`running → failed`，
以及重跑用的 `completed → ready/running`、`failed → ready/running`。

**禁止**：`pending_review → running`、`pending_review → completed`、`pending_review → failed`。
特别地：**未经人工审核，Human-in-the-Loop 模式不得执行测试**。

> `pending_review → ready` **只能由人工修改磁盘文件完成**，Skill 不得代劳（Full-Auto 新生成的用例
> 直接以 `ready` 落盘，属"生成即 ready"，不是状态转换，见 `rules/mode-rule.md §四`）。

## 四、⚠ Case Status 与 Execution Result 必须分离

| 维度 | 取值 | 存放位置 |
|------|------|---------|
| Case Status（生命周期） | `pending_review` / `ready` / `running` / `completed` / `failed` | Case Frontmatter `status` |
| Execution Result（执行结果） | `PASS` / `FAIL` / `ERROR` / `BLOCKED` | Run Report + Frontmatter `last_run_status` |
| Failure Type（失败类型） | `Assertion Failure` / `Automation Error` / `Environment` / `Test Data` / `Blocked` | Run Report |

典型组合：

```
Case Status: completed   Execution Result: FAIL    Failure Type: Assertion Failure
  → 测试正常执行完成，业务断言失败（产品缺陷候选）

Case Status: failed      Execution Result: ERROR   Failure Type: Automation Error
  → 自动化本身异常，没有正常完成（脚本/环境问题）
```

**严禁**把业务断言失败写成 `status: failed`，也严禁把自动化异常伪装成业务失败。
历史状态记号（✅PASS / ❌FAIL / ⚠BLOCKED / 🚫DEPRECATED）继续用于**报告与聚合文档的执行结果展示**，
它们是 Execution Result 维度，不是 Case Status。

## 五、🔒 人工修改保护（强制）

Case 文件一旦存在（尤其 `pending_review` / `ready`），**磁盘文件是唯一事实来源**。禁止：

- 覆盖 / 删除 / 重建 Case 文件；
- 用重新生成的内容替换人工修改过的正文或测试数据；
- 擅自恢复成旧版本；
- 擅自修改测试数据（包括"看起来更合理"的美化）；
- 删除用户新增的 Frontmatter 字段、注释、章节。

示例：首次生成 `username = 123456`，用户改为 `username = 12345678901234567890`，
下一次运行**必须**读取并使用 `12345678901234567890`。

### 状态回写必须最小化

执行过程中只允许更新：`status`、`updated_at`、`last_run_id`、`last_run_status`
（以及用例约定的执行摘要字段）。**不得重写整个 Markdown 文件**，不得改变正文、
不得调整 Markdown 排版/缩进/引号，不得删除未知字段。

参考实现：`caseStore.ts` 的 `updateFrontmatter()` —— 逐行定位键并只替换该行的值，
键不存在才追加到 Frontmatter 末尾；正文原样透传。

### Case 只保存执行摘要

Case 文件**不保存完整历史执行结果**，只维护：

```yaml
last_run_id: RUN-20260810-151530
last_run_status: FAIL
```

详细结果一律进 `<reportDir>/RUN-*.md`，保证**一个 Case 可被多次执行、每次执行有独立报告**。

## 六、去重（生成新用例前强制执行）

生成任何新 Case 前，必须先扫描 `<caseDir>` 全量已有用例，按下列维度判定是否已存在等价用例：

1. **Case ID**：同 ID 直接复用，禁止重建。
2. **Title**：语义等价（去除标点/大小写/同义词差异）视为重复。
3. **测试目标 + 测试场景**：同一页面/接口的同一业务场景。
4. **测试字段集合**：Test Data Matrix 覆盖的字段集合高度重叠（≥80%）。
5. **测试数据**：数据组的输入组合实质相同。

判定结果处理：

| 情况 | 处理 |
|------|------|
| 完全等价 | **复用已有 Case**，不新建；必要时只追加缺失的数据组（追加，不改已有行） |
| 高度重叠但有新场景 | 新建 Case，并在正文 `## 关联用例` 注明与哪条重叠、差异是什么 |
| 全新场景 | 新建 Case，分配新 ID |

**重复运行规则**：重新分析目标页面**不得**重新生成 `TC-001/TC-002/...`。
已有等价 Case 优先复用；确有新场景才新建；**任何情况下不得覆盖旧 Case**。

## 七、ID 规范

`TC-<MODULE>-<NNN>`，模块段用业务模块缩写，例如 `TC-AUTH-001`、`TC-ORDER-LIST-012`。

- 类型信息（E2E / API / IMPORT / VARIANT）写在 Frontmatter 自定义字段 `kind` 或正文，
  不占用 ID 段，避免同一场景因类型拆分导致 ID 体系割裂。
- ID 一经分配不得复用、不得重排、不得因删除而回收。

## 八、可执行性检查（进入执行前）

某 Case 被纳入本次执行前必须满足：

- [ ] `status == ready`（或上次中断残留的 `running`，重跑时重新置位）
- [ ] 存在可解析的 Test Data Matrix，或用例明确标注"无参数化数据"
- [ ] 数据组中不含 `TODO` / `REQUIRED_INPUT` 占位符（含则该 Case 保持 `pending_review` 或标 BLOCKED 并说明）
- [ ] 已有对应自动化脚本，或本轮可生成（见 `rules/script-rule.md`）

不满足的用例：**不执行**，在 Run Report 中标 `BLOCKED` 并写明原因，禁止标成 Pass。
