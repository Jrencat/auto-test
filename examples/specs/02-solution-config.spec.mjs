/**
 * 代表 Spec B —— 真实 Product Bug。
 *
 * `fake-app.renderRowAction()` 漏了 `status === '暂存'` 分支，本 Spec 会真实捕获它。
 *
 * 迁移要点：
 *   v1.x：失败信息止步于 test 标题 + 错误堆栈，归因写在报告散文里。
 *   2.0 ：失败被拆成三份可机器读取的事实——
 *         ① 哪条 Assertion 失败（A1）② 失败时的证据 ③ 结构化 Diagnostic（分类/假设/结论/行动）。
 *         Harness 保存它们，但**不替 Agent 推理**：假设与结论由 Agent 提出。
 */
import { renderRowAction } from '../fake-app.mjs';

export const spec = {
  caseId: 'TC-SOLUTIONCONFIG-002',
  title: '列表行 status 变体：暂存行应渲染「继续填写」',
  script_ref: 'examples/specs/02-solution-config.spec.mjs',

  assertions: [
    { id: 'A1', layer: 'ui', description: 'status=暂存 的行渲染「继续填写」按钮', required: true },
    { id: 'A2', layer: 'ui', description: 'status=已提交 的行渲染「修改」按钮', required: true },
  ],

  async execute(ctx) {
    ctx.step('打开配制溶液列表页');

    const draftRow = { id: 'SC-001', status: '暂存' };
    const submittedRow = { id: 'SC-002', status: '已提交' };

    ctx.step('读取暂存行的操作按钮');
    const draftAction = renderRowAction(draftRow);
    const draftEv = ctx.evidence(
      'screenshot',
      'row-draft.png',
      `ROW[id=${draftRow.id} status=${draftRow.status}] BUTTON[${draftAction.label}]`,
    );
    ctx.assert('A1', draftAction.label === '继续填写', {
      expected: '继续填写',
      actual: draftAction.label,
      evidence: [draftEv],
    });

    ctx.step('读取已提交行的操作按钮');
    const submittedAction = renderRowAction(submittedRow);
    const submittedEv = ctx.evidence(
      'screenshot',
      'row-submitted.png',
      `ROW[id=${submittedRow.id} status=${submittedRow.status}] BUTTON[${submittedAction.label}]`,
    );
    ctx.assert('A2', submittedAction.label === '修改', {
      expected: '修改',
      actual: submittedAction.label,
      evidence: [submittedEv],
    });
  },

  /** 断言失败时由 Agent 提供的诊断。Harness 只负责把它和执行事实绑定保存。 */
  diagnose({ failedAssertions }) {
    if (!failedAssertions.includes('A1')) return null;
    return {
      classification: 'PRODUCT_BUG',
      hypothesis: 'renderRowAction 未实现 status=暂存 的分支，导致所有行统一返回「修改」',
      diagnostic:
        '同一函数对 status=已提交 的行返回正确结果（A2 通过），排除调用方传参错误；'
        + '差异只出现在 status=暂存 这一分支，指向实现缺少该分支。',
      action: '在 renderRowAction 中补充 status === "暂存" 分支，返回「继续填写」后重跑本 Case',
    };
  },
};
