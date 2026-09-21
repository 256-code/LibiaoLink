import { describe, expect, it } from "vitest";
import { ClockService } from "../src/common/clock/clock.service.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import { FileService } from "../src/modules/file/index.js";
import type {
  DuplicateFileRow,
  FileCompletePatch,
  FileInsertInput,
  FileNodeBriefRow,
  FileProjectBriefRow,
  FileRow,
  FileTaskBriefRow,
  FileVersionInsertInput,
  FileVersionRow,
  UploadSessionInsertInput,
  UploadSessionPatch,
  UploadSessionRow,
} from "../src/modules/file/file.repository.js";
import type { FileRepository } from "../src/modules/file/file.repository.js";
import type { PermissionService } from "../src/modules/permission/index.js";
import { ObjectStorage, StorageError } from "../src/storage/index.js";
import type {
  CompleteMultipartUploadInput,
  CopyObjectInput,
  CopyObjectResult,
  CreateMultipartUploadInput,
  DownloadUrlInput,
  MultipartUploadKeyInput,
  MultipartUploadRef,
  ObjectHead,
  PartUploadUrlInput,
  PurgeObjectResult,
  SignedUrl,
  UploadedPart,
} from "../src/storage/index.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "99999999-9999-4999-8999-999999999999";
const FILE = "22222222-2222-4222-8222-222222222222";
const OTHER_FILE = "22222222-2222-4222-8222-22222222222a";
const NODE = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555";
const VERSION = "66666666-6666-4666-8666-666666666666";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";
const OTHER_ACTOR = "caa8d763-4b6a-4967-9b26-7d1086272c9c";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const NOW = new Date("2026-09-21T08:00:00Z");
const MI_B = 1024 * 1024;
const STAGING_KEY = `projects/${PROJECT}/files/${FILE}/staging/${SESSION}`;
const CONTRACT_KEY = `projects/${PROJECT}/files/${FILE}/v1/${HASH}.pdf`;
const ENV = {
  UPLOAD_MAX_SIZE_MB: 2048,
  UPLOAD_SESSION_TTL_HOURS: 24,
} as unknown as Env;

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: FILE,
    projectId: PROJECT,
    nodeId: null,
    taskId: null,
    docType: null,
    name: "机械设计图纸.pdf",
    status: "draft",
    currentVersionId: null,
    version: 0,
    createdBy: ACTOR,
    createdAt: NOW,
    updatedAt: NOW,
    finalizedAt: null,
    finalizedBy: null,
    recycledAt: null,
    recycledBy: null,
    recycledFromStatus: null,
    purgeAfter: null,
    ...overrides,
  };
}

function makeSessionRow(overrides: Partial<UploadSessionRow> = {}): UploadSessionRow {
  return {
    id: SESSION,
    fileId: FILE,
    intent: "version",
    status: "active",
    objectKey: STAGING_KEY,
    storageUploadId: null,
    partSizeBytes: 8 * MI_B,
    totalParts: 2,
    sizeBytes: 12 * MI_B,
    contentHash: null,
    mime: null,
    changePayload: null,
    createdBy: ACTOR,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 24 * 3_600_000),
    completedAt: null,
    abortedAt: null,
    ...overrides,
  };
}

function makeVersionRow(overrides: Partial<FileVersionRow> = {}): FileVersionRow {
  return {
    id: VERSION,
    fileId: FILE,
    seq: 1,
    objectKey: CONTRACT_KEY,
    sizeBytes: 12 * MI_B,
    contentHash: HASH,
    mime: null,
    uploadedBy: ACTOR,
    uploadedAt: NOW,
    changeRequestId: null,
    ...overrides,
  };
}

function part(partNumber: number, sizeBytes: number): UploadedPart {
  return { partNumber, sizeBytes, etag: "\"etag-" + partNumber + "\"", lastModified: NOW };
}

