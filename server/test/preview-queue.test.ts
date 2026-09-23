import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockService } from "../src/common/clock/clock.service.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { ClaimOutboxInput, OutboxClaimedRow, OutboxRetryInput } from "../src/db/outbox.store.js";
import type { OutboxStore } from "../src/db/outbox.store.js";
import type { FileRepository, FileRow, FileVersionRow } from "../src/modules/file/file.repository.js";
import { ConverterError, PreviewConverter, type ConvertInput, type ConvertResult } from "../src/modules/file/preview.converter.js";
import { buildPreviewJobPayload, parsePreviewJob, previewJobDedupeKey } from "../src/modules/file/preview.job.js";
import type { PreviewArtifactKey, PreviewArtifactRow, PreviewRepository } from "../src/modules/file/preview.repository.js";
import { PreviewService } from "../src/modules/file/preview.service.js";
import { previewTargetsFor } from "../src/modules/file/preview.targets.js";
import { StorageError, type GetObjectResult, type PutObjectInput } from "../src/storage/index.js";
import type { ObjectStorage } from "../src/storage/index.js";

/**
 * M4-05c 预览转换队列门禁（不连库、不连转换器）：
 * ① 转换器客户端 —— 响应头 / 错误面 → 可重试 vs 确定性、管线版本比对、超时与不可达；
 * ② 队列消费 —— 三元组幂等（ready 复用 / failed 不原地重试）、产物键与元数据、失败降级与退避、dead 唤醒边界。
 * 转换器真机行为（沙箱四性 / 中文字体 / 通道矩阵）由 px 线 M4-05b 证据文档与真机回放覆盖，这里只管接线口径。
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const VERSION = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);
const NOW = new Date("2026-09-23T08:00:00Z");
const OUTBOX_ID = 4242;
const SOURCE_KEY = `projects/${PROJECT}/files/${FILE}/v1/${HASH}.pdf`;
const ARTIFACT_KEY = `previews/${HASH}/1.0.0/pdf`;

const ENV = {
  PREVIEW_CONVERTER_URL: "http://127.0.0.1:9900",
  PREVIEW_PIPELINE_VERSION: "1.0.0",
  PREVIEW_CONVERT_TIMEOUT_MS: 90000,
  PREVIEW_CONVERT_MAX_ATTEMPTS: 3,
  PREVIEW_CONVERT_BACKOFF_MS: 15000,
  PREVIEW_CONVERT_MAX_SOURCE_MB: 100,
  OUTBOX_POLL_MS: 5000,
  OUTBOX_BATCH_LIMIT: 2,
  OUTBOX_STALE_MS: 600000,
} as unknown as Env;

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: FILE,
    projectId: PROJECT,
    nodeId: null,
    taskId: null,
    docType: null,
    name: "机械设计图纸.pdf",
    status: "final",
    currentVersionId: VERSION,
    version: 6,
    createdBy: "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69",
    createdAt: NOW,
    updatedAt: NOW,
    finalizedAt: NOW,
    finalizedBy: null,
    recycledAt: null,
    recycledBy: null,
    recycledFromStatus: null,
    purgeAfter: null,
    ...overrides,
  };
}

function makeVersionRow(overrides: Partial<FileVersionRow> = {}): FileVersionRow {
  return {
    id: VERSION,
    fileId: FILE,
    seq: 1,
    objectKey: SOURCE_KEY,
    sizeBytes: 12 * 1024 * 1024,
    contentHash: HASH,
    mime: "application/pdf",
    uploadedBy: "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69",
    uploadedAt: NOW,
    changeRequestId: null,
    ...overrides,
  };
}

function makeArtifactRow(overrides: Partial<PreviewArtifactRow> = {}): PreviewArtifactRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    fileId: FILE,
    versionId: VERSION,
    contentHash: HASH,
    target: "pdf",
    pipelineVersion: "1.0.0",
    status: "not_ready",
    objectKey: null,
    error: null,
    generatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** 可重试 / 确定性失败用例共用的任务行。 */
