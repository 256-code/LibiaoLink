import { useEffect, useState } from "react";
import { ApiError } from "./api";
import { AppHeader } from "./components/AppHeader";
import { DateRangePicker, type DateRange } from "./components/DateRangePicker";
import { Loader } from "./components/Loader";
import { SelectMenu } from "./components/SelectMenu";
import type { DirectoryUser } from "./directory";
import { fetchProjectList, formatDateTime, type ApiProject } from "./projectApi";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_OBJECT_TYPES,
  AUDIT_OBJECT_TYPE_LABELS,
  AUDIT_RESULTS,
  AUDIT_RESULT_LABELS,
  auditLabelOf,
  fetchAuditLogs,
  type AuditLogListResult,
} from "./auditApi";
import {
  AUDIT_CHANGE_LINE_LIMIT,
  auditChangeLines,
  auditObjectText,
  auditSummaryText,
  type AuditFormatContext,
} from "./auditFormat";
import { EMPTY_AUDIT_QUERY, EMPTY_LIST_QUERY, type AuditQueryState } from "./useHashRoute";
import type { MeResponse } from "./types";

/**
 * 操作记录页（C7-04「管理员查询页」· u12 · 2026-10-08）。
 * 入口 = 右上角头像菜单「退出登录」下方的「操作记录」（AppHeader；仅 audit.view 渲染，服务端逐请求仍是最终裁决）。
 * 口径：全站关键操作留痕（谁 / 何时 / 动作 / 对象 / 摘要 / 结果），occurredAt 倒序、分页 50；
 * 筛选 = 操作人 / 动作 / 对象类型 / 结果 / 项目 / 时间区间 —— 与首页列表同一套「地址即状态」（useHashRoute 的 AuditQueryState，
 * 可分享 / 可收藏 / 刷新不丢）。越权尝试（result=denied）在结果列一眼可见（C7-03）。
 * 失败口径：403 = 无 audit.view（菜单本不渲染，直链访问兜底提示）；其余错误给「重试」。
 */

type AuditPageState =
  | { kind: "loading" }
  | { kind: "error"; message: string; forbidden: boolean }
  | { kind: "ready"; result: AuditLogListResult };


