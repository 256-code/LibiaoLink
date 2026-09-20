/**
 * 审计写入出口（越权 / 未命中留痕，C7-03）：接口定义在 common，实现由 admin 模块提供
 * （AppModule 以 AUDIT_SINK 绑定），避免 common → modules 的反向依赖；
 * 全局异常过滤器（ApiErrorFilter）据此在 403 / 项目域 404 时补写审计行。
 */
export interface DeniedAuditInput {
  actorId: string;
  actorName: string | null;
  objectType: string;
  objectId: string;
  projectId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface AuditSink {
  /** 追加一条「越权 / 未命中」审计（result=denied，action=deny）。实现方自行吞错（审计失败不影响响应）。 */
  recordDenied(input: DeniedAuditInput): Promise<void>;
}

/** DI 令牌：AppModule 里绑定到 admin 的 AuditService（useExisting）。 */
export const AUDIT_SINK = "libiaolink:audit-sink";
