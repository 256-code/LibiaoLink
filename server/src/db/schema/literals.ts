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

/** 审计动作（audit_logs.action，h7 · C7）：新增 / 修改 / 删除 / 进度 / 完成 / 推进 / 回退 / 越权拒绝。 */
export const AUDIT_ACTION_KEYS = ["create", "update", "delete", "progress", "complete", "advance", "rollback", "deny"] as const;

/** 审计结果（audit_logs.result）：成功 / 越权拒绝 / 执行失败。 */
export const AUDIT_RESULT_KEYS = ["succeeded", "denied", "failed"] as const;

/** 审计入口（audit_logs.entry）：页面 / API / 系统任务 / 批量。 */
export const AUDIT_ENTRY_KEYS = ["api", "page", "system", "batch"] as const;
