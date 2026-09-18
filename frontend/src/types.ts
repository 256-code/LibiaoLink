export type User = {
  name: string | null;
  displayName: string | null;
  email: string | null;
  id: string | null;
  owner: string | null;
};

export type MeResponse = {
  user: User;
  claims: Record<string, unknown>;
  expiresAt: number | null;
};

export type CardAccent = "blue" | "emerald" | "amber";

// 预留色：暂不启用，未来新增项目类型时可用（例如红色、紫色）
// export type CardAccentReserved = "rose" | "violet";

export const PROJECT_TYPES = ["T-sort", "3D分拣", "飞箱"] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_ACCENTS: Record<ProjectType, CardAccent> = {
  "T-sort": "blue",
  "3D分拣": "emerald",
  "飞箱": "amber",
};

/**
 * 项目经理（演示目录）：契约侧来自 identity 用户（UUID）。
 * 列表筛选与卡片展示按 id 关联、按姓名显示（URL 参数 filter[managerId]，与 shared 契约同口径）。
 */
export type Manager = {
  id: string;
  name: string;
};

/** 项目（内存态演示数据）：编号、序号与人员字段命名对齐 shared 契约（code / seqNo / managerId）。 */
export type Project = {
  id: string;
  /** 项目序号（契约 seqNo ↔ projects.seq_no）：服务端创建时分配，全库唯一、不可修改、不回收；卡片两位补零展示。 */
  seqNo: number;
  code: string;
  description: string;
  region: string;
  projectType: ProjectType;
  accent: CardAccent;
  updatedAt: string;
  managerId: string;
};
