/**
 * 翻译服务（§6.16 ㉕ · Push 301）：手打内容英译的落库通路 —— 单条（库优先 + 引擎兜底）/ 批量查库 / 保存链路后台预热。
 *
 * 业务口径 2026-10-13：「现在点击切换由于项目数量多 翻译不过来会有很大延迟 所以我希望当因为手打内容为中文
 * 并且保存的时候 后台自动翻译 并且写入数据库 下次切换翻译的时候直接调用即可」。
 *
 *  - translate：先查译文库（content_translations），命中直出；未命中调内网引擎（HY-MT1.5-1.8B，
 *    env TRANSLATE_ORIGIN，默认 127.0.0.1:5008）后 upsert 落库 —— 之后任何端命中即读库直出。
 *  - lookup：批量只读查库（不调引擎）—— 英文界面切页一次请求拿整页已存译文。
 *  - warmup：保存链路（任务 / 项目控制器挂点）把新写入的手打中文文本丢进来，后台异步翻好落库；
 *    去重（同文本 5 分钟窗口）+ 限并发 2 + 从不抛错（失败静默，下次保存 / 页面到达再试）。
 *
 * 键口径：hash = sha256(q)，q = **原文**（Push 301 起所有通路统一 —— 前端读路径与保存链路预热同键）。
 * 术语保护 / 回换 / 规整内聚在服务端 translate.text.ts（原先在前端按占位符形态发引擎；保存链路预热
 * 不经过前端，保护必须挪到服务端才能保证「预热落库的译文」与「前端读库的键 / 质量」一致）。
 */
import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { TranslateLang } from "@libiaolink/contracts";
import { AppError } from "../../common/errors/app-error.js";
import { AppConfig } from "../../config/config.module.js";
import { TranslateRepository } from "./translate.repository.js";
import { finalizeTranslation, protectGlossary } from "./translate.text.js";

/** 译文库行的引擎标识（换引擎后按此列可批量重翻）。 */
export const TRANSLATE_ENGINE = "hy-mt-1.5-1.8b";

/** 预热去重窗口（毫秒）：同文本在此窗口内不重复排队。 */
const WARMUP_RECENT_TTL_MS = 300000;
/** 预热队列每次调用的条数硬顶（防大列表保存时内存失控）。 */
const WARMUP_MAX_PER_CALL = 300;
/** 预热并发（本地引擎单实例；2 并发足够且不打满）。 */
const WARMUP_CONCURRENCY = 2;
/** 中文痕迹（含 CJK 基本区即排队；纯英文 / 数字文本不翻）。 */
const CJK_PATTERN = /[\u4e00-\u9fff]/;

interface EngineHit { translatedText: string }