/** 仓储替身：只记录调用并返回预置行（类型经 as unknown as FileRepository 桥接）。 */
class FakeFileRepository {
  project: FileProjectBriefRow | null = { id: PROJECT, status: "active", deletedAt: null };
  node: FileNodeBriefRow | null = { id: NODE, projectId: PROJECT, deletedAt: null };
  task: FileTaskBriefRow | null = { id: TASK, projectId: PROJECT };
  file: FileRow | null = makeFileRow();
  session: UploadSessionRow | null = makeSessionRow();
  duplicate: DuplicateFileRow | null = null;
  expiredRows: (UploadSessionRow & { projectId: string })[] = [];
  /** 锁会话时抛错（验证过期清理「单条失败不阻断」）。 */
  failLockFor: string | null = null;
  /** 首次探测位次（copy 前）；默认 1。 */
  nextSeqBase = 1;
  /** true 时模拟「copy 之后、事务内复核之前」被并发完成抢了位次。 */
  seqDriftOnLock = false;

  insertedFiles: FileInsertInput[] = [];
  insertedSessions: UploadSessionInsertInput[] = [];
  insertedVersions: FileVersionInsertInput[] = [];
  sessionPatches: { id: string; patch: UploadSessionPatch }[] = [];
  duplicateQueries: { projectId: string; contentHash: string; excludeFileId: string }[] = [];
  lockSessionCalls = 0;

  async findProjectBrief(): Promise<FileProjectBriefRow | null> {
    return this.project;
  }

  async findNodeBrief(): Promise<FileNodeBriefRow | null> {
    return this.node;
  }

  async findTaskBrief(): Promise<FileTaskBriefRow | null> {
    return this.task;
  }

  async insertFile(input: FileInsertInput): Promise<FileRow> {
    this.insertedFiles.push(input);
    const row = makeFileRow({
      projectId: input.projectId,
      nodeId: input.nodeId,
      taskId: input.taskId,
      docType: input.docType,
      name: input.name,
      status: input.status,
      createdBy: input.createdBy,
      version: 0,
      currentVersionId: null,
    });
    this.file = row;
    return row;
  }

  async insertSession(input: UploadSessionInsertInput): Promise<UploadSessionRow> {
    this.insertedSessions.push(input);
    const row = makeSessionRow({
      id: input.id,
      fileId: input.fileId,
      intent: input.intent,
      objectKey: input.objectKey,
      partSizeBytes: input.partSizeBytes,
      totalParts: input.totalParts,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      mime: input.mime,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      expiresAt: input.expiresAt,
    });
    this.session = row;
    return row;
  }

  async findDuplicateByHash(projectId: string, contentHash: string, excludeFileId: string): Promise<DuplicateFileRow | null> {
    this.duplicateQueries.push({ projectId, contentHash, excludeFileId });
    return this.duplicate;
  }

  async findFileById(fileId: string): Promise<FileRow | null> {
    return this.file !== null && this.file.id === fileId ? this.file : null;
  }

  async findSessionById(sessionId: string): Promise<UploadSessionRow | null> {
    return this.session !== null && this.session.id === sessionId ? this.session : null;
  }

  /** 会话查找：先看当前会话，再看批量过期列表（过期清理场景）。 */
  private sessionById(sessionId: string): UploadSessionRow | null {
    if (this.session !== null && this.session.id === sessionId) return this.session;
    return this.expiredRows.find((row) => row.id === sessionId) ?? null;
  }

  async lockSession(_tx: unknown, sessionId: string): Promise<UploadSessionRow | null> {
    this.lockSessionCalls += 1;
    if (this.failLockFor === sessionId) throw new Error("fake: lockSession 失败");
    return this.sessionById(sessionId);
  }

  async updateSession(sessionId: string, patch: UploadSessionPatch): Promise<UploadSessionRow> {
    this.sessionPatches.push({ id: sessionId, patch });
    const current = this.sessionById(sessionId);
    if (current === null) throw new Error("fake: 会话不存在");
    const next = { ...current, ...patch } as UploadSessionRow;
    if (this.session !== null && this.session.id === sessionId) {
      this.session = next;
    } else {
      this.expiredRows = this.expiredRows.map((row) => (row.id === sessionId ? { ...next, projectId: row.projectId } : row));
    }
    return next;
  }

  async lockFile(): Promise<FileRow | null> {
    return this.file;
  }