function makeJobRow(overrides: Partial<OutboxClaimedRow> = {}): OutboxClaimedRow {
  return {
    id: OUTBOX_ID,
    topic: "preview.job",
    dedupeKey: previewJobDedupeKey({ contentHash: HASH, pipelineVersion: "1.0.0", target: "pdf" }),
    payload: buildPreviewJobPayload({
      projectId: PROJECT,
      fileId: FILE,
      versionId: VERSION,
      contentHash: HASH,
      target: "pdf",
      trigger: "finalize",
    }),
    attempts: 0,
    availableAt: NOW,
    lockedAt: NOW,
    ...overrides,
  };
}

const CONVERT_INPUT: ConvertInput = {
  bytes: new Uint8Array([1, 2, 3]),
  target: "pdf",
  fileName: "机械设计图纸.pdf",
  sourceMime: "application/pdf",
  requestId: "req-1",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeConverter(env: Partial<Env> = {}): PreviewConverter {
  return new PreviewConverter(new AppConfig({ ...ENV, ...env } as Env));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreviewConverter（转换器客户端 · deploy/preview/README「五」）", () => {
  it("200：读回产物字节与响应头（mode / 耗时 / 产物名解 URL 编码 / 管线版本）", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "x-pipeline-version": "1.0.0",
          "x-convert-mode": "convert",
          "x-convert-duration-ms": "716",
          "x-artifact-name": encodeURIComponent("机械设计图纸.pdf"),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeConverter().convert(CONVERT_INPUT);

    expect(result).toMatchObject({
      contentType: "application/pdf",
      mode: "convert",
      durationMs: 716,
      artifactName: "机械设计图纸.pdf",
      pipelineVersion: "1.0.0",
    });
    expect([...result.bytes]).toEqual([9, 8, 7]);

    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: unknown }];
    expect(call[0]).toBe("http://127.0.0.1:9900/convert");
    expect(call[1].headers).toMatchObject({
      "x-preview-target": "pdf",
      "x-file-name": encodeURIComponent("机械设计图纸.pdf"),
      "x-source-mime": "application/pdf",
      "x-request-id": "req-1",
    });
  });

  it("源 MIME 为空时不发 x-source-mime（可选项不送空头）", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "x-pipeline-version": "1.0.0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await makeConverter().convert({ ...CONVERT_INPUT, sourceMime: null });

    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers["x-source-mime"]).toBeUndefined();
    expect(call[1].headers["x-preview-target"]).toBe("pdf");
  });

  it("错误面分类：503 / 504 可重试；413 / 415 / 422 / 501 确定性失败（message 直接可落降级副行）", async () => {
    const cases: { status: number; code: string; kind: string }[] = [
      { status: 503, code: "SERVICE_BUSY", kind: "retryable" },
      { status: 503, code: "SERVICE_UNAVAILABLE", kind: "retryable" },
      { status: 504, code: "CONVERT_TIMEOUT", kind: "retryable" },
      { status: 413, code: "PAYLOAD_TOO_LARGE", kind: "deterministic" },
      { status: 415, code: "UNSUPPORTED_MEDIA", kind: "deterministic" },
      { status: 422, code: "CONVERT_FAILED", kind: "deterministic" },
      { status: 501, code: "UNSUPPORTED_TARGET", kind: "deterministic" },
    ];
    for (const item of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(item.status, {
            error: item.code,
            message: "转换失败：" + item.code,
            pipelineVersion: "1.0.0",
          }),
        ),
      );
      await expect(makeConverter().convert(CONVERT_INPUT)).rejects.toMatchObject({
        kind: item.kind,
        code: item.code,
        status: item.status,
      });
    }
  });

  it("管线版本不一致（200 但 x-pipeline-version 不同）：确定性失败，绝不写错缓存键", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "x-pipeline-version": "1.0.1" } })),
    );
    await expect(makeConverter().convert(CONVERT_INPUT)).rejects.toMatchObject({
      kind: "deterministic",
      code: "PIPELINE_VERSION_MISMATCH",
    });
  });

  it("不可达 / 客户端超时：都归可重试（502 语义由退避与到顶兜底）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    await expect(makeConverter().convert(CONVERT_INPUT)).rejects.toMatchObject({
      kind: "retryable",
      code: "CONVERT_UNREACHABLE",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }),
    );
    await expect(makeConverter().convert(CONVERT_INPUT)).rejects.toMatchObject({
      kind: "retryable",
      code: "CONVERT_TIMEOUT_LOCAL",
    });
  });

  it("超长 message 截到 500（preview_artifacts.error 的 CHECK 上限）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { error: "CONVERT_FAILED", message: "崩".repeat(900) })),
    );
    const error = await makeConverter()
      .convert(CONVERT_INPUT)
      .then(() => null)
      .catch((thrown: unknown) => thrown as Error);
    expect(error).not.toBeNull();
    expect(error!.message).toHaveLength(500);
  });

  it("healthz：200 + 版本一致 / 版本不一致 / 503 soffice 不可用 / 不可达（都不抛错）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true, pipelineVersion: "1.0.0" })));
    expect(await makeConverter().healthz()).toMatchObject({ ok: true, pipelineVersion: "1.0.0", versionMatches: true });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true, pipelineVersion: "1.0.1" })));
    expect(await makeConverter().healthz()).toMatchObject({ ok: true, versionMatches: false });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, { ok: false, pipelineVersion: "1.0.0" })));
    const busy = await makeConverter().healthz();
    expect(busy).toMatchObject({ ok: false, versionMatches: true });
    expect(busy.detail).toContain("soffice");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const down = await makeConverter().healthz();
    expect(down).toMatchObject({ ok: false, pipelineVersion: null, versionMatches: false });
    expect(down.detail).toContain("不可达");
  });
});

