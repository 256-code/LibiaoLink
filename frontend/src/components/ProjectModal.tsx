import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { RegionTools } from "../regionTools";
import type { DictItem } from "../dicts";
import type { Member } from "../data/members";
import { MemberMultiSelect } from "./MemberSelect";
import { RegionSelect } from "./RegionSelect";
import { SelectMenu } from "./SelectMenu";
import type { SelectOption } from "./SelectMenu";

export type ProjectDraft = {
  code: string;
  /** 前端「项目描述」= 契约 name。 */
  description: string;
  /** 项目经理（多位，Push 136）：至少一位，数组顺序 = 展示顺序。 */
  managerIds: string[];
  /** 项目类型：字典 projectType 的码（主题色由字典元数据下发）。 */
  projectType: string;
  /** 项目地区：字典 region 的码。 */
  region: string;
};

type ProjectModalProps = {
  mode: "create" | "edit";
  initial?: ProjectDraft;
  /** 字典下拉项（GET /api/v1/dicts）。 */
  regions: DictItem[];
  projectTypes: DictItem[];
  /** 地区「＋ 添加」的落地方式（写地区字典，全站共享），由 App 层实现。 */
  regionTools: RegionTools;
  /** 项目经理候选（GET /api/v1/users）。 */
  managerOptions: Member[];
  onClose: () => void;
  /** 提交：返回 null = 成功（父层负责关窗 / 刷新列表）；返回文案 = 失败提示，窗口保持打开。 */
  onSubmit: (draft: ProjectDraft) => Promise<string | null>;
};

const fieldClass =
  "block w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25";

/** 项目类型主题色（字典 metadata.accent；缺省品牌黄）。 */
function accentOf(items: DictItem[], code: string): string {
  const item = items.find((entry) => entry.code === code);
  const accent = item === undefined ? undefined : item.metadata["accent"];
  return typeof accent === "string" && accent !== "" ? accent : "#feca04";
}

/** 项目类型下拉项：色点 + 名称（色值随字典 metadata.accent 下发，前端不硬编码）。 */
function typeOptionsOf(items: DictItem[]): SelectOption[] {
  return items.map((item) => ({
    value: item.code,
    label: (
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-zinc-900/10"
          style={{ backgroundColor: accentOf(items, item.code) }}
          aria-hidden="true"
        />
        <span className="truncate">{item.name}</span>
      </span>
    ),
  }));
}

export function ProjectModal({ mode, initial, regions, projectTypes, regionTools, managerOptions, onClose, onSubmit }: ProjectModalProps) {
  const isEdit = mode === "edit";
  const [code, setCode] = useState(initial?.code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [managerIds, setManagerIds] = useState<string[]>(initial?.managerIds ?? []);
  const [projectType, setProjectType] = useState<string>(initial?.projectType ?? projectTypes[0]?.code ?? "");
  const [region, setRegion] = useState<string>(initial?.region ?? regions[0]?.code ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const canSubmit =
    code.trim() !== "" && description.trim() !== "" && managerIds.length > 0 && projectType !== "" && region !== "" && !pending;
  const title = isEdit ? "编辑项目" : "新建项目";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(null);
    const message = await onSubmit({ code, description, managerIds, projectType, region });
    setPending(false);
    if (message !== null) {
      setError(message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
      >
        <h2 className="text-lg font-bold text-zinc-900">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {isEdit ? "修改项目信息，保存后立即生效。" : "填写项目信息，创建后按项目时间出现在列表里。"}
        </p>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目编号</span>
            <input
              className={fieldClass}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="如 CNBJ-20260708-0001"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目描述</span>
            <input
              className={fieldClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="如 中国包裹分拣"
            />
          </label>
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">
              项目经理<span className="ml-1 text-xs font-normal text-zinc-400">可多位</span>
            </span>
            <MemberMultiSelect
              values={managerIds}
              onChange={setManagerIds}
              options={managerOptions}
              placeholder="选择项目经理"
              ariaLabel="选择项目经理"
            />
            <span className="mt-1 block text-[11px] text-zinc-400">至少一位；多位时按勾选顺序展示（Push 136）。</span>
          </div>
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目地区</span>
            <RegionSelect value={region} regions={regions} tools={regionTools} onChange={setRegion} ariaLabel="选择项目地区" />
          </div>
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目类型</span>
            <SelectMenu
              value={projectType}
              options={typeOptionsOf(projectTypes)}
              onChange={setProjectType}
              ariaLabel="选择项目类型"
              placeholder="请选择项目类型"
              disabled={projectTypes.length === 0}
            />
          </div>

          {error === null ? null : (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-[#feca04] px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "提交中…" : isEdit ? "保存修改" : "创建项目"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
