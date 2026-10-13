/** 导出报告英文译文通道 —— 业务口径 2026-10-10（「项目进展描述……需要翻译」；方案与实测见 `前端功能需求.md` §6.16 ⑭/⑮/⑯）。
 *
 * 契约：POST /api/v1/translate
 *   入参 { q: string, source: "zh", target: "en", format: "text" }
 *   出参 { translatedText: string }
 * （形态对齐内网 LibreTranslate 的 /translate —— 开发环境由 Vite 代理直连 127.0.0.1:5005
 *  （见 vite.config.ts 的 TRANSLATE_ORIGIN，服务本体见 deploy/libretranslate/）；
 *  生产环境由后端 server/ 按同一契约实现代理 + 缓存。）
 *
 * 容错（重要）：本模块**从不抛错** —— 任何一条拿不到译文就跳过（返回表里没有该条），
 * 调用方（导出流程）保持中文原文照出：通道不可用不影响导出的可用性。
 *
 * 「写进展描述即后台翻译」（业务口径 2026-10-13「当前项目总览导出翻译需要等待时间 我们现在换一种方式
 * 当用户写项目进展描述时直接后台翻译」，§6.16 ㉑）：会话级译文缓存 + 后台预热 ——
 * 页面数据一到 / 每次写入回写就把「项目名 + 全部非空进展描述」丢进 prefetchZhToEn
 * （去重、跳过已缓存 / 在途 / 刚失败过的，限并发静默跑）；导出时 translateZhToEn 命中缓存即取，
 * 只有没预热到的条目才现场翻（行为与原来一致），常用路径下导出不再等机器翻译。
 */

/** 常见缩写词（全大写译文规整时保留原样；Argos 小模型偶发整句大写，实测 2026-10-10）。 */
const KEEP_UPPER = new Set([
  "WCS", "AGV", "AMR", "PDF", "API", "URL", "ID", "IT", "OK",
  "QC", "QA", "WMS", "GPS", "AI", "UI", "IP", "PLC", "ERP", "MES", "SKU",
]);

/** 译文规整：去多余空白；整句全大写（小模型偶发）时转句首大写，保留常见缩写与带数字词元。 */
export function normalizeEnglish(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4 || letters !== letters.toUpperCase()) {
    return trimmed;
  }
  let atStart = true;
  const out: string[] = [];
  for (const token of trimmed.split(/(\s+)/)) {
    if (token === "") {
      continue;
    }
    if (/^\s+$/.test(token)) {
      out.push(token);
      continue;
    }
    if (!/[A-Za-z]/.test(token)) {
      out.push(token);
      if (/[.!?]$/.test(token)) {
        atStart = true;
      }
      continue;
    }
    let word: string;
    if (/\d/.test(token) || KEEP_UPPER.has(token.toUpperCase())) {
      word = token.toUpperCase();
    } else {
      word = token.toLowerCase();
      if (atStart) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
      }
    }
    out.push(word);
    atStart = /[.!?]$/.test(word);
  }
  return out.join("");
}

/** 并发上限：单条服务 + 导出场景（去重后个位数）小并发即可，同时防批量导入时打满请求。 */
const MAX_CONCURRENCY = 4;

/** 会话级译文缓存上限（Map 插入序淘汰最老一条）：防长会话里无限攒；进展描述一般几十条量级，600 条足够宽松。 */
const CACHE_LIMIT = 600;

/** 预热失败后的静默退避（毫秒）：通道不可用时，别让每次页面数据刷新都重打一遍失败请求；导出路径不受退避限制（用户正等着）。 */
const PREFETCH_RETRY_MS = 60000;

/** 会话级「原文 → 英文」缓存（同一 SPA 会话内跨页面共用）：写进展描述时预热、导出直接命中。 */
const translationCache = new Map<string, string>();

/** 在途请求（原文 → 同一个 Promise）：预热与导出同时要同一条时只打一次机器翻译。 */
const inFlight = new Map<string, Promise<string | null>>();

/** 预热失败时间（原文 → 时间戳）：退避窗口内不再为它发起预热。 */
const failedAt = new Map<string, number>();

