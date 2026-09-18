import { z } from "@libiaolink/contracts";

/** 环境变量契约：唯一入口是 loadEnv()，缺失 / 非法即启动失败（fail fast）。 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
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
