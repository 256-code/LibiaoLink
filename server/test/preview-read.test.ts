import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import type { FileRepository, FileRow, FileVersionRow } from "../src/modules/file/file.repository.js";
import { PreviewReadService } from "../src/modules/file/preview-read.service.js";
import type { PreviewArtifactKey, PreviewArtifactRow, PreviewRepository } from "../src/modules/file/preview.repository.js";
import type { PermissionService } from "../src/modules/permission/index.js";
import type { DownloadUrlInput, ObjectStorage, SignedUrl } from "../src/storage/index.js";

/**
 * M4-05 读 API 门禁（不连库、不连对象存储）：`GET /files/{id}/preview` 的三态语义。
 * ① ready —— 短时签名（TTL 与内联语义）+ **只记一条** preview 审计（D2-07）；
 * ② not_ready —— 首次登记 + 幂等补投（去重键 = 三元组、trigger = read），已有行不重复登记；
 * ③ failed —— 缓存态失败回原因不原地重试；判不出通道 / 无版本两类终态降级（不落表不投递）；
 * ④ 404 —— 文件不存在 / 项目不可见 / 版本不属于该文件（同形，防 IDOR）。
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const VERSION = "66666666-6666-4666-8666-666666666666";
const HISTORY = "88888888-8888-4888-8888-888888888888";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";
const HASH = "a".repeat(64);
const HASH_HISTORY = "b".repeat(64);
const NOW = new Date("2026-09-23T08:00:00Z");
const ARTIFACT_KEY = "previews/" + HASH + "/1.0.0/pdf";
const ARTIFACT_KEY_HISTORY = "previews/" + HASH_HISTORY + "/1.0.0/pdf";

const ENV = {
  PREVIEW_PIPELINE_VERSION: "1.0.0",
  PREVIEW_URL_TTL_SECONDS: 300,
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
    createdBy: ACTOR,
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
    objectKey: "projects/" + PROJECT + "/files/" + FILE + "/v1/" + HASH + ".pdf",
    sizeBytes: 12 * 1024 * 1024,
    contentHash: HASH,
    mime: "application/pdf",
    uploadedBy: ACTOR,
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

class FakeFileRepository {
  file: FileRow | null = makeFileRow();
  readonly versions = new Map<string, FileVersionRow>([[VERSION, makeVersionRow()]]);

  async findFileById(fileId: string): Promise<FileRow | null> {
    return this.file !== null && this.file.id === fileId ? this.file : null;
  }

  async findVersionById(fileId: string, versionId: string): Promise<FileVersionRow | null> {
    const version = this.versions.get(versionId);
    return version !== undefined && version.fileId === fileId ? version : null;
  }
}

class FakePreviewRepository {
  rows: PreviewArtifactRow[] = [];
  readonly queries: PreviewArtifactKey[] = [];
  readonly ensured: (PreviewArtifactKey & { fileId: string; versionId: string })[] = [];

  async findByKey(key: PreviewArtifactKey): Promise<PreviewArtifactRow | null> {
    this.queries.push(key);
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
    });
    this.rows.push(row);
    return row;
  }
}

class FakeStorage {
  readonly signed: DownloadUrlInput[] = [];
  expiresAt = new Date("2026-09-23T08:05:00Z");

  async signDownloadUrl(input: DownloadUrlInput): Promise<SignedUrl> {
    this.signed.push(input);
    return { url: "https://minio.local/" + input.objectKey + "?sig=1", expiresAt: this.expiresAt };
  }
}

class FakePermissionService {
  visible = true;
  readonly calls: string[] = [];

  async assertProjectVisible(_actorId: string, projectId: string): Promise<{ projectId: string; member: boolean; projectManager: boolean }> {
    this.calls.push(projectId);
    if (!this.visible) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    return { projectId, member: true, projectManager: false };
  }
}

class FakeAuditService {
  readonly entries: Record<string, unknown>[] = [];

  async record(_client: unknown, input: Record<string, unknown>): Promise<void> {
    this.entries.push(input);
  }
}

class FakeDatabase {
  readonly outbox: unknown[] = [];
  transactions = 0;
  db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      this.transactions += 1;
      return fn(this.makeTx());
    },
  };

  makeTx() {
    return {
      insert: () => ({
        values: (value: unknown) => {
          this.outbox.push(value);
          return { onConflictDoUpdate: async () => {} };
        },
      }),
    };
  }
}

interface Harness {
  service: PreviewReadService;
  repo: FakeFileRepository;
  previews: FakePreviewRepository;
  storage: FakeStorage;
  permission: FakePermissionService;
  audit: FakeAuditService;
  database: FakeDatabase;
}

function makeService(env: Partial<Env> = {}): Harness {
  const repo = new FakeFileRepository();
  const previews = new FakePreviewRepository();
  const storage = new FakeStorage();
  const permission = new FakePermissionService();
  const audit = new FakeAuditService();
  const database = new FakeDatabase();
  const config = new AppConfig({ ...ENV, ...env } as Env);
  const service = new PreviewReadService(
    database as unknown as DatabaseService,
    repo as unknown as FileRepository,
    previews as unknown as PreviewRepository,
    storage as unknown as ObjectStorage,
    permission as unknown as PermissionService,
    audit as unknown as AuditService,
    config,
  );
  return { service, repo, previews, storage, permission, audit, database };
}

describe("PreviewReadService.getPreview（M4-05 读 API）", () => {
  it("ready（缺省当前版本）：短时签名 + 写一条 preview 审计 + 三态字段齐全", async () => {
    const h = makeService();
    h.previews.rows = [
      makeArtifactRow({ status: "ready", objectKey: ARTIFACT_KEY, generatedAt: new Date("2026-09-23T07:00:00Z") }),
    ];

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result).toEqual({
      fileId: FILE,
      versionId: VERSION,
      status: "ready",
      target: "pdf",
      url: "https://minio.local/" + ARTIFACT_KEY + "?sig=1",
      expiresAt: "2026-09-23T08:05:00.000Z",
      pipelineVersion: "1.0.0",
      reason: null,
      generatedAt: "2026-09-23T07:00:00.000Z",
    });
    expect(h.audit.entries).toHaveLength(1);
    expect(h.audit.entries[0]).toMatchObject({
      actorId: ACTOR,
      action: "preview",
      objectType: "file",
      objectId: FILE,
      projectId: PROJECT,
      metadata: { versionId: VERSION, target: "pdf", pipelineVersion: "1.0.0" },
    });
    expect(h.audit.entries[0]!.summary).toContain("机械设计图纸.pdf");
    expect(h.previews.ensured).toHaveLength(0);
    expect(h.database.outbox).toHaveLength(0);
  });

  it("签名参数：TTL 取 PREVIEW_URL_TTL_SECONDS，不传 fileName（内联渲染，不改写 Content-Disposition）", async () => {
    const h = makeService({ PREVIEW_URL_TTL_SECONDS: 120 });
    h.previews.rows = [makeArtifactRow({ status: "ready", objectKey: ARTIFACT_KEY, generatedAt: NOW })];

    await h.service.getPreview(FILE, null, ACTOR);

    expect(h.storage.signed).toEqual([{ objectKey: ARTIFACT_KEY, expiresInSeconds: 120 }]);
    expect(Object.keys(h.storage.signed[0]!)).toEqual(["objectKey", "expiresInSeconds"]);
  });

  it("ready 指定历史版本（A4-06）：按该版本三元组命中，审计记该 versionId", async () => {
    const h = makeService();
    h.repo.versions.set(HISTORY, makeVersionRow({ id: HISTORY, seq: 2, contentHash: HASH_HISTORY }));
    h.previews.rows = [
      makeArtifactRow({ versionId: HISTORY, contentHash: HASH_HISTORY, status: "ready", objectKey: ARTIFACT_KEY_HISTORY, generatedAt: NOW }),
      makeArtifactRow({ status: "ready", objectKey: ARTIFACT_KEY, generatedAt: NOW }),
    ];

    const result = await h.service.getPreview(FILE, HISTORY, ACTOR);

    expect(h.previews.queries).toEqual([{ contentHash: HASH_HISTORY, pipelineVersion: "1.0.0", target: "pdf" }]);
    expect(result).toMatchObject({
      versionId: HISTORY,
      status: "ready",
      url: "https://minio.local/" + ARTIFACT_KEY_HISTORY + "?sig=1",
    });
    expect(h.audit.entries[0]).toMatchObject({ metadata: { versionId: HISTORY, target: "pdf", pipelineVersion: "1.0.0" } });
  });

  it("not_ready（首次请求）：同事务登记 not_ready + 幂等补投（去重键 = 三元组，trigger = read）+ 不写审计", async () => {
    const h = makeService();

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result).toEqual({
      fileId: FILE,
      versionId: VERSION,
      status: "not_ready",
      target: null,
      url: null,
      expiresAt: null,
      pipelineVersion: "1.0.0",
      reason: null,
      generatedAt: null,
    });
    expect(h.database.transactions).toBe(1);
    expect(h.previews.ensured).toEqual([
      { fileId: FILE, versionId: VERSION, contentHash: HASH, pipelineVersion: "1.0.0", target: "pdf" },
    ]);
    expect(h.database.outbox).toEqual([
      {
        topic: "preview.job",
        dedupeKey: "preview.job:" + HASH + ":1.0.0:pdf",
        status: "pending",
        payload: {
          projectId: PROJECT,
          fileId: FILE,
          versionId: VERSION,
          contentHash: HASH,
          target: "pdf",
          trigger: "read",
        },
      },
    ]);
    expect(h.audit.entries).toHaveLength(0);
    expect(h.storage.signed).toHaveLength(0);
  });

  it("not_ready（已有登记行）：不重复登记，仍补投（同去重键；dead 行由 appendOutboxIfAbsent 唤醒）", async () => {
    const h = makeService();
    h.previews.rows = [makeArtifactRow({ status: "not_ready" })];

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result.status).toBe("not_ready");
    expect(h.previews.ensured).toHaveLength(0);
    expect(h.database.outbox).toHaveLength(1);
    expect(h.database.outbox[0]).toMatchObject({ dedupeKey: "preview.job:" + HASH + ":1.0.0:pdf" });
  });

  it("failed（缓存态）：回原因、不原地重试（不补投 / 不登记 / 不签名 / 不审计）", async () => {
    const h = makeService();
    h.previews.rows = [
      makeArtifactRow({ status: "failed", error: "转换失败：UNSUPPORTED_MEDIA（该扩展名暂不支持）" }),
    ];

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result).toEqual({
      fileId: FILE,
      versionId: VERSION,
      status: "failed",
      target: null,
      url: null,
      expiresAt: null,
      pipelineVersion: "1.0.0",
      reason: "转换失败：UNSUPPORTED_MEDIA（该扩展名暂不支持）",
      generatedAt: null,
    });
    expect(h.database.outbox).toHaveLength(0);
    expect(h.previews.ensured).toHaveLength(0);
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("判不出渲染通道（.zip）：终态降级 failed，不查产物 / 不登记 / 不投递 / 不写审计", async () => {
    const h = makeService();
    h.repo.file = makeFileRow({ name: "资料包.zip" });
    h.repo.versions.set(VERSION, makeVersionRow({ mime: "application/zip" }));

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result.status).toBe("failed");
    expect(result.versionId).toBe(VERSION);
    expect(result.reason).toContain("暂不支持在线预览");
    expect(result.pipelineVersion).toBeNull();
    expect(h.previews.queries).toHaveLength(0);
    expect(h.previews.ensured).toHaveLength(0);
    expect(h.database.outbox).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("文件尚无版本（draft 未完成上传）：终态降级 failed，versionId 为空", async () => {
    const h = makeService();
    h.repo.file = makeFileRow({ status: "draft", currentVersionId: null });
    h.repo.versions.delete(VERSION);

    const result = await h.service.getPreview(FILE, null, ACTOR);

    expect(result).toEqual({
      fileId: FILE,
      versionId: null,
      status: "failed",
      target: null,
      url: null,
      expiresAt: null,
      pipelineVersion: null,
      reason: "文件尚无任何版本（未完成过上传），请下载查看",
      generatedAt: null,
    });
    expect(h.previews.queries).toHaveLength(0);
  });

  it("versionId 不属于该文件 / 不存在 → 404（不查产物）", async () => {
    const h = makeService();
    h.repo.versions.set(HISTORY, makeVersionRow({ id: HISTORY, fileId: "33333333-3333-4333-8333-333333333333" }));

    await expect(h.service.getPreview(FILE, HISTORY, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.previews.queries).toHaveLength(0);
    expect(h.storage.signed).toHaveLength(0);
  });

  it("文件不存在 → 404（且不判可见性）", async () => {
    const h = makeService();
    h.repo.file = null;

    await expect(h.service.getPreview(FILE, null, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.permission.calls).toHaveLength(0);
  });

  it("项目不可见 → 404（越权与不存在同形；不签发、不审计、不补投）", async () => {
    const h = makeService();
    h.permission.visible = false;

    await expect(h.service.getPreview(FILE, null, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.previews.queries).toHaveLength(0);
    expect(h.database.outbox).toHaveLength(0);
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });
});