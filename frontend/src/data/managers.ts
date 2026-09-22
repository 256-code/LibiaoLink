/**
 * 项目经理目录（演示数据）= 人员目录（`data/members.ts`）里 role=项目经理 的 20 人（全部虚构姓名）。
 * id 为固定 UUID（与契约 `projects.manager_ids` 同格式）；接入 identity / 用户表后由接口数据替换；界面统一按 id 取姓名展示。
 */
import { memberName } from "./members";

/** 按 id 取姓名；未知 id 回退返回 id 本身（脏链接兜底，界面不出现空白）。 */
export function managerName(managerId: string): string {
  return memberName(managerId);
}

/**
 * 多位项目经理的展示文本（Push 136）：姓名按存储顺序「、」连接；空数组 = 空串。
 * 卡片 / 详情顶栏 / 任务表「项目经理」列与搜索都用它，保证同一个项目各处显示一致。
 */
export function managerNames(managerIds: readonly string[]): string {
  return managerIds.map((managerId) => managerName(managerId)).join("、");
}
