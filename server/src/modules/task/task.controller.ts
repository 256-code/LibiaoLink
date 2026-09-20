import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  ProjectSummarySchema,
  TaskCreateBodySchema,
  TaskDetailSchema,
  TaskListItemSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskProgressUpdateBodySchema,
  TaskSchema,
  TaskUpdateBodySchema,
  UuidSchema,
  z,
} from "@libiaolink/contracts";
import { ZodValidationPipe } from "../../common/http/zod-validation.pipe.js";
import { CsrfGuard, CurrentActorId, SessionGuard } from "../identity/index.js";
import { TaskService } from "./task.service.js";

type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
type TaskCreateBody = z.infer<typeof TaskCreateBodySchema>;
type TaskUpdateBody = z.infer<typeof TaskUpdateBodySchema>;
type TaskProgressUpdateBody = z.infer<typeof TaskProgressUpdateBodySchema>;

const uuidParam = new ZodValidationPipe(UuidSchema);

/**
 * 任务接口（h4 · S6·task）：契约 shared/src/modules/tasks.ts。
 * summary 挂 /projects/{id}/summary（项目总览四格，数据来源为任务派生；M3 契约已入、随本卡落地）。
 * 读登录即可；写入口径（成员平权 / 手工创建仅管理员）见 TaskService。
 */
@Controller("api/v1/projects")
@UseGuards(SessionGuard, CsrfGuard)
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** 项目总览四格：当前阶段 / 逾期 / 已完成 / 总数（汇总卡与阶段标签用）。 */
  @Get(":id/summary")
  summary(@Param("id", uuidParam) id: string): Promise<z.infer<typeof ProjectSummarySchema>> {
    return this.tasks.summary(id);
  }

  /** 任务列表：分页 + 阶段 / 负责人 / 展示态筛选 + 关键字 + 白名单排序（TaskListItem 随行摘要）。 */
  @Get(":id/tasks")
  list(
    @Param("id", uuidParam) id: string,
    @Query(new ZodValidationPipe(TaskListQuerySchema)) query: TaskListQuery,
  ): Promise<z.infer<typeof TaskListResponseSchema>> {
    return this.tasks.list(id, query);
  }

  /** 任务详情：抽屉全字段 + 文件清单。 */
  @Get(":id/tasks/:taskId")
  detail(
    @Param("id", uuidParam) id: string,
    @Param("taskId", uuidParam) taskId: string,
  ): Promise<z.infer<typeof TaskDetailSchema>> {
    return this.tasks.detail(id, taskId);
  }

  /** 创建任务：从任务节点生成（判重 409 TASK_ALREADY_EXISTS）或手工创建（仅管理员）。 */
  @Post(":id/tasks")
  create(
    @Param("id", uuidParam) id: string,
    @Body(new ZodValidationPipe(TaskCreateBodySchema)) body: TaskCreateBody,
    @CurrentActorId() actorId: string,
  ): Promise<z.infer<typeof TaskSchema>> {
    return this.tasks.create(id, body, actorId);
  }

  /** 编辑任务（乐观锁；status 基础三态同事务联动进度 / 完成日期；任务描述 / 成果文件锁定不在本接口）。 */
  @Patch(":id/tasks/:taskId")
  update(
    @Param("id", uuidParam) id: string,
    @Param("taskId", uuidParam) taskId: string,
    @Body(new ZodValidationPipe(TaskUpdateBodySchema)) body: TaskUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<z.infer<typeof TaskSchema>> {
    return this.tasks.update(id, taskId, body, actorId);
  }

  /** 更新四格进度（联动状态与完成日期；progress<1 清完成日期 —— 清除的唯一方式）。 */
  @Patch(":id/tasks/:taskId/progress")
  updateProgress(
    @Param("id", uuidParam) id: string,
    @Param("taskId", uuidParam) taskId: string,
    @Body(new ZodValidationPipe(TaskProgressUpdateBodySchema)) body: TaskProgressUpdateBody,
    @CurrentActorId() actorId: string,
  ): Promise<z.infer<typeof TaskListItemSchema>> {
    return this.tasks.updateProgress(id, taskId, body, actorId);
  }
}
