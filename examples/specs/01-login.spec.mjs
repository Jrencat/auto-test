/**
 * 代表 Spec A —— 稳定 PASS。
 *
 * 迁移要点（v1.x → 2.0）：
 *   v1.x：断言写在脚本里，结果只体现为"这条 test 绿了"，报告靠 results.json 投影猜。
 *   2.0 ：每条断言用 Case 里声明的 **Assertion ID** 登记求值结果，并绑定证据。
 *         Harness 由此能回答"A1 这条断言这次到底是不是真的被验证过"。
 */
import { login } from '../fake-app.mjs';

export const spec = {
  caseId: 'TC-LOGIN-001',
  title: '登录成功后跳转首页',
  script_ref: 'examples/specs/01-login.spec.mjs',

  assertions: [
    { id: 'A1', layer: 'ui', description: '登录成功后跳转到 /home', required: true },
    { id: 'A2', layer: 'api', description: 'login 接口返回 code=200 且带 token', required: true },
  ],

  /**
   * @param {object} ctx  { core, runId, attemptId, step, assert, evidence }
   */
  async execute(ctx) {
    ctx.step('打开登录页');

    const res = login('tester', 'p@ssw0rd');
    ctx.step('提交账号密码');

    // 证据先落盘，再被断言引用——保证"断言通过"这件事有东西可回溯
    const apiEv = ctx.evidence('api_response', 'login-response.json', JSON.stringify(res.body, null, 2));
    ctx.assert('A2', res.httpStatus === 200 && res.body.code === 200 && Boolean(res.body.token), {
      expected: 'httpStatus=200, code=200, token 非空',
      actual: `httpStatus=${res.httpStatus}, code=${res.body.code}, token=${res.body.token ?? '(none)'}`,
      evidence: [apiEv],
    });

    ctx.step('等待跳转');
    const shotEv = ctx.evidence('screenshot', 'after-login.png', `SCREEN[route=${res.redirect}]`);
    ctx.assert('A1', res.redirect === '/home', {
      expected: '/home',
      actual: res.redirect,
      evidence: [shotEv],
    });
  },
};