describe("previewTargetsFor / preview.job（投递侧映射）", () => {
  it("通道映射：图片 → image；PDF / Office（含 xlsx）→ pdf；判不出类型不投", () => {
    expect(previewTargetsFor({ fileName: "现场照片.png", mime: "image/png" })).toEqual(["image"]);
    expect(previewTargetsFor({ fileName: "矢量图.svg", mime: null })).toEqual(["image"]);
    expect(previewTargetsFor({ fileName: "机械设计图纸.pdf", mime: null })).toEqual(["pdf"]);
    expect(previewTargetsFor({ fileName: "方案.docx", mime: null })).toEqual(["pdf"]);
    expect(previewTargetsFor({ fileName: "报价.xlsx", mime: null })).toEqual(["pdf"]);
    expect(previewTargetsFor({ fileName: "无扩展名", mime: "application/vnd.ms-excel" })).toEqual(["pdf"]);
    expect(previewTargetsFor({ fileName: "交付包.zip", mime: null })).toEqual([]);
    expect(previewTargetsFor({ fileName: "工具包", mime: null })).toEqual([]);
  });

  it("去重键 = 三元组：内容 / 管线版本 / 通道 任一不同即不同任务", () => {
    const base = previewJobDedupeKey({ contentHash: HASH, pipelineVersion: "1.0.0", target: "pdf" });
    expect(base).toBe("preview.job:" + HASH + ":1.0.0:pdf");
    expect(previewJobDedupeKey({ contentHash: HASH, pipelineVersion: "1.0.1", target: "pdf" })).not.toBe(base);
    expect(previewJobDedupeKey({ contentHash: HASH, pipelineVersion: "1.0.0", target: "image" })).not.toBe(base);
    expect(previewJobDedupeKey({ contentHash: "b".repeat(64), pipelineVersion: "1.0.0", target: "pdf" })).not.toBe(base);
  });

  it("载荷解析：非法（缺字段 / 通道不在值集 / 非字符串）一律 null，不兜底默认值", () => {
    const payload = buildPreviewJobPayload({
      projectId: PROJECT,
      fileId: FILE,
      versionId: VERSION,
      contentHash: HASH,
      target: "pdf",
      trigger: "finalize",
    });
    expect(parsePreviewJob(payload)).toEqual({ projectId: PROJECT, fileId: FILE, versionId: VERSION, target: "pdf" });
    expect(parsePreviewJob({ ...payload, target: "svg" })).toBeNull();
    expect(parsePreviewJob({ ...payload, versionId: "" })).toBeNull();
    expect(parsePreviewJob({ fileId: FILE })).toBeNull();
  });
});

/** outbox 领取器替身：claim 从 queue 取行并记账，回写三态各记一笔。 */
class FakeOutboxStore {
  queue: OutboxClaimedRow[] = [];
  readonly claims: ClaimOutboxInput[] = [];
  readonly done: number[] = [];
  readonly retried: { id: number; input: OutboxRetryInput }[] = [];
  readonly dead: { id: number; input: { attempts: number; error: string } }[] = [];

