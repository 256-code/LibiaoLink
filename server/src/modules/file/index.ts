/** file 模块唯一公开出口（跨模块只允许 import 本文件）。 */
export { FileModule } from "./file.module.js";
export { FileService, EXPIRE_SWEEP_BATCH } from "./file.service.js";
export type { DuplicateFileRow, FileRow, FileVersionRow, UploadSessionRow } from "./file.repository.js";
