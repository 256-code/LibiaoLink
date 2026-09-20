# project 模块（h2 · S6·project：M2-01 项目 CRUD + M2-04 首页列表 / facets + M2-05 成员名册）

| 字段 | 内容 |
|---|---|
| 类型 | 领域模块（domain） |
| 职责 | 项目主数据、首页分类字段（地区 / 项目类型 / 项目经理）、项目软删；阶段推进 / 成员 / 视图随 M2-03 / M2-05 / M2-06 |
| 主责 | wmj（团队分工.md §2） |
| 对外接口 | ProjectService（listProjects / getFacets / getProject / createProject / updateProject / deleteProject）、ProjectMemberService（listMembers / addMember / removeMember）；HTTP：GET /api/v1/projects、GET /api/v1/projects/facets、GET / PATCH / DELETE /api/v1/projects/{id}、POST /api/v1/projects、GET / POST /api/v1/projects/{id}/members、DELETE /api/v1/projects/{id}/members/{userId} |

## 已实现（h2 第一批）

- 路由（契约 `shared/src/modules/projects.ts`，OpenAPI tags=projects）：全部挂 `SessionGuard + CsrfGuard`（读要登录、写要 `X-CSRF-Token`）。注册顺序上 `GET /facets` 在 `GET /:id` 之前（否则被 `:id` 吃掉）；`id` 走 `UuidSchema` 校验（非法 400 VALIDATION_FAILED）。
- M2-01 项目 CRUD：
  - 创建 `POST /api/v1/projects` → 201；`seq_no` 由数据库序列分配（请求不接受 `seqNo`）；`code` 唯一由约束兜底，23505 + `projects_code_key` → 409 `PROJECT_CODE_EXISTS`；缺省 `stageKey = presale`。
  - 更新 `PATCH /api/v1/projects/{id}`：乐观锁（正文回传 `version`，命中则 `version + 1` 并刷新 `updated_at`）；不匹配 409 `VERSION_CONFLICT`；期间被删 → 404。
  - 软删 `DELETE /api/v1/projects/{id}`：`If-Match` 头回传当前 `version`（缺失 / 非纯数字 400；不匹配 409），落 `deleted_at` / `deleted_by`（操作人取会话 `users.id`，`CurrentActorId` 装饰器）；返回被删项目。
  - 归档写保护（ADR-027）：`status = archived` 的项目 PATCH / DELETE 一律 409 `PROJECT_ARCHIVED`（错误码本轮新增，映射表同步）。
- M2-04 首页列表 / facets：`GET /api/v1/projects` 与 `GET /api/v1/projects/facets` 共用 `buildProjectFilter`（v0.3 §3.3「禁止两套 SQL」）——多值 `filter[region|projectType|managerId|stageKey|status]`（英文逗号分隔）、`q` 命中编号 / 名称 / 客户 / 序号、`filter[timeFrom] / filter[timeTo]` 闭区间（`updated_at`）；facets 五组固定返回（A6），`total` 与列表同口径。
- 时间口径（ADR-028）：区间按 Asia/Shanghai 日界（固定 `+08:00`，中国无夏令时）——下界含当日 00:00，上界取次日 00:00 不含；`timeFrom` 晚于 `timeTo` 或 `status` / `stageKey` / `managerId` 含非法值一律 400（不返回静默空列表）。
- 排序（A9）：白名单 `updatedAt` / `createdAt` / `seqNo`，方向 `asc|desc`；缺省 `updatedAt:desc`（最近活动在前）；仓储补 `asc(seq_no)` 稳定 tie-breaker，分页不跳行。
- 软删可见性（A5）：列表 / 详情 / facets 统一 `deleted_at is null`；`seq_no` 不回收、`code` 唯一约束保留（同编号再建仍 409）；新列 + 局部索引 `ix_projects_active_updated` 见迁移 `0009_projects_soft_delete.sql`（`npm run check:db-schema`：18 张表 / 190 列 / 51 索引 / 47 CHECK）。
- 触点：`ProjectRepository.touch(id, at)` 为 ADR-022「项目 updated_at 触发集」的单点入口（阶段推进 / 任务变更等聚合视图变更调用；文件 / 日报 / 系统调度不调用）；本批 CRUD 自身由 `updateWithVersion` 一并刷新。
- 单测：`test/project-crud.test.ts` —— 筛选解析（多值 / 非法枚举 400 / 上海时区日界 / 区间反向 400）、排序白名单、行 → 契约视图映射、创建缺省阶段与撞号 409、乐观锁冲突、归档写保护、软删可见性与操作人透传、唯一约束违例解包（21 例，不连库）。

