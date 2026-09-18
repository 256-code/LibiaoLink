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
                    /** @description UUID（主键与关联 ID） */
                    "filter[ownerId]"?: components["schemas"]["Uuid"];
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
        /** 新建项目（编号服务端生成；默认按已发布蓝图导入节点） */
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
                    /** @description UUID（主键与关联 ID） */
                    "filter[ownerId]"?: components["schemas"]["Uuid"];
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
        /**
         * @description 统一错误码（技术设计v0.2 §7.2）
         * @enum {string}
         */
        ErrorCode: "VALIDATION_FAILED" | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "NODE_REQUIRED_DOC_MISSING" | "NODE_ALREADY_DONE" | "NODE_DELETED" | "BLUEPRINT_SCHEMA_INVALID" | "BLUEPRINT_REF_UNKNOWN" | "FILE_STATE_INVALID" | "IDEMPOTENT_REPLAY" | "PREVIEW_NOT_READY" | "PREVIEW_FAILED" | "INTERNAL";
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
        /** @description 写操作幂等键（Idempotency-Key 请求头）；重复提交返回首次结果 */
        IdempotencyKey: string;
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
             * @description 项目编号：服务端生成，创建请求不接收
             * @example LB-2026-0001
             */
            code: string;
            /** @example XX 客户分拣项目 */
            name: string;
            customer: string | null;
            /** @description 项目落地地区（字典 region；缺省「未分类」） */
            region: string;
            /** @description 项目类型（字典 project_type；主题色随字典元数据下发，前端不硬编码） */
            projectType: string;
            ownerId: components["schemas"]["Uuid"];
            managerId: components["schemas"]["Uuid"] & (string | null);
            stageKey: components["schemas"]["StageKey"];
            status: components["schemas"]["ProjectStatus"];
            description: string | null;
            version: components["schemas"]["Version"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        ProjectCreateBody: {
            name: string;
            customer?: string;
            region: string;
            projectType: string;
            ownerId: components["schemas"]["Uuid"];
            managerId?: components["schemas"]["Uuid"];
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
            ownerId: {
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
            name?: string;
            customer?: string | null;
            region?: string;
            projectType?: string;
            ownerId?: components["schemas"]["Uuid"];
            managerId?: components["schemas"]["Uuid"] & (string | null);
            stageKey?: components["schemas"]["StageKey"];
            status?: components["schemas"]["ProjectStatus"];
            description?: string | null;
            version: components["schemas"]["Version"];
        };
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
