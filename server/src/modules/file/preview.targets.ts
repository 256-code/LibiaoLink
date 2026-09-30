import { extensionOf } from "../../storage/index.js";
import type { PreviewTarget } from "./preview.job.js";

/**
 * 预览通道判定（S3 起两段口径：转换产物通道 + ONLYOFFICE 查看器通道 · ADR-030 / S8-2 定案）。
 *
 * - **产物通道**（`previewTargetsFor`）：只投 / 只走「转换管线真能出产物」的通道 —— 图片 → `image`（直通）、
 *   PDF → `pdf`（源直通）；`structured` 一期 501 不投（缓存键 / 枚举保留，随二期结构化渲染启用）。
 *   Office / 文本族自 S3 起**不再投递转换任务**（改由 ONLYOFFICE 查看器承接、无转换产物 ——
 *   就绪以 `FilePreviewResponse.viewer` 判定、不占 `target`）。判不出类型不投：读取侧按确定性降级「请下载」。
 * - **查看器通道**（`viewerChannelFor`）：Office（含宏变体 docm / xlsm / pptm）+ 文本族（txt / csv / html / htm）
 *   → ONLYOFFICE 文档大类（word / cell / slide）+ 文件类型（扩展名小写；无扩展名时按 MIME 反推）——
 *   查看器配置 `documentType` / `document.fileType` 的输入（S8-2 三补 1：文本族按 word / cell 映射）。
 *
 * 判定优先级与历史口径一致：图片 / PDF（扩展名或 MIME）优先，其余才进查看器族。
 * 分类只影响「谁被提前转换 / 谁直接进查看器」；转换器自身的通道判定（扩展名 + `x-source-mime`）不变 ——
 * 两侧口径不一致时转换器返回 415 / 422，按确定性失败降级，不会产出错产物。
 */

/** 图片族：浏览器直接渲染；矢量 SVG 也归 image 通道（ADR-007：枚举按渲染通道而非格式定义）。 */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "svg"]);

/**
 * 产物通道映射：图片 → image、PDF → pdf、其余不投（Office / 文本族走查看器通道）。
 */
export function previewTargetsFor(input: { fileName: string; mime: string | null }): readonly PreviewTarget[] {
  const extension = extensionOf(input.fileName);
  const mime = (input.mime ?? "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
    return ["image"];
  }
  if (extension === "pdf" || mime === "application/pdf") {
    return ["pdf"];
  }
  return [];
}

/** 查看器通道输出：ONLYOFFICE documentType / document.fileType 的判定输入。 */
export interface ViewerChannel {
  documentType: "word" | "cell" | "slide";
  fileType: string;
}

/** 扩展名 → 查看器文档大类（文本族口径：txt / html / htm 按 word，csv 按 cell —— S8-2 三补 1）。 */
const VIEWER_EXTENSION_TYPES: Record<string, ViewerChannel> = {
  doc: { documentType: "word", fileType: "doc" },
  docx: { documentType: "word", fileType: "docx" },
  docm: { documentType: "word", fileType: "docm" },
  odt: { documentType: "word", fileType: "odt" },
  rtf: { documentType: "word", fileType: "rtf" },
  txt: { documentType: "word", fileType: "txt" },
  html: { documentType: "word", fileType: "html" },
  htm: { documentType: "word", fileType: "htm" },
  xls: { documentType: "cell", fileType: "xls" },
  xlsx: { documentType: "cell", fileType: "xlsx" },
  xlsm: { documentType: "cell", fileType: "xlsm" },
  ods: { documentType: "cell", fileType: "ods" },
  csv: { documentType: "cell", fileType: "csv" },
  ppt: { documentType: "slide", fileType: "ppt" },
  pptx: { documentType: "slide", fileType: "pptx" },
  pptm: { documentType: "slide", fileType: "pptm" },
  odp: { documentType: "slide", fileType: "odp" },
};

/** MIME → 查看器通道（无扩展名 / 扩展名判不出时的反推；宏变体 MIME 以 DocServer 实际注册的小写形态比对）。 */
const VIEWER_MIME_TYPES: readonly { mime: string; channel: ViewerChannel }[] = [
  { mime: "application/msword", channel: { documentType: "word", fileType: "doc" } },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    channel: { documentType: "word", fileType: "docx" },
  },
  { mime: "application/vnd.ms-word.document.macroenabled.12", channel: { documentType: "word", fileType: "docm" } },
  { mime: "application/vnd.oasis.opendocument.text", channel: { documentType: "word", fileType: "odt" } },
  { mime: "application/rtf", channel: { documentType: "word", fileType: "rtf" } },
  { mime: "text/plain", channel: { documentType: "word", fileType: "txt" } },
  { mime: "text/html", channel: { documentType: "word", fileType: "html" } },
  { mime: "application/vnd.ms-excel", channel: { documentType: "cell", fileType: "xls" } },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    channel: { documentType: "cell", fileType: "xlsx" },
  },
  { mime: "application/vnd.ms-excel.sheet.macroenabled.12", channel: { documentType: "cell", fileType: "xlsm" } },
  { mime: "application/vnd.oasis.opendocument.spreadsheet", channel: { documentType: "cell", fileType: "ods" } },
  { mime: "text/csv", channel: { documentType: "cell", fileType: "csv" } },
  { mime: "application/vnd.ms-powerpoint", channel: { documentType: "slide", fileType: "ppt" } },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    channel: { documentType: "slide", fileType: "pptx" },
  },
  {
    mime: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    channel: { documentType: "slide", fileType: "pptm" },
  },
  { mime: "application/vnd.oasis.opendocument.presentation", channel: { documentType: "slide", fileType: "odp" } },
];

/**
 * 查看器通道判定（S3 · ADR-030）：Office / 文本族 → `{ documentType, fileType }`；其余 null（含图片 / PDF ——
 * 它们先经 `previewTargetsFor` 走产物通道）。扩展名优先、MIME 兜底（与历史判定优先级一致）。
 */
export function viewerChannelFor(input: { fileName: string; mime: string | null }): ViewerChannel | null {
  const byExtension = VIEWER_EXTENSION_TYPES[extensionOf(input.fileName)];
  if (byExtension !== undefined) {
    return { ...byExtension };
  }
  const mime = (input.mime ?? "").toLowerCase();
  const byMime = VIEWER_MIME_TYPES.find((item) => item.mime === mime);
  return byMime === undefined ? null : { ...byMime.channel };
}
