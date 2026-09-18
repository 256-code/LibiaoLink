import type { Project } from "../types";

export const INITIAL_PROJECTS: Project[] = [
  { id: "cnbj-0001", index: "01", title: "CNBJ-20260708-0001", description: "中国包裹分拣", projectType: "T-sort", region: "中国", accent: "blue", updatedAt: "2026-07-08 08:15", manager: "李伟" },
  { id: "usca-0002", index: "02", title: "USCA-20260708-0002", description: "美国包裹分拣", projectType: "T-sort", region: "美国", accent: "blue", updatedAt: "2026-07-08 09:02", manager: "王芳" },
  { id: "debe-0003", index: "03", title: "DEBE-20260708-0003", description: "德国包裹分拣", projectType: "3D分拣", region: "德国", accent: "emerald", updatedAt: "2026-07-08 09:47", manager: "陈晨" },
  { id: "jptk-0004", index: "04", title: "JPTK-20260708-0004", description: "日本包裹分拣", projectType: "飞箱", region: "日本", accent: "amber", updatedAt: "2026-07-08 10:20", manager: "刘洋" },
  { id: "gbln-0005", index: "05", title: "GBLN-20260708-0005", description: "英国包裹分拣", projectType: "T-sort", region: "英国", accent: "blue", updatedAt: "2026-07-08 11:05", manager: "赵磊" },
  { id: "frly-0006", index: "06", title: "FRLY-20260708-0006", description: "法国包裹分拣", projectType: "3D分拣", region: "法国", accent: "emerald", updatedAt: "2026-07-08 13:12", manager: "孙悦" },
  { id: "krsl-0007", index: "07", title: "KRSL-20260708-0007", description: "韩国包裹分拣", projectType: "3D分拣", region: "韩国", accent: "emerald", updatedAt: "2026-07-08 14:38", manager: "周涛" },
  { id: "thbk-0008", index: "08", title: "THBK-20260708-0008", description: "泰国包裹分拣", projectType: "飞箱", region: "泰国", accent: "amber", updatedAt: "2026-07-08 15:09", manager: "吴敏" },
  { id: "vnsg-0009", index: "09", title: "VNSG-20260708-0009", description: "越南包裹分拣", projectType: "T-sort", region: "越南", accent: "blue", updatedAt: "2026-07-08 16:24", manager: "郑凯" },
  { id: "inmu-0010", index: "10", title: "INMU-20260708-0010", description: "印度包裹分拣", projectType: "3D分拣", region: "印度", accent: "emerald", updatedAt: "2026-07-08 17:41", manager: "冯雪" },
  { id: "brsp-0011", index: "11", title: "BRSP-20260708-0011", description: "巴西包裹分拣", projectType: "飞箱", region: "巴西", accent: "amber", updatedAt: "2026-07-08 08:52", manager: "何俊" },
  { id: "clsc-0012", index: "12", title: "CLSC-20260708-0012", description: "智利包裹分拣", projectType: "飞箱", region: "智利", accent: "amber", updatedAt: "2026-07-08 10:33", manager: "许静" },
  { id: "pelm-0013", index: "13", title: "PELM-20260708-0013", description: "秘鲁包裹分拣", projectType: "T-sort", region: "秘鲁", accent: "blue", updatedAt: "2026-07-08 12:07", manager: "高峰" },
  { id: "grat-0014", index: "14", title: "GRAT-20260708-0014", description: "希腊包裹分拣", projectType: "3D分拣", region: "希腊", accent: "emerald", updatedAt: "2026-07-08 13:55", manager: "林娜" },
  { id: "plwa-0015", index: "15", title: "PLWA-20260708-0015", description: "波兰包裹分拣", projectType: "飞箱", region: "波兰", accent: "amber", updatedAt: "2026-07-08 15:18", manager: "罗成" },
  { id: "nlan-0016", index: "16", title: "NLAN-20260708-0016", description: "荷兰包裹分拣", projectType: "T-sort", region: "荷兰", accent: "blue", updatedAt: "2026-07-08 16:46", manager: "梁爽" },
  { id: "sesk-0017", index: "17", title: "SESK-20260708-0017", description: "瑞典包裹分拣", projectType: "3D分拣", region: "瑞典", accent: "emerald", updatedAt: "2026-07-08 09:28", manager: "宋扬" },
  { id: "chzh-0018", index: "18", title: "CHZH-20260708-0018", description: "瑞士包裹分拣", projectType: "飞箱", region: "瑞士", accent: "amber", updatedAt: "2026-07-08 11:39", manager: "唐磊" },
  { id: "noos-0019", index: "19", title: "NOOS-20260708-0019", description: "挪威包裹分拣", projectType: "T-sort", region: "挪威", accent: "blue", updatedAt: "2026-07-08 14:02", manager: "韩雪" },
  { id: "zajn-0020", index: "20", title: "ZAJN-20260708-0020", description: "南非包裹分拣", projectType: "3D分拣", region: "南非", accent: "emerald", updatedAt: "2026-07-08 17:15", manager: "曹阳" },
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
