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

- [ ] `status == ready`（或上次中断残留的 `running`，重跑时重新置位），
      **或** `status == completed` / `failed` 且已通过 §九 Cheap Reuse Gate 判定为 `REUSE`
      （重跑复用，按 §三"合法转换"置 `→ running`）
- [ ] 存在可解析的 Test Data Matrix，或用例明确标注"无参数化数据"
- [ ] 数据组中不含 `TODO` / `REQUIRED_INPUT` 占位符（含则该 Case 保持 `pending_review` 或标 BLOCKED 并说明）
- [ ] 已有对应自动化脚本，或本轮可生成（见 `rules/script-rule.md`）

不满足的用例：**不执行**，在 Run Report 中标 `BLOCKED` 并写明原因，禁止标成 Pass。

## 九、Repeat Run —— Cheap Reuse Gate（`completed` / `failed` 用例的复用判定）

> 解决的问题：同一模块第二次触发时，磁盘上的 Case 已是 `completed`，既不匹配"存在 `ready`"的
> 复用分支，又过不了 §八 的可执行性检查，导致**重新走一遍 Step3 八层源码分析 + Step4/Step5 生成**。
> 本节给出**廉价**的复用判定，使 Repeat Run 直接进入执行。

**触发条件**（三条全满足才进入本节）：
1. 本次目标模块在 `<caseDir>` 存在 `status == completed` 或 `failed` 的 Case；
2. 该模块**不存在** `ready` 用例（存在则走原有 ready 分支，本节不介入）；
3. 当前为 Full-Auto，或 HITL 下用户已确认执行。

### 9.1 允许的输入（白名单，禁止扩大）

判定**只允许**读取下列内容：

| 输入 | 来源 | 成本 |
|------|------|------|
| `module` / `route` / `script` | Case Frontmatter **已有字段** | 已在 Step0.2 全量读取，零额外成本 |
| `updated_at` | Case Frontmatter 已有字段，作为 diff 时间基线 | 同上 |
| 上述 `route` / `script` 对应路径的 **git diff** | `git log --since` + `git status --porcelain` | 每仓库 2 条命令，不读文件内容 |
| `script` 文件、`route` 目标目录的**存在性与 mtime** | 文件系统 `stat` | 可忽略，不读内容 |

**🚫 判定阶段严禁**（违反即为设计失败）：
- 新增任何 Frontmatter 字段（含 `api` / `hash` / `fingerprint` 等）——Case Schema 不得改动；
- 重新执行 Step3 的八层源码分析（Vue→Router→API→Controller→Service→Mapper→XML→DB）；
- 为判断能否复用而重新分析整个模块、读 Controller/Service/Mapper/XML、查数据库；
- 建立任何 Cache、指纹库、状态文件或新的持久化产物。

> **成本红线**：若 Reuse Gate 本身比重新生成 Case 更昂贵，视为设计失败，必须退回本节重新裁剪。

### 9.2 判定命令（`<paths>` 见 9.3）

⚠ **`<cwd>` 不一定是 git 仓库**：monorepo/多仓项目里 `<frontend>` 与 `<backend>`
（`runtime.local.json`）常是**各自独立的仓库**，而 `<cwd>` 只是它们的父目录。
因此**必须按仓库分别执行**，用 `git -C <repo>`，**不得**只在 `<cwd>` 跑一次：

```bash
# 对 <frontend> / <backend> 各执行一次（repo 取 runtime.local.json 中的目录）
git -C <repo> rev-parse --show-toplevel                                          # 先确认是仓库
git -C <repo> log --since="<updated_at>" --pretty=format: --name-only -- <paths> | sort -u
git -C <repo> status --porcelain -- <paths>
```

- 两条命令对所有仓库都为空 → 无变化；任一非空 → 按 9.4 分档。
- **某个仓库不可用 / 不是 git 仓库 / 命令失败** → **仅该仓库覆盖的路径**降级为
  `MAJOR STRUCTURAL`，其余仓库的判定结果照常有效（避免父目录非仓库时整体误判为全量分析）。
