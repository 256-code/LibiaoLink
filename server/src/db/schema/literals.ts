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

/** 项目内角色（project_members.role_in_project，v0.3 §3.3）：与全局角色（roles）相互独立，名册内既可见性也认角色。 */
export const PROJECT_MEMBER_ROLES = [
  "project_manager",
  "project_member",
] as const;

/** 角色数据范围（roles.data_scope，v0.2 §4.1）：由宽到窄，多角色取并集。 */
export const DATA_SCOPE_KEYS = [
  "all",
  "managed_projects",
  "involved_projects",
  "own_stakeholders",
  "granted",
] as const;
