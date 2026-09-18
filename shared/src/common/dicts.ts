import { z } from "../zod.ts";

/**
 * 字典与状态枚举（唯一来源）。
 * 与 技术设计v0.2-架构与数据模型.md §2.4 状态机 / §2.5 字典（C9）对应；
 * 地区 / 项目类型是数据字典（C9），不在契约中枚举，以字典接口与主数据校验为准。
 */

export const STAGE_KEYS = [
  "presale",
  "design",
  "purchase",
  "assembly",
  "install",
  "deploy",
  "trial",
  "production",
  "acceptance",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_NAMES: Record<StageKey, string> = {
  presale: "售前规划",
  design: "设计开发",
  purchase: "加工采购",
  assembly: "组装发货",
  install: "硬件实施",
  deploy: "软件部署",
  trial: "试运行",
  production: "生产阶段",
  acceptance: "验收",
};

export const StageKeySchema = z.enum(STAGE_KEYS).openapi("StageKey", {
  description: "九阶段字典（v0.2 §2.5：售前规划 / 设计开发 / 加工采购 / 组装发货 / 硬件实施 / 软件部署 / 试运行 / 生产阶段 / 验收）",
});

export const DOC_TYPES = [
  "CAD图纸",
  "技术协议",
  "合同",
  "评审单",
  "设备清单",
  "物料总清单",
  "发货装箱单",
  "到货单",
  "安装完成证明",
  "验收单",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DocTypeSchema = z.enum(DOC_TYPES).openapi("DocType", {
  description: "十类成果文件字典；门禁 required_doc 只能引用此字典（v0.2 §2.5）",
});

export const PRIORITY_VALUES = ["重要且紧急", "紧急但不重要", "重要不紧急", "不紧急不重要"] as const;

export const PrioritySchema = z.enum(PRIORITY_VALUES).openapi("Priority", {
  description: "紧急重要度四象限字典",
});

export const ProjectStatusSchema = z.enum(["active", "paused", "done", "archived"]).openapi("ProjectStatus", {
  description: "项目状态（projects.status）",
});

export const StageStatusSchema = z.enum(["pending", "active", "done"]).openapi("StageStatus", {
  description: "阶段状态（project_stages.status）",
});

export const NodeStatusSchema = z.enum(["pending", "active", "done", "deleted"]).openapi("NodeStatus", {
  description: "节点状态（project_nodes.status）；done 必须过门禁",
});

export const NodeOriginSchema = z.enum(["blueprint", "added_by_user"]).openapi("NodeOrigin", {
  description: "节点来源；一期增删仅限模板节点池",
});

export const TaskBaseStatusSchema = z.enum(["pending", "active", "done"]).openapi("TaskBaseStatus", {
  description: "任务存储基础态（不写回派生结果）",
});

export const TaskDisplayStatusSchema = z
  .enum(["pending", "active", "done", "overdue", "early_done"])
  .openapi("TaskDisplayStatus", {
    description:
      "任务展示五态（服务端派生）：待开始 / 进行中 / 已完成 / 已延期 / 提前完成；逾期标注落在 actualEnd",
  });

export const FileStatusSchema = z
  .enum(["draft", "final", "changed", "archived", "recycled"])
  .openapi("FileStatus", { description: "文件五态（v0.2 §5.2）" });

export const ChangeStatusSchema = z.enum(["applied"]).openapi("ChangeStatus", {
  description: "变更申请状态；一期申请即通过（唯一终态 applied），多级审批二期可启用",
});

export const BlueprintStatusSchema = z.enum(["draft", "published"]).openapi("BlueprintStatus", {
  description: "蓝图状态：发布产生新版本，不自动影响已生成项目（快照）",
});

export const ISSUE_STATUS_VALUES = ["ungrouped", "open", "in_progress", "done"] as const;

export const IssueStatusSchema = z.enum(ISSUE_STATUS_VALUES).openapi("IssueStatus", {
  description: "问题四态：未分组 / 未解决 / 处理中 / 已完成",
});
