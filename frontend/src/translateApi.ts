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

/** 逐条翻译（POST /api/v1/translate），失败条目直接跳过（不抛错）。 */
async function translateOne(text: string): Promise<[string, string] | null> {
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
    return normalized === "" ? null : [text, normalized];
  } catch {
    return null;
  }
}

/** 把一批中文文本翻成英文（去重 + 限并发 + 逐条容错）；返回「原文 → 英文」映射，失败条目不在表里。
 * onProgress(done, total)：翻译进度回调（去重后每完成一条回报一次，含失败条目）—— 导出等待浮层用它显示
 * 「项目进展描述翻译中 + 预计需要 XX 秒」（§6.16 ⑳，见 components/ExportProgressOverlay.tsx）。 */
export async function translateZhToEn(
  texts: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ReadonlyMap<string, string>> {
  const unique = Array.from(new Set(texts.filter((text) => text.trim() !== "")));
  onProgress?.(0, unique.length);
  const results = new Map<string, string>();
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, unique.length) }, async () => {
    while (cursor < unique.length) {
      const at = cursor;
      cursor += 1;
      const hit = await translateOne(unique[at]);
      if (hit !== null) {
        results.set(hit[0], hit[1]);
      }
      done += 1;
      onProgress?.(done, unique.length);
    }
  });
  await Promise.all(workers);
  return results;
}
