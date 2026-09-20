import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import {
  CasdoorDirectorySource,
  normalizeCasdoorGroup,
  normalizeCasdoorUser,
} from "../src/modules/identity/casdoor-directory.source.js";
import { InternalTokenGuard, matchesInternalToken } from "../src/modules/identity/internal-token.guard.js";
import { InternalUserService } from "../src/modules/identity/internal-user.service.js";
import type { SessionService } from "../src/modules/identity/session.service.js";
import { UserService } from "../src/modules/identity/user.service.js";
import { UserRepository, type UserRow } from "../src/modules/identity/user.repository.js";
import type { ExecutionContext } from "@nestjs/common";

const AT = new Date("2026-09-20T06:00:00.000Z");

// ---------- 内存替身（不连库 / 不连外网，验证领域语义） ----------

function userRow(overrides: Partial<UserRow> & { id: string; username: string }): UserRow {
  return {
    casdoorId: "casdoor-" + overrides.id,
    displayName: overrides.username,
    email: null,
    owner: null,
    status: "active",
    removedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

class FakeUserRepository {
  rows: UserRow[] = [];
  updates: { id: string; status: string; removedAt?: Date | null }[] = [];
  lastQuery: { q: string | null; limit: number; offset: number } | null = null;

  async findByUsername(username: string): Promise<UserRow | null> {
    return this.rows.find((row) => row.username === username) ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const lower = email.toLowerCase();
    return this.rows.find((row) => (row.email ?? "").toLowerCase() === lower) ?? null;
  }

  async updateInternalState(
    id: string,
    next: { status: "active" | "disabled"; removedAt?: Date | null },
    at: Date,
  ): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error("fake 用户行丢失：" + id);
    row.status = next.status;
    if (Object.prototype.hasOwnProperty.call(next, "removedAt")) {
      row.removedAt = next.removedAt ?? null;
    }
    row.updatedAt = at;
    this.updates.push({
      id,
      status: next.status,
      ...(Object.prototype.hasOwnProperty.call(next, "removedAt") ? { removedAt: next.removedAt ?? null } : {}),
    });
  }

  async listDirectory(options: { q: string | null; limit: number; offset: number }): Promise<{ rows: UserRow[]; total: number }> {
    this.lastQuery = options;
    const matched = this.rows.filter((row) => {
      if (row.status !== "active") return false;
      if (options.q === null) return true;
      const needle = options.q.toLowerCase();
      return (
        row.username.toLowerCase().includes(needle) ||
        row.displayName.toLowerCase().includes(needle) ||
        (row.email ?? "").toLowerCase().includes(needle)
      );
    });
    return { rows: matched.slice(options.offset, options.offset + options.limit), total: matched.length };
  }
}

class FakeSessionService {
  affected = 0;
  revoked: string[] = [];

  async revokeAllForUser(userId: string): Promise<number> {
    this.revoked.push(userId);
    return this.affected;
  }
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

async function expectAppErrorAsync(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error("预期抛出 AppError，但未抛出");
}

function internalService(rows: UserRow[], affected = 0): { service: InternalUserService; users: FakeUserRepository; sessions: FakeSessionService } {
  const users = new FakeUserRepository();
  users.rows = rows;
  const sessions = new FakeSessionService();
  sessions.affected = affected;
  const service = new InternalUserService(users as unknown as UserRepository, sessions as unknown as SessionService);
  return { service, users, sessions };
}

// ---------- 离职回收（/internal/users/* 语义：name 优先 / email 兜底 / 幂等 / 踢线） ----------

describe("InternalUserService（h1 离职回收）", () => {
  it("disable：置 disabled 并踢掉在线会话", async () => {
    const { service, users, sessions } = internalService([userRow({ id: "u1", username: "zhangsan", email: "zhangsan@libiaorobot.com" })], 2);
    const result = await service.execute("disable", { name: "zhangsan", email: null });
    expect(result).toEqual({ ok: true, name: "zhangsan", action: "disable", affectedSessions: 2 });
    expect(users.rows[0]?.status).toBe("disabled");
    expect(users.rows[0]?.removedAt).toBeNull();
    expect(sessions.revoked).toEqual(["u1"]);
  });

  it("disable：重复调用幂等（已禁用仍清残留会话）", async () => {
    const { service, users } = internalService([userRow({ id: "u1", username: "zhangsan", status: "disabled" })], 0);
    const result = await service.execute("disable", { name: "zhangsan", email: null });
    expect(result.affectedSessions).toBe(0);
    expect(users.rows[0]?.status).toBe("disabled");
  });

  it("enable：恢复 active 并清空 removed_at，不恢复旧会话", async () => {
    const { service, users } = internalService([userRow({ id: "u1", username: "zhangsan", status: "disabled", removedAt: AT })]);
    const result = await service.execute("enable", { name: "zhangsan", email: null });
    expect(result).toEqual({ ok: true, name: "zhangsan", action: "enable", affectedSessions: 0 });
    expect(users.rows[0]?.status).toBe("active");
    expect(users.rows[0]?.removedAt).toBeNull();
  });

  it("delete：软删（disabled + removed_at）并踢线，不物理删行", async () => {
    const { service, users } = internalService([userRow({ id: "u1", username: "zhangsan" })], 1);
    const result = await service.execute("delete", { name: "zhangsan", email: null });
    expect(result).toEqual({ ok: true, name: "zhangsan", action: "delete", affectedSessions: 1 });
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]?.status).toBe("disabled");
    expect(users.rows[0]?.removedAt).toBeInstanceOf(Date);
  });

  it("name 查不到时用 email 兜底（大小写不敏感）", async () => {
    const { service, users } = internalService([userRow({ id: "u1", username: "lisi", email: "lisi@libiaorobot.com" })]);
    const result = await service.execute("disable", { name: "lisi-alias", email: "LiSi@libiaorobot.com" });
    expect(result.ok).toBe(true);
    expect(result.name).toBe("lisi");
    expect(users.rows[0]?.status).toBe("disabled");
  });

  it("name 优先：name 命中时不再看 email", async () => {
    const { service } = internalService([
      userRow({ id: "u1", username: "zhangsan", email: "other@x.com" }),
      userRow({ id: "u2", username: "lisi", email: "zhangsan@x.com" }),
    ]);
    const result = await service.execute("disable", { name: "zhangsan", email: "zhangsan@x.com" });
    expect(result.name).toBe("zhangsan");
  });

  it("目录中不存在：幂等成功（不报错、0 会话）", async () => {
    const { service } = internalService([]);
    const result = await service.execute("delete", { name: "ghost", email: null });
    expect(result).toEqual({ ok: true, name: "ghost", action: "delete", affectedSessions: 0 });
  });

  it("name 与 email 都缺：400 VALIDATION_FAILED", async () => {
    const { service } = internalService([]);
    await expectAppErrorAsync(() => service.execute("disable", { name: null, email: null }), "VALIDATION_FAILED");
  });
});