## 已实现（h2 第二批 · M2-05 名册 + 分类字段口径）

- 数据面（迁移 `0010_project_members.sql` + Drizzle `projectMembers`）：`project_members`（`project_id` / `user_id` / `role_in_project` / `joined_at`；`uq_project_members_project_user` 联合唯一 + `ix_project_members_user` 反查索引）；`npm run check:db-schema`：19 张表 / 195 列 / 54 索引 / 48 CHECK。
- 名册接口（`ProjectMemberService` + `ProjectMemberRepository`）：
  - `GET /api/v1/projects/{id}/members` —— 名册列表（项目经理在前，同角色按工号升序），姓名 / 工号随行下发（A2 / ADR-021：关联一律 users.id）。
  - `POST /api/v1/projects/{id}/members`（200）—— 添加 / 更新成员（**幂等 upsert**：同项目 + 同用户唯一，重复提交 = 覆盖角色、`joinedAt` 保持首次），缺省角色 `project_member`；目标用户不存在 → 404「用户不存在」（复用用户目录语义）。
  - `DELETE /api/v1/projects/{id}/members/{userId}` —— 移除成员并返回被移除行；不是成员 / 项目不可见统一 404（ADR-011 统一 404 语义）。
- 角色口径：`role_in_project` 一期两值 `project_manager` / `project_member`（与全局角色 `roles` / `user_roles` 相互独立：前者管项目名册与记录级可见性，后者管功能权限）。`projects.manager_id`（主数据：首页 `filter[managerId]` / 卡片展示）与名册**不自动联动**：建项目时的成员初始化随 M2-02 建项目事务（h3），管理界面（u 系列）落地时收敛。
- ADR-022 触点：成员增删 / 改角色后调用 `ProjectRepository.touch`，项目 `updated_at` 前移（「人来动、视图可见的变更才触发」②）。
- 归档写保护（ADR-027）同样覆盖名册：归档项目的 POST / DELETE 成员 → 409 `PROJECT_ARCHIVED`（名册读仍可用）。
- 分类字段口径（A1-12 定档）：`region` / `projectType` 是首页分类侧边栏（facets 五组里的两组，A6）与统计的来源；创建请求缺省「**未分类**」（契约 `default("未分类")`，前端表单仍必填、空串 400）；更新可改。字典取值由 C9 字典维护（`GET /dicts` 已入契约，落表随 h7；在此之前前端提示 + 服务端不封锁取值）。
- 单测：`test/project-members.test.ts` —— 视图映射、列表顺序与项目不可见 404、添加 upsert + touch、重复添加改角色保留 joinedAt、目标用户 404、归档写保护（不落任何写入）、移除与「不是成员」404（7 例，不连库）。

## 边界与后续

- 不做：名册的**记录级过滤**（列表 / 详情 / facets / 搜索按成员裁剪、非成员 404）随 h6 策略服务（ADR-011）——本批只落名册数据面与维护接口；`projects.manager_id` 与名册的自动联动随 M2-02 建项目事务（h3）/ 管理界面（u 系列）。
- 不做：`blueprintVersion` 入参当前忽略（建项目按已发布蓝图导入 stages / nodes / requirements 的快照事务随 M2-02 · h3）；阶段推进（M2-03）、项目记录级权限的**过滤**（M2-05 后半：非成员 404 语义随 h6 策略服务）、视图 / 关注 / 偏好（M2-06）、写接口幂等键 `Idempotency-Key`（随 i5 的 idempotency_keys 表）、CRUD 审计留痕（随 h7 audit_logs）。
- 权限现状：本批读接口登录即可读、写接口登录即可写（数据范围裁剪与「仅项目经理 / 管理员可写」随 h6）；前端在此之前的按钮可见性只做体验，不作为安全边界（ADR-011）。
- 待接：⓪ 成员批量维护（导入 / 变更）随 u 系列管理界面；① 项目总览四格 `GET /api/v1/projects/{id}/summary`（契约已入，依赖任务派生口径，随 M3 任务卡片）；② 搜索 / 导出复用本模块 filter 构造器（随 M5 检索卡片）；③ 归档动作 `status = archived` 的专门端点（`PATCH` 即可置位，前端确认流随 u 系列）。
