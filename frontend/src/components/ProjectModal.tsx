import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ReactNode } from "react";
import { DICT_ACCENT_PALETTE, accentOfItem, type DictItem, type Dicts } from "../dicts";
import type { DictTools } from "../dictTools";
import type { Member } from "../data/members";
import { DictSelect } from "./DictSelect";
import { MemberMultiSelect } from "./MemberSelect";

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
  /** 字典下拉项（GET /api/v1/dicts）：地区 + 项目类型。 */
  dicts: Dicts;
  /** 字典「＋ 添加」与行内删除的落地方式，由 App 层实现（region 登录即可；projectType 与删除需 dict.manage）。 */
  dictTools: DictTools;
  /** 是否持有 dict.manage（Push 172）：决定「＋ 添加项目类型」与两类条目删除入口的呈现（服务端仍是最终裁决）。 */
  canManageDicts: boolean;
  /** 项目经理候选（GET /api/v1/users）。 */
  managerOptions: Member[];
  onClose: () => void;
  /** 提交：返回 null = 成功（父层负责关窗 / 刷新列表）；返回文案 = 失败提示，窗口保持打开。 */
  onSubmit: (draft: ProjectDraft) => Promise<string | null>;
};

const fieldClass =
  "block w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25";

/**
 * 项目类型下拉内容（触发器与选项行同款）：色点 + 名称 —— 色值随字典 metadata.accent 下发，前端不硬编码；
 * 存量值（item === null：已删除条目的存量值 / 字典外的码）按兜底色（品牌黄）渲染。
 */
function projectTypeContent(name: string, item: DictItem | null): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-zinc-900/10"
        style={{ backgroundColor: accentOfItem(item ?? undefined).color }}
        aria-hidden="true"
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function ProjectModal({ mode, initial, dicts, dictTools, canManageDicts, managerOptions, onClose, onSubmit }: ProjectModalProps) {
  const isEdit = mode === "edit";
  const [code, setCode] = useState(initial?.code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [managerIds, setManagerIds] = useState<string[]>(initial?.managerIds ?? []);
  const [projectType, setProjectType] = useState<string>(initial?.projectType ?? dicts.projectType[0]?.code ?? "");
  const [region, setRegion] = useState<string>(initial?.region ?? dicts.region[0]?.code ?? "");
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
            <DictSelect
              value={region}
              items={dicts.region}
              ariaLabel="选择项目地区"
              placeholder="请选择地区"
              onAdd={(input) => dictTools.onAdd("region", input)}
              addText={{
                label: "添加地区",
                placeholder: "输入地区名称，如 东南亚",
                note: "保存后写入地区字典（C9）：全站可选（所有项目的地区下拉都能选到），并可在首页按它筛选；删除与改名由管理员维护。",
              }}
              onDelete={
                canManageDicts
                  ? (code) => dictTools.onDelete("region", code)
                  : undefined
              }
              deleteLabelOf={(_code, name) => "删除地区 " + name}
              onChange={setRegion}
            />
          </div>
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目类型</span>
            <DictSelect
              value={projectType}
              items={dicts.projectType}
              ariaLabel="选择项目类型"
              placeholder="请选择项目类型"
              renderContent={projectTypeContent}
              onAdd={
                canManageDicts
                  ? (input) => dictTools.onAdd("projectType", input)
                  : undefined
              }
              addText={{
                label: "添加项目类型",
                placeholder: "输入类型名称，如 分拣机",
              }}
              palette={{
                label: "颜色模板",
                options: DICT_ACCENT_PALETTE,
              }}
              onDelete={
                canManageDicts
                  ? (code) => dictTools.onDelete("projectType", code)
                  : undefined
              }
              deleteLabelOf={(_code, name) => "删除项目类型 " + name}
              onChange={setProjectType}
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