  async updateFileOnComplete(fileId: string, patch: FileCompletePatch): Promise<FileRow> {
    if (this.file === null) throw new Error("fake: 文件不存在");
    this.file = { ...this.file, id: fileId, currentVersionId: patch.currentVersionId, version: patch.version, updatedAt: patch.updatedAt };
    return this.file;
  }

  async nextVersionSeq(_fileId: string, client?: unknown): Promise<number> {
    if (client === undefined) return this.nextSeqBase;
    return this.nextSeqBase + (this.seqDriftOnLock ? 1 : 0);
  }

  async insertVersion(input: FileVersionInsertInput): Promise<FileVersionRow> {
    this.insertedVersions.push(input);
    return makeVersionRow({
      fileId: input.fileId,
      seq: input.seq,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      mime: input.mime,
      uploadedBy: input.uploadedBy,
      uploadedAt: input.uploadedAt,
    });
  }

  async listExpiredActiveSessions(): Promise<(UploadSessionRow & { projectId: string })[]> {
    return this.expiredRows;
  }
}

/** 对象存储替身：断言「键形态」「调用顺序」「按版本清理」。 */
class FakeObjectStorage extends ObjectStorage {
  readonly bucket = "test-bucket";
  parts: UploadedPart[] = [];
  head: ObjectHead | null = null;
  listError: Error | null = null;

  created: CreateMultipartUploadInput[] = [];
  signed: PartUploadUrlInput[] = [];
  listed: MultipartUploadKeyInput[] = [];
  completed: CompleteMultipartUploadInput[] = [];
  aborted: MultipartUploadKeyInput[] = [];
  copied: CopyObjectInput[] = [];
  purged: string[] = [];

  async createMultipartUpload(input: CreateMultipartUploadInput): Promise<MultipartUploadRef> {
    this.created.push(input);
    return { objectKey: input.objectKey, uploadId: "storage-1" };
  }

  async signPartUploadUrl(input: PartUploadUrlInput): Promise<SignedUrl> {
    this.signed.push(input);
    return { url: "https://s3.test/" + input.objectKey + "?partNumber=" + input.partNumber, expiresAt: new Date(NOW.getTime() + 900_000) };
  }

  async listParts(input: MultipartUploadKeyInput): Promise<UploadedPart[]> {
    this.listed.push(input);
    if (this.listError !== null) throw this.listError;
    return this.parts;
  }

  async completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<{ etag: string | null }> {
    this.completed.push(input);
    return { etag: "\"merged-etag\"" };
  }

  async abortMultipartUpload(input: MultipartUploadKeyInput): Promise<void> {
    this.aborted.push(input);
  }

  async headObject(objectKey: string): Promise<ObjectHead | null> {
    if (this.head === null) return null;
    return { ...this.head, objectKey };
  }

  async signDownloadUrl(input: DownloadUrlInput): Promise<SignedUrl> {
    return { url: "https://s3.test/" + input.objectKey, expiresAt: new Date(NOW.getTime() + 300_000) };
  }

  async purgeObject(objectKey: string): Promise<PurgeObjectResult> {
    this.purged.push(objectKey);
    return { deletedVersions: 1, deleteMarkers: 0 };
  }

  async copyObject(input: CopyObjectInput): Promise<CopyObjectResult> {
    this.copied.push(input);
    return { etag: "\"copy-etag\"", versionId: null };
  }

  async probe(): Promise<void> {}
}

class FakePermissionService {
  visible = true;
  canUpload = true;

  async assertProjectVisible(_actorId: string, projectId: string): Promise<{ projectId: string; member: boolean; projectManager: boolean }> {
    if (!this.visible) throw new Error("fake: 项目不可见");
    return { projectId, member: true, projectManager: false };
  }

  async assertCan(): Promise<void> {
    if (!this.canUpload) throw new Error("fake: 无权限");
  }
}

class FakeAuditService {
  entries: unknown[] = [];
  async record(_client: unknown, input: unknown): Promise<void> {
    this.entries.push(input);
  }
}

class FakeDatabase {
  outbox: unknown[] = [];
  db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(this.makeTx()),
  };
  makeTx() {
    return {
      insert: () => ({
        values: async (value: unknown) => {
          this.outbox.push(value);
        },
      }),
    };
  }
}