- `<paths>` 为**相对该仓库根**的路径（`script` 相对 `<frontend>`，页面 glob 同理）。

#### ⚠ 未跟踪（`??`）文件不等于"发生了变化"

auto-test 生成的脚本通常**尚未提交**，`git status` 恒为 `??`。若把 `??` 直接当作变更，
则 First Run 之后的每一次 Repeat Run 都会把全部 Case 判成 `IMPACTED`，
**复用永远不会生效**（等价于优化失效）。因此：

| `git status` 码 | 含义 | 判定 |
|-----------------|------|------|
| ` M` / `M ` / `MM` / `AM` / `D ` / ` D` | 已跟踪文件被修改或删除 | **计入变更** |
| `??`（未跟踪） | 多为本 Case 自己上一轮生成的产物 | **不直接计入**；改用下方 mtime 判据 |

**未跟踪文件的 mtime 判据**（一次 `stat`，不读文件内容，成本可忽略）：

```
mtime(<script>) > updated_at(Case)  → 该文件在上轮执行之后被改动 → 计入变更
mtime(<script>) ≤ updated_at(Case)  → 该文件是上轮执行的产物本身 → 不计入变更
```

> 依据：Case 的 `last_run_id` 所记录的那次执行**就是**生成该脚本的执行，
> 把它算成"自那次执行以来的变化"在事实上是错的。

### 9.3 监视路径（由已有字段推导，不新增字段）

| 路径 | 推导方式 |
|------|---------|
| 脚本 | Frontmatter `script`（相对 `<frontend>`），逐 Case 精确路径 |
| 前端页面 | 绑定 `sourceLocate.vueGlobRel` 以 `module` 展开（如 `src/views/**/<module>/**/*.vue`） |
| 后端 | 在 `<backend>` 的 diff 结果中**按 `module` / `route` 末段做文件名包含过滤**（纯字符串过滤，不读文件内容） |

### 9.4 三档判定（唯一分档，不得新增档位）

| 档 | 判定条件 | 动作 |
|----|---------|------|
| **NO CHANGE** | 监视路径无提交变更、无未提交变更，且 `script` 文件存在、`route` 仍可解析到文件 | **REUSE** → 跳过 Step3 / Step4 / Step5，`completed`/`failed` → `running`，直接进 Step7 执行 |
| **IMPACTED** | 仅部分监视路径变化，且可经 `script` 字段映射回**具体 Case** | **PARTIAL RE-ANALYSIS** → 只对受影响的 Case / Script 做局部重分析与更新；未受影响的 Case 仍走 REUSE |
| **MAJOR STRUCTURAL** | `route` 已解析不到任何文件 / `script` 文件缺失 / 路由注册文件变化 / 该模块 **过半** Case 被影响 / git 不可用 | **FULL ANALYSIS** → 回到常规 Step3 全量分析（**唯一允许全量的路径**） |

**禁止**：任何微小文件变化直接触发 `MAJOR STRUCTURAL`；也禁止"存在 Case → 永远复用"的 Blind Reuse。

### 9.5 复用时的强制约束

- **不新建 Case**：REUSE 与 PARTIAL 分支下，未受影响的 Case 一律不重建、不重排 ID。
- **正文零改动**：复用只允许回写 §五 规定的 4 个字段（`status` / `updated_at` / `last_run_id` /
  `last_run_status`），正文、测试数据、人工修改一律不动。
- **不无理由重写脚本**：`script` 指向的文件存在且未被判定 IMPACTED 时，**禁止**重新生成。
- **覆盖能力不变**：复用的是"已完成的分析与生成工作"，**不是**测试内容。数据组数量、断言、
  变体矩阵、负向用例、真实渲染探测、串行+隔离执行策略一律不变。
- 判定结果必须在 Run Report 中记一行：`Reuse Gate: NO CHANGE | IMPACTED(<CaseIDs>) | MAJOR STRUCTURAL`，
  并写明所依据的变更文件清单（无变更时写 `none`）。
