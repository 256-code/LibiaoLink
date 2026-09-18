/**
 * 本文件由 shared/scripts/generate.mjs 生成，禁止手改（CONTRIBUTING 第 14 节）。
 * 源：shared/src 下的 Zod schema → generated/openapi.json → 本文件。
 */
export interface paths {
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目列表（分页 + 多维筛选 + 排序） */
        get: {
            parameters: {
                query?: {
                    /** @description 地区（多值逗号分隔） */
                    "filter[region]"?: string;
                    /** @description 项目类型（多值逗号分隔） */
                    "filter[projectType]"?: string;
                    /** @description 项目经理（多值逗号分隔） */
                    "filter[managerId]"?: string;
                    /** @description 阶段 key（多值逗号分隔） */
                    "filter[stageKey]"?: string;
                    /** @description 项目状态（多值逗号分隔） */
                    "filter[status]"?: string;
                    /** @description 关键字（编号 / 名称 / 客户） */
                    q?: string;
                    page?: number;
                    limit?: number;
                    /** @description 排序：sort=field:asc,field2:desc（v0.2 §7.1） */
                    sort?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 项目列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectListResponse"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        /** 新建项目（编号由创建人填写；默认按已发布蓝图导入节点） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ProjectCreateBody"];
                };
            };
            responses: {
                /** @description 创建成功 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/facets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 首页分类计数（与列表同一筛选口径） */
        get: {
            parameters: {
                query?: {
                    /** @description 地区（多值逗号分隔） */
                    "filter[region]"?: string;
                    /** @description 项目类型（多值逗号分隔） */
                    "filter[projectType]"?: string;
                    /** @description 项目经理（多值逗号分隔） */
                    "filter[managerId]"?: string;
                    /** @description 阶段 key（多值逗号分隔） */
                    "filter[stageKey]"?: string;
                    /** @description 项目状态（多值逗号分隔） */
                    "filter[status]"?: string;
                    /** @description 关键字（编号 / 名称 / 客户） */
                    q?: string;
                    page?: number;
                    limit?: number;
                    /** @description 排序：sort=field:asc,field2:desc（v0.2 §7.1） */
                    sort?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 各维度计数 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectFacets"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目详情 */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 项目 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 更新项目（乐观锁：必须回传 version） */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ProjectUpdateBody"];
                };
            };
            responses: {
                /** @description 更新后的项目 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/projects/{id}/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目总览四格（当前阶段 / 逾期 / 已完成 / 总数） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 总览统计 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectSummary"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目任务列表（表格与抽屉直接渲染的全字段） */
        get: {
            parameters: {
                query?: {
                    /** @description 九阶段字典（v0.2 §2.5：售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收） */
                    stage?: components["schemas"]["StageKey"];
                    /** @description UUID（主键与关联 ID） */
                    "filter[ownerId]"?: components["schemas"]["Uuid"];
                    /** @description 展示态（多值逗号分隔）：pending / active / done / overdue / early_done */
                    "filter[status]"?: string;
                    /** @description 关键字（中英文任务描述） */
                    q?: string;
                    page?: number;
                    limit?: number;
                    /** @description 排序：sort=field:asc,field2:desc（v0.2 §7.1） */
                    sort?: string;
                };
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 任务列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TaskListResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/tasks/{taskId}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 更新任务进度（联动状态与完成日期，写审计；回退同样留痕） */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    taskId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["TaskProgressUpdateBody"];
                };
            };
            responses: {
                /** @description 更新后的任务 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Task"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/blueprint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前蓝图（含版本与发布状态） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 蓝图视图 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlueprintView"];
                    };
                };
            };
        };
        /** 保存蓝图草稿（必须通过 schema + 引用校验） */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["BlueprintSaveBody"];
                };
            };
            responses: {
                /** @description 保存后的蓝图视图 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlueprintView"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/blueprint/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发布蓝图（递增 blueprintVersion；不影响已生成项目） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["BlueprintSaveBody"];
                };
            };
            responses: {
                /** @description 发布后的蓝图视图 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlueprintView"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/blueprint/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 导出蓝图 JSON（自建格式，round-trip 无损） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 蓝图 JSON */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Blueprint"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/blueprint/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 导入蓝图 JSON（保存为草稿；重复导入幂等） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["BlueprintImportBody"];
                };
            };
            responses: {
                /** @description 导入后的蓝图视图 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BlueprintView"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/flow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目流程（阶段 + 节点 + 约束 + 状态） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 项目流程 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectFlow"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/nodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 新增节点（一期仅模板节点池；留痕） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["NodeCreateBody"];
                };
            };
            responses: {
                /** @description 新节点 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectNode"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/nodes/{nodeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 删除节点（软删除 + 留痕；关联成果物时先提示） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    nodeId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["NodeDeleteBody"];
                };
            };
            responses: {
                /** @description 已删除的节点（status=deleted） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectNode"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 完成节点（服务端事务内过门禁；缺件返回 422 + missing 明细） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["NodeCompleteBody"];
                };
            };
            responses: {
                /** @description 完成后的节点 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NodeCompleteResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/can-complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 完成预检（UI 置灰依据；不替代服务端强校验） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 预检结果 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CanCompleteResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 项目文件库列表（按类型 / 节点 / 任务 / 状态 / 上传人筛选） */
        get: {
            parameters: {
                query?: {
                    /** @description UUID（主键与关联 ID） */
                    "filter[nodeId]"?: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    "filter[taskId]"?: components["schemas"]["Uuid"];
                    /** @description 文件状态（多值逗号分隔）：draft / final / changed / archived / recycled */
                    "filter[status]"?: string;
                    /** @description 成果文件类型（多值逗号分隔，取值见 DocType 字典） */
                    "filter[docType]"?: string;
                    /** @description UUID（主键与关联 ID） */
                    "filter[uploadedBy]"?: components["schemas"]["Uuid"];
                    /** @description 关键字（文件名） */
                    q?: string;
                    page?: number;
                    limit?: number;
                    /** @description 排序：sort=field:asc,field2:desc（v0.2 §7.1） */
                    sort?: string;
                };
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 文件列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileListResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 发起上传（分片直传；version = 草稿替换 / change = 定档后变更，申请即通过） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UploadCreateBody"];
                };
            };
            responses: {
                /** @description 上传会话（含分片参数；complete 时登记版本） */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadCreateResponse"];
                    };
                };
                /** @description 契约校验失败（VALIDATION_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 文件详情（含当前版本） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 文件详情 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileDetail"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 版本链（历史版本可预览 / 下载，受权限控制） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 版本链 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileVersionListResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/versions/{versionId}/download-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 版本短时签名下载（写查看 / 下载审计） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    versionId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 签名下载地址 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileDownloadUrlResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/uploads/{uploadId}/parts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 批量获取分片预签名 URL（首传 / 断点续传共用） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    uploadId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UploadPartsBody"];
                };
            };
            responses: {
                /** @description 分片预签名 URL */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadPartsResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/uploads/{uploadId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 上传会话状态（已传 / 缺失分片；断点续传依据） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    uploadId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 会话状态 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadSessionView"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/uploads/{uploadId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 完成上传（登记 file_version；intent=change 同事务落变更） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    uploadId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UploadCompleteBody"];
                };
            };
            responses: {
                /** @description 文件、版本与（change 意图的）变更记录 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadCompleteResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/uploads/{uploadId}/abort": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消上传会话（未完成分片由对象存储生命周期兜底清理） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    uploadId: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 已取消的会话 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UploadAbortResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 定档（锁版；此后修改必须走变更） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FileFinalizeBody"];
                };
            };
            responses: {
                /** @description 已定档的文件 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["File"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 回溯生成新版本（不删除历史；定档后按变更流留痕） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FileRollbackBody"];
                };
            };
            responses: {
                /** @description 回溯后的文件与新版本 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileRollbackResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 业务校验未通过（门禁 / 蓝图校验，含明细） */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/recycle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 移入回收站（默认保留 30 天，可恢复） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FileRecycleBody"];
                };
            };
            responses: {
                /** @description 已回收的文件 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["File"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 从回收站恢复（回到进入前状态） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FileRestoreBody"];
                };
            };
            responses: {
                /** @description 已恢复的文件 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["File"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/purge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 彻底删除（仅管理员；对象与元数据一并清理，操作留痕） */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
                    "Idempotency-Key"?: components["schemas"]["IdempotencyKey"];
                };
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FilePurgeBody"];
                };
            };
            responses: {
                /** @description 已彻底删除 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FilePurgeResponse"];
                    };
                };
                /** @description 无权限（FORBIDDEN） */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description 冲突（VERSION_CONFLICT / 状态不允许当前操作） */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{id}/change-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 变更记录列表（按阶段 / 节点 / 文件 / 申请人 / 关键字检索） */
        get: {
            parameters: {
                query?: {
                    /** @description 阶段（多值逗号分隔） */
                    "filter[stageKey]"?: string;
                    /** @description UUID（主键与关联 ID） */
                    "filter[nodeId]"?: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    "filter[fileId]"?: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    "filter[appliedBy]"?: components["schemas"]["Uuid"];
                    /** @description UUID（主键与关联 ID） */
                    "filter[projectId]"?: components["schemas"]["Uuid"];
                    /** @description 关键字（变更原因 / 变更前后摘要） */
                    q?: string;
                    page?: number;
                    limit?: number;
                    /** @description 排序：sort=field:asc,field2:desc（v0.2 §7.1） */
                    sort?: string;
                };
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 变更记录列表 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequestListResponse"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/change-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 变更详情（含变更后文件与版本） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    /** @description UUID（主键与关联 ID） */
                    id: components["schemas"]["Uuid"];
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 变更详情 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequestDetail"];
                    };
                };
                /** @description 资源不存在或不可见（NOT_FOUND，统一 404 语义） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 登录入口：302 跳转 Casdoor 授权页（PKCE + state；returnTo 为同源回跳路径） */
        get: {
            parameters: {
                query?: {
                    /** @description 登录成功后的回跳路径（仅同源相对路径） */
                    returnTo?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 跳转 SSO 授权页（Set-Cookie: 转场 state / verifier） */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 登录回调：校验 state + PKCE 换令牌，建立 HttpOnly 会话后 302 回 returnTo */
        get: {
            parameters: {
                query?: {
                    code?: string;
                    state?: string;
                    error?: string;
                    error_description?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 会话建立，跳转应用内路径 */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 回调校验失败（AUTH_CALLBACK_FAILED） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前登录用户（会话无效 / 超时返回 401，前端据此重新走 SSO） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 已登录用户 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MeResponse"];
                    };
                };
                /** @description 未认证（AUTH_REQUIRED） */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 登出：清本地会话并 302 到 Casdoor 单点登出（携 id_token_hint） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 跳转 SSO 登出（本地会话已撤销） */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description 统一错误信封（技术设计v0.2 §7.2） */
        ApiError: {
            code: components["schemas"]["ErrorCode"];
            /** @example 参数校验失败 */
            message: string;
            /** @default [] */
            details: components["schemas"]["ErrorDetail"][];
            /** @example 4f1c2f2e-6f8a-4b1e-9a1f-2f6d6f2c9d10 */
            traceId: string;
        };
        /** @description 自建蓝图 JSON（v0.2 §3.2）；导入校验 = schema + 引用 + 幂等 */
        Blueprint: {
            /** @enum {number} */
            schemaVersion: 1;
            blueprintVersion: number;
            name: string;
            updatedAt: components["schemas"]["DateTime"];
            stages: components["schemas"]["BlueprintStage"][];
        };
        BlueprintConstraint: components["schemas"]["BlueprintRequiredDocConstraint"] | components["schemas"]["BlueprintReservedConstraint"];
        /** @description 导入自建蓝图 JSON（保存为草稿；重复导入幂等） */
        BlueprintImportBody: {
            blueprint: components["schemas"]["Blueprint"];
        };
        /** @description 每个节点至少一类约束（校验规则见 v0.2 §3.4） */
        BlueprintNode: {
            /**
             * @description 节点稳定键；一经发布不可改名（改名 = 新增 + 废弃）
             * @example design.mech
             */
            key: string;
            /** @example 机械设计图纸 */
            name: string;
            /** @description 排序（建议 10/20/30 步长，便于插入） */
            seq: number;
            /** @default [] */
            constraints: components["schemas"]["BlueprintConstraint"][];
        };
        /** @description 必交成果物（一期门禁实现的唯一约束类型） */
        BlueprintRequiredDocConstraint: {
            /** @enum {string} */
            type: "required_doc";
            docType: components["schemas"]["DocType"];
            /** @default 1 */
            minCount: number;
        };
        /** @description 预留约束类型（结构就位、规则后置） */
        BlueprintReservedConstraint: {
            /** @enum {string} */
            type: "field" | "dependency" | "deadline";
            /** @default {} */
            config: {
                [key: string]: unknown;
            };
        };
        /** @description 保存蓝图草稿（必须通过 schema + 引用校验） */
        BlueprintSaveBody: {
            blueprint: components["schemas"]["Blueprint"];
        };
        BlueprintStage: {
            key: components["schemas"]["StageKey"];
            name: string;
            seq: number;
            nodes: components["schemas"]["BlueprintNode"][];
        };
        /**
         * @description 蓝图状态：发布产生新版本，不自动影响已生成项目（快照）
         * @enum {string}
         */
        BlueprintStatus: "draft" | "published";
        BlueprintView: {
            blueprint: components["schemas"]["Blueprint"];
            status: components["schemas"]["BlueprintStatus"];
            publishedAt: components["schemas"]["DateTime"] & (string | null);
            publishedBy: components["schemas"]["Uuid"] & (string | null);
        };
        /** @description 完成预检（UI 置灰依据；服务端仍在事务内强校验） */
        CanCompleteResponse: {
            canComplete: boolean;
            missing: components["schemas"]["NodeGateMissing"][];
        };
        /** @description 变更申请字段（随上传会话提交，完成上传时同事务生效） */
        ChangeIntentBody: {
            /** @description 变更原因（必填；无变更后文件不允许提交） */
            reason: string;
            beforeSummary?: string;
            afterSummary?: string;
            stageKey?: components["schemas"]["StageKey"];
        };
        /** @description intent=change 时的变更记录；version 意图为空 */
        ChangeRequest: {
            id: components["schemas"]["Uuid"];
            projectId: components["schemas"]["Uuid"];
            nodeId: components["schemas"]["Uuid"] & (string | null);
            stageKey: components["schemas"]["StageKey"] & (string | null);
            /** @description 变更原因（必填） */
            reason: string;
            /** @description 变更前摘要 */
            beforeSummary: string | null;
            /** @description 变更后摘要 */
            afterSummary: string | null;
            status: components["schemas"]["ChangeStatus"];
            appliedBy: components["schemas"]["Uuid"];
            appliedAt: components["schemas"]["DateTime"];
            createdAt: components["schemas"]["DateTime"];
            fileId: components["schemas"]["Uuid"] & unknown;
            versionId: components["schemas"]["Uuid"] & unknown;
            versionSeq: number;
        } | null;
        /** @description 变更记录（v0.2 §5.3；一期申请即通过、全程留痕） */
        ChangeRequestDetail: components["schemas"]["ChangeRequest"] & {
            file: components["schemas"]["File"];
            version: components["schemas"]["FileVersion"];
        };
        ChangeRequestListResponse: {
            items: (components["schemas"]["ChangeRequest"] & unknown)[];
            page: number;
            limit: number;
            total: number;
        };
        /**
         * @description 变更申请状态；一期申请即通过（唯一终态 applied），多级审批二期可启用
         * @enum {string}
         */
        ChangeStatus: "applied";
        /**
         * Format: date
         * @description 业务日期 YYYY-MM-DD（不携带时区）
         */
        DateOnly: string | null;
        /**
         * Format: date-time
         * @description ISO8601 时间戳（UTC 存储，前端按 Asia/Shanghai 展示）
         */
        DateTime: string;
        /**
         * @description 十类成果文件字典；门禁 required_doc 只能引用此字典（v0.2 §2.5）
         * @enum {string|null}
         */
        DocType: "CAD图纸" | "技术协议" | "合同" | "评审单" | "设备清单" | "物料总清单" | "发货装箱单" | "到货单" | "安装完成证明" | "验收单" | null;
        /** @description 同内容哈希的既有文件提示（用户确认后可继续上传，不做强阻断） */
        DuplicateHint: {
            fileId: components["schemas"]["Uuid"];
            name: string;
            sizeBytes: number;
            uploadedBy: components["schemas"]["Uuid"];
            uploadedAt: components["schemas"]["DateTime"];
        } | null;
        /**
         * @description 统一错误码（技术设计v0.2 §7.2）
         * @enum {string}
         */
        ErrorCode: "VALIDATION_FAILED" | "AUTH_REQUIRED" | "AUTH_CALLBACK_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "PROJECT_CODE_EXISTS" | "NODE_REQUIRED_DOC_MISSING" | "NODE_ALREADY_DONE" | "NODE_DELETED" | "BLUEPRINT_SCHEMA_INVALID" | "BLUEPRINT_REF_UNKNOWN" | "FILE_STATE_INVALID" | "UPLOAD_INCOMPLETE" | "UPLOAD_EXPIRED" | "CHECKSUM_MISMATCH" | "IDEMPOTENT_REPLAY" | "PREVIEW_NOT_READY" | "PREVIEW_FAILED" | "INTERNAL";
        /** @description 字段级错误明细（校验失败、门禁缺件等） */
        ErrorDetail: {
            /** @example too_small */
            code: string;
            /** @example limit 必须是 1~200 的整数 */
            message: string;
            /** @example query.limit */
            path?: string;
            meta?: {
                [key: string]: unknown;
            };
        };
        /** @description 文件（v0.2 §5.2；定档后不可覆盖，修改必须走变更） */
        File: {
            id: components["schemas"]["Uuid"];
            projectId: components["schemas"]["Uuid"];
            nodeId: components["schemas"]["Uuid"] & (string | null);
            taskId: components["schemas"]["Uuid"] & (string | null);
            docType: components["schemas"]["DocType"] & unknown;
            /**
             * @description 原文件名（含中文，保留在元数据）
             * @example 机械设计图纸-v2.docx
             */
            name: string;
            status: components["schemas"]["FileStatus"];
            currentVersionId: components["schemas"]["Uuid"] & (string | null);
            version: components["schemas"]["Version"];
            createdBy: components["schemas"]["Uuid"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
            finalizedAt: components["schemas"]["DateTime"] & (string | null);
            finalizedBy: components["schemas"]["Uuid"] & (string | null);
            recycledAt: components["schemas"]["DateTime"] & (string | null);
            recycledBy: components["schemas"]["Uuid"] & (string | null);
            recycledFromStatus: components["schemas"]["FileStatus"] & (string | null);
        };
        /** @description 文件详情（含当前版本；版本链走 /files/{id}/versions） */
        FileDetail: components["schemas"]["File"] & {
            currentVersion: components["schemas"]["FileVersion"];
        };
        FileDownloadUrlResponse: {
            /** @description 短时签名下载地址（写查看 / 下载审计；对象存储禁止匿名读取） */
            url: string;
            fileName: string;
            sizeBytes: number;
            expiresAt: components["schemas"]["DateTime"];
        };
        /** @description 定档（锁版）：至少存在 1 个版本；定档后不可覆盖或替换 */
        FileFinalizeBody: {
            version: components["schemas"]["Version"];
        };
        FileListResponse: {
            items: components["schemas"]["File"][];
            page: number;
            limit: number;
            total: number;
        };
        /** @description 彻底删除（仅管理员；对象与元数据一并清理，操作留痕） */
        FilePurgeBody: {
            version: components["schemas"]["Version"];
            reason?: string;
        };
        FilePurgeResponse: {
            fileId: components["schemas"]["Uuid"];
            purgedAt: components["schemas"]["DateTime"];
        };
        /** @description 移入回收站（任意状态可删；默认保留 30 天，可恢复） */
        FileRecycleBody: {
            version: components["schemas"]["Version"];
            reason?: string;
        };
        FileRestoreBody: {
            version: components["schemas"]["Version"];
        };
        /** @description 回溯生成新版本（不删除历史版本；定档后回溯走变更、申请即通过） */
        FileRollbackBody: {
            toVersionId: components["schemas"]["Uuid"] & unknown;
            /** @description 回溯原因（留痕；定档 / 已变更文件按变更流处理） */
            reason: string;
            version: components["schemas"]["Version"];
        };
        FileRollbackResponse: {
            file: components["schemas"]["File"];
            version: components["schemas"]["FileVersion"];
            changeRequest: components["schemas"]["ChangeRequest"] & unknown;
        };
        /**
         * @description 文件五态（v0.2 §5.2）
         * @enum {string}
         */
        FileStatus: "draft" | "final" | "changed" | "archived" | "recycled";
        /** @description 文件版本（v0.2 §5.1；对象键 = projects/{projectId}/files/{fileId}/v{seq}/{contentHash}.{ext}） */
        FileVersion: {
            id: components["schemas"]["Uuid"];
            fileId: components["schemas"]["Uuid"];
            /** @description 版本号（同一文件内递增，从 1 开始） */
            seq: number;
            sizeBytes: number;
            contentHash: components["schemas"]["Sha256"] & unknown;
            mime: string | null;
            uploadedBy: components["schemas"]["Uuid"];
            uploadedAt: components["schemas"]["DateTime"];
            changeRequestId: components["schemas"]["Uuid"] & (string | null);
        } | null;
        FileVersionListResponse: {
            items: components["schemas"]["FileVersion"][];
            total: number;
        };
        /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
        IdempotencyKey: string;
        /** @description /auth/me 响应（会话由 HttpOnly Cookie 承载） */
        MeResponse: {
            user: components["schemas"]["User"];
            /** @description ID Token 声明（已验签；排障用） */
            claims: {
                [key: string]: unknown;
            };
            /**
             * @description ID Token 到期时间（Unix 秒，UTC）；null = 未知
             * @example 1758182400
             */
            expiresAt: number | null;
        };
        NodeCompleteBody: {
            version: components["schemas"]["Version"];
        };
        NodeCompleteResponse: {
            node: components["schemas"]["ProjectNode"];
        };
        /** @description 新增节点（仅模板节点池，留痕） */
        NodeCreateBody: {
            stageId: components["schemas"]["Uuid"];
            /** @description 模板节点池内的节点稳定键（一期仅允许蓝图内的 key） */
            nodeKey: string;
            name?: string;
            seq?: number;
        };
        NodeDeleteBody: {
            version: components["schemas"]["Version"];
        };
        /** @description 缺件明细（门禁拒绝时会一次性返回） */
        NodeGateMissing: {
            docType: components["schemas"]["DocType"];
            required: number;
            present: number;
        };
        /**
         * @description 节点来源；一期增删仅限模板节点池
         * @enum {string}
         */
        NodeOrigin: "blueprint" | "added_by_user";
        /** @description 节点约束实例（node_requirements） */
        NodeRequirement: {
            /** @enum {string} */
            requirementType: "required_doc" | "field" | "dependency" | "deadline";
            docType: components["schemas"]["DocType"];
            minCount: number;
        };
        /**
         * @description 节点状态（project_nodes.status）；done 必须过门禁
         * @enum {string}
         */
        NodeStatus: "pending" | "active" | "done" | "deleted";
        /**
         * @description 紧急重要度四象限字典
         * @enum {string|null}
         */
        Priority: "重要且紧急" | "紧急但不重要" | "重要不紧急" | "不紧急不重要" | null;
        /** @description 项目（v0.2 §2.3 projects） */
        Project: {
            id: components["schemas"]["Uuid"];
            /**
             * @description 项目编号：创建人填写（建后可修改）；服务端只校验唯一性，不生成；格式仅前端提示
             * @example CNBJ-20260708-0001
             */
            code: string;
            /**
             * @description 项目序号：服务端创建时分配（全库唯一、不可修改、不回收；与项目编号一一对应同一项目）；卡片等展示场景两位补零，列表支持 sort=seqNo:asc|desc
             * @example 1
             */
            seqNo: number;
            /** @example XX 客户分拣项目 */
            name: string;
            customer: string | null;
            /** @description 项目落地地区（字典 region；缺省「未分类」） */
            region: string;
            /** @description 项目类型（字典 project_type；主题色随字典元数据下发，前端不硬编码） */
            projectType: string;
            managerId: components["schemas"]["Uuid"];
            stageKey: components["schemas"]["StageKey"];
            status: components["schemas"]["ProjectStatus"];
            description: string | null;
            version: components["schemas"]["Version"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /** @description 创建项目：项目序号 seqNo 不接受传入，由服务端分配并随响应返回 */
        ProjectCreateBody: {
            /**
             * @description 项目编号：创建人填写；格式仅前端提示，服务端不做强校验；重复返回 409 PROJECT_CODE_EXISTS
             * @example CNBJ-20260708-0001
             */
            code: string;
            name: string;
            customer?: string;
            region: string;
            projectType: string;
            managerId: components["schemas"]["Uuid"];
            stageKey?: components["schemas"]["StageKey"];
            description?: string;
            /** @description 导入的蓝图版本；缺省 = 当前已发布版本 */
            blueprintVersion?: number;
        };
        /** @description 首页分类计数；计数与列表同口径（同筛选条件） */
        ProjectFacets: {
            total: number;
            region: {
                [key: string]: number;
            };
            projectType: {
                [key: string]: number;
            };
            managerId: {
                [key: string]: number;
            };
            stageKey: {
                [key: string]: number;
            };
            status: {
                [key: string]: number;
            };
        };
        /** @description 项目流程（阶段 + 节点 + 约束 + 状态）；导入即快照 */
        ProjectFlow: {
            projectId: components["schemas"]["Uuid"];
            /** @description 项目导入时的蓝图版本（快照） */
            blueprintVersion: number;
            stages: components["schemas"]["ProjectStage"][];
        };
        ProjectListResponse: {
            items: components["schemas"]["Project"][];
            page: number;
            limit: number;
            total: number;
        };
        ProjectNode: {
            id: components["schemas"]["Uuid"];
            projectId: components["schemas"]["Uuid"];
            stageId: components["schemas"]["Uuid"];
            nodeKey: string;
            name: string;
            seq: number;
            status: components["schemas"]["NodeStatus"];
            origin: components["schemas"]["NodeOrigin"];
            doneAt: components["schemas"]["DateTime"] & (string | null);
            doneBy: components["schemas"]["Uuid"] & (string | null);
            sourceBlueprintVersion: number;
            version: components["schemas"]["Version"];
            requirements: components["schemas"]["NodeRequirement"][];
        };
        ProjectStage: {
            id: components["schemas"]["Uuid"];
            stageKey: components["schemas"]["StageKey"];
            name: string;
            seq: number;
            status: components["schemas"]["StageStatus"];
            plannedStart: components["schemas"]["DateOnly"];
            plannedEnd: components["schemas"]["DateOnly"];
            actualStart: components["schemas"]["DateOnly"];
            actualEnd: components["schemas"]["DateOnly"];
            nodes: components["schemas"]["ProjectNode"][];
        };
        /**
         * @description 项目状态（projects.status）
         * @enum {string}
         */
        ProjectStatus: "active" | "paused" | "done" | "archived";
        /** @description 项目总览统计（任务派生，口径见 v0.2 §2.4） */
        ProjectSummary: {
            projectId: components["schemas"]["Uuid"];
            currentStage: components["schemas"]["StageKey"];
            overdue: number;
            done: number;
            total: number;
        };
        ProjectUpdateBody: {
            /**
             * @description 项目编号：建后可修改；同样校验唯一性，重复返回 409 PROJECT_CODE_EXISTS
             * @example CNBJ-20260708-0001
             */
            code?: string;
            name?: string;
            customer?: string | null;
            region?: string;
            projectType?: string;
            managerId?: components["schemas"]["Uuid"];
            stageKey?: components["schemas"]["StageKey"];
            status?: components["schemas"]["ProjectStatus"];
            description?: string | null;
            version: components["schemas"]["Version"];
        };
        /** @description 客户端计算的内容哈希；传入时若命中已有内容则返回 duplicateHint（A4-04，提示后可确认继续）；complete 时必须回传 */
        Sha256: string;
        /**
         * @description 九阶段字典（v0.2 §2.5：售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收）
         * @enum {string}
         */
        StageKey: "presale" | "design" | "purchase" | "assembly" | "install" | "deploy" | "trial" | "production" | "acceptance";
        /**
         * @description 阶段状态（project_stages.status）
         * @enum {string}
         */
        StageStatus: "pending" | "active" | "done";
        /** @description 任务（v0.2 §2.3 tasks；展示态派生规则见 §2.4） */
        Task: {
            id: components["schemas"]["Uuid"];
            projectId: components["schemas"]["Uuid"];
            stageKey: components["schemas"]["StageKey"];
            nodeId: components["schemas"]["Uuid"] & (string | null);
            title: string;
            titleEn: string | null;
            ownerId: components["schemas"]["Uuid"];
            status: components["schemas"]["TaskBaseStatus"];
            displayStatus: components["schemas"]["TaskDisplayStatus"];
            progress: components["schemas"]["TaskProgress"];
            plannedStart: components["schemas"]["DateOnly"];
            plannedEnd: components["schemas"]["DateOnly"];
            actualEnd: components["schemas"]["DateOnly"];
            estimatedDays: number | null;
            headcount: number | null;
            priority: components["schemas"]["Priority"];
            deliverable: components["schemas"]["DocType"];
            note: string | null;
            onTime: boolean | null;
            changeRef: components["schemas"]["Uuid"] & (string | null);
            version: components["schemas"]["Version"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /**
         * @description 任务存储基础态（不写回派生结果）
         * @enum {string}
         */
        TaskBaseStatus: "pending" | "active" | "done";
        /**
         * @description 任务展示五态（服务端派生）：待开始 / 进行中 / 已完成 / 已延期 / 提前完成；逾期标注落在 actualEnd
         * @enum {string}
         */
        TaskDisplayStatus: "pending" | "active" | "done" | "overdue" | "early_done";
        TaskListResponse: {
            items: components["schemas"]["Task"][];
            page: number;
            limit: number;
            total: number;
        };
        /** @description 任务进度四格：0 / 25% / 50% / 75% / 100% */
        TaskProgress: 0 | 0.25 | 0.5 | 0.75 | 1;
        TaskProgressUpdateBody: {
            progress: components["schemas"]["TaskProgress"];
            actualEnd?: components["schemas"]["DateOnly"] & unknown;
            note?: string;
            version: components["schemas"]["Version"];
        };
        UploadAbortResponse: {
            upload: components["schemas"]["UploadSession"];
        };
        UploadCompleteBody: {
            contentHash: components["schemas"]["Sha256"] & unknown;
        };
        UploadCompleteResponse: {
            file: components["schemas"]["File"];
            version: components["schemas"]["FileVersion"];
            changeRequest: components["schemas"]["ChangeRequest"];
        };
        /** @description 发起上传（分片直传；返回预签名分片 URL 的获取入口） */
        UploadCreateBody: {
            projectId: components["schemas"]["Uuid"];
            name: string;
            /** @description 字节数；上限由服务端配置（UPLOAD_MAX_SIZE_MB），超出返回 400 VALIDATION_FAILED */
            sizeBytes: number;
            mime?: string;
            contentHash?: components["schemas"]["Sha256"];
            docType?: components["schemas"]["DocType"];
            nodeId?: components["schemas"]["Uuid"];
            taskId?: components["schemas"]["Uuid"];
            /** @enum {string} */
            intent: "version";
        } | {
            projectId: components["schemas"]["Uuid"];
            name: string;
            /** @description 字节数；上限由服务端配置（UPLOAD_MAX_SIZE_MB），超出返回 400 VALIDATION_FAILED */
            sizeBytes: number;
            mime?: string;
            contentHash?: components["schemas"]["Sha256"];
            docType?: components["schemas"]["DocType"];
            nodeId?: components["schemas"]["Uuid"];
            taskId?: components["schemas"]["Uuid"];
            /** @enum {string} */
            intent: "change";
            change: components["schemas"]["ChangeIntentBody"];
        };
        UploadCreateResponse: {
            file: components["schemas"]["File"];
            upload: components["schemas"]["UploadSession"];
            duplicateHint: components["schemas"]["DuplicateHint"];
        };
        /**
         * @description 上传意图：version = 新增/替换版本（仅 draft 文件）；change = 定档后变更（同一事务写 change_requests + 新版本 + 状态 changed）
         * @enum {string}
         */
        UploadIntent: "version" | "change";
        /** @description 批量获取分片预签名 URL（首传与断点续传共用；续传前先查会话状态拿缺失分片） */
        UploadPartsBody: {
            partNumbers: number[];
        };
        UploadPartsResponse: {
            uploadId: components["schemas"]["Uuid"];
            partSizeBytes: number;
            parts: components["schemas"]["UploadPartUrl"][];
            expiresAt: components["schemas"]["DateTime"];
        };
        UploadPartUrl: {
            partNumber: number;
            /** @description 预签名 PUT URL（浏览器直传对象存储，api 不代理大文件流量） */
            url: string;
            expiresAt: components["schemas"]["DateTime"];
        };
        /** @description 上传会话（服务端只登记元数据；分片状态以对象存储 ListParts 为准） */
        UploadSession: {
            id: components["schemas"]["Uuid"];
            fileId: components["schemas"]["Uuid"];
            intent: components["schemas"]["UploadIntent"];
            partSizeBytes: number;
            totalParts: number;
            status: components["schemas"]["UploadSessionStatus"];
            createdAt: components["schemas"]["DateTime"];
            expiresAt: components["schemas"]["DateTime"];
        };
        /**
         * @description 上传会话状态；active 可续传，completed/aborted/expired 不可再用
         * @enum {string}
         */
        UploadSessionStatus: "active" | "completed" | "aborted" | "expired";
        /** @description 上传会话（服务端只登记元数据；分片状态以对象存储 ListParts 为准） */
        UploadSessionView: components["schemas"]["UploadSession"] & {
            /** @description 已上传分片（来自对象存储 ListParts） */
            uploadedPartNumbers: number[];
            /** @description 缺失分片（断点续传只补这些） */
            missingPartNumbers: number[];
        };
        /** @description 登录用户（SSO 归一化口径，ADR-010） */
        User: {
            /**
             * @description Casdoor 用户 ID（claims.id → users.casdoor_id）
             * @example a195b721bb30a7d4
             */
            id: string | null;
            /**
             * @description 工号（claims.name → users.username）
             * @example A0001
             */
            name: string | null;
            /**
             * @description 姓名（claims.displayName → users.display_name）
             * @example 张三
             */
            displayName: string | null;
            /** @example zhangsan@libiaorobot.com */
            email: string | null;
            /**
             * @description 所属组织（claims.owner）
             * @example libiaorobot.com
             */
            owner: string | null;
        };
        /**
         * Format: uuid
         * @description UUID（主键与关联 ID）
         */
        Uuid: string;
        /** @description 乐观锁版本：读取时返回，更新时必须原样回传，冲突返回 409 */
        Version: number;
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
