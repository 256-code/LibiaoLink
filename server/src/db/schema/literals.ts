/** 固定的 SQL 字面量工具：仅用于把本文件的稳定枚举写进 CHECK 定义（避免在 schema 里散落引号）。 */
export function sqlValueList(values: readonly string[]): string {
  const quote = String.fromCharCode(39);
  return "(" + values.map((value) => quote + value + quote).join(", ") + ")";
}

export const STAGE_KEYS = [
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
] as const;