export function AuditLogPage({ me, query, onChangeQuery, directory }: {
  me: MeResponse;
  query: AuditQueryState;
  onChangeQuery: (next: AuditQueryState) => void;
  directory: readonly DirectoryUser[];
}) {
  const [state, setState] = useState<AuditPageState>({ kind: "loading" });
  const [reloadTick, setReloadTick] = useState(0);
  const [projects, setProjects] = useState<ApiProject[]>([]);

  // 项目筛选 / 项目列的选项（一次拉满；失败只影响选项丰富度，不阻塞主列表）
  useEffect(() => {
    let alive = true;
    fetchProjectList(EMPTY_LIST_QUERY)
      .then((payload) => {
        if (alive) {
          setProjects(payload.items);
        }
      })
      .catch(() => {
        if (alive) {
          setProjects([]);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchAuditLogs({
      actorId: query.actorId,
      action: query.action,
      objectType: query.objectType,
      result: query.result,
      projectId: query.projectId,
      from: query.from,
      to: query.to,
      page: query.page,
    })
      .then((result) => {
        if (alive) {
          setState({ kind: "ready", result });
        }
      })
      .catch((error: unknown) => {
        if (!alive) {
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setState({ kind: "error", message: "没有权限查看操作记录（需要 audit.view）。", forbidden: true });
          return;
        }
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "网络异常，请稍后重试。",
          forbidden: false,
        });
      });
    return () => {
      alive = false;
    };
  }, [query.actorId, query.action, query.objectType, query.result, query.projectId, query.from, query.to, query.page, reloadTick]);

  const patchFilter = (patch: Partial<AuditQueryState>): void => {
    onChangeQuery({ ...query, ...patch, page: 1 });
  };
  const gotoPage = (page: number): void => {
    onChangeQuery({ ...query, page });
  };

  const hasFilter =
    query.actorId !== null ||
    query.action !== null ||
    query.objectType !== null ||
    query.result !== null ||
    query.projectId !== null ||
    query.from !== null ||
    query.to !== null;

  const actorOptions = [{ value: "", label: "全部操作人" }].concat(directory.map((user) => ({ value: user.id, label: user.displayName })));
  const actionOptions = [{ value: "", label: "全部动作" }].concat(AUDIT_ACTIONS.map((action) => ({ value: action, label: auditLabelOf(AUDIT_ACTION_LABELS, action) })));
  const objectTypeOptions = [{ value: "", label: "全部对象" }].concat(AUDIT_OBJECT_TYPES.map((type) => ({ value: type, label: auditLabelOf(AUDIT_OBJECT_TYPE_LABELS, type) })));
  const resultOptions = [{ value: "", label: "全部结果" }].concat(AUDIT_RESULTS.map((result) => ({ value: result, label: auditLabelOf(AUDIT_RESULT_LABELS, result) })));
  const projectOptions = [{ value: "", label: "全部项目" }].concat(projects.map((project) => ({ value: project.id, label: project.code + " · " + project.name })));
  const projectCodeById = new Map(projects.map((project) => [project.id, project.code] as const));
  const userNameById = new Map(directory.map((user) => [user.id, user.displayName] as const));
  const formatContext: AuditFormatContext = { userNameById, projectCodeById };

  const range: DateRange | null = query.from === null || query.to === null ? null : { from: query.from, to: query.to };
  const totalPages = state.kind === "ready" ? Math.max(1, Math.ceil(state.result.total / state.result.limit)) : 1;

  return (
    <div className="min-h-screen">
      <AppHeader me={me} />
      <main className="w-full px-6 pb-10 pt-3">
        <div data-audit-page="" className="w-full space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900">操作记录</h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                全站关键操作的留痕（新增 / 修改 / 删除 / 预览 / 下载 / 越权尝试……），按时间倒序；仅系统管理员可见。
              </p>
            </div>
            {state.kind === "ready" ? (
              <p data-audit-count="" className="text-xs text-zinc-500">
                共 {state.result.total} 条
              </p>
            ) : null}
          </header>

          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <span data-audit-filter="actor" className="w-40 shrink-0">
              <SelectMenu
                ariaLabel="按操作人筛选"
                value={query.actorId ?? ""}
                options={actorOptions}
                onChange={(value) => {
                  patchFilter({ actorId: value === "" ? null : value });
                }}
              />
            </span>
            <span data-audit-filter="action" className="w-32 shrink-0">
              <SelectMenu
                ariaLabel="按动作筛选"
                value={query.action ?? ""}
                options={actionOptions}
                onChange={(value) => {
                  patchFilter({ action: value === "" ? null : value });
                }}
              />
            </span>
            <span data-audit-filter="objectType" className="w-36 shrink-0">
              <SelectMenu
                ariaLabel="按对象类型筛选"
                value={query.objectType ?? ""}
                options={objectTypeOptions}
                onChange={(value) => {
                  patchFilter({ objectType: value === "" ? null : value });
                }}
              />
            </span>
            <span data-audit-filter="result" className="w-32 shrink-0">
              <SelectMenu
                ariaLabel="按结果筛选"
                value={query.result ?? ""}
                options={resultOptions}
                onChange={(value) => {
                  patchFilter({ result: value === "" ? null : value });
                }}
              />
            </span>
            <span data-audit-filter="project" className="w-48 shrink-0">
              <SelectMenu
                ariaLabel="按项目筛选"
                value={query.projectId ?? ""}
                options={projectOptions}
                onChange={(value) => {
                  patchFilter({ projectId: value === "" ? null : value });
                }}
              />
            </span>
            <span data-audit-filter="time" className="shrink-0">
              <DateRangePicker
                ariaLabel="按时间筛选"
                value={range}
                onChange={(next) => {
                  patchFilter({ from: next === null ? null : next.from, to: next === null ? null : next.to });
                }}
              />
            </span>
            {hasFilter ? (
              <button
                type="button"
                data-audit-clear="true"
                onClick={() => {
                  onChangeQuery(EMPTY_AUDIT_QUERY);
                }}
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
              >
                清除筛选
              </button>
            ) : null}
          </section>

          {state.kind === "loading" ? (
            <div className="flex justify-center py-16">
              <Loader />
            </div>
          ) : null}

          {state.kind === "error" ? (
            <div role="alert" data-audit-error="" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <span>{state.message}</span>
              {state.forbidden ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setReloadTick((tick) => tick + 1);
                  }}
                  className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium transition hover:bg-rose-100"
                >
                  重试
                </button>
              )}
            </div>
          ) : null}

          {state.kind === "ready" && state.result.items.length === 0 ? (
            <div data-audit-empty="true" className="rounded-xl border border-zinc-200 bg-white px-4 py-12 text-center text-sm text-zinc-500">
              {hasFilter ? "当前筛选下没有操作记录，可清除筛选后重试。" : "暂无操作记录。"}
            </div>
          ) : null}

          {state.kind === "ready" && state.result.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
                <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                  <thead className="bg-zinc-50 text-zinc-500">
                    <tr>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">时间</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">操作人</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">动作</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">对象</th>
                      <th className="border-b border-zinc-200 px-4 py-3 font-medium">操作内容</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">结果</th>
                      <th className="whitespace-nowrap border-b border-zinc-200 px-4 py-3 font-medium">项目</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.items.map((item) => {
                      const changeLines = auditChangeLines(item, formatContext);
                      return (
                      <tr key={item.id} data-audit-row={String(item.id)} className="align-top transition hover:bg-zinc-50/70">
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-700">{formatDateTime(item.occurredAt)}</td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-700">{item.actorName ?? "系统"}</td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3">
                          <span
                            data-audit-action={item.action}
                            className={
                              "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " +
                              (item.action === "delete" || item.action === "deny" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600")
                            }
                          >
                            {auditLabelOf(AUDIT_ACTION_LABELS, item.action)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-600">
                          {auditObjectText(item, formatContext)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-3">
                          <p className="text-zinc-700">{auditSummaryText(item)}</p>
                          {changeLines.length === 0 ? null : (
                            <ul className="mt-1.5 space-y-0.5">
                              {changeLines.slice(0, AUDIT_CHANGE_LINE_LIMIT).map((line, index) => (
                                <li key={line.label + "·" + String(index)} data-audit-change={line.label} data-audit-change-kind={line.kind} className="text-xs leading-5">
                                  <span className="text-zinc-500">{line.label}</span>
                                  <span className="mx-1 text-zinc-300">·</span>
                                  {line.kind === "create" ? (
                                    <span className="font-medium text-zinc-700">{line.to}</span>
                                  ) : line.kind === "clear" ? (
                                    item.action === "delete" ? (
                                      <span className="text-zinc-700">{line.from}</span>
                                    ) : (
                                      <>
                                        <span className="text-zinc-400">{line.from}</span>
                                        <span className="ml-1 text-zinc-400">（已清空）</span>
                                      </>
                                    )
                                  ) : (
                                    <>
                                      <span className="text-[11px] text-zinc-400">修改前</span>
                                      <span className="ml-1 text-zinc-400">{line.from}</span>
                                      <span className="mx-1 text-zinc-300">→</span>
                                      <span className="text-[11px] text-zinc-400">修改后</span>
                                      <span className="ml-1 font-medium text-zinc-800">{line.to}</span>
                                    </>
                                  )}
                                </li>
                              ))}
                              {changeLines.length > AUDIT_CHANGE_LINE_LIMIT ? (
                                <li className="text-xs text-zinc-400">等 {changeLines.length} 项变化</li>
                              ) : null}
                            </ul>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3">
                          <span
                            data-audit-result={item.result}
                            className={
                              "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium " +
                              (item.result === "succeeded"
                                ? "bg-emerald-50 text-emerald-700"
                                : item.result === "denied"
                                  ? "bg-amber-100 text-amber-800"
                                  : item.result === "failed"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-zinc-100 text-zinc-600")
                            }
                          >
                            {auditLabelOf(AUDIT_RESULT_LABELS, item.result)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap border-b border-zinc-100 px-4 py-3 text-zinc-600">
                          {item.projectId === null ? "—" : projectCodeById.get(item.projectId) ?? "—"}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3">
                <p data-audit-page-info="" className="text-xs text-zinc-500">
                  共 {state.result.total} 条 · 第 {state.result.page} / {totalPages} 页
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-audit-prev="true"
                    disabled={state.result.page <= 1}
                    onClick={() => {
                      gotoPage(state.result.page - 1);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    data-audit-next="true"
                    disabled={state.result.page >= totalPages}
                    onClick={() => {
                      gotoPage(state.result.page + 1);
                    }}
                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300"
                  >
                    下一页
                  </button>
                </div>
              </footer>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