@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);
  /** 预热去重表（文本 → 最近排队时间）。 */
  private readonly warmupRecent = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly repository: TranslateRepository,
  ) {}

  /** 单条翻译（译文库优先；未命中调引擎后落库）。 */
  async translate(q: string, source: TranslateLang, target: TranslateLang): Promise<string> {
    const hash = hashOf(q);
    const hit = await this.repository.findByHash(source, target, hash);
    if (hit !== null && hit.translatedText !== "") {
      return hit.translatedText;
    }
    const translated = await this.callEngine(q, source, target);
    await this.repository.upsert({ sourceLang: source, targetLang: target, sourceHash: hash, sourceText: q, translatedText: translated, engine: TRANSLATE_ENGINE }, new Date());
    return translated;
  }

  /** 批量查库（只读，不调引擎）：按请求顺序返回命中条目。 */
  async lookup(qs: readonly string[], source: TranslateLang, target: TranslateLang): Promise<Array<{ q: string; translatedText: string }>> {
    const unique: string[] = [];
    const hashToText = new Map<string, string>();
    for (const q of qs) {
      const hash = hashOf(q);
      if (hashToText.has(hash)) {
        continue;
      }
      hashToText.set(hash, q);
      unique.push(hash);
    }
    const rows = await this.repository.findManyByHashes(source, target, unique);
    const textByHash = new Map(rows.map((row) => [row.sourceHash, row.translatedText]));
    const out: Array<{ q: string; translatedText: string }> = [];
    for (const hash of unique) {
      const translatedText = textByHash.get(hash);
      if (translatedText !== undefined && translatedText !== "") {
        out.push({ q: hashToText.get(hash) ?? "", translatedText });
      }
    }
    return out;
  }

  /**
   * 保存即后台翻译（业务口径）：把一批手打文本静默翻好落库 —— 不同步、不抛错、不阻塞保存响应。
   * 只排「非空 + 含中文痕迹 + 去重窗口外」的文本；已入库的条目在后台逐条跳过。
   */
  warmup(texts: readonly string[]): void {
    const now = Date.now();
    this.pruneWarmupRecent(now);
    const queue: string[] = [];
    for (const raw of texts) {
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text === "" || !CJK_PATTERN.test(text)) {
        continue;
      }
      if (this.warmupRecent.has(text)) {
        continue;
      }
      this.warmupRecent.set(text, now);
      queue.push(text);
      if (queue.length >= WARMUP_MAX_PER_CALL) {
        break;
      }
    }
    if (queue.length === 0) {
      return;
    }
    let cursor = 0;
    void Promise.all(
      Array.from({ length: Math.min(WARMUP_CONCURRENCY, queue.length) }, async () => {
        while (cursor < queue.length) {
          const at = cursor;
          cursor += 1;
          const text = queue[at];
          if (text === undefined) {
            return;
          }
          await this.warmupOne(text);
        }
      }),
    );
  }

  /** 单条预热：已入库跳过；未入库调引擎翻好落库；任何失败静默（下次再试）。 */
  private async warmupOne(text: string): Promise<void> {
    try {
      const hash = hashOf(text);
      const hit = await this.repository.findByHash("zh", "en", hash);
      if (hit !== null && hit.translatedText !== "") {
        return;
      }
      const translated = await this.callEngine(text, "zh", "en");
      await this.repository.upsert({ sourceLang: "zh", targetLang: "en", sourceHash: hash, sourceText: text, translatedText: translated, engine: TRANSLATE_ENGINE }, new Date());
    } catch (error) {
      this.logger.debug("warmup skipped: " + String(error instanceof Error ? error.message : error));
    }
  }

  /** 去重表瘦身（仅在超阈值时扫过期项）。 */
  private pruneWarmupRecent(now: number): void {
    if (this.warmupRecent.size <= 2000) {
      return;
    }
    for (const [key, at] of this.warmupRecent) {
      if (now - at > WARMUP_RECENT_TTL_MS) {
        this.warmupRecent.delete(key);
      }
    }
  }

  /**
   * 调内网引擎（契约同 /translate：{q, source, target, format} → {translatedText}）。失败一律 AppError INTERNAL。
   * 术语保护在服务端做：出引擎前占位符化（translate.text.ts），回包规整 + 回换后返回**最终英文**。
   */
  private async callEngine(q: string, source: TranslateLang, target: TranslateLang): Promise<string> {
    const { protectedText, tokens } = protectGlossary(q);
    let response: Response;
    try {
      response = await fetch(new URL("/translate", this.config.env.TRANSLATE_ORIGIN), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: protectedText, source, target, format: "text" }),
        signal: AbortSignal.timeout(this.config.env.TRANSLATE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError("INTERNAL", "翻译引擎不可用（" + (error instanceof Error ? error.message : String(error)) + "）");
    }
    if (!response.ok) {
      throw new AppError("INTERNAL", "翻译引擎返回 HTTP " + String(response.status));
    }
    const data = (await response.json().catch(() => null)) as EngineHit | null;
    const raw = data !== null && typeof data.translatedText === "string" ? data.translatedText : "";
    if (raw === "") {
      throw new AppError("INTERNAL", "翻译引擎响应缺少 translatedText");
    }
    const finalText = finalizeTranslation(raw, tokens);
    if (finalText === "") {
      throw new AppError("INTERNAL", "翻译引擎响应规整后为空");
    }
    return finalText;
  }
}

/** sha256 十六进制（译文库键）。 */
function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
