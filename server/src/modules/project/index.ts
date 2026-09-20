/** project 模块唯一公开出口（跨模块只允许 import 本文件；ADR-010 / g6）。 */
export { ProjectModule } from "./project.module.js";
export { ProjectService, toProjectView } from "./project.service.js";
export type { ProjectView, ProjectListResult, ProjectFacetsResult } from "./project.service.js";
export { ProjectMemberService, toProjectMemberView } from "./project-member.service.js";
export type { ProjectMemberView, ProjectMemberListResult } from "./project-member.service.js";
export type { ProjectRow, ProjectViewRow } from "./project.repository.js";
export type { ProjectMemberRow, ProjectMemberViewRow } from "./project-member.repository.js";
