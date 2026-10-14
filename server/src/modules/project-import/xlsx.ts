import { inflateRawSync } from "node:zlib";
import { AppError } from "../../common/errors/app-error.js";

/**
 * xlsx 读取（老表导入）：xlsx = ZIP 容器（workbook.xml / sheetN.xml / sharedStrings.xml / media/*）。
 * 本文件只做「读」：中央目录定位 + 惰性 inflate（60 MB 级老表、150+ 内嵌图也能应付），
 * 不引第三方库（服务端此前没有任何 Excel 依赖；解析口径与 D:/LibiaoLink_help/_conv/legacy-convert.mjs 一致）。
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** ZIP 归档（只读）：按名取原始字节，deflate 惰性解压并缓存。 */
export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();
  private readonly cache = new Map<string, Buffer>();

  private constructor(private readonly bytes: Buffer) {}

  static open(bytes: Buffer): ZipArchive {
    const archive = new ZipArchive(bytes);
    archive.readCentralDirectory();
    return archive;
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer | null {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(name);
    if (entry === undefined) return null;
    const raw = this.bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    let data: Buffer;
    if (entry.method === 0) {
      data = Buffer.from(raw);
    } else if (entry.method === 8) {
      data = inflateRawSync(raw);
    } else {
      throw new AppError("IMPORT_PARSE_FAILED", "不支持的压缩方式（zip method " + entry.method + "）：" + entry.name);
    }
    this.cache.set(name, data);
    return data;
  }

  /** 读取 UTF-8 文本（xml）。 */
  readText(name: string): string | null {
    const data = this.read(name);
    return data === null ? null : data.toString("utf8");
  }

  private readCentralDirectory(): void {
    const eocd = this.findEndOfCentralDirectory();
    const count = this.bytes.readUInt16LE(eocd + 10);
    let cursor = this.bytes.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i += 1) {
      if (this.bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;
      const method = this.bytes.readUInt16LE(cursor + 10);
      const compressedSize = this.bytes.readUInt32LE(cursor + 20);
      const uncompressedSize = this.bytes.readUInt32LE(cursor + 24);
      const nameLength = this.bytes.readUInt16LE(cursor + 28);
      const extraLength = this.bytes.readUInt16LE(cursor + 30);
      const commentLength = this.bytes.readUInt16LE(cursor + 32);
      const localOffset = this.bytes.readUInt32LE(cursor + 42);
      const name = this.bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      const localNameLength = this.bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = this.bytes.readUInt16LE(localOffset + 28);
      this.entries.set(name, {
        name,
        method,
        compressedSize,
        uncompressedSize,
        dataOffset: localOffset + 30 + localNameLength + localExtraLength,
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (this.entries.size === 0) {
      throw new AppError("IMPORT_PARSE_FAILED", "文件不是有效的 xlsx（zip 中央目录为空）");
    }
  }

  private findEndOfCentralDirectory(): number {
    const start = Math.max(0, this.bytes.length - 22 - 65535);
    for (let i = this.bytes.length - 22; i >= start; i -= 1) {
      if (this.bytes.readUInt32LE(i) === EOCD_SIGNATURE) return i;
    }
    throw new AppError("IMPORT_PARSE_FAILED", "文件不是有效的 xlsx（缺少 zip 结束记录）");
  }
}

export interface SheetGrid {
  name: string;
  path: string;
  /** 行 x 列网格；空单元格 = null。 */
  rows: (string | null)[][];
}

/** 表内图片锚点（1 based 行 / 列；sheet = 工作表名，media = xl/media 下文件名）。 */
export interface SheetImageAnchor {
  sheet: string;
  row: number;
  col: number;
  media: string;
}

export interface ParsedWorkbook {
  sheets: SheetGrid[];
  anchors: SheetImageAnchor[];
  readMedia(name: string): Buffer | null;
}

function between(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start + open.length);
  if (end < 0) return null;
  return text.slice(start + open.length, end);
}

function unescapeXml(text: string): string {
  return text
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&quot;").join(String.fromCharCode(34))
    .split("&apos;").join(String.fromCharCode(39))
    .split("&amp;").join("&");
}

function parseRelationships(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const quote = String.fromCharCode(34);
  for (const piece of xml.split("<Relationship ").slice(1)) {
    const id = between(piece, "Id=" + quote, quote);
    const target = between(piece, "Target=" + quote, quote);
    if (id !== null && target !== null) map.set(id, target);
  }
  return map;
}

function resolvePath(basePath: string, target: string): string {
  const parts = basePath.split("/");
  parts.pop();
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function colIndex(letters: string): number {
  let value = 0;
  for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value - 1;
}

function splitCellRef(ref: string): { letters: string; row: number } {
  let end = 0;
  while (end < ref.length) {
    const code = ref.charCodeAt(end);
    if (code < 65 || code > 90) break;
    end += 1;
  }
  const letters = end === 0 ? "A" : ref.slice(0, end);
  const row = Number(ref.slice(end)) - 1;
  return { letters, row };
}

/** 内联字符串 / 富文本：拼接所有 <t> 文本。 */
function inlineText(chunk: string): string {
  let text = "";
  let from = 0;
  while (true) {
    const open = chunk.indexOf("<t", from);
    if (open < 0) break;
    const gt = chunk.indexOf(">", open);
    if (gt < 0) break;
    const close = chunk.indexOf("</t>", gt);
    if (close < 0) break;
    text += unescapeXml(chunk.slice(gt + 1, close));
    from = close + 4;
  }
  return text;
}

function readSharedStrings(zip: ZipArchive): string[] {
  const xml = zip.readText("xl/sharedStrings.xml");
  if (xml === null) return [];
  const list: string[] = [];
  for (const piece of xml.split("<si>").slice(1)) {
    list.push(inlineText(piece));
  }
  return list;
}

function readSheetGrid(zip: ZipArchive, name: string, path: string, shared: string[]): SheetGrid {
  const xml = zip.readText(path);
  if (xml === null) return { name, path, rows: [] };
  const quote = String.fromCharCode(34);
  const grid: (string | null)[][] = [];
  for (const chunk of xml.split("<c ").slice(1)) {
    const endOfOpen = chunk.indexOf(">");
    if (endOfOpen < 0) continue;
    const attrs = chunk.slice(0, endOfOpen);
    const close = chunk.indexOf("</c>");
    const inner = close >= 0 && endOfOpen < close ? chunk.slice(endOfOpen + 1, close) : "";
    const ref = between(attrs, "r=" + quote, quote);
    if (ref === null) continue;
    const typeAttr = between(attrs, " t=" + quote, quote);
    let value: string | null = null;
    const valueIndex = inner.indexOf("<v>");
    if (valueIndex >= 0) {
      const valueEnd = inner.indexOf("</v>", valueIndex);
      value = inner.slice(valueIndex + 3, valueEnd >= 0 ? valueEnd : inner.length);
    } else if (inner.indexOf("<t") >= 0) {
      value = inlineText(inner);
    }
    if (value === null) continue;
    let text = value;
    if (typeAttr === "s") {
      const index = Number(value);
      text = shared[index] === undefined ? "" : shared[index];
    }
    const parsed = splitCellRef(ref);
    if (!Number.isFinite(parsed.row) || parsed.row < 0) continue;
    const rowCol = colIndex(parsed.letters);
    if (rowCol < 0) continue;
    let target = grid[parsed.row];
    if (target === undefined) {
      target = [];
      grid[parsed.row] = target;
    }
    target[rowCol] = text;
  }
  const rows: (string | null)[][] = [];
  let maxCol = 0;
  for (const row of grid) if (row !== undefined) maxCol = Math.max(maxCol, row.length);
  for (let r = 0; r < grid.length; r += 1) {
    const source = grid[r];
    const row: (string | null)[] = [];
    for (let c = 0; c < maxCol; c += 1) {
      const value = source === undefined ? undefined : source[c];
      row.push(value === undefined ? null : value);
    }
    rows.push(row);
  }
  return { name, path, rows };
}

function readAnchors(zip: ZipArchive, sheets: SheetGrid[]): SheetImageAnchor[] {
  const anchors: SheetImageAnchor[] = [];
  const quote = String.fromCharCode(34);
  for (const sheet of sheets) {
    const base = sheet.path.split("/").pop() ?? "";
    const relsPath = sheet.path.slice(0, sheet.path.length - base.length) + "_rels/" + base + ".rels";
    const relsXml = zip.readText(relsPath);
    if (relsXml === null) continue;
    const rels = parseRelationships(relsXml);
    let drawingPath: string | null = null;
    for (const target of rels.values()) {
      if (target.includes("drawing")) {
        drawingPath = target.startsWith("/") ? target.slice(1) : resolvePath(sheet.path, target);
      }
    }
    if (drawingPath === null) continue;
    const drawingXml = zip.readText(drawingPath);
    if (drawingXml === null) continue;
    const drawingBase = drawingPath.split("/").pop() ?? "";
    const drawingRelsPath = drawingPath.slice(0, drawingPath.length - drawingBase.length) + "_rels/" + drawingBase + ".rels";
    const drawingRelsXml = zip.readText(drawingRelsPath);
    const drawingRels = drawingRelsXml === null ? new Map<string, string>() : parseRelationships(drawingRelsXml);
    const normalized = drawingXml
      .split("<xdr:twoCellAnchor>").join("<xdr:oneCellAnchor>")
      .split("<xdr:absoluteAnchor>").join("<xdr:oneCellAnchor>");
    for (const piece of normalized.split("<xdr:oneCellAnchor").slice(1)) {
      const colText = between(piece, "<xdr:col>", "</xdr:col>");
      const rowText = between(piece, "<xdr:row>", "</xdr:row>");
      const embedIndex = piece.indexOf("r:embed=");
      if (colText === null || rowText === null || embedIndex < 0) continue;
      const embed = between(piece.slice(embedIndex), "r:embed=" + quote, quote);
      if (embed === null) continue;
      const mediaPath = drawingRels.get(embed);
      if (mediaPath === undefined) continue;
      const media = mediaPath.split("/").pop();
      if (media === undefined || media === "") continue;
      anchors.push({ sheet: sheet.name, row: Number(rowText) + 1, col: Number(colText) + 1, media });
    }
  }
  return anchors;
}

/** 解析老表工作簿：全部工作表（文本网格）+ 图片锚点 + media 读取器。 */
export function parseWorkbook(bytes: Buffer): ParsedWorkbook {
  const zip = ZipArchive.open(bytes);
  const workbookXml = zip.readText("xl/workbook.xml");
  const workbookRelsXml = zip.readText("xl/_rels/workbook.xml.rels");
  if (workbookXml === null || workbookRelsXml === null) {
    throw new AppError("IMPORT_PARSE_FAILED", "文件不是有效的 xlsx（缺少 workbook.xml）");
  }
  const quote = String.fromCharCode(34);
  const rels = parseRelationships(workbookRelsXml);
  const shared = readSharedStrings(zip);
  const sheets: SheetGrid[] = [];
  for (const piece of workbookXml.split("<sheet ").slice(1)) {
    const name = between(piece, "name=" + quote, quote);
    const rid = between(piece, "r:id=" + quote, quote);
    if (name === null || rid === null) continue;
    const target = rels.get(rid);
    if (target === undefined) continue;
    const path = target.startsWith("/") ? target.slice(1) : resolvePath("xl/workbook.xml", target);
    if (zip.has(path)) sheets.push(readSheetGrid(zip, name, path, shared));
  }
  if (sheets.length === 0) {
    throw new AppError("IMPORT_PARSE_FAILED", "工作簿里没有可读的工作表");
  }
  return {
    sheets,
    anchors: readAnchors(zip, sheets),
    readMedia: (name: string) => zip.read("xl/media/" + name),
  };
}
