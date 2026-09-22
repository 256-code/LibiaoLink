import type { Project } from "../types";

/**
 * 首页演示数据（20 条，全部虚构）：
 * 项目经理自 Push 136 起由单个改为**多位**（`managerIds`）—— 印度项目（冯雪 + 李伟）与美国项目（王芳 + 陈晨）
 * 是双经理演示样例，其余项目保留一位；数组顺序 = 卡片 / 详情 / 筛选里的展示顺序。
 */
export const INITIAL_PROJECTS: Project[] = [
  { id: "cnbj-0001", seqNo: 1, code: "CNBJ-20260708-0001", description: "中国包裹分拣", projectType: "T-sort", region: "中国", accent: "blue", createdAt: "2026-07-08 08:15", updatedAt: "2026-07-08 08:15", managerIds: ["2f7c1a94-5d0e-4b6a-9c31-8e0f5a2b7001"] },
  { id: "usca-0002", seqNo: 2, code: "USCA-20260708-0002", description: "美国包裹分拣", projectType: "T-sort", region: "美国", accent: "blue", createdAt: "2026-07-08 09:02", updatedAt: "2026-07-08 09:02", managerIds: ["3a8d2b05-6e1f-4c7b-9d42-9f1a6b3c8002", "4b9e3c16-7f20-4d8c-9e53-a02b7c4d9003"] },
  { id: "debe-0003", seqNo: 3, code: "DEBE-20260708-0003", description: "德国包裹分拣", projectType: "3D分拣", region: "德国", accent: "emerald", createdAt: "2026-07-08 09:47", updatedAt: "2026-07-08 09:47", managerIds: ["4b9e3c16-7f20-4d8c-9e53-a02b7c4d9003"] },
  { id: "jptk-0004", seqNo: 4, code: "JPTK-20260708-0004", description: "日本包裹分拣", projectType: "飞箱", region: "日本", accent: "amber", createdAt: "2026-07-08 10:20", updatedAt: "2026-07-08 10:20", managerIds: ["5c0f4d27-8031-4e9d-9f64-b13c8d5e0004"] },
  { id: "gbln-0005", seqNo: 5, code: "GBLN-20260708-0005", description: "英国包裹分拣", projectType: "T-sort", region: "英国", accent: "blue", createdAt: "2026-07-08 11:05", updatedAt: "2026-07-08 11:05", managerIds: ["6d1a5e38-9142-4f0e-9075-c24d9e6f1005"] },
  { id: "frly-0006", seqNo: 6, code: "FRLY-20260708-0006", description: "法国包裹分拣", projectType: "3D分拣", region: "法国", accent: "emerald", createdAt: "2026-07-08 13:12", updatedAt: "2026-07-08 13:12", managerIds: ["7e2b6f49-a253-401f-9186-d35e0f702006"] },
  { id: "krsl-0007", seqNo: 7, code: "KRSL-20260708-0007", description: "韩国包裹分拣", projectType: "3D分拣", region: "韩国", accent: "emerald", createdAt: "2026-07-08 14:38", updatedAt: "2026-07-08 14:38", managerIds: ["8f3c705a-b364-4120-9297-e46f10813007"] },
  { id: "thbk-0008", seqNo: 8, code: "THBK-20260708-0008", description: "泰国包裹分拣", projectType: "飞箱", region: "泰国", accent: "amber", createdAt: "2026-07-08 15:09", updatedAt: "2026-07-08 15:09", managerIds: ["904d816b-c475-4231-93a8-f57021924008"] },
  { id: "vnsg-0009", seqNo: 9, code: "VNSG-20260708-0009", description: "越南包裹分拣", projectType: "T-sort", region: "越南", accent: "blue", createdAt: "2026-07-08 16:24", updatedAt: "2026-07-08 16:24", managerIds: ["a15e927c-d586-4342-94b9-068132a35009"] },
  { id: "inmu-0010", seqNo: 10, code: "INMU-20260708-0010", description: "印度包裹分拣", projectType: "3D分拣", region: "印度", accent: "emerald", createdAt: "2026-07-08 17:41", updatedAt: "2026-07-08 17:41", managerIds: ["b26fa38d-e697-4453-95ca-179243b46010", "2f7c1a94-5d0e-4b6a-9c31-8e0f5a2b7001"] },
  { id: "brsp-0011", seqNo: 11, code: "BRSP-20260708-0011", description: "巴西包裹分拣", projectType: "飞箱", region: "巴西", accent: "amber", createdAt: "2026-07-08 08:52", updatedAt: "2026-07-08 08:52", managerIds: ["c370b49e-f7a8-4564-96db-28a354c57011"] },
  { id: "clsc-0012", seqNo: 12, code: "CLSC-20260708-0012", description: "智利包裹分拣", projectType: "飞箱", region: "智利", accent: "amber", createdAt: "2026-07-08 10:33", updatedAt: "2026-07-08 10:33", managerIds: ["d481c5af-08b9-4675-97ec-39b465d68012"] },
  { id: "pelm-0013", seqNo: 13, code: "PELM-20260708-0013", description: "秘鲁包裹分拣", projectType: "T-sort", region: "秘鲁", accent: "blue", createdAt: "2026-07-08 12:07", updatedAt: "2026-07-08 12:07", managerIds: ["e592d6b0-19ca-4786-98fd-4ac576e79013"] },
  { id: "grat-0014", seqNo: 14, code: "GRAT-20260708-0014", description: "希腊包裹分拣", projectType: "3D分拣", region: "希腊", accent: "emerald", createdAt: "2026-07-08 13:55", updatedAt: "2026-07-08 13:55", managerIds: ["f6a3e7c1-2adb-4897-990e-5bd687f8a014"] },
  { id: "plwa-0015", seqNo: 15, code: "PLWA-20260708-0015", description: "波兰包裹分拣", projectType: "飞箱", region: "波兰", accent: "amber", createdAt: "2026-07-08 15:18", updatedAt: "2026-07-08 15:18", managerIds: ["07b4f8d2-3bec-49a8-a11f-6ce79809b015"] },
  { id: "nlan-0016", seqNo: 16, code: "NLAN-20260708-0016", description: "荷兰包裹分拣", projectType: "T-sort", region: "荷兰", accent: "blue", createdAt: "2026-07-08 16:46", updatedAt: "2026-07-08 16:46", managerIds: ["18c509e3-4cfd-4ab9-b220-7df8a91ac016"] },
  { id: "sesk-0017", seqNo: 17, code: "SESK-20260708-0017", description: "瑞典包裹分拣", projectType: "3D分拣", region: "瑞典", accent: "emerald", createdAt: "2026-07-08 09:28", updatedAt: "2026-07-08 09:28", managerIds: ["29d61af4-5d0e-4bca-b331-8e09ba2bd017"] },
  { id: "chzh-0018", seqNo: 18, code: "CHZH-20260708-0018", description: "瑞士包裹分拣", projectType: "飞箱", region: "瑞士", accent: "amber", createdAt: "2026-07-08 11:39", updatedAt: "2026-07-08 11:39", managerIds: ["3ae72b05-6e1f-4cdb-b442-9f1acb3ce018"] },
  { id: "noos-0019", seqNo: 19, code: "NOOS-20260708-0019", description: "挪威包裹分拣", projectType: "T-sort", region: "挪威", accent: "blue", createdAt: "2026-07-08 14:02", updatedAt: "2026-07-08 14:02", managerIds: ["4bf83c16-7f20-4dec-b553-a02bdc4df019"] },
  { id: "zajn-0020", seqNo: 20, code: "ZAJN-20260708-0020", description: "南非包裹分拣", projectType: "3D分拣", region: "南非", accent: "emerald", createdAt: "2026-07-08 17:15", updatedAt: "2026-07-08 17:15", managerIds: ["5c094d27-8031-4efd-b664-b13ced5e0020"] },
];

export const PROJECT_STAGES = [
  "项目总览",
  "售前规划",
  "设计开发",
  "加工采购",
  "组装发货",
  "硬件实施",
  "软件部署",
  "试运行",
  "生产阶段",
  "验收",
] as const;
