import {
  Catch,
  HttpException,
  Inject,
  Logger,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { HTTP_STATUS_BY_ERROR_CODE, z, type ApiError, type ErrorCode, type ErrorDetail } from "@libiaolink/contracts";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { AUDIT_SINK, type AuditSink } from "../audit/audit-sink.js";
import { isUuidLike, objectRefOfUrl, shouldRecordDenied } from "../audit/audit-path.js";
import { AppError } from "./app-error.js";

const CODE_BY_HTTP_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
};

/** 请求侧需要的最小字段（会话守卫注入 actorId / user；common 层不 import 业务模块类型）。 */
type AuditableRequest = {
  id?: unknown;
  method?: string;
  url?: string;
  actorId?: string;
  user?: { displayName?: string };
};

/** 全局异常过滤器：所有非 2xx 响应体收敛为契约包 ApiError 信封；403 / 项目域 404 另写越权留痕（C7-03）。 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  constructor(@Optional() @Inject(AUDIT_SINK) private readonly auditSink?: AuditSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<AuditableRequest>();
    const traceId =
      typeof request.id === "string" && request.id.length > 0 ? request.id : randomUUID();
    const envelope = this.toEnvelope(exception, traceId);

    if (envelope.status >= 500) {
      this.logger.error(
        (request.method ?? "-") + " " + (request.url ?? "-") + " -> " + envelope.status,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    this.recordDenied(request, envelope.body, traceId);

    response.status(envelope.status).json(envelope.body);
  }

  /**
   * 越权 / 未命中留痕（C7-03）：403 全记；404 只记写请求与项目域路径（避免普通 404 噪声）。
   * 异步补写：AuditService.recordDenied 自行吞错 + 告警日志，不阻塞响应（告警推送随 M5 通知模块）。
   */
  private recordDenied(request: AuditableRequest, body: ApiError, traceId: string): void {
    if (this.auditSink === undefined) return;
    const actorId = request.actorId;
    if (actorId === undefined) return;
    const method = request.method ?? "";
    const url = request.url ?? "";
    if (!shouldRecordDenied(method, url, body.code)) return;
    const ref = objectRefOfUrl(url);
    if (ref === null) return;
    void this.auditSink.recordDenied({
      actorId,
      actorName: typeof request.user?.displayName === "string" ? request.user.displayName : null,
      objectType: ref.objectType,
      objectId: ref.objectId,
      projectId: ref.objectType === "project" && isUuidLike(ref.objectId) ? ref.objectId : null,
      summary: method + " " + url + " → " + body.code + "：" + body.message,
      metadata: { traceId, errorCode: body.code, method, url },
    });
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
