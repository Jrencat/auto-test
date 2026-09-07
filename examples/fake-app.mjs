/**
 * fake-app —— 供示例 Spec 驱动的极简"被测系统"。
 *
 * 它存在的唯一目的：让三个代表 Spec **真的会通过、真的会失败、真的会抖动**，
 * 从而产生真实的 Run / Attempt / Assertion / Evidence，而不是靠断言桩伪造结果。
 *
 * 不依赖浏览器与网络，因此示例在任何机器上都能一键复现。
 */

/** 正常工作的登录：凭据正确即跳转 /home 并返回 200。 */
export function login(username, password) {
  if (username === 'tester' && password === 'p@ssw0rd') {
    return { httpStatus: 200, body: { code: 200, token: 'tok_abc123' }, redirect: '/home' };
  }
  return { httpStatus: 401, body: { code: 40100, message: '账号或密码错误' }, redirect: '/login' };
}

/**
 * 配制溶液列表的行操作按钮。
 *
 * ⚠ 这里有一个**故意保留的真实缺陷**：`status === '暂存'` 的行应渲染「继续填写」，
 * 但实现里漏了这个分支，一律返回「修改」。示例 Spec 02 会真实地捕获它。
 */
export function renderRowAction(row) {
  // BUG: 缺少 status === '暂存' 的分支
  return { label: '修改', enabled: true };
}

/** 期望的正确实现，供报告说明缺陷时对照（未被 renderRowAction 使用）。 */
export function expectedRowAction(row) {
  return row.status === '暂存'
    ? { label: '继续填写', enabled: true }
    : { label: '修改', enabled: true };
}

/**
 * 带真实抖动的库存查询：前 `warmupFailures` 次因"连接尚未就绪"抛错，之后正常。
 * 用于演示 Retry 与 FLAKY —— 抖动来自被测系统本身，不是测试脚本假装失败。
 */
export function makeFlakyStockReader({ warmupFailures = 1, stock = 42 } = {}) {
  let calls = 0;
  return function readStock() {
    calls += 1;
    if (calls <= warmupFailures) {
      const err = new Error('ECONNRESET: 库存服务连接被重置');
      err.kind = 'TIMEOUT';
      throw err;
    }
    return { available: stock, frozen: 0, used: 8 };
  };
}
