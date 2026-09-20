// LibiaoLink · 种子 #5：地区 / 项目类型字典（h7 · S6·admin · C9-01）
// 口径来源：技术设计v0.2 §2.5（字典第一批）+ v0.3 §3.2（dict_types / dict_items：code、name、sort、enabled、metadata 含 accent）。
// 范围：只写 region / projectType 两类（阶段 / 成果文件类型 / 紧急重要度走契约枚举，不进字典接口 —— 契约 shared/src/modules/dicts.ts）。
// 修订语义：幂等 —— 类型 / 条目按 (type_code, code) 存在即跳过，**不覆盖库内已修订的口径**（管理端改过的值不被种子回滚），不删除；
//   停用 = enabled=false（由管理端维护，C9-02：停用不影响存量数据展示）。
// 取值状态：业务尚未回执（技术设计v0.3 §7.3 #10），本文件为「最小样例 · 可修订」；回执后改常量区并重跑。

export const name = "dicts";
export const title = "数据字典（地区 / 项目类型 · v0.2 §2.5）";

/** 可修订常量区：metadata.accent / accentText 是前端主题色元数据（C9-01：字典驱动，前端不硬编码）。 */
export const DICTS = [
  {
    type: { code: "region", name: "地区", sort: 10 },
    items: [
      { code: "华东", name: "华东", sort: 10 },
      { code: "华北", name: "华北", sort: 20 },
      { code: "华南", name: "华南", sort: 30 },
      { code: "华中", name: "华中", sort: 40 },
      { code: "西南", name: "西南", sort: 50 },
      { code: "西北", name: "西北", sort: 60 },
      { code: "东北", name: "东北", sort: 70 },
      { code: "海外", name: "海外", sort: 80 },
    ],
  },
  {
    type: { code: "projectType", name: "项目类型", sort: 20 },
    items: [
      // 码与主题色对齐前端既有行为（frontend/src/types.ts 的 PROJECT_TYPES / PROJECT_TYPE_ACCENTS；u12 后前端改读字典）
      { code: "T-sort", name: "T-sort", sort: 10, metadata: { accent: "#3b82f6", accentText: "#ffffff" } },
      { code: "3D分拣", name: "3D分拣", sort: 20, metadata: { accent: "#10b981", accentText: "#ffffff" } },
      { code: "飞箱", name: "飞箱", sort: 30, metadata: { accent: "#feca04", accentText: "#313033" } },
    ],
  },
];

export async function run(client) {
  const summary = { typesInserted: 0, typesUnchanged: 0, itemsInserted: 0, itemsUnchanged: 0 };
  for (const dict of DICTS) {
    const type = dict.type;
    const foundType = await client.query("select code from dict_types where code = $1", [type.code]);
    if (foundType.rows.length === 0) {
      await client.query(
        "insert into dict_types (code, name, sort, enabled, created_at, updated_at) values ($1, $2, $3, true, now(), now())",
        [type.code, type.name, type.sort],
      );
      summary.typesInserted += 1;
    } else {
      summary.typesUnchanged += 1;
    }
    for (const item of dict.items) {
      const found = await client.query("select id from dict_items where type_code = $1 and code = $2", [type.code, item.code]);
      if (found.rows.length > 0) {
        summary.itemsUnchanged += 1;
        continue;
      }
      await client.query(
        "insert into dict_items (type_code, code, name, sort, enabled, metadata, created_at, updated_at) values ($1, $2, $3, $4, true, $5::jsonb, now(), now())",
        [type.code, item.code, item.name, item.sort, JSON.stringify(item.metadata ?? {})],
      );
      summary.itemsInserted += 1;
    }
  }
  return summary;
}
