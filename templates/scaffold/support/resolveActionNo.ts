import type { APIRequestContext } from '@playwright/test';

/**
 * 动态解析当前有效的业务标识（单号/编号）——不依赖静态文档快照（会随真实业务流转过期）。
 * 见 auto-test skill `rules/source-analysis-rule.md §1.6`。
 *
 * 下方为**通用示例**：调用一个"查询当前有效业务单据列表"的接口，取回可用标识。
 * 请把接口路径、请求参数、返回字段改成你项目里对应的查询接口。
 */

export interface IdCandidate {
  id: number;
  /** 业务标识（单号/编号），字段名按你的接口调整 */
  bizNo: string;
  /** 可选的判别字段（如类型/状态），供按变体维度筛选 */
  type?: number | string;
  status?: number | string;
}

/**
 * 查询当前有效候选标识。
 * @param listApi   你项目里"查询有效业务单据列表"的接口路径
 * @param query     查询参数（如状态、类型过滤）
 */
export async function resolveIdCandidates(
  apiClient: APIRequestContext,
  listApi: string,
  query: Record<string, unknown> = {},
): Promise<IdCandidate[]> {
  const resp = await apiClient.post(listApi, { data: query });
  const body = await resp.json().catch(() => null);
  return Array.isArray(body?.data) ? body.data : [];
}

/** 取第一个候选标识；取不到返回 null（调用方据此判 BLOCKED 并说明数据空档，而非编造） */
export async function resolveFirstId(
  apiClient: APIRequestContext,
  listApi: string,
  query: Record<string, unknown> = {},
): Promise<string | null> {
  const list = await resolveIdCandidates(apiClient, listApi, query);
  return list[0]?.bizNo ?? null;
}
