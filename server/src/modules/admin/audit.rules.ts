import type { AuditChangeEntry } from "../../db/schema/admin.js";

/**
 * 审计纯函数（h7 · C7）：字段级 diff。路径 → 对象的解析在 common/audit/audit-path.ts（全局过滤器共用）。
 * 不依赖 Nest / 数据库，供单测直接使用（test/admin-audit.test.ts）。
 */

/** 稳定序列化：对象键排序、Date 归一化为 ISO，保证 diff 比较与键序无关。 */
export function stableValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((item) => stableValue(item)).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + stableValue(record[key])).join(",") + "}";
}

/** 字段级 diff（C7-02）：before / after 键并集上的浅比较；值按稳定序列化比较，输出按字段名排序。 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChangeEntry[] {
  const left = before ?? {};
  const right = after ?? {};
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes: AuditChangeEntry[] = [];
  for (const field of fields) {
    const from = left[field] ?? null;
    const to = right[field] ?? null;
    if (stableValue(from) !== stableValue(to)) changes.push({ field, from, to });
  }
  return changes.sort((a, b) => a.field.localeCompare(b.field));
}