  async claim(input: ClaimOutboxInput): Promise<OutboxClaimedRow[]> {
    this.claims.push(input);
    return this.queue.splice(0, input.limit);
  }

  async markDone(id: number): Promise<void> {
    this.done.push(id);
  }

  async markRetry(id: number, input: OutboxRetryInput): Promise<void> {
    this.retried.push({ id, input });
  }

  async markDead(id: number, input: { attempts: number; error: string }): Promise<void> {
    this.dead.push({ id, input });
  }
}

/** preview_artifacts 替身：内存三元组表（唯一键语义与真库一致）。 */
class FakePreviewRepository {
  rows: PreviewArtifactRow[] = [];
  readonly ensured: (PreviewArtifactKey & { fileId: string; versionId: string })[] = [];
  readonly ready: { key: PreviewArtifactKey; input: { objectKey: string; generatedAt: Date } }[] = [];
  readonly failed: { key: PreviewArtifactKey; input: { error: string; updatedAt: Date } }[] = [];

  async findByKey(key: PreviewArtifactKey): Promise<PreviewArtifactRow | null> {
    return (
      this.rows.find(
        (row) =>
          row.contentHash === key.contentHash &&
          row.pipelineVersion === key.pipelineVersion &&
          row.target === key.target,
      ) ?? null
    );
  }

  async ensureRequested(input: PreviewArtifactKey & { fileId: string; versionId: string }): Promise<PreviewArtifactRow> {
    this.ensured.push(input);
    const existing = await this.findByKey(input);
    if (existing !== null) {
      return existing;
    }
    const row = makeArtifactRow({
      fileId: input.fileId,
      versionId: input.versionId,
      contentHash: input.contentHash,
      pipelineVersion: input.pipelineVersion,
      target: input.target,
      status: "not_ready",
    });
    this.rows.push(row);
    return row;
  }

  async markReady(key: PreviewArtifactKey, input: { objectKey: string; generatedAt: Date }): Promise<void> {
    this.ready.push({ key, input });
  }

  async markFailed(key: PreviewArtifactKey, input: { error: string; updatedAt: Date }): Promise<void> {
    this.failed.push({ key, input });
  }
}

class FakeFileRepository {
  file: FileRow | null = makeFileRow();
  version: FileVersionRow | null = makeVersionRow();

  async findFileById(): Promise<FileRow | null> {
    return this.file;
  }

  async findVersionById(): Promise<FileVersionRow | null> {
    return this.version;
  }
}

class FakeStorage {
  source: GetObjectResult | null = {
    objectKey: SOURCE_KEY,
    bytes: new Uint8Array([4, 5, 6]),
    contentType: "application/pdf",
    sizeBytes: 3,
  };
  putError: Error | null = null;
  readonly puts: PutObjectInput[] = [];

  async getObject(objectKey: string): Promise<GetObjectResult | null> {
    return this.source === null ? null : { ...this.source, objectKey };
  }

  async putObject(input: PutObjectInput): Promise<{ etag: string | null }> {
    if (this.putError !== null) {
      throw this.putError;
    }
    this.puts.push(input);
    return { etag: "\"put-etag\"" };
  }
}

class FakeConverter {
  readonly calls: ConvertInput[] = [];
  result: ConvertResult | Error = {
    bytes: new Uint8Array([7, 8, 9, 10]),
    contentType: "application/pdf",
    mode: "convert",
    durationMs: 716,
    artifactName: "机械设计图纸.pdf",
    pipelineVersion: "1.0.0",
  };