interface Harness {
  service: FileService;
  repo: FakeFileRepository;
  storage: FakeObjectStorage;
  permission: FakePermissionService;
  audit: FakeAuditService;
  database: FakeDatabase;
  clock: ClockService;
}

function makeService(env: Partial<Env> = {}): Harness {
  const repo = new FakeFileRepository();
  const storage = new FakeObjectStorage();
  const permission = new FakePermissionService();
  const audit = new FakeAuditService();
  const database = new FakeDatabase();
  const clock = new ClockService();
  clock.setSource(() => NOW);
  const config = new AppConfig({ ...ENV, ...env } as Env);
  const service = new FileService(
    database as unknown as DatabaseService,
    repo as unknown as FileRepository,
    storage,
    permission as unknown as PermissionService,
    audit as unknown as AuditService,
    config,
    clock,
  );
  return { service, repo, storage, permission, audit, database, clock };
}

describe("FileService.createUpload（M4-01 发起上传）", () => {
  it("发起上传：建 draft 文件 + 暂存键会话，返回分片计划与会话视图", async () => {
    const h = makeService();
    const result = await h.service.createUpload(
      { projectId: PROJECT, name: "机械设计图纸.pdf", sizeBytes: 12 * MI_B, mime: "application/pdf", intent: "version" },
      ACTOR,
    );

    expect(result.file.status).toBe("draft");
    expect(result.file.version).toBe(0);
    expect(result.file.createdBy).toBe(ACTOR);
    expect(result.upload.intent).toBe("version");
    expect(result.upload.status).toBe("active");
    expect(result.upload.partSizeBytes).toBe(8 * MI_B);
    expect(result.upload.totalParts).toBe(2);
    expect(result.upload.createdAt).toBe(NOW.toISOString());
    expect(result.upload.expiresAt).toBe(new Date(NOW.getTime() + 24 * 3_600_000).toISOString());
    expect(result.duplicateHint).toBeNull();

    // 会话先写暂存键（ADR-006）：…/staging/{sessionId}（sessionId 由服务端生成）
    const inserted = h.repo.insertedSessions[0]!;
    expect(inserted.objectKey).toBe(`projects/${PROJECT}/files/${FILE}/staging/${inserted.id}`);
    expect(inserted.id).toBe(result.upload.id);
    expect(inserted.expiresAt).toEqual(new Date(NOW.getTime() + 24 * 3_600_000));
    expect(h.repo.insertedFiles[0]!.status).toBe("draft");
    // init 未给哈希 → 不查秒传提示
    expect(h.repo.duplicateQueries).toHaveLength(0);
    // 审计：一条 create（objectType=file，metadata 带 uploadId）
    expect(h.audit.entries).toHaveLength(1);
    expect(h.audit.entries[0]).toMatchObject({ action: "create", objectType: "file", objectId: FILE });
  });

  it("带 contentHash：命中同项目既有内容 → 回秒传提示（不阻断）", async () => {
    const h = makeService();
    h.repo.duplicate = {
      fileId: OTHER_FILE,
      name: "机械设计图纸-v1.pdf",
      sizeBytes: 12 * MI_B,
      uploadedBy: OTHER_ACTOR,
      uploadedAt: new Date("2026-09-10T02:00:00Z"),
    };
    const result = await h.service.createUpload(
      { projectId: PROJECT, name: "机械设计图纸.pdf", sizeBytes: 12 * MI_B, contentHash: HASH.toUpperCase(), intent: "version" },
      ACTOR,
    );

    expect(result.duplicateHint).toEqual({
      fileId: OTHER_FILE,
      name: "机械设计图纸-v1.pdf",
      sizeBytes: 12 * MI_B,
      uploadedBy: OTHER_ACTOR,
      uploadedAt: "2026-09-10T02:00:00.000Z",
    });
    // 哈希统一小写后落会话与查询
    expect(h.repo.insertedSessions[0]!.contentHash).toBe(HASH);
    expect(h.repo.duplicateQueries[0]).toMatchObject({ projectId: PROJECT, contentHash: HASH, excludeFileId: FILE });
  });

  it("intent=change → 400（契约上传入口没有 fileId，随 M4-04 落地前直接拒绝）", async () => {
    const h = makeService();
    await expect(
      h.service.createUpload(
        { projectId: PROJECT, name: "变更.pdf", sizeBytes: MI_B, intent: "change", change: { reason: "设计变更" } },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 400 });
    expect(h.repo.insertedSessions).toHaveLength(0);
  });

  it("超过 UPLOAD_MAX_SIZE_MB → 400 VALIDATION_FAILED（details 带 limitBytes）", async () => {
    const h = makeService({ UPLOAD_MAX_SIZE_MB: 1 } as Partial<Env>);
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "大文件.zip", sizeBytes: 2 * MI_B, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 400,
      details: [{ code: "too_large", path: "sizeBytes", meta: { limitBytes: MI_B } }],
    });
    expect(h.repo.insertedFiles).toHaveLength(0);
  });

  it("项目已归档 → 409 PROJECT_ARCHIVED；项目不存在 → 404", async () => {
    const h = makeService();
    h.repo.project = { id: PROJECT, status: "archived", deletedAt: null };
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED", httpStatus: 409 });

    h.repo.project = null;
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("nodeId / taskId 跨项目 → 400（防挂接到别的项目）", async () => {
    const h = makeService();
    h.repo.node = { id: NODE, projectId: OTHER_PROJECT, deletedAt: null };
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, nodeId: NODE, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: [{ code: "invalid_node", path: "nodeId" }] });

    h.repo.node = { id: NODE, projectId: PROJECT, deletedAt: new Date("2026-09-01T00:00:00Z") };
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, nodeId: NODE, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    h.repo.node = { id: NODE, projectId: PROJECT, deletedAt: null };
    h.repo.task = { id: TASK, projectId: OTHER_PROJECT };
    await expect(
      h.service.createUpload({ projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, taskId: TASK, intent: "version" }, ACTOR),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: [{ code: "invalid_task", path: "taskId" }] });
  });

  it("同项目 nodeId / taskId → 允许（随文件落库）", async () => {
    const h = makeService();
    const result = await h.service.createUpload(
      { projectId: PROJECT, name: "图纸.pdf", sizeBytes: MI_B, nodeId: NODE, taskId: TASK, docType: "CAD图纸", intent: "version" },
      ACTOR,
    );
    expect(result.file.nodeId).toBe(NODE);
    expect(result.file.taskId).toBe(TASK);
    expect(result.file.docType).toBe("CAD图纸");
  });
});

