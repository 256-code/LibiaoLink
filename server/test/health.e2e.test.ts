import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import { DatabaseService } from "../src/db/database.service.js";

const env = loadEnv({
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgres://test@127.0.0.1:1/test",
  LOG_LEVEL: "silent",
});

const createFakeDatabase = (failOnSqlFragment?: string) => ({
  pool: {
    query: (sql: string) => {
      if (failOnSqlFragment && sql.includes(failOnSqlFragment)) {
        return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1"));
      }
      return Promise.resolve({ rows: [] });
    },
  },
  ping: async () => undefined,
});

async function createApp(fakeDatabase: unknown) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  })
    .overrideProvider(DatabaseService)
    .useValue(fakeDatabase)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.init();
  return app;
}

describe("health 端点（骨架验收：本地起服务并过健康检查）", () => {
  it("GET /healthz 返回 200", async () => {
    const app = await createApp(createFakeDatabase());
    const response = await request(app.getHttpServer()).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /readyz 全部探测通过时返回 200 ok", async () => {
    const app = await createApp(createFakeDatabase());
    const response = await request(app.getHttpServer()).get("/readyz");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.checks).toHaveLength(3);
    await app.close();
  });

  it("GET /readyz 表不可达时返回 503 degraded", async () => {
    const app = await createApp(createFakeDatabase("from projects"));
    const response = await request(app.getHttpServer()).get("/readyz");
    expect(response.status).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.ok).toBe(false);
    const failed = response.body.checks.filter((check: { ok: boolean }) => !check.ok);
    expect(failed.length).toBeGreaterThan(0);
    await app.close();
  });

  it("未知路由返回统一 ApiError 信封", async () => {
    const app = await createApp(createFakeDatabase());
    const response = await request(app.getHttpServer()).get("/no-such-route");
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NOT_FOUND");
    expect(response.body.details).toEqual([]);
    expect(typeof response.body.traceId).toBe("string");
    await app.close();
  });
});
