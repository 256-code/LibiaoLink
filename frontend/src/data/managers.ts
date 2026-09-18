import type { Manager } from "../types";

/**
 * 演示用项目经理目录：id 为固定 UUID（与契约 projects.manager_id 同格式）。
 * 接入 identity / 用户表后由接口数据替换；界面统一按 id 取姓名展示。
 */
export const MANAGERS: Manager[] = [
  { id: "2f7c1a94-5d0e-4b6a-9c31-8e0f5a2b7001", name: "李伟" },
  { id: "3a8d2b05-6e1f-4c7b-9d42-9f1a6b3c8002", name: "王芳" },
  { id: "4b9e3c16-7f20-4d8c-9e53-a02b7c4d9003", name: "陈晨" },
  { id: "5c0f4d27-8031-4e9d-9f64-b13c8d5e0004", name: "刘洋" },
  { id: "6d1a5e38-9142-4f0e-9075-c24d9e6f1005", name: "赵磊" },
  { id: "7e2b6f49-a253-401f-9186-d35e0f702006", name: "孙悦" },
  { id: "8f3c705a-b364-4120-9297-e46f10813007", name: "周涛" },
  { id: "904d816b-c475-4231-93a8-f57021924008", name: "吴敏" },
  { id: "a15e927c-d586-4342-94b9-068132a35009", name: "郑凯" },
  { id: "b26fa38d-e697-4453-95ca-179243b46010", name: "冯雪" },
  { id: "c370b49e-f7a8-4564-96db-28a354c57011", name: "何俊" },
  { id: "d481c5af-08b9-4675-97ec-39b465d68012", name: "许静" },
  { id: "e592d6b0-19ca-4786-98fd-4ac576e79013", name: "高峰" },
  { id: "f6a3e7c1-2adb-4897-990e-5bd687f8a014", name: "林娜" },
  { id: "07b4f8d2-3bec-49a8-a11f-6ce79809b015", name: "罗成" },
  { id: "18c509e3-4cfd-4ab9-b220-7df8a91ac016", name: "梁爽" },
  { id: "29d61af4-5d0e-4bca-b331-8e09ba2bd017", name: "宋扬" },
  { id: "3ae72b05-6e1f-4cdb-b442-9f1acb3ce018", name: "唐磊" },
  { id: "4bf83c16-7f20-4dec-b553-a02bdc4df019", name: "韩雪" },
  { id: "5c094d27-8031-4efd-b664-b13ced5e0020", name: "曹阳" },
];

/** 按 id 取姓名；未知 id 回退返回 id 本身（脏链接兜底，界面不出现空白）。 */
export function managerName(managerId: string): string {
  return MANAGERS.find((manager) => manager.id === managerId)?.name ?? managerId;
}
