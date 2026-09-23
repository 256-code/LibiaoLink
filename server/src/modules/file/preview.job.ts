import { PREVIEW_TARGETS } from "@libiaolink/contracts";

/**
 * 预览任务（outbox topic `preview.job`）的载荷与去重键（M4-05c · ADR-007）。
 *
 * 投递侧（定档预生成 P1 / 读取侧幂等补投）与消费侧（worker 领取器）共用这一份定义：
 * 去重键是「同一三元组只转一次」的一半，两端各拼一套字符串迟早会漂移。
 *
 * 三元组 = contentHash + pipelineVersion + target：
 * - 内容相同（跨文件 / 回溯 / 变更）→ 同一个任务、同一份产物（preview_artifacts 按三元组唯一）；
 * - 换管线版本（`PREVIEW_PIPELINE_VERSION` 递增）→ 新任务、新缓存键，旧产物自然失效（不放原地覆盖）。
 */
export const PREVIEW_JOB_TOPIC = "preview.job";

/** 渲染通道（与契约 `PREVIEW_TARGETS` 同值；本模块内不引 zod，避免把契约运行时拖进消费路径）。 */
export type PreviewTarget = (typeof PREVIEW_TARGETS)[number];

export interface PreviewJobInput {
  projectId: string;
  fileId: string;
  versionId: string;
  contentHash: string;
  target: PreviewTarget;
  /** 触发来源（只进日志 / 排障，不参与任何判定）：`finalize` 定档预生成 / `read` 读取侧补投。 */
  trigger: string;
}

/** 消费侧解析后的任务（payload 里的 contentHash 只作排障参照，缓存键以库内版本行的 contentHash 为准）。 */
export interface PreviewJob {
  projectId: string;
  fileId: string;
  versionId: string;
  target: PreviewTarget;
}

/** 去重键：三元组直接在键里 —— 同三元组只有一个任务，且任务生来就与缓存键对齐。 */
export function previewJobDedupeKey(input: {
  contentHash: string;
  pipelineVersion: string;
  target: PreviewTarget;
}): string {
  return (
    PREVIEW_JOB_TOPIC + ":" + input.contentHash.toLowerCase() + ":" + input.pipelineVersion + ":" + input.target
  );
}

export function buildPreviewJobPayload(input: PreviewJobInput): Record<string, unknown> {
  return {
    projectId: input.projectId,
    fileId: input.fileId,
    versionId: input.versionId,
    contentHash: input.contentHash.toLowerCase(),
    target: input.target,
    trigger: input.trigger,
  };
}

/** 载荷解析：字段缺失 / 类型不对 / 通道非法一律返回 null（消费侧按确定性失败处理，不猜、不兜底默认值）。 */
export function parsePreviewJob(payload: Record<string, unknown>): PreviewJob | null {
  const { projectId, fileId, versionId, target } = payload;
  if (typeof projectId !== "string" || projectId === "") return null;
  if (typeof fileId !== "string" || fileId === "") return null;
  if (typeof versionId !== "string" || versionId === "") return null;
  if (typeof target !== "string" || !PREVIEW_TARGETS.includes(target as PreviewTarget)) return null;
  return { projectId, fileId, versionId, target: target as PreviewTarget };
}