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

/** 项目（内存态演示数据）：编号、序号与人员字段命名对齐 shared 契约（code / seqNo / managerIds）。 */
export type Project = {
  id: string;
  /** 项目序号（契约 seqNo ↔ projects.seq_no）：服务端创建时分配，全库唯一、不可修改、不回收；卡片两位补零展示。 */
  seqNo: number;
  code: string;
  description: string;
  region: string;
  projectType: ProjectType;
  accent: CardAccent;
  /** 创建时间（契约 createdAt）：创建时生成、不随编辑变化；卡片右下角与详情顶栏「创建于」展示。 */
  createdAt: string;
  /** 项目时间（契约 updatedAt）：项目最近活动时间——主数据变更 / 阶段推进 / 任务变更刷新；列表排序 / 搜索 / 「项目时间」区间筛选用，暂不上卡面（见 前端功能需求 第六章第 14 条）。 */
  updatedAt: string;
  /**
   * 项目经理（多位，Push 136）：至少一位、可多位，数组顺序 = 展示顺序。
   * 对齐契约 `projects.manager_ids`（uuid[]、非空）；列表筛选 `filter[managerId]` 命中「该项目有这一位经理」，
   * 卡片 / 详情顶栏 / 任务表「项目经理」列都按这一份名单展示。
   */
  managerIds: string[];
};
