import { z } from "@libiaolink/contracts";

/** 环境变量契约：唯一入口是 loadEnv()，缺失 / 非法即启动失败（fail fast）。 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // ---- 认证与会话（ADR-010；g6 会话后端化） ----
    CASDOOR_ISSUER: z.string().min(1).default("http://localhost:8000"),
    CASDOOR_CLIENT_ID: z.string().default(""),
    CASDOOR_CLIENT_SECRET: z.string().default(""),
    CASDOOR_REDIRECT_URI: z.string().min(1).default("http://localhost:3000/auth/callback"),
    CASDOOR_SCOPE: z.string().min(1).default("openid profile email"),
    /** 目录同步 owner（Casdoor 组织名；本地沙箱 libiaorobot，公司环境 libiaorobot.com）。 */
    CASDOOR_ORG_NAME: z.string().default(""),
    /** 会话空闲超时（分钟）：接入标准「企业内部系统」档为 30；0 仅测试用（立即超时）。 */
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(0).default(30),
    /** 会话 Cookie Secure 属性：auto = 仅 production 开启（本地 http 调试不受影响）。 */
    SESSION_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
    /** 内部作业接口凭证（请求头 X-Internal-Token；docs/开发者接入注意事项(SSO接入标准).md 第五部分）。 */
    INTERNAL_SYNC_TOKEN: z.string().default(""),
    /**
     * 权限判定开关（一期口径「我们当前这个系统就不要考虑权限」，2026-09-23 业务已定）：
     * `false`（默认）= **不判权限** —— 授权画像一律等效管理员（数据范围 all + 契约全量权限位 + admin 角色码），
     * 功能权限 / 记录级可见性 / 字段级投影 / 角色内硬检查全部放开；`true` = 按 ADR-011 判定（二期打开）。
     * 只影响**裁定**，不动数据：用户偏好（常用筛选 / 醒目模式 / 任务表列显隐）仍按账号各存一行（user_preferences）。
     */
    PERMISSION_ENFORCED: z.enum(["true", "false"]).default("false"),
    // ---- 对象存储（ADR-006：S3 协议抽象 + 一期 MinIO 单节点；本地沙箱见 deploy/minio/） ----
    S3_ENDPOINT: z.string().min(1).default("http://127.0.0.1:9000"),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_ACCESS_KEY: z.string().default(""),
    S3_SECRET_KEY: z.string().default(""),
    S3_BUCKET: z.string().min(1).default("libiaolink"),
    /** 寻址方式：auto = 非 AWS 端点走 path-style（MinIO / SeaweedFS 必需），AWS 走 virtual-host。 */
    S3_FORCE_PATH_STYLE: z.enum(["auto", "true", "false"]).default("auto"),
    /** 分片预签名 URL 有效期（秒）：单个分片的直传窗口（浏览器直传，api 不代理流量）。 */
    S3_PART_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(900),
    /** 下载预签名 URL 有效期（秒）：ADR-006 要求短时签名，禁止匿名读取。 */
    S3_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
    /** 单文件大小上限（MB）；上传管道（M4-01）据此返回 400 VALIDATION_FAILED。 */
    UPLOAD_MAX_SIZE_MB: z.coerce.number().int().min(1).max(102400).default(2048),
    /** 上传会话有效期（小时）：过期不可续传，需重新发起（契约 UploadSession.expiresAt）。 */
    UPLOAD_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /** 回收站保留期（天）：移入回收站时写 `files.purge_after = recycled_at + 保留期`（A4-12，默认 30）。 */
    FILE_RECYCLE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    // ---- 预览转换沙箱（M4-05c · ADR-007：converter 落点 deploy/preview/，接口契约见其 README「五」） ----
    /** 转换器基址：dev = 本机哑中继 `127.0.0.1:9900`；生产 = worker 与 converter 同处 internal 网络的内部地址。 */
    PREVIEW_CONVERTER_URL: z.string().min(1).default("http://127.0.0.1:9900"),
    /** 转换管线版本（进预览产物三元组缓存键）：与镜像标签同值，换镜像必须一并递增（deploy/preview/README「四」）。 */
    PREVIEW_PIPELINE_VERSION: z.string().min(1).default("1.0.0"),
    /** 客户端超时（毫秒）：比容器内硬超时（60000）留余量 —— 才拿得到 504 CONVERT_TIMEOUT 而不是被客户端掐断的裸超时。 */
    PREVIEW_CONVERT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(90000),
    /** 可重试失败的最大尝试次数（含首次）：到顶写产物 failed + outbox dead（D2-05 降级「请下载」）。 */
    PREVIEW_CONVERT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    /** 重试退避基数（毫秒）：第 n 次失败后等 min(基数 × 2^(n-1), 30 分钟)。 */
    PREVIEW_CONVERT_BACKOFF_MS: z.coerce.number().int().min(1000).max(600000).default(15000),
    /** 直接降级「仅下载」的源文件上限（MB）：转换峰值内存约为源文件数倍，别把沙箱配额打满（deploy/preview「七」）。 */
    PREVIEW_CONVERT_MAX_SOURCE_MB: z.coerce.number().int().min(1).max(512).default(100),
    /** 预览地址短时签名有效期（秒）：D2-04 短时签名 + 禁匿名；越长越接近「把产物地址变成长期免鉴权入口」。 */
    PREVIEW_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
    /** 预览转换队列开关（worker）：`false` = 只投递不消费（排障 / 压测用）。 */
    PREVIEW_JOB_ENABLED: z.enum(["true", "false"]).default("true"),
    // ---- Outbox 领取器（M4-05c：领取 + 消费 + 重试 + dead；不含规则 / 通知编排） ----
    /** 领取轮询周期（毫秒）。 */
    OUTBOX_POLL_MS: z.coerce.number().int().min(200).max(600000).default(5000),
    /** 单轮领取条数上限：单条最长占满客户端超时（90s），默认 2 与转换器沙箱并发 2 对齐。 */
    OUTBOX_BATCH_LIMIT: z.coerce.number().int().min(1).max(50).default(2),
    /** 领取后超过该时长未回写视为 worker 崩溃遗留、可重新领取（毫秒；必须 > 单条最长耗时）。 */
    OUTBOX_STALE_MS: z.coerce.number().int().min(60000).max(86400000).default(600000),
  })
  .superRefine((value, context) => {
    // S3 单次 CopyObject 上限 5 GiB（ADR-006：complete 时 `…/staging/{sessionId}` → 契约键走一次复制，
    // 见 src/storage/part-plan.ts 的 SINGLE_COPY_MAX_BYTES）。放开这个上限必须先补 UploadPartCopy。
    if (value.UPLOAD_MAX_SIZE_MB * 1024 * 1024 > 5 * 1024 * 1024 * 1024) {
      context.addIssue({
        code: "custom",
        message: "UPLOAD_MAX_SIZE_MB 不得超过 5120（S3 单次 CopyObject 上限 5 GiB；放开需先补分片复制）",
        path: ["UPLOAD_MAX_SIZE_MB"],
      });
    }
    // PREVIEW_PIPELINE_VERSION 进对象键（storage/object-key.ts 的片段白名单同口径）：非法字符会在构造键时抛错，
    // 提前到启动期拦下（fail fast）；「与镜像标签同值」的规则见 deploy/preview/README「四」。
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.PREVIEW_PIPELINE_VERSION)) {
      context.addIssue({
        code: "custom",
        message: "PREVIEW_PIPELINE_VERSION 只允许字母 / 数字 / . _ -（首字符须为字母或数字，最长 64）",
        path: ["PREVIEW_PIPELINE_VERSION"],
      });
    }
    if (value.OUTBOX_STALE_MS < value.PREVIEW_CONVERT_TIMEOUT_MS) {
      context.addIssue({
        code: "custom",
        message: "OUTBOX_STALE_MS 必须 >= PREVIEW_CONVERT_TIMEOUT_MS，否则正在转换的行会被当成崩溃遗留重复领取",
        path: ["OUTBOX_STALE_MS"],
      });
    }
    if (value.NODE_ENV !== "production") {
      return;
    }
    if (value.CASDOOR_CLIENT_ID === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 CASDOOR_CLIENT_ID", path: ["CASDOOR_CLIENT_ID"] });
    }
    if (value.CASDOOR_CLIENT_SECRET === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 CASDOOR_CLIENT_SECRET", path: ["CASDOOR_CLIENT_SECRET"] });
    }
    if (value.CASDOOR_ORG_NAME === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 CASDOOR_ORG_NAME", path: ["CASDOOR_ORG_NAME"] });
    }
    if (value.INTERNAL_SYNC_TOKEN === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 INTERNAL_SYNC_TOKEN", path: ["INTERNAL_SYNC_TOKEN"] });
    }
    if (value.S3_ACCESS_KEY === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 S3_ACCESS_KEY", path: ["S3_ACCESS_KEY"] });
    }
    if (value.S3_SECRET_KEY === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 S3_SECRET_KEY", path: ["S3_SECRET_KEY"] });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => (issue.path.join(".") || "(root)") + "：" + issue.message)
      .join("；");
    throw new Error("环境变量校验失败 —— " + detail);
  }
  return parsed.data;
}
