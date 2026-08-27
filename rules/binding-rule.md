# binding-rule —— 项目绑定解析、运行时路径与前端脚手架生成

对应主流程 **Step0**。目标：让全局引擎在**任意工作目录**运行时，自动解析出前后端项目路径、技术栈画像、
当前分支，并幂等补齐前端测试脚手架——**引擎本体零硬编码路径**。

## 一、绑定文件（生成在当前工作目录，不在引擎内）

```
<cwd>/.claude/auto-test/
├── project.json          # 项目画像（可提交，多人共享）——见 templates/binding/project.template.json
├── runtime.local.json    # 本机绝对路径 + 当前分支（gitignore）——见 templates/binding/runtime.local.template.json
└── .gitignore            # 内含 runtime.local.json
```

- `<cwd>` = 用户触发 `/auto-test` 时的工作目录（通常为仓库/工作区根）。
- `project.json`：相对结构与领域默认（前后端目录名、端口、DB 工具、断言字段、命令等），**不含绝对路径**。
- `runtime.local.json`：仅存**本机绝对路径 + 分支**，随机器/分支变化，故 gitignore。

### 测试资产目录（与绑定目录分开，Step0 一并幂等创建）

```
<cwd>/.auto-test/
├── cases/        # 测试用例资产（SSOT），建议提交入库
├── reports/      # 每次执行的独立批次报告 + .jsonl 执行记录
└── .gitignore    # 默认忽略 reports/*.jsonl
```

- 路径可被绑定 `project.json.caseStore.casesDir` / `reportsDir` 覆盖。
- **只创建缺失目录，绝不清空或覆盖已有用例文件**（见 `rules/case-store-rule.md §人工修改保护`）。
- 若目录位置被自定义，把绝对路径通过 `AUTO_TEST_CASE_DIR` / `AUTO_TEST_REPORT_DIR` 环境变量
  下发给 Playwright（或在 `tests/.env.test` 写 `AUTO_TEST_DIR`），使脚本与编排层看到同一份资产。

## 二、解析顺序（Step0，按序尝试，命中即停）

1. **已有绑定**：读 `<cwd>/.claude/auto-test/project.json` + `runtime.local.json`。
   - 校验 `runtime.local.json.frontendDir`（及 `backendDir`）路径**真实存在**。有效 → 进入第四节刷新分支。
2. **自动探测**（无绑定或路径失效时）：
   - 前端：在 `<cwd>` 及其一级子目录中找**含 `package.json` 且依赖含前端框架/`@playwright/test`、
     或已有 `tests/` 的目录**。
   - 后端：找**含 `pom.xml` / `build.gradle` / `go.mod` / 后端 `package.json` 的目录**（无后端可跳过）。
   - 兼容读取 `<cwd>/.claude/settings*.json` 中若已记录的路径线索。
   - 探测到唯一候选 → 采用；多个候选 → 列出让用户 AskUserQuestion 选择。
3. **交互询问**（仍无法确定时，需求 4）：用 **AskUserQuestion** 请用户输入：
   - 前端项目**绝对路径**（必填）
   - 后端项目**绝对路径**（可选；无则 DB/后端源码断言相应降级）
   - 页面文档目录（可选，默认 `docs/test-pages/`，最终写入 `.env.test` 的 `TEST_PAGE_DOC_DIR`；
     目标项目实际目录名不同时（如 `docs/测试/`）按实际填写）
4. 生成/更新 `project.json`（缺失时以 `templates/binding/project.template.json` 为底，填入探测到的目录名）
   与 `.gitignore`（写入 `runtime.local.json`）。

> **禁止**要求用户提供源码文件路径（那是自动定位的职责，见 source-analysis-rule）；这里只解析**项目根**。

## 三、生成/刷新 runtime.local.json（需求 5，支持分支自动对准）

**每次运行**都刷新，使不同分支自动测对应代码：

1. `frontendDir` / `backendDir`：绝对路径（来自解析/探测/用户输入）。
2. `frontendBranch`：运行 `git -C "<frontendDir>" branch --show-current`（游离态取 `git -C ... rev-parse --short HEAD`）。
3. `backendBranch`：同理对 `<backendDir>`（无后端则空）。
4. `generatedAt`：写入**真实当前时间**（运行时取，勿留占位）。
5. 写回 `<cwd>/.claude/auto-test/runtime.local.json`。

> 用户在不同分支上开发前后端时，本文件记录当次运行时各自的真实分支，报告 Test Environment 章节据此填写。
> 若前后端分支组合与上次不同，在编排开头 `log` 提示用户当前测试针对的分支，避免"测错分支"。

## 四、前端测试脚手架生成（需求 6，幂等）

目标：`<frontendDir>/tests/` 具备可运行的 Playwright 基建。以 `templates/scaffold/` 为源，**幂等**处理：

| 文件 | 处理 |
|------|------|
| `tests/support/env.ts` | 缺失则生成（含 `pageDocDir`）；已存在则**仅当缺 `pageDocDir` 字段时**补该字段，不覆盖 |
| `tests/support/crypto.ts` / `fixtures.ts` / `auth.setup.ts` / `resolveActionNo.ts` | 缺失则生成；已存在不覆盖 |
| `tests/support/caseStore.ts` | 缺失则生成（Case 资产读写 + Test Data Matrix 解析 + Run 记录）；已存在不覆盖 |
| `playwright.config.ts`（前端根） | 缺失则生成；已存在不覆盖 |
| `tests/.env.test.example` | 缺失则生成；已存在则**仅追加缺失变量**（尤其 `TEST_PAGE_DOC_DIR`），不改已有行 |
| `tests/.env.test` | **绝不生成/覆盖**（含真实账号）。缺失时提示用户手动创建 |
| `tests/README.md` | 缺失则生成 |

**硬性约束**：
- 不覆盖用户已有文件；只补缺失文件或缺失的 env 变量行。
- 生成脚手架属**新增测试基建**，不触碰前端业务源码，不做任何格式化。
- 若目标项目非 Vue/Playwright 技术栈：跳过脚手架生成，改按 environment-rule 探测既有框架，并在报告说明。

## 五、生成后提示（需求 6）

脚手架就绪后，若 `tests/.env.test` 不存在或缺关键项，向用户输出可直接执行的指引（提示，不代填账号）：

```
请配置测试环境：
  cd <frontendDir>
  cp tests/.env.test.example tests/.env.test
然后在 tests/.env.test 填写：
  - 地址：TEST_API_BASE / TEST_WEB_BASE（网关与前端 dev 地址）
  - 账号：TEST_USERNAME / TEST_PASSWORD（务必用测试环境账号）
  - 页面文档目录：TEST_PAGE_DOC_DIR（默认 docs/test-pages/，按项目实际目录改）
配置完成后重新运行 /auto-test。
```

`.env.test` 未就绪（缺账号/地址）→ 输出 BLOCKED（引导用户配置后再跑），不静默用默认账号乱试。

## 六、绑定结果向后续步骤传递

Step0 完成后，后续所有步骤引用的 `<frontend>`/`<backend>`/命令 cwd/断言字段/页面文档目录，
一律从本步解析出的绑定（`project.json` + `runtime.local.json` + `<frontend>/tests/.env.test`）取值，
不再各自硬编码。字段含义见 `configs/project.schema.md`。
