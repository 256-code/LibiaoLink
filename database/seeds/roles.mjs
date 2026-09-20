// LibiaoLink · 种子 #6a：一期六个内置角色（database/seeds/README.md 种子 #6）
// 口径：技术设计v0.2 §4.1（角色与数据范围表；技术设计v0.3 §3.2 M1）。
// 范围：只写 roles（code / name / data_scope）；功能权限矩阵（role_permissions 条目）随 h6（PoC-6）填充。
// 说明：角色行以本文件为准（可修订）——改 name / dataScope 后重跑即生效；不做 DELETE（user_roles 有引用）。

export const name = "roles";
export const title = "角色（一期六个内置角色 · v0.2 §4.1）";

/** 可修订常量区：角色集为业务定稿（C3-01 / C3-02）；调整后重跑本脚本。 */
export const ROLES = [
  { code: "admin", name: "系统管理员", dataScope: "all" },
  { code: "project_manager", name: "项目经理", dataScope: "managed_projects" },
  { code: "task_owner", name: "任务负责人", dataScope: "involved_projects" },
  { code: "project_member", name: "项目成员", dataScope: "involved_projects" },
  { code: "sales", name: "销售（录入）", dataScope: "own_stakeholders" },
  { code: "viewer", name: "只读", dataScope: "granted" },
];

export async function run(client) {
  const summary = { inserted: 0, updated: 0, unchanged: 0 };
  for (const role of ROLES) {
    const found = await client.query("select id, name, data_scope from roles where code = $1", [role.code]);
    const row = found.rows[0];
    if (row === undefined) {
      await client.query("insert into roles (code, name, data_scope) values ($1, $2, $3)", [role.code, role.name, role.dataScope]);
      summary.inserted += 1;
      continue;
    }
    if (row.name === role.name && row.data_scope === role.dataScope) {
      summary.unchanged += 1;
      continue;
    }
    await client.query("update roles set name = $2, data_scope = $3, updated_at = now() where id = $1", [row.id, role.name, role.dataScope]);
    summary.updated += 1;
  }
  return summary;
}
