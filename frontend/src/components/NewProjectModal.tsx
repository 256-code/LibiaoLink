import { useEffect, useState } from "react";
import { MANAGERS } from "../data/managers";
import { PROJECT_TYPES } from "../types";
import type { ProjectType } from "../types";

export type NewProjectDraft = {
  code: string;
  description: string;
  managerId: string;
  projectType: ProjectType;
};

type NewProjectModalProps = {
  onClose: () => void;
  onCreate: (draft: NewProjectDraft) => void;
};

const fieldClass =
  "block w-full appearance-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25";

export function NewProjectModal({ onClose, onCreate }: NewProjectModalProps) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [managerId, setManagerId] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("T-sort");

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

  const canSubmit = code.trim() !== "" && description.trim() !== "" && managerId !== "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建项目"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
      >
        <h2 className="text-lg font-bold text-zinc-900">新建项目</h2>
        <p className="mt-1 text-sm text-zinc-500">填写项目信息，创建后出现在项目列表末尾。</p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }
            onCreate({ code, description, managerId, projectType });
          }}
        >
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
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目经理</span>
            <select
              className={fieldClass}
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
            >
              <option value="">请选择项目经理</option>
              {MANAGERS.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-700">项目类型</span>
            <select
              className={fieldClass}
              value={projectType}
              onChange={(event) => {
                setProjectType(event.target.value as ProjectType);
              }}
            >
              {PROJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

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
              创建项目
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