  async convert(input: ConvertInput): Promise<ConvertResult> {
    this.calls.push(input);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

interface Harness {
  service: PreviewService;
  outbox: FakeOutboxStore;
  previews: FakePreviewRepository;
  repo: FakeFileRepository;
  storage: FakeStorage;
  converter: FakeConverter;
  clock: ClockService;
}

function makeService(env: Partial<Env> = {}): Harness {
  const outbox = new FakeOutboxStore();
  const previews = new FakePreviewRepository();
  const repo = new FakeFileRepository();
  const storage = new FakeStorage();
  const converter = new FakeConverter();
  const clock = new ClockService();
  clock.setSource(() => NOW);
  const config = new AppConfig({ ...ENV, ...env } as Env);
  const service = new PreviewService(
    repo as unknown as FileRepository,
    previews as unknown as PreviewRepository,
    outbox as unknown as OutboxStore,
    storage as unknown as ObjectStorage,
    converter as unknown as PreviewConverter,
    config,
    clock,
  );
  return { service, outbox, previews, repo, storage, converter, clock };
}

describe("PreviewService.drainOnce（M4-05c 预览队列消费）", () => {
  it("成功链路：领取 → 直读源字节 → 转换 → 产物回对象存储（键 = 三元组）→ ready → done", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];

    const stats = await h.service.drainOnce();

    expect(h.outbox.claims[0]).toMatchObject({ topics: ["preview.job"], limit: 2, staleAfterMs: 600000 });
    expect(h.converter.calls).toHaveLength(1);
    expect(h.converter.calls[0]).toMatchObject({
      target: "pdf",
      fileName: "机械设计图纸.pdf",
      sourceMime: "application/pdf",
    });
    expect([...h.converter.calls[0]!.bytes]).toEqual([4, 5, 6]);

    expect(h.storage.puts).toHaveLength(1);
    expect(h.storage.puts[0]).toMatchObject({ objectKey: ARTIFACT_KEY, contentType: "application/pdf" });
    expect(h.storage.puts[0]!.metadata).toMatchObject({
      "preview-pipeline-version": "1.0.0",
      "preview-target": "pdf",
      "preview-content-hash": HASH,
      "preview-source-version": VERSION,
      "preview-mode": "convert",
    });

    expect(h.previews.ready[0]!.key).toEqual({ contentHash: HASH, pipelineVersion: "1.0.0", target: "pdf" });
    expect(h.previews.ready[0]!.input.objectKey).toBe(ARTIFACT_KEY);
    expect(h.previews.ready[0]!.input.generatedAt).toBe(NOW);
    expect(h.outbox.done).toEqual([OUTBOX_ID]);
    expect(h.outbox.retried).toHaveLength(0);
    expect(h.outbox.dead).toHaveLength(0);
    expect(stats).toMatchObject({ claimed: 1, ready: 1, reused: 0, retried: 0, dead: 0, skipped: 0 });
  });

  it("三元组幂等：已有 ready 行 → 不调转换器、不重写产物，直接 done", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.previews.rows = [makeArtifactRow({ status: "ready", objectKey: ARTIFACT_KEY, generatedAt: NOW })];

    const stats = await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.storage.puts).toHaveLength(0);
    expect(h.previews.ready).toHaveLength(0);
    expect(h.outbox.done).toEqual([OUTBOX_ID]);
    expect(stats).toMatchObject({ claimed: 1, ready: 0, reused: 1 });
  });

  it("failed 是缓存态：不原地重试（由 pipeline_version 递增失效），任务直接 done", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.previews.rows = [makeArtifactRow({ status: "failed", error: "上一轮确定性失败" })];

    await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.outbox.done).toEqual([OUTBOX_ID]);
    expect(h.outbox.dead).toHaveLength(0);
  });

  it("确定性失败（422）：一次即降级 —— 产物 failed（error ≤ 500）+ outbox dead", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.converter.result = new ConverterError("deterministic", "CONVERT_FAILED", 422, "LibreOffice 转换失败：文件已损坏");

    const stats = await h.service.drainOnce();

    expect(h.previews.failed).toHaveLength(1);
    expect(h.previews.failed[0]).toMatchObject({
      key: { contentHash: HASH, pipelineVersion: "1.0.0", target: "pdf" },
      input: { error: "LibreOffice 转换失败：文件已损坏", updatedAt: NOW },
    });
    expect(h.outbox.dead[0]).toMatchObject({ id: OUTBOX_ID, input: { attempts: 1, error: "LibreOffice 转换失败：文件已损坏" } });
    expect(h.outbox.retried).toHaveLength(0);
    expect(stats).toMatchObject({ dead: 1, retried: 0 });
  });

  it("可重试失败（503）：回 pending 退避（15s 起步），不写 failed（产物留在 not_ready）", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.converter.result = new ConverterError("retryable", "SERVICE_BUSY", 503, "转换器忙，请稍后重试");

    const stats = await h.service.drainOnce();

    expect(h.previews.failed).toHaveLength(0);
    expect(h.outbox.done).toHaveLength(0);
    expect(h.outbox.retried[0]).toMatchObject({
      id: OUTBOX_ID,
      input: { attempts: 1, error: "转换器忙，请稍后重试" },
    });
    expect(h.outbox.retried[0]!.input.availableAt.getTime()).toBe(NOW.getTime() + 15000);
    expect(stats).toMatchObject({ retried: 1, dead: 0 });
  });

  it("可重试到顶（第 3 次）：转 failed + dead，退避不再排程", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow({ attempts: 2 })];
    h.converter.result = new ConverterError("retryable", "CONVERT_TIMEOUT", 504, "转换超时（60s）");

    const stats = await h.service.drainOnce();

    expect(h.outbox.retried).toHaveLength(0);
    expect(h.previews.failed[0]!.input.error).toBe("转换超时（60s）");
    expect(h.outbox.dead[0]).toMatchObject({ id: OUTBOX_ID, input: { attempts: 3 } });
    expect(stats).toMatchObject({ dead: 1 });
  });

  it("重试退避封顶 30 分钟（尝试次数多时不再翻倍）", async () => {
    const h = makeService({ PREVIEW_CONVERT_MAX_ATTEMPTS: 10, PREVIEW_CONVERT_BACKOFF_MS: 600000 });
    h.outbox.queue = [makeJobRow({ attempts: 5 })];
    h.converter.result = new ConverterError("retryable", "SERVICE_BUSY", 503, "忙");

    await h.service.drainOnce();

    expect(h.outbox.retried[0]!.input.availableAt.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("structured 通道一期未启用：不调转换器，直接确定性降级", async () => {
    const h = makeService();
    h.outbox.queue = [
      makeJobRow({
        payload: buildPreviewJobPayload({
          projectId: PROJECT,
          fileId: FILE,
          versionId: VERSION,
          contentHash: HASH,
          target: "structured",
          trigger: "read",
        }),
      }),
    ];

    const stats = await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.previews.failed[0]!.input.error).toContain("structured");
    expect(h.outbox.dead).toHaveLength(1);
    expect(stats).toMatchObject({ dead: 1 });
  });

  it("超大源文件（> PREVIEW_CONVERT_MAX_SOURCE_MB）：不调转换器，直接降级「请下载」", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.repo.version = makeVersionRow({ sizeBytes: 101 * 1024 * 1024 });

    await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.storage.puts).toHaveLength(0);
    expect(h.previews.failed[0]!.input.error).toContain("超过预览转换上限 100 MB");
    expect(h.outbox.dead).toHaveLength(1);
  });

  it("源对象缺失（存储侧读不到）：按可重试处理，不一次判死", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.storage.source = null;

    const stats = await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.outbox.retried[0]!.input.error).toContain("源对象不存在");
    expect(h.previews.failed).toHaveLength(0);
    expect(stats).toMatchObject({ retried: 1 });
  });

  it("产物写库 / 写对象失败（存储抖动）：按可重试处理", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.storage.putError = new StorageError("unavailable", "对象存储暂不可用，请稍后重试");

    await h.service.drainOnce();

    expect(h.outbox.retried).toHaveLength(1);
    expect(h.outbox.dead).toHaveLength(0);
    expect(h.previews.ready).toHaveLength(0);
  });

  it("源版本已不存在（彻底删除 / 到期清理）：任务跳过并消费掉，不留噪音", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];
    h.repo.version = null;

    const stats = await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.previews.ensured).toHaveLength(0);
    expect(h.outbox.done).toEqual([OUTBOX_ID]);
    expect(stats).toMatchObject({ claimed: 1, skipped: 1, dead: 0 });
  });

  it("载荷非法：转 dead（不猜默认值，也不占转换配额）", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow({ payload: { fileId: FILE } })];

    const stats = await h.service.drainOnce();

    expect(h.converter.calls).toHaveLength(0);
    expect(h.outbox.dead[0]!.input.error).toContain("载荷非法");
    expect(stats).toMatchObject({ dead: 1 });
  });

  it("首投登记：库内还没有产物行时补一条 not_ready（同三元组后续命中同一行）", async () => {
    const h = makeService();
    h.outbox.queue = [makeJobRow()];

    await h.service.drainOnce();

    expect(h.previews.ensured[0]).toMatchObject({
      fileId: FILE,
      versionId: VERSION,
      contentHash: HASH,
      pipelineVersion: "1.0.0",
      target: "pdf",
    });
  });
});