describe("FileService.signParts（分片预签名 / 断点续传）", () => {
  it("首次取分片 URL：登记存储侧 UploadId（行锁下只建一次）", async () => {
    const h = makeService();
    const result = await h.service.signParts(FILE, SESSION, { partNumbers: [1, 2] }, ACTOR);

    expect(h.storage.created).toHaveLength(1);
    expect(h.storage.created[0]!.objectKey).toBe(STAGING_KEY);
    expect(h.repo.sessionPatches[0]!.patch.storageUploadId).toBe("storage-1");
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(result.partSizeBytes).toBe(8 * MI_B);
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 24 * 3_600_000).toISOString());
    expect(h.storage.signed.map((p) => p.partNumber)).toEqual([1, 2]);
  });

  it("已有存储侧 UploadId → 直接签名，不重复建会话", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-9" });
    const result = await h.service.signParts(FILE, SESSION, { partNumbers: [2] }, ACTOR);

    expect(h.storage.created).toHaveLength(0);
    expect(h.storage.signed[0]).toMatchObject({ uploadId: "storage-9", partNumber: 2 });
    expect(result.parts).toHaveLength(1);
  });

  it("分片号超出会话范围 → 400（不触存储）", async () => {
    const h = makeService();
    await expect(h.service.signParts(FILE, SESSION, { partNumbers: [3] }, ACTOR)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 400,
      details: [{ code: "out_of_range", path: "partNumbers" }],
    });
    expect(h.storage.created).toHaveLength(0);
  });

  it("会话过期：惰性置 expired + 清暂存，回 410", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", expiresAt: new Date(NOW.getTime() - 1) });
    await expect(h.service.signParts(FILE, SESSION, { partNumbers: [1] }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      httpStatus: 410,
    });

    expect(h.storage.aborted).toHaveLength(1);
    expect(h.storage.purged).toEqual([STAGING_KEY]);
    expect(h.repo.sessionPatches.at(-1)!.patch.status).toBe("expired");
    expect(h.audit.entries.at(-1)).toMatchObject({ actorId: null, objectType: "file", objectId: FILE, metadata: { uploadId: SESSION } });
  });

  it("会话已中止 → 410；会话不属于该文件 → 404", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ status: "aborted" });
    await expect(h.service.signParts(FILE, SESSION, { partNumbers: [1] }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      httpStatus: 410,
    });

    h.repo.session = makeSessionRow({ fileId: OTHER_FILE });
    await expect(h.service.signParts(FILE, SESSION, { partNumbers: [1] }, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("FileService.getUpload（会话状态 / 续传依据）", () => {
  it("按 ListParts 回已传与缺失分片", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", totalParts: 4 });
    h.storage.parts = [part(1, 8 * MI_B), part(3, 8 * MI_B)];
    const view = await h.service.getUpload(FILE, SESSION, ACTOR);

    expect(view.uploadedPartNumbers).toEqual([1, 3]);
    expect(view.missingPartNumbers).toEqual([2, 4]);
    expect(view.status).toBe("active");
  });

  it("尚未建存储侧会话 → 已传为空、缺失全部（不触存储）", async () => {
    const h = makeService();
    const view = await h.service.getUpload(FILE, SESSION, ACTOR);
    expect(view.uploadedPartNumbers).toEqual([]);
    expect(view.missingPartNumbers).toEqual([1, 2]);
    expect(h.storage.listed).toHaveLength(0);
  });

  it("会话过期 → 409 FILE_STATE_INVALID（惰性清理）", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", expiresAt: new Date(NOW.getTime() - 1) });
    await expect(h.service.getUpload(FILE, SESSION, ACTOR)).rejects.toMatchObject({
      code: "FILE_STATE_INVALID",
      httpStatus: 409,
    });
    expect(h.repo.sessionPatches.at(-1)!.patch.status).toBe("expired");
    expect(h.storage.purged).toEqual([STAGING_KEY]);
  });

  it("已完成的会话 → 409（不可续传）", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ status: "completed", completedAt: NOW });
    await expect(h.service.getUpload(FILE, SESSION, ACTOR)).rejects.toMatchObject({
      code: "FILE_STATE_INVALID",
      httpStatus: 409,
    });
  });
});

