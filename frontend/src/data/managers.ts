import type { Manager } from "../types";
import { PROJECT_MANAGERS, memberName } from "./members";

/**
 * 演示用项目经理目录 = 人员目录（`data/members.ts`）里 role=项目经理 的 20 人（全部虚构姓名）。
 * id 为固定 UUID（与契约 projects.manager_id 同格式）；接入 identity / 用户表后由接口数据替换；界面统一按 id 取姓名展示。
 */
export const MANAGERS: Manager[] = PROJECT_MANAGERS.map((member) => ({
  id: member.id,
  name: member.name,
}));

/** 按 id 取姓名；未知 id 回退返回 id 本身（脏链接兜底，界面不出现空白）。 */
export function managerName(managerId: string): string {
  return memberName(managerId);
}
