import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { AppConfig } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import type { DatabaseService } from "../src/db/database.service.js";
import type { AuditService } from "../src/modules/admin/index.js";
import { FileDownloadService } from "../src/modules/file/file-download.service.js";
import type { FileRepository, FileRow, FileVersionRow } from "../src/modules/file/file.repository.js";
import type { PermissionService } from "../src/modules/permission/index.js";
import type { DownloadUrlInput, ObjectStorage, SignedUrl } from "../src/storage/index.js";

/**
 * M4-05f 下载切片门禁（不连库、不连对象存储）：`GET /files/{id}/versions/{versionId}/download-url`。
 * ① 成功 —— 短时签名（attachment 语义：**传 fileName**；窗口 = `S3_DOWNLOAD_URL_TTL_SECONDS`）+ 一条 download 审计；
 * ② A4-06 —— 任意历史版本可下载（按该版本对象键与体积）；
 * ③ 权限 —— 项目可见（404）之上再判 `file.download`（403）；不可见优先 404（不因缺权限暴露存在性）；
 * ④ 先签名后审计 —— 签名失败不写审计；404 / 403 一律不签名不审计。
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const VERSION = "66666666-6666-4666-8666-666666666666";
const HISTORY = "88888888-8888-4888-8888-888888888888";
const ACTOR = "ea6eff88-4b3e-4df1-9ce0-02ffb14fed69";
const HASH = "a".repeat(64);
const HASH_HISTORY = "b".repeat(64);
const NOW = new Date("2026-09-24T02:00:00Z");
const OBJECT_KEY = "projects/" + PROJECT + "/files/" + FILE + "/v2/" + HASH + ".pdf";
const OBJECT_KEY_HISTORY = "projects/" + PROJECT + "/files/" + FILE + "/v1/" + HASH_HISTORY + ".pdf";

const ENV = { S3_DOWNLOAD_URL_TTL_SECONDS: 300 } as unknown as Env;

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
    seq: 2,
    objectKey: OBJECT_KEY,
    sizeBytes: 12 * 1024 * 1024,
    contentHash: HASH,
    mime: "application/pdf",
    uploadedBy: ACTOR,
    uploadedAt: NOW,
    changeRequestId: null,
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

class FakeStorage {
  readonly signed: DownloadUrlInput[] = [];
  expiresAt = new Date("2026-09-24T02:05:00Z");
  fail = false;

  async signDownloadUrl(input: DownloadUrlInput): Promise<SignedUrl> {
    this.signed.push(input);
    if (this.fail) {
      throw new AppError("INTERNAL", "对象存储暂不可用，请稍后重试");
    }
    return { url: "https://minio.local/" + input.objectKey + "?sig=1", expiresAt: this.expiresAt };
  }
}

class FakePermissionService {
  visible = true;
  canDownload = true;
  readonly checked: string[] = [];

  async assertProjectVisible(
    _actorId: string,
    projectId: string,
  ): Promise<{ projectId: string; member: boolean; projectManager: boolean }> {
    if (!this.visible) {
      throw new AppError("NOT_FOUND", "项目不存在或不可见");
    }
    return { projectId, member: true, projectManager: false };
  }

  async assertCan(_actorId: string, key: string, _context?: unknown, message?: string): Promise<void> {
    this.checked.push(key);
    if (!this.canDownload) {
      throw new AppError("FORBIDDEN", message ?? "无权限：" + key);
    }
  }
}

class FakeAuditService {
  readonly entries: Record<string, unknown>[] = [];

  async record(_client: unknown, input: Record<string, unknown>): Promise<void> {
    this.entries.push(input);
  }
}

class FakeDatabase {
  db = {};
}

interface Harness {
  service: FileDownloadService;
  repo: FakeFileRepository;
  storage: FakeStorage;
  permission: FakePermissionService;
  audit: FakeAuditService;
}

function makeService(env: Partial<Env> = {}): Harness {
  const repo = new FakeFileRepository();
  const storage = new FakeStorage();
  const permission = new FakePermissionService();
  const audit = new FakeAuditService();
  const database = new FakeDatabase();
  const config = new AppConfig({ ...ENV, ...env } as Env);
  const service = new FileDownloadService(
    database as unknown as DatabaseService,
    repo as unknown as FileRepository,
    storage as unknown as ObjectStorage,
    permission as unknown as PermissionService,
    audit as unknown as AuditService,
    config,
  );
  return { service, repo, storage, permission, audit };
}

describe("FileDownloadService.getDownloadUrl（M4-05f 下载切片）", () => {
  it("成功（当前指定版本）：附件语义签名 + 响应四字段 + 写一条 download 审计", async () => {
    const h = makeService();

    const result = await h.service.getDownloadUrl(FILE, VERSION, ACTOR);

    expect(result).toEqual({
      url: "https://minio.local/" + OBJECT_KEY + "?sig=1",
      fileName: "机械设计图纸.pdf",
      sizeBytes: 12 * 1024 * 1024,
      expiresAt: "2026-09-24T02:05:00.000Z",
    });
    expect(h.audit.entries).toHaveLength(1);
    expect(h.audit.entries[0]).toMatchObject({
      actorId: ACTOR,
      action: "download",
      objectType: "file",
      objectId: FILE,
      projectId: PROJECT,
      metadata: { versionId: VERSION },
    });
    expect(h.audit.entries[0]!.summary).toContain("机械设计图纸.pdf");
    expect(h.audit.entries[0]!.summary).toContain("v2");
  });

  it("签名参数：objectKey = 该版本对象键、fileName = 原名（attachment）、窗口 = S3_DOWNLOAD_URL_TTL_SECONDS", async () => {
    const h = makeService({ S3_DOWNLOAD_URL_TTL_SECONDS: 120 });

    await h.service.getDownloadUrl(FILE, VERSION, ACTOR);

    expect(h.storage.signed).toEqual([{ objectKey: OBJECT_KEY, fileName: "机械设计图纸.pdf", expiresInSeconds: 120 }]);
    expect(h.permission.checked).toEqual(["file.download"]);
  });

  it("A4-06 历史版本：按该版本对象键与体积签名，审计记该 versionId（不串版本）", async () => {
    const h = makeService();
    h.repo.versions.set(HISTORY, makeVersionRow({ id: HISTORY, seq: 1, objectKey: OBJECT_KEY_HISTORY, sizeBytes: 3 * 1024 * 1024, contentHash: HASH_HISTORY }));

    const result = await h.service.getDownloadUrl(FILE, HISTORY, ACTOR);

    expect(h.storage.signed[0]).toMatchObject({ objectKey: OBJECT_KEY_HISTORY });
    expect(result).toMatchObject({ sizeBytes: 3 * 1024 * 1024 });
    expect(h.audit.entries[0]).toMatchObject({ metadata: { versionId: HISTORY } });
  });

  it("先签名后审计：签名失败上抛且不写审计（地址没签发就不算一次下载）", async () => {
    const h = makeService();
    h.storage.fail = true;

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toThrow("对象存储暂不可用");
    expect(h.audit.entries).toHaveLength(0);
  });

  it("文件不存在 → 404（不签名不审计）", async () => {
    const h = makeService();
    h.repo.file = null;

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("项目不可见 → 404（不签名不审计）", async () => {
    const h = makeService();
    h.permission.visible = false;

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("可见但缺 file.download → 403（A4-10；不签名不审计）", async () => {
    const h = makeService();
    h.permission.canDownload = false;

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("不可见 + 缺权限 → 404 优先（不因缺权限暴露资源存在性，ADR-011 不变量 3）", async () => {
    const h = makeService();
    h.permission.visible = false;
    h.permission.canDownload = false;

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.permission.checked).toEqual([]);
  });

  it("versionId 不属于该文件 / 不存在 → 404（不签名不审计）", async () => {
    const h = makeService();
    h.repo.versions.delete(VERSION);

    await expect(h.service.getDownloadUrl(FILE, VERSION, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.storage.signed).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
  });
});