describe("FileService.completeUpload（合并 / 复制到契约键 / 落版本）", () => {
  function readyHarness(): Harness {
    const h = makeService();
    h.repo.file = makeFileRow();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", contentHash: HASH, mime: "application/pdf" });
    h.storage.parts = [part(1, 8 * MI_B), part(2, 4 * MI_B)];
    h.storage.head = { objectKey: STAGING_KEY, sizeBytes: 12 * MI_B, etag: "\"merged-etag\"", contentType: "application/pdf", lastModified: NOW };
    return h;
  }

  it("成功：合并 → HEAD 校验 → 复制契约键 → 写版本 / 文件 / 会话 + 审计 + outbox → 清暂存", async () => {
    const h = readyHarness();
    const result = await h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR);

    // 合并按编号升序提交
    expect(h.storage.completed[0]!.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    // 键形态：暂存键 → 契约键
    expect(h.storage.copied[0]).toMatchObject({ sourceKey: STAGING_KEY, destinationKey: CONTRACT_KEY, contentType: "application/pdf" });
    expect(h.storage.purged).toEqual([STAGING_KEY]);

    const version = h.repo.insertedVersions[0]!;
    expect(version.objectKey).toBe(CONTRACT_KEY);
    expect(version.seq).toBe(1);
    expect(version.sizeBytes).toBe(12 * MI_B);
    expect(version.contentHash).toBe(HASH);

    expect(result.file.currentVersionId).toBe(VERSION);
    expect(result.file.version).toBe(1);
    expect(result.version.seq).toBe(1);
    expect(result.changeRequest).toBeNull();

    expect(h.repo.sessionPatches.at(-1)!.patch.status).toBe("completed");
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: "complete",
      objectType: "file",
      objectId: FILE,
      metadata: { uploadId: SESSION, versionSeq: 1, objectKey: CONTRACT_KEY, duplicateOf: null },
    });
    expect(h.database.outbox).toHaveLength(1);
    expect(h.database.outbox[0]).toMatchObject({ topic: "file.version.created", dedupeKey: "file.version.created:" + VERSION, status: "pending" });
  });

  it("分片未齐 → 409 UPLOAD_INCOMPLETE（details 带缺失分片；不合并）", async () => {
    const h = readyHarness();
    h.storage.parts = [part(1, 8 * MI_B)];
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      httpStatus: 409,
      details: [{ code: "missing_parts", meta: { missing: [2] } }],
    });
    expect(h.storage.completed).toHaveLength(0);
    expect(h.repo.insertedVersions).toHaveLength(0);
  });

  it("尚未上传任何分片 → 409 UPLOAD_INCOMPLETE（缺失全部）", async () => {
    const h = readyHarness();
    h.repo.session = makeSessionRow({ storageUploadId: null });
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      httpStatus: 409,
      details: [{ code: "missing_parts", meta: { missing: [1, 2] } }],
    });
    expect(h.storage.listed).toHaveLength(0);
  });

  it("合并后大小与声明不一致 → 409 UPLOAD_INCOMPLETE（size_mismatch）", async () => {
    const h = readyHarness();
    h.storage.head = { objectKey: STAGING_KEY, sizeBytes: 11 * MI_B, etag: null, contentType: null, lastModified: NOW };
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      httpStatus: 409,
      details: [{ code: "size_mismatch", path: "sizeBytes" }],
    });
    expect(h.storage.copied).toHaveLength(0);
    expect(h.repo.insertedVersions).toHaveLength(0);
  });

  it("合并结果在存储侧不存在 → 409 UPLOAD_INCOMPLETE", async () => {
    const h = readyHarness();
    h.storage.head = null;
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      httpStatus: 409,
    });
    expect(h.storage.copied).toHaveLength(0);
  });

  it("哈希与发起时声明不一致 → 422 FILE_HASH_MISMATCH（不复制、不落库）", async () => {
    const h = readyHarness();
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: OTHER_HASH }, ACTOR)).rejects.toMatchObject({
      code: "FILE_HASH_MISMATCH",
      httpStatus: 422,
      details: [{ code: "hash_mismatch", path: "contentHash" }],
    });
    expect(h.storage.copied).toHaveLength(0);
    expect(h.repo.insertedVersions).toHaveLength(0);
  });

  it("init 未给哈希 → complete 的哈希即为准（大小校验仍生效）", async () => {
    const h = readyHarness();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", contentHash: null });
    const result = await h.service.completeUpload(FILE, SESSION, { contentHash: OTHER_HASH.toUpperCase() }, ACTOR);
    expect(result.version.contentHash).toBe(OTHER_HASH);
    expect(h.storage.copied[0]!.destinationKey).toBe(`projects/${PROJECT}/files/${FILE}/v1/${OTHER_HASH}.pdf`);
  });

  it("会话过期 → 410（先惰性清理）", async () => {
    const h = readyHarness();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1", expiresAt: new Date(NOW.getTime() - 1) });
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      httpStatus: 410,
    });
    expect(h.storage.completed).toHaveLength(0);
  });

  it("存储侧会话已不存在（ListParts 报错）→ 410 UPLOAD_SESSION_EXPIRED", async () => {
    const h = readyHarness();
    h.storage.listError = new StorageError("upload_not_found", "NoSuchUpload");
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "UPLOAD_SESSION_EXPIRED",
      httpStatus: 410,
    });
  });

  it("copy 后位次被并发完成抢占 → 500 INTERNAL（不写半份版本）", async () => {
    const h = readyHarness();
    h.repo.seqDriftOnLock = true;
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "INTERNAL",
      httpStatus: 500,
    });
    expect(h.repo.insertedVersions).toHaveLength(0);
    expect(h.database.outbox).toHaveLength(0);
  });

  it("copyObject 存储失败 → 映射为契约错误（不落库）", async () => {
    const h = readyHarness();
    h.storage.copyObject = async () => {
      throw new StorageError("unavailable", "S3 不可用");
    };
    await expect(h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR)).rejects.toMatchObject({
      code: "INTERNAL",
      httpStatus: 500,
    });
    expect(h.repo.insertedVersions).toHaveLength(0);
  });

  it("暂存清理失败只告警：版本已落库，complete 仍成功", async () => {
    const h = readyHarness();
    h.storage.purgeObject = async () => {
      throw new Error("purge 失败");
    };
    const result = await h.service.completeUpload(FILE, SESSION, { contentHash: HASH }, ACTOR);
    expect(result.version.seq).toBe(1);
    expect(h.repo.insertedVersions).toHaveLength(1);
  });
});

