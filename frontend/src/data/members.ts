/**
 * 人员模型（M3-07 刀 1 后半接线版）：只保留 UI 侧的类型。
 * 演示用人员目录（MEMBER_DIRECTORY / PROJECT_MANAGERS / memberByName 等）已随接线下线 ——
 * 候选人来自服务端用户目录（GET /api/v1/users，见 frontend/src/directory.ts 的 directoryMemberOptions）。
 */
export type MemberRole = string;

export type Member = {
  id: string;
  name: string;
  /** 副标题（用户目录接线口径 = 工号 username）。 */
  handle: string;
  role: MemberRole;
};
