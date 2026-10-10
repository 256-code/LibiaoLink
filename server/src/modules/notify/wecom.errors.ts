/**
 * 企微失败分类（M5-03-1 · S8-1）：错误码 → 三分类（permanent / retryable / rate_limited）+ token 特例（token_invalid）。
 *
 * 口径来源：docs/M5-03-实施方案(企微通道).md §五 失败模型（wecom_app / wecom_group 场景表 +
 *   处置三分类）、shared/src/modules/notifications.ts NOTIFY_CHANNELS 描述（群机器人「限速 20 条每分钟」）。
 *
 * 处置对照（实现侧消费 · M5-03-2 / M5-03-3 接线）：
 *   permanent → dead + 降级（C5-04）+ 留痕 + 告警
 *   retryable → 退避重试（有界；到顶转 dead + 降级）
 *   rate_limited → 延期重排（排队下一窗口，**不消耗重试次数**）
 *   token_invalid → token 失效特例：客户端内失效重取一次；重取后仍失效 → 调用方按配置类处置
 *
 * 错误码集合为**初始集**：以官方文档 + M5-03-4 真机实测最终锁定（应用消息与 webhook 错误码集合不同）；
 * 锁定后本表即唯一分类口径。未收录 errcode 一律按 retryable 兜底（有界重试，不误杀）。
 */

export const WECOM_CHANNELS = ["wecom_app", "wecom_group"] as const;
export type WecomChannel = (typeof WECOM_CHANNELS)[number];

export type WecomFailureKind = "permanent" | "retryable" | "rate_limited" | "token_invalid";

/** 自建应用：access_token 失效 / 缺失（41001 缺失、40014 非法、42001 过期）—— 客户端会失效重取一次。 */
export const WECOM_APP_TOKEN_ERRCODES: readonly number[] = [40014, 41001, 42001];

/** 自建应用错误码分类（初始集 · M5-03-4 实测锁定）。 */
const APP_ERRCODE_KINDS: ReadonlyMap<number, WecomFailureKind> = new Map<number, WecomFailureKind>([
  [40001, "permanent"], // invalid appsecret（配置 / 部署问题）
  [40013, "permanent"], // invalid corpid
  [40056, "permanent"], // invalid agentid
  [41002, "permanent"], // missing corpid
  [41004, "permanent"], // missing appsecret
  [60011, "permanent"], // userid 不存在 / 离职 / 未激活 / 不在可见范围（一类）
  [45002, "permanent"], // 消息内容超字节上限 / 大小非法（B5 产出侧裁剪为主，投递层兜底拒绝）
  [45009, "rate_limited"], // 接口频率超限（接口调用超过限制）
  [-1, "retryable"], // 系统繁忙
]);

/** 群机器人（webhook）错误码分类（初始集 · M5-03-4 实测锁定）。 */
const GROUP_ERRCODE_KINDS: ReadonlyMap<number, WecomFailureKind> = new Map<number, WecomFailureKind>([
  [93000, "permanent"], // webhook 失效（key 重置 / 机器人被移出群 / 群解散或换群）
  [45009, "rate_limited"], // 单机器人 20 条/分钟
  [-1, "retryable"], // 系统繁忙
]);

const TOKEN_ERRCODE_SET = new Set<number>(WECOM_APP_TOKEN_ERRCODES);

/** errcode → 分类；未收录一律 retryable 兜底（有界重试；到顶转 dead + 告警）。 */
export function classifyWecomErrcode(channel: WecomChannel, errcode: number): WecomFailureKind {
  if (channel === "wecom_app" && TOKEN_ERRCODE_SET.has(errcode)) {
    return "token_invalid";
  }
  const table = channel === "wecom_app" ? APP_ERRCODE_KINDS : GROUP_ERRCODE_KINDS;
  return table.get(errcode) ?? "retryable";
}

/** HTTP 状态 → 分类（无合法 JSON 包体时的兜底）：429 / 5xx / 408 可恢复；其余 4xx 视为网关 / 配置类确定性失败。 */
export function classifyWecomHttpStatus(status: number): WecomFailureKind {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 408 || status >= 500) {
    return "retryable";
  }
  if (status >= 400) {
    return "permanent";
  }
  return "retryable";
}

/** 网络异常（超时 / 连接失败 / DNS / 中断）→ 统一 retryable；描述文本过掩码（key / secret / access_token 不回显）。 */
export function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const masked = error.message.replace(/(key|secret|access_token)=[^&\s]+/gi, "$1=***");
    return masked === "" ? error.name : error.name + ": " + masked;
  }
  return "unknown error";
}
