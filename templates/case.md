---
id: TC-<MODULE>-<NNN>
title: <一句话说明测试目标>
status: pending_review
version: 1
created_at: <YYYY-MM-DDTHH:mm:ss+08:00>
updated_at: <YYYY-MM-DDTHH:mm:ss+08:00>
last_run_id: null
last_run_status: null
kind: e2e
module: <module>
route: <order-module/list>
script: tests/e2e/<module>.<scenario>.e2e.spec.ts
---

# TC-<MODULE>-<NNN> <用例标题>

> 本文件是**测试用例资产**（`.auto-test/cases/`）。Skill 只做最小化状态回写，
> 正文与测试数据以磁盘内容为准，人工修改优先（见 `rules/case-store-rule.md §人工修改保护`）。

## 测试目标

<这条用例要验证什么业务规则/校验逻辑；写清楚判定标准>

## 前置条件

- 登录态：<测试账号 / 权限要求>
- 依赖数据：<需要哪些已存在的数据；动态取号的取号接口>
- 环境：<依赖服务 / 特性开关>

## 测试步骤

1. <打开页面 / 调用接口>
2. <按数据组填入 Test Data Matrix 中的字段值>
3. <提交 / 触发校验>

## 测试数据明细

> 必须是**具体、可执行**的真实数据；抽象描述只能写在「数据特征」列。
> 同一「数据组 ID」的多行 = 一次完整的参数化输入（见 `rules/test-data-rule.md §三`）。
> 数据无法确定时写 `TODO` / `REQUIRED_INPUT`，并保持 `status: pending_review`，禁止编造。

| 数据组 ID | 字段名称 | 具体测试输入 | 数据类型 | 数据特征/类型 | 预期校验结果 |
|---|---|---|---|---|---|
| D001 | <field> | `<真实值>` | string | 正常值 | - |
| D001 | <field2> | `<真实值>` | string | 正常值 | <整组期望：提交成功> |
| D002 | <field> | `<边界真实值>` | string | 边界值（长度=N） | <提示文案原文> |
| D003 | <field> | `' OR '1'='1` | string | SQL Injection | 拒绝非法输入 |
| D004 | <field> | `<script>alert(1)</script>` | string | XSS Payload | 字符被转义，不执行脚本 |

## 断言

- **前端**：<字段校验 / 必填 / 按钮禁用 / Toast 文案 / 状态切换 / 无白屏与 Console Error>
- **API**：<url / method / HTTP Status / 业务 code / response 关键字段>
- **数据库**：<绑定 assertLayers.database.keyFields 的关键字段变化与守恒；无 DB 工具则标 Not Executed>

## 关联用例

- <与哪条已有用例重叠、差异是什么（去重判定结论，见 case-store-rule §六）；无则写"无">

## 备注（人工）

<人工审核时补充的业务约束、已知问题、数据来源说明。Skill 不得删改本节。>
