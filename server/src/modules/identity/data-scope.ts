import { DATA_SCOPE_KEYS } from "../../db/schema/literals.js";

export type DataScope = (typeof DATA_SCOPE_KEYS)[number];

/**
 * 由宽到窄的约定序（与 roles.data_scope 的 CHECK 同源）：只服务粗粒度快速判定；
 * 精确的数据范围裁剪由 h6 策略服务用「范围集合」构建 where（ADR-011 buildScopeWhere）。
 */
export const DATA_SCOPE_WIDTH: readonly DataScope[] = DATA_SCOPE_KEYS;

export function isDataScope(value: string): value is DataScope {
  return (DATA_SCOPE_KEYS as readonly string[]).includes(value);
}

/** 去重 + 由宽到窄排序；非法值直接抛错（表上有 CHECK，出现即代码 / 数据问题）。 */
export function sortDataScopes(scopes: readonly string[]): DataScope[] {
  const unique = new Set<DataScope>();
  for (const scope of scopes) {
    if (!isDataScope(scope)) {
      throw new Error("未知数据范围：" + scope);
    }
    unique.add(scope);
  }
  return DATA_SCOPE_WIDTH.filter((scope) => unique.has(scope));
}

/** 最宽范围（无角色时 null）；多角色并存时以集合为准（h6），此函数只用于粗判与展示。 */
export function widestDataScope(scopes: readonly string[]): DataScope | null {
  const sorted = sortDataScopes(scopes);
  return sorted[0] ?? null;
}
