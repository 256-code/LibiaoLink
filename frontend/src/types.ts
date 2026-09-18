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

export type Project = {
  id: string;
  index: string;
  title: string;
  description: string;
  region: string;
  projectType: ProjectType;
  accent: CardAccent;
  updatedAt: string;
  manager: string;
};
