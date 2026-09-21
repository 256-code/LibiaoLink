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
