import { extensionOf } from "../../storage/index.js";
import type { PreviewTarget } from "./preview.job.js";

/**
 * 定档预生成（P1）投哪些渲染通道（ADR-007 通道矩阵 · 一期）。
 *
 * 只投「一期转换器真能出产物」的通道 —— 图片 → `image`（直通）；PDF / Office → `pdf`
 * （PDF 源直通、Office 走 soffice）；xlsx 按 ADR-007「一期未启用时走 pdf」投 `pdf`（`structured` 一期 501，
 * 投了只会拿到确定性失败）。判不出类型（如 `.exe`）不投：读取侧按 `not_ready` 走 D2-05 降级「请下载查看」，
 * 不占用转换配额、也不在表里留失败行。
 *
 * 分类只影响「谁被提前转换」：最终通道判定在转换器（以扩展名 + `x-source-mime` 为准）；
 * 两侧口径不一致时转换器返回 415 / 422，按确定性失败降级，不会产出错产物。
 */

/** 图片族：浏览器直接渲染；矢量 SVG 也归 image 通道（ADR-007：枚举按渲染通道而非格式定义）。 */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "svg"]);

/** Office / 文本族：soffice 转 PDF（xlsx / xls 一期同走 pdf）。 */
const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "txt",
  "csv",
  "html",
  "htm",
]);

const OFFICE_MIME_PREFIXES = [
  "application/msword",
  "application/vnd.ms-",
  "application/vnd.openxmlformats-",
  "application/vnd.oasis.opendocument",
  "application/rtf",
  "text/",
];

export function previewTargetsFor(input: { fileName: string; mime: string | null }): readonly PreviewTarget[] {
  const extension = extensionOf(input.fileName);
  const mime = (input.mime ?? "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension) || mime.startsWith("image/")) {
    return ["image"];
  }
  if (extension === "pdf" || mime === "application/pdf") {
    return ["pdf"];
  }
  if (OFFICE_EXTENSIONS.has(extension) || OFFICE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return ["pdf"];
  }
  return [];
}