// ---------- 内部凭证（X-Internal-Token） ----------

describe("InternalTokenGuard / matchesInternalToken", () => {
  it("常量时间比较：空值与不等长一律失败", () => {
    expect(matchesInternalToken("", "s3cret")).toBe(false);
    expect(matchesInternalToken("s3cret", "")).toBe(false);
    expect(matchesInternalToken("s3cre", "s3cret")).toBe(false);
    expect(matchesInternalToken("s3cret", "s3cret")).toBe(true);
  });

  it("正确 token 放行；缺失 / 错误 token 401", () => {
    const guard = new InternalTokenGuard(new AppConfig({ INTERNAL_SYNC_TOKEN: "s3cret" } as unknown as Env));
    expect(guard.canActivate(contextWithHeaders({ "x-internal-token": "s3cret" }))).toBe(true);
    expectAppError(() => guard.canActivate(contextWithHeaders({ "x-internal-token": "wrong" })), "AUTH_REQUIRED");
    expectAppError(() => guard.canActivate(contextWithHeaders({})), "AUTH_REQUIRED");
  });

  it("服务端未配置 token：一律 401（不静默放行）", () => {
    const guard = new InternalTokenGuard(new AppConfig({ INTERNAL_SYNC_TOKEN: "" } as unknown as Env));
    expectAppError(() => guard.canActivate(contextWithHeaders({ "x-internal-token": "" })), "AUTH_REQUIRED");
  });
});

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

// ---------- Casdoor 目录适配器（拉取 → 归一化 → OrgDirectorySnapshot） ----------

interface FetchStub {
  calls: URL[];
  fetchImpl: typeof fetch;
}

