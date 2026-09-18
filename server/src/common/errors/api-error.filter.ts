import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { HTTP_STATUS_BY_ERROR_CODE, z, type ApiError, type ErrorCode, type ErrorDetail } from "@libiaolink/contracts";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { AppError } from "./app-error.js";

const CODE_BY_HTTP_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
};

/** 全局异常过滤器：所有非 2xx 响应体收敛为契约包 ApiError 信封。 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<{ id?: unknown; method?: string; url?: string }>();
    const traceId =
      typeof request.id === "string" && request.id.length > 0 ? request.id : randomUUID();
    const envelope = this.toEnvelope(exception, traceId);

    if (envelope.status >= 500) {
      this.logger.error(
        (request.method ?? "-") + " " + (request.url ?? "-") + " -> " + envelope.status,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(envelope.status).json(envelope.body);
  }

  private toEnvelope(exception: unknown, traceId: string): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      const status = exception.httpStatus >= 400 ? exception.httpStatus : 500;
      return {
        status,
        body: { code: exception.code, message: exception.message, details: exception.details, traceId },
      };
    }
    if (exception instanceof z.ZodError) {
      return {
        status: 400,
        body: { code: "VALIDATION_FAILED", message: "参数校验失败", details: toDetails(exception), traceId },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code: CODE_BY_HTTP_STATUS[status] ?? "INTERNAL",
          message: this.messageOf(exception),
          details: [],
          traceId,
        },
      };
    }
    return { status: 500, body: { code: "INTERNAL", message: "服务器内部错误", details: [], traceId } };
  }

  private messageOf(exception: HttpException): string {
    const payload = exception.getResponse();
    if (typeof payload === "string") return payload;
    if (typeof payload === "object" && payload !== null) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === "string") return message;
      if (Array.isArray(message)) {
        return message.filter((item): item is string => typeof item === "string").join("；");
      }
    }
    return exception.message;
  }
}

export function toDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.join(".") || undefined,
  }));
}
