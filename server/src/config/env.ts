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
    /** 会话空闲超时（分钟）：接入标准「企业内部系统」档为 30；0 仅测试用（立即超时）。 */
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(0).default(30),
    /** 会话 Cookie Secure 属性：auto = 仅 production 开启（本地 http 调试不受影响）。 */
    SESSION_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") {
      return;
    }
    if (value.CASDOOR_CLIENT_ID === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 CASDOOR_CLIENT_ID", path: ["CASDOOR_CLIENT_ID"] });
    }
    if (value.CASDOOR_CLIENT_SECRET === "") {
      context.addIssue({ code: "custom", message: "生产环境必须配置 CASDOOR_CLIENT_SECRET", path: ["CASDOOR_CLIENT_SECRET"] });
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