describe("FileService.abortUpload（取消上传）", () => {
  it("取消：中止分片 + 清暂存 + 置 aborted + 审计（幂等返回）", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ storageUploadId: "storage-1" });
    const result = await h.service.abortUpload(FILE, SESSION, ACTOR);

    expect(result.upload.status).toBe("aborted");
    expect(h.storage.aborted[0]).toMatchObject({ objectKey: STAGING_KEY, uploadId: "storage-1" });
    expect(h.storage.purged).toEqual([STAGING_KEY]);
    expect(h.repo.sessionPatches.at(-1)!.patch).toMatchObject({ status: "aborted", abortedAt: NOW });
    expect(h.audit.entries.at(-1)).toMatchObject({ action: "delete", objectType: "file", objectId: FILE, metadata: { uploadId: SESSION } });
  });

  it("重复取消（已 aborted / 已 expired）→ 幂等返回，不重复清存储", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ status: "aborted" });
    const result = await h.service.abortUpload(FILE, SESSION, ACTOR);
    expect(result.upload.status).toBe("aborted");
    expect(h.storage.aborted).toHaveLength(0);
    expect(h.storage.purged).toHaveLength(0);
  });

  it("已完成的上传 → 409（回退走版本回溯 M4-02）", async () => {
    const h = makeService();
    h.repo.session = makeSessionRow({ status: "completed", completedAt: NOW });
    await expect(h.service.abortUpload(FILE, SESSION, ACTOR)).rejects.toMatchObject({
      code: "FILE_STATE_INVALID",
      httpStatus: 409,
    });
    expect(h.storage.purged).toHaveLength(0);
  });
});

