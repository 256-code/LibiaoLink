import { HTTP_STATUS_BY_ERROR_CODE, type ErrorCode, type ErrorDetail } from "@libiaolink/contracts";

/** 业务错误唯一构造入口：错误码来自契约包，HTTP 状态由映射表决定（技术设计v0.2 §7.2）。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[];
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.httpStatus = HTTP_STATUS_BY_ERROR_CODE[code];
  }
}
