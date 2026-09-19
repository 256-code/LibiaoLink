/**
 * 演示用人员目录（全部为虚构姓名，不对应真实员工）：
 * - 项目经理 20 人：id 为固定 UUID（与契约 projects.manager_id 同格式），供项目经理下拉 / 筛选使用；
 * - 交付成员 11 人：实施 / 机械 / 软件 / 质量 / 采购 / 商务，供任务负责人下拉使用。
 * 接入 identity 用户表后由接口数据替换；界面统一按 id 取「姓名 + 拼音名」展示（对齐任务负责人中英文合并显示口径）。
 */
export type MemberRole =
  | "项目经理"
  | "实施工程师"
  | "机械工程师"
  | "软件工程师"
  | "质量工程师"
  | "采购专员"
  | "商务专员";

export type Member = {
  id: string;
  name: string;
  /** 拼音名（展示用，如 pengyan；对齐任务负责人中英文合并显示）。 */
  handle: string;
  role: MemberRole;
};

export const MEMBER_DIRECTORY: Member[] = [
  { id: "2f7c1a94-5d0e-4b6a-9c31-8e0f5a2b7001", name: "李伟", handle: "liwei", role: "项目经理" },
  { id: "3a8d2b05-6e1f-4c7b-9d42-9f1a6b3c8002", name: "王芳", handle: "wangfang", role: "项目经理" },
  { id: "4b9e3c16-7f20-4d8c-9e53-a02b7c4d9003", name: "陈晨", handle: "chenchen", role: "项目经理" },
  { id: "5c0f4d27-8031-4e9d-9f64-b13c8d5e0004", name: "刘洋", handle: "liuyang", role: "项目经理" },
  { id: "6d1a5e38-9142-4f0e-9075-c24d9e6f1005", name: "赵磊", handle: "zhaolei", role: "项目经理" },
  { id: "7e2b6f49-a253-401f-9186-d35e0f702006", name: "孙悦", handle: "sunyue", role: "项目经理" },
  { id: "8f3c705a-b364-4120-9297-e46f10813007", name: "周涛", handle: "zhoutao", role: "项目经理" },
  { id: "904d816b-c475-4231-93a8-f57021924008", name: "吴敏", handle: "wumin", role: "项目经理" },
  { id: "a15e927c-d586-4342-94b9-068132a35009", name: "郑凯", handle: "zhengkai", role: "项目经理" },
  { id: "b26fa38d-e697-4453-95ca-179243b46010", name: "冯雪", handle: "fengxue", role: "项目经理" },
  { id: "c370b49e-f7a8-4564-96db-28a354c57011", name: "何俊", handle: "hejun", role: "项目经理" },
  { id: "d481c5af-08b9-4675-97ec-39b465d68012", name: "许静", handle: "xujing", role: "项目经理" },
  { id: "e592d6b0-19ca-4786-98fd-4ac576e79013", name: "高峰", handle: "gaofeng", role: "项目经理" },
  { id: "f6a3e7c1-2adb-4897-990e-5bd687f8a014", name: "林娜", handle: "linna", role: "项目经理" },
  { id: "07b4f8d2-3bec-49a8-a11f-6ce79809b015", name: "罗成", handle: "luocheng", role: "项目经理" },
  { id: "18c509e3-4cfd-4ab9-b220-7df8a91ac016", name: "梁爽", handle: "liangshuang", role: "项目经理" },
  { id: "29d61af4-5d0e-4bca-b331-8e09ba2bd017", name: "宋扬", handle: "songyang", role: "项目经理" },
  { id: "3ae72b05-6e1f-4cdb-b442-9f1acb3ce018", name: "唐磊", handle: "tanglei", role: "项目经理" },
  { id: "4bf83c16-7f20-4dec-b553-a02bdc4df019", name: "韩雪", handle: "hanxue", role: "项目经理" },
  { id: "5c094d27-8031-4efd-b664-b13ced5e0020", name: "白婧", handle: "baijing", role: "项目经理" },
  { id: "7c2d7061-b475-4311-93a7-e57a1b8c4021", name: "彭砚", handle: "pengyan", role: "实施工程师" },
  { id: "8d3e8172-c586-4422-a4b8-f68b2c9d5022", name: "苏珩", handle: "suheng", role: "实施工程师" },
  { id: "9e4f9283-d697-4533-b5c9-079c3dae6023", name: "秦朗", handle: "qinlang", role: "实施工程师" },
  { id: "af509394-e7a8-4644-c6da-18ad4ebf7024", name: "石昀", handle: "shiyun", role: "实施工程师" },
  { id: "b061a4a5-f8b9-4755-d7eb-29be5fc08025", name: "卢青", handle: "luqing", role: "机械工程师" },
  { id: "c172b5b6-09ca-4866-e8fc-3acf60d19026", name: "程屿", handle: "chengyu", role: "机械工程师" },
  { id: "d283c6c7-1adb-4977-f90d-4bd071e2a027", name: "方沐", handle: "fangmu", role: "软件工程师" },
  { id: "e394d7d8-2bec-4a88-0a1e-5ce182f3b028", name: "夏珂", handle: "xiake", role: "软件工程师" },
  { id: "f4a5e8e9-3cfd-4b99-1b2f-6df29304c029", name: "谢遥", handle: "xieyao", role: "质量工程师" },
  { id: "05b6f9fa-4d0e-4caa-2c30-7e03a415d030", name: "蒋恬", handle: "jiangtian", role: "采购专员" },
  { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4031", name: "岑宁", handle: "chenning", role: "商务专员" },
];

const BY_ID = new Map(MEMBER_DIRECTORY.map((member) => [member.id, member]));

/** 项目经理（人员目录里 role=项目经理 的 20 人）：项目经理下拉 / 筛选使用。 */
export const PROJECT_MANAGERS: Member[] = MEMBER_DIRECTORY.filter((member) => member.role === "项目经理");

/** 按 id 取成员；未知 id 返回 undefined。 */
export function memberById(memberId: string): Member | undefined {
  return BY_ID.get(memberId);
}

/** 按 id 取姓名；未知 id 回退返回 id 本身（脏链接兜底，界面不出现空白）。 */
export function memberName(memberId: string): string {
  return BY_ID.get(memberId)?.name ?? memberId;
}

/** 按姓名反查成员（演示数据保存的是姓名 / 拼音，编辑表单按 id 选中）。 */
export function memberByName(name: string): Member | undefined {
  return MEMBER_DIRECTORY.find((member) => member.name === name);
}

/** 展示口径：姓名(拼音)，如 彭砚(pengyan)。 */
export function memberLabel(member: Member): string {
  return member.handle === "" ? member.name : member.name + "(" + member.handle + ")";
}
