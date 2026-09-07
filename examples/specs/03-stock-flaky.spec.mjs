/**
 * 代表 Spec C —— Retry / Flaky / Evidence。
 *
 * 被测系统首次调用会真实抛出连接错误，第二次才正常（`makeFlakyStockReader`）。
 *
 * 迁移要点：
 *   v1.x：Playwright 的 `retries: 1` 把两次尝试折叠成一个 `flaky` 计数，
 *         Attempt 1 的输入、证据、错误全部丢失，最终只剩一个 PASS。
 *   2.0 ：两次 Attempt 各自独立持有证据与结果；终局判为 **FLAKY 而非 PASS**，
 *         不稳定性无法被"重试一下就绿了"掩盖。
 */
import { makeFlakyStockReader } from '../fake-app.mjs';

// 跨 Attempt 共享同一个 reader：抖动状态才会真实地"第一次失败、第二次成功"
const readStock = makeFlakyStockReader({ warmupFailures: 1, stock: 42 });

export const spec = {
  caseId: 'TC-STOCK-001',
  title: '库存查询：可用量与守恒校验',
  script_ref: 'examples/specs/03-stock-flaky.spec.mjs',
  retryable: true,

  assertions: [
    { id: 'A1', layer: 'api', description: '库存查询返回可用量 available >= 0', required: true },
    { id: 'A2', layer: 'db', description: '库存守恒：available + frozen + used 与基线一致', required: true },
  ],

  async execute(ctx) {
    ctx.step('调用库存查询接口');

    let stock;
    try {
      stock = readStock();
    } catch (e) {
      // 失败也必须留证据——否则这次 Attempt 在磁盘上等于没发生过
      ctx.evidence('stderr', 'stock-error.log', `${e.message}\nkind=${e.kind}`);
      throw Object.assign(e, { failureType: 'TIMEOUT' });
    }

    const ev = ctx.evidence('db_snapshot', 'stock.json', JSON.stringify(stock, null, 2));

    ctx.step('断言可用量');
    ctx.assert('A1', stock.available >= 0, {
      expected: 'available >= 0',
      actual: `available=${stock.available}`,
      evidence: [ev],
    });

    ctx.step('断言库存守恒');
    const total = stock.available + stock.frozen + stock.used;
    ctx.assert('A2', total === 50, {
      expected: 'available + frozen + used = 50',
      actual: `${stock.available} + ${stock.frozen} + ${stock.used} = ${total}`,
      evidence: [ev],
    });
  },
};