/** 去重 + 去空（缓存键与请求体都用原文整串，与导出查表口径一致）。 */
function uniqueTexts(texts: readonly string[]): string[] {
  return Array.from(new Set(texts.filter((text) => text.trim() !== "")));
}

/** 写缓存（顺带清失败标记；超限时按插入序丢最老一条）。 */
function cachePut(source: string, translated: string): void {
  failedAt.delete(source);
  translationCache.delete(source);
  translationCache.set(source, translated);
  while (translationCache.size > CACHE_LIMIT) {
    const oldest = translationCache.keys().next();
    if (oldest.done) {
      break;
    }
    translationCache.delete(oldest.value);
  }
}

/** 逐条翻译（POST /api/v1/translate），失败返回 null（不抛错；由 translateOneShared 统一记退避 / 写缓存）。 */
async function translateOne(text: string): Promise<string | null> {
  try {
    const response = await fetch("/api/v1/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "zh", target: "en", format: "text" }),
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    const translatedText =
      typeof data === "object" && data !== null ? (data as { translatedText?: unknown }).translatedText : undefined;
    if (typeof translatedText !== "string") {
      return null;
    }
    const normalized = normalizeEnglish(translatedText);
    return normalized === "" ? null : normalized;
  } catch {
    return null;
  }
}

/** 同一原文共用一次在途请求（预热与导出并发时只打一条机器翻译）；成功后写缓存、失败记退避时间。 */
function translateOneShared(text: string): Promise<string | null> {
  const existing = inFlight.get(text);
  if (existing !== undefined) {
    return existing;
  }
  const task = (async () => {
    try {
      const translated = await translateOne(text);
      if (translated === null) {
        failedAt.set(text, Date.now());
        return null;
      }
      cachePut(text, translated);
      return translated;
    } finally {
      inFlight.delete(text);
    }
  })();
  inFlight.set(text, task);
  return task;
}

/**
 * 后台预热（「写进展描述即后台翻译」· §6.16 ㉑）：把一批中文文本静默翻好放进会话缓存 —— 不等待、不抛错。
 * 已缓存 / 在途 / 退避窗口内失败过的条目直接跳过（失败不弹提示；导出时仍按原行为现场重试、静默降级）。
 */
export function prefetchZhToEn(texts: readonly string[]): void {
  const now = Date.now();
  const queue = uniqueTexts(texts).filter(
    (text) => !translationCache.has(text) && !inFlight.has(text) && (failedAt.get(text) ?? 0) + PREFETCH_RETRY_MS <= now,
  );
  if (queue.length === 0) {
    return;
  }
  let cursor = 0;
  void Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const at = cursor;
        cursor += 1;
        await translateOneShared(queue[at]);
      }
    }),
  );
}

/** 会话缓存直取（不打请求）：给「抽屉打开即显示译文」这类场景用；没命中返回 null（调用方再走 translateZhToEn）。 */
export function cachedZhToEn(text: string): string | null {
  return translationCache.get(text) ?? null;
}

/** 把一批中文文本翻成英文（会话缓存优先 + 缺的现场翻：去重 + 限并发 + 逐条容错）；返回「原文 → 英文」映射
 * （含命中缓存的条目），失败 / 拿不到译文的条目不在表里。
 * onProgress(done, total)：命中缓存的条目一开始即计入 done、未缓存的每完成一条回报一次（含失败条目）——
 * 导出等待浮层用它显示「项目进展描述翻译中 + 预计需要 XX 秒」（§6.16 ⑳，见 components/ExportProgressOverlay.tsx）。 */
export async function translateZhToEn(
  texts: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ReadonlyMap<string, string>> {
  const unique = uniqueTexts(texts);
  const missing = unique.filter((text) => !translationCache.has(text));
  let done = unique.length - missing.length;
  onProgress?.(done, unique.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, missing.length) }, async () => {
    while (cursor < missing.length) {
      const at = cursor;
      cursor += 1;
      await translateOneShared(missing[at]);
      done += 1;
      onProgress?.(done, unique.length);
    }
  });
  await Promise.all(workers);
  const results = new Map<string, string>();
  for (const text of unique) {
    const hit = translationCache.get(text);
    if (hit !== undefined) {
      results.set(text, hit);
    }
  }
  return results;
}