function makeFetch(handler: (url: URL) => Response): FetchStub {
  const calls: URL[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function casdoorUser(index: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "uuid-" + String(index), name: "user" + String(index), displayName: "用户" + String(index), email: "user" + String(index) + "@libiaorobot.com", ...extra };
}

function directorySource(stub: FetchStub, owner = "libiaorobot"): CasdoorDirectorySource {
  return new CasdoorDirectorySource({
    issuer: "http://casdoor.test:8000",
    owner,
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl: stub.fetchImpl,
  });
}

describe("CasdoorDirectorySource（h1 目录适配器）", () => {
  it("用户分页拉取：p / pageSize 翻页并合并；携带鉴权参数", async () => {
    const firstPage = Array.from({ length: 100 }, (_value, index) => casdoorUser(index + 1));
    const secondPage = [casdoorUser(101), casdoorUser(102), casdoorUser(103, { isForbidden: true })];
    const stub = makeFetch((url) => {
      if (url.pathname === "/api/get-users") {
        return jsonResponse({ status: "ok", msg: "", data: url.searchParams.get("p") === "1" ? firstPage : secondPage });
      }
      return jsonResponse({ status: "ok", msg: "", data: [] });
    });
    const snapshot = await directorySource(stub).pull();
    expect(snapshot.users).toHaveLength(103);
    expect(snapshot.users[102]?.status).toBe("disabled");
    expect(snapshot.departments).toEqual([]);
    const first = stub.calls[0];
    expect(first?.searchParams.get("owner")).toBe("libiaorobot");
    expect(first?.searchParams.get("pageSize")).toBe("100");
    expect(first?.searchParams.get("clientId")).toBe("client-id");
    expect(first?.searchParams.get("clientSecret")).toBe("client-secret");
    expect(stub.calls.map((url) => url.searchParams.get("p"))).toEqual(["1", "2", null]);
  });

  it("服务端忽略分页（重复页）时去重并停页，不进入死循环", async () => {
    const page = Array.from({ length: 100 }, (_value, index) => casdoorUser(index + 1));
    const stub = makeFetch(() => jsonResponse({ status: "ok", data: page }));
    const snapshot = await directorySource(stub).pull();
    expect(snapshot.users).toHaveLength(100);
    expect(stub.calls.filter((url) => url.pathname === "/api/get-users")).toHaveLength(2);
  });

  it("脏行（缺 id / name）跳过；重复 casdoorId 去重", async () => {
    const stub = makeFetch((url) => {
      if (url.pathname === "/api/get-users") {
        return jsonResponse({ status: "ok", data: [casdoorUser(1), { name: "no-id" }, { id: "no-name" }, casdoorUser(1)] });
      }
      return jsonResponse({ status: "ok", data: [] });
    });
    const snapshot = await directorySource(stub).pull();
    expect(snapshot.users.map((user) => user.casdoorId)).toEqual(["uuid-1"]);
  });

  it("群组归一化：isTopGroup 归根、parentId 解析、isDeleted 跳过", async () => {
    const stub = makeFetch((url) => {
      if (url.pathname === "/api/get-groups") {
        return jsonResponse({
          status: "ok",
          data: [
            { name: "libiaorobot", displayName: "镭标机器人", isTopGroup: true },
            { name: "rd", displayName: "研发部", parentId: "libiaorobot" },
            { name: "hr", displayName: "人事部", parentId: "libiaorobot", isDeleted: true },
          ],
        });
      }
      return jsonResponse({ status: "ok", data: [] });
    });
    const snapshot = await directorySource(stub).pull();
    expect(snapshot.departments).toEqual([
      { sourceId: "libiaorobot", name: "镭标机器人", parentSourceId: null, status: "active" },
      { sourceId: "rd", name: "研发部", parentSourceId: "libiaorobot", status: "active" },
    ]);
  });

  it("status != ok / HTTP 非 2xx：抛 INTERNAL（不静默）", async () => {
    const failed = makeFetch(() => jsonResponse({ status: "error", msg: "unauthorized" }));
    await expectAppErrorAsync(() => directorySource(failed).pull(), "INTERNAL");
    const broken = makeFetch(() => new Response("boom", { status: 500 }));
    await expectAppErrorAsync(() => directorySource(broken).pull(), "INTERNAL");
  });

  it("未配置 owner / 凭据：抛 INTERNAL", async () => {
    const stub = makeFetch(() => jsonResponse({ status: "ok", data: [] }));
    await expectAppErrorAsync(() => directorySource(stub, "").pull(), "INTERNAL");
  });

  it("归一化纯函数：缺 id / name 返回 null；isDeleted 组返回 null", () => {
    expect(normalizeCasdoorUser({ id: "u", name: "zhangsan" })).toEqual({
      casdoorId: "u",
      username: "zhangsan",
      displayName: "zhangsan",
      email: null,
      status: "active",
    });
    expect(normalizeCasdoorUser({ name: "zhangsan" })).toBeNull();
    expect(normalizeCasdoorUser(null)).toBeNull();
    expect(normalizeCasdoorGroup({ name: "rd", parentId: "root" })).toEqual({
      sourceId: "rd",
      name: "rd",
      parentSourceId: "root",
      status: "active",
    });
    expect(normalizeCasdoorGroup({ name: "rd", isDeleted: true })).toBeNull();
  });
});

// ---------- 用户目录（GET /api/v1/users） ----------

describe("UserService.listUsers（A2 用户目录）", () => {
  it("只映射契约字段；q 去空白；offset = (page-1) * limit", async () => {
    const users = new FakeUserRepository();
    users.rows = [
      userRow({ id: "u1", username: "1001", displayName: "张三", email: "zhangsan@libiaorobot.com" }),
      userRow({ id: "u2", username: "1002", displayName: "李四", status: "disabled" }),
      userRow({ id: "u3", username: "1003", displayName: "张五" }),
    ];
    const service = new UserService(users as unknown as UserRepository);
    const page = await service.listUsers({ q: " 张 ", page: 2, limit: 1 });
    expect(users.lastQuery).toEqual({ q: "张", limit: 1, offset: 1 });
    expect(page.page).toBe(2);
    expect(page.limit).toBe(1);
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.username).toBe("1003");
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(["displayName", "email", "id", "status", "username"]);
  });

  it("空白 q 视为无关键字；默认只含启用用户", async () => {
    const users = new FakeUserRepository();
    users.rows = [userRow({ id: "u1", username: "1001" }), userRow({ id: "u2", username: "1002", status: "disabled" })];
    const service = new UserService(users as unknown as UserRepository);
    const page = await service.listUsers({ q: "   ", page: 1, limit: 50 });
    expect(users.lastQuery?.q).toBeNull();
    expect(page.total).toBe(1);
  });
});