describe("FileService.sweepExpiredSessions（worker 定时清理）", () => {
  const EXPIRED_A = "77777777-7777-4777-8777-777777777777";
  const EXPIRED_B = "88888888-8888-4888-8888-888888888888";

  function expiredRow(id: string, overrides: Partial<UploadSessionRow> = {}): UploadSessionRow & { projectId: string } {
    return {
      ...makeSessionRow({
        id,
        objectKey: `projects/${PROJECT}/files/${FILE}/staging/${id}`,
        storageUploadId: null,
        status: "active",
        expiresAt: new Date(NOW.getTime() - 60_000),
        ...overrides,
      }),
      projectId: PROJECT,
    };
  }

  it("逐条清理过期会话：中止分片 + 清暂存 + 置 expired，返回扫描 / 清理计数", async () => {
    const h = makeService();
    const rowA = expiredRow(EXPIRED_A, { storageUploadId: "storage-1" });
    const rowB = expiredRow(EXPIRED_B);
    h.repo.expiredRows = [rowA, rowB];
    const result = await h.service.sweepExpiredSessions();

    expect(result).toEqual({ scanned: 2, expired: 2 });
    expect(h.storage.aborted).toHaveLength(1);
    expect(h.storage.purged).toEqual([rowA.objectKey, rowB.objectKey]);
    expect(h.repo.sessionPatches.filter((p) => p.patch.status === "expired")).toHaveLength(2);
    expect(h.audit.entries).toHaveLength(2);
  });

  it("单条失败不阻断后续（只记告警）", async () => {
    const h = makeService();
    h.repo.failLockFor = EXPIRED_A;
    h.repo.expiredRows = [expiredRow(EXPIRED_A), expiredRow(EXPIRED_B)];
    const result = await h.service.sweepExpiredSessions();
    expect(result.scanned).toBe(2);
    expect(result.expired).toBe(1);
  });
});