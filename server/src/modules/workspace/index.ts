/** workspace 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { WorkspaceModule } from "./workspace.module.js";
export { WorkspaceService } from "./workspace.service.js";
export { addDays, emptyTaskGroups, taskGroupOf } from "./workspace.rules.js";
export type { WorkspaceIssueRow, WorkspaceTaskRow } from "./workspace.repository.js";
