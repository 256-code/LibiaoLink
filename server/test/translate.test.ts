/**
 * 翻译落库回归（§6.16 ㉕ · Push 301）：译文库优先短路 / 未命中调引擎并落库 / 术语保护与回换在服务端 /
 * 引擎故障 INTERNAL / 批量只读查库（绝不调引擎）/ 保存链路预热（CJK 过滤 + 同文本去重 + 失败静默）。
 * 真机口径见 server/src/modules/translate/README.md。
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/config.module.js";
import type {
  ContentTranslationHitRow,
  ContentTranslationRow,
  ContentTranslationUpsert,
  TranslateRepository,
} from "../src/modules/translate/translate.repository.js";
import { TranslateService } from "../src/modules/translate/translate.service.js";

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

class FakeTranslationRepository {
  rows = new Map<string, { sourceText: string; translatedText: string; engine: string }>();
  upsertCalls: ContentTranslationUpsert[] = [];
  lookupCalls: string[][] = [];

  private key(sourceLang: string, targetLang: string, hash: string): string {
    return sourceLang + "|" + targetLang + "|" + hash;
  }

  async findByHash(sourceLang: string, targetLang: string, hash: string): Promise<ContentTranslationRow | null> {
    const row = this.rows.get(this.key(sourceLang, targetLang, hash));
    return row ?? null;
  }

  async findManyByHashes(sourceLang: string, targetLang: string, hashes: readonly string[]): Promise<ContentTranslationHitRow[]> {
    this.lookupCalls.push([...hashes]);
    const out: ContentTranslationHitRow[] = [];
    for (const hash of hashes) {
      const row = this.rows.get(this.key(sourceLang, targetLang, hash));
      if (row !== undefined) {
        out.push({ sourceHash: hash, translatedText: row.translatedText });
      }
    }
    return out;
  }

  async upsert(input: ContentTranslationUpsert, _at: Date): Promise<void> {
    this.upsertCalls.push(input);
    this.rows.set(this.key(input.sourceLang, input.targetLang, input.sourceHash), {
      sourceText: input.sourceText,
      translatedText: input.translatedText,
      engine: input.engine,
    });
  }
}

const config = {
  env: { TRANSLATE_ORIGIN: "http://translate.test:5008", TRANSLATE_TIMEOUT_MS: 20000 },
} as unknown as AppConfig;

function makeService(): { repository: FakeTranslationRepository; service: TranslateService } {
  const repository = new FakeTranslationRepository();
  const service = new TranslateService(config, repository as unknown as TranslateRepository);
  return { repository, service };
}

/** fetch 替身：记录每次发往引擎的 q 并回包。 */
function stubEngineReply(reply: (q: string) => { status?: number; payload?: unknown; throwError?: boolean }): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { q?: unknown };
    const q = typeof body.q === "string" ? body.q : "";
    calls.push(q);
    const outcome = reply(q);
    if (outcome.throwError === true) {
      throw new Error("engine down");
    }
    return new Response(JSON.stringify(outcome.payload ?? { translatedText: "" }), {
      status: outcome.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TranslateService.translate（库优先 + 引擎兜底落库）", () => {
  it("译文库命中：直接返回，不调引擎、不重复写", async () => {
    const { repository, service } = makeService();
    repository.rows.set("zh|en|" + hashOf("任务一"), { sourceText: "任务一", translatedText: "Task one", engine: "hy-mt-1.5-1.8b" });
    const engine = stubEngineReply(() => ({ payload: { translatedText: "SHOULD NOT BE CALLED" } }));
    await expect(service.translate("任务一", "zh", "en")).resolves.toBe("Task one");
    expect(engine.calls).toHaveLength(0);
    expect(repository.upsertCalls).toHaveLength(0);
  });

  it("未命中：发原文的术语保护形态到引擎，回包回换 + 落库（键 = sha256(原文)）", async () => {
    const { repository, service } = makeService();
    const engine = stubEngineReply((q) => ({ payload: { translatedText: q } }));
    const final = await service.translate("基督城仓配中心扩建", "zh", "en");
    expect(engine.calls).toHaveLength(1);
    const sent = engine.calls[0] ?? "";
    expect(sent).not.toContain("基督城");
    expect(sent).toContain("Xq");
    expect(final).toContain("Christchurch");
    expect(final).toContain("Warehouse and Distribution Center");
    expect(final).not.toContain("Xq");
    expect(repository.upsertCalls).toHaveLength(1);
    const written = repository.upsertCalls[0];
    expect(written?.sourceText).toBe("基督城仓配中心扩建");
    expect(written?.sourceHash).toBe(hashOf("基督城仓配中心扩建"));
    expect(written?.translatedText).toBe(final);
    expect(written?.engine).toBe("hy-mt-1.5-1.8b");
  });

  it("整句全大写回包（小模型偶发）：规整成句首大写后落库", async () => {
    const { service, repository } = makeService();
    stubEngineReply(() => ({ payload: { translatedText: "ACCEPTANCE REPORT SUBMITTED" } }));
    const final = await service.translate("验收报告已提交", "zh", "en");
    expect(final).toBe("Acceptance report submitted");
    expect(repository.upsertCalls[0]?.translatedText).toBe("Acceptance report submitted");
  });

  it("引擎 HTTP 失败 / 网络异常：抛 AppError INTERNAL，不落库", async () => {
    const first = makeService();
    stubEngineReply(() => ({ status: 502 }));
    await expect(first.service.translate("任务二", "zh", "en")).rejects.toMatchObject({ code: "INTERNAL" });
    expect(first.repository.upsertCalls).toHaveLength(0);

    const second = makeService();
    stubEngineReply(() => ({ throwError: true }));
    await expect(second.service.translate("任务三", "zh", "en")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("引擎回包缺 translatedText：抛 INTERNAL", async () => {
    const { service } = makeService();
    stubEngineReply(() => ({ payload: {} }));
    await expect(service.translate("任务四", "zh", "en")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("TranslateService.lookup（批量只读查库）", () => {
  it("按哈希去重查库、命中按请求序返回、未命中跳过、不调引擎", async () => {
    const { repository, service } = makeService();
    repository.rows.set("zh|en|" + hashOf("甲"), { sourceText: "甲", translatedText: "A", engine: "hy-mt-1.5-1.8b" });
    repository.rows.set("zh|en|" + hashOf("乙"), { sourceText: "乙", translatedText: "B", engine: "hy-mt-1.5-1.8b" });
    const engine = stubEngineReply(() => ({ payload: { translatedText: "SHOULD NOT BE CALLED" } }));
    const hits = await service.lookup(["甲", "丙", "乙", "甲"], "zh", "en");
    expect(hits).toEqual([
      { q: "甲", translatedText: "A" },
      { q: "乙", translatedText: "B" },
    ]);
    expect(engine.calls).toHaveLength(0);
    expect(repository.lookupCalls).toHaveLength(1);
    expect(repository.lookupCalls[0]).toHaveLength(3);
  });

  it("空入参：直接返回空表（查库层对空表短路，替身收到空哈希数组）", async () => {
    const { repository, service } = makeService();
    await expect(service.lookup([], "zh", "en")).resolves.toEqual([]);
    expect(repository.lookupCalls).toEqual([[]]);
  });
});

describe("TranslateService.warmup（保存即后台翻译）", () => {
  it("只排中文文本（去空去重），后台翻好落库；重复调用在去重窗口内不再排队", async () => {
    const { repository, service } = makeService();
    const engine = stubEngineReply((q) => ({ payload: { translatedText: q } }));
    service.warmup(["任务甲", "plain ascii", "", "任务甲", "   "]);
    await vi.waitFor(() => {
      expect(repository.upsertCalls).toHaveLength(1);
    });
    expect(engine.calls).toHaveLength(1);
    service.warmup(["任务甲"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.calls).toHaveLength(1);
    expect(repository.upsertCalls).toHaveLength(1);
  });

  it("已入库条目跳过（不调引擎）；引擎失败静默不抛错", async () => {
    const seeded = makeService();
    seeded.repository.rows.set("zh|en|" + hashOf("已翻文本"), { sourceText: "已翻文本", translatedText: "Done", engine: "hy-mt-1.5-1.8b" });
    const okEngine = stubEngineReply((q) => ({ payload: { translatedText: q } }));
    seeded.service.warmup(["已翻文本"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(okEngine.calls).toHaveLength(0);
    expect(seeded.repository.upsertCalls).toHaveLength(0);

    vi.unstubAllGlobals();
    const failing = makeService();
    stubEngineReply(() => ({ throwError: true }));
    failing.service.warmup(["失败文本"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(failing.repository.upsertCalls).toHaveLength(0);
  });
});
