import { useEffect, useState } from "react";
import {
  loadWecomDmBinding,
  rateLimitedRetryAt,
  requestWecomDmBindingCode,
  unbindWecomDm,
  type WecomDmBindingCode,
  type WecomDmBindingState,
} from "../bindingApi";
import { useT } from "../i18n";
import { formatDateTime } from "../projectApi";

/**
 * 企业微信绑定操作面板（D5 / D6 · M5-03-5-6 绑定码链路前端 · Push 250）。
 *
 * 两处复用：设置页「企业微信绑定」卡片（variant = page）与首登引导弹窗（variant = guide）。
 * 面板只做「状态 + 取码 / 倒计时 / 复制 + 解绑」，引导文案与外壳由宿主给（见 SettingsPage / BindingGuideModal）。
 *
 * 取码：`POST /wecom-dm-binding/codes` → 6 位码 + `expiresInSeconds` 倒计时（重复取码作废旧码，
 *  一律以最新响应为准）；频率到顶 = 429 `RATE_LIMITED` → 按 `details[].meta.retryAt` 置灰按钮 + 倒计时。
 * 解绑：`DELETE /wecom-dm-binding`（幂等）—— 二次确认后提交，成功回未绑定态。
 * 安全（口径 §9）：界面只展示掩码（末 4 位）；除 6 位码本身外不缓存 / 不落日志企微标识。
 */
export type BindingNotice = { kind: "ok" | "error"; text: string };

export function WecomBindingPanel(props: {
  variant: "page" | "guide";
  onNotice: (notice: BindingNotice) => void;
  onBoundChange?: (bound: boolean) => void;
}) {
  const t = useT();
  const [state, setState] = useState<WecomDmBindingState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [code, setCode] = useState<WecomDmBindingCode | null>(null);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"code" | "unbind" | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reload = (): void => {
    setLoadFailed(false);
    setState(null);
    void loadWecomDmBinding()
      .then((next) => {
        setState(next);
        props.onBoundChange?.(next.bound);
      })
      .catch(() => {
        setLoadFailed(true);
      });
  };

  useEffect(() => {
    reload();
    // 只随组件挂载拉一次（面板由宿主按需挂载 / 卸载）；后续状态一律由本面板写口的响应回读
  }, []);

  const codeLeft = code === null ? 0 : Math.max(0, Math.ceil((Date.parse(code.expiresAt) - now) / 1000));
  const retryLeft = retryAt === null ? 0 : Math.max(0, Math.ceil((Date.parse(retryAt) - now) / 1000));
  const ticking = codeLeft > 0 || retryLeft > 0;

  useEffect(() => {
    if (!ticking) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [ticking]);

  const handleGetCode = async (): Promise<void> => {
    setBusy("code");
    try {
      const result = await requestWecomDmBindingCode();
      setNow(Date.now());
      setCode(result);
      setRetryAt(null);
      props.onNotice({ kind: "ok", text: t("settings.bind.codeReady") });
    } catch (error) {
      const limit = rateLimitedRetryAt(error);
      if (limit !== null) {
        setRetryAt(limit);
        props.onNotice({ kind: "error", text: t("settings.bind.rateLimited") });
      } else {
        props.onNotice({ kind: "error", text: t("settings.bind.codeFailed") });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (code === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code.code);
      props.onNotice({ kind: "ok", text: t("settings.bind.copied") });
    } catch {
      props.onNotice({ kind: "error", text: t("settings.bind.copyFailed") });
    }
  };

  const handleUnbind = async (): Promise<void> => {
    setBusy("unbind");
    try {
      const next = await unbindWecomDm();
      setState(next);
      props.onBoundChange?.(next.bound);
      setCode(null);
      setConfirmUnbind(false);
      props.onNotice({ kind: "ok", text: t("settings.bind.unboundOk") });
    } catch {
      props.onNotice({ kind: "error", text: t("settings.bind.unbindFailed") });
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return (
      <div data-wecom-binding="error" className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>{t("settings.bind.loadFailed")}</span>
        <button
          type="button"
          data-wecom-binding-retry="true"
          onClick={reload}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
        >
          {t("settings.bind.retry")}
        </button>
      </div>
    );
  }

  if (state === null) {
    return <div data-wecom-binding="loading" className="text-xs text-zinc-400">{t("settings.bind.loading")}</div>;
  }

  const codeBlock =
    code === null ? null : (
      <div
        data-wecom-binding-code={code.code}
        data-wecom-binding-code-state={codeLeft > 0 ? "active" : "expired"}
        className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3"
      >
        <p className="text-xs text-amber-800">{t("settings.bind.codeHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="font-mono text-2xl font-semibold tracking-[0.3em] text-zinc-900">{code.code}</span>
          <button
            type="button"
            data-wecom-binding-copy="true"
            onClick={() => void handleCopy()}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
          >
            {t("settings.bind.copy")}
          </button>
          <span data-wecom-binding-countdown={String(codeLeft)} className="text-xs tabular-nums text-amber-800">
            {codeLeft > 0 ? t("settings.bind.codeLeft", { seconds: codeLeft }) : t("settings.bind.codeExpired")}
          </span>
        </div>
      </div>
    );

  if (state.bound) {
    return (
      <div data-wecom-binding="bound" className={props.variant === "guide" ? "" : "space-y-1"}>
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {t("settings.bind.bound")}
          </span>
          {state.wecomUseridMasked === null ? null : (
            <span className="font-mono text-xs text-zinc-500">{t("settings.bind.masked", { mask: state.wecomUseridMasked })}</span>
          )}
        </p>
        {state.boundAt === null ? null : (
          <p className="text-xs text-zinc-500">{t("settings.bind.boundAt", { time: formatDateTime(state.boundAt) })}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirmUnbind ? (
            <>
              <span className="text-xs text-zinc-500">{t("settings.bind.unbindAsk")}</span>
              <button
                type="button"
                data-wecom-binding-unbind-confirm="true"
                disabled={busy !== null}
                onClick={() => void handleUnbind()}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-95 disabled:opacity-60"
              >
                {busy === "unbind" ? t("settings.bind.unbinding") : t("settings.bind.unbindConfirm")}
              </button>
              <button
                type="button"
                data-wecom-binding-unbind-cancel="true"
                disabled={busy !== null}
                onClick={() => {
                  setConfirmUnbind(false);
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-60"
              >
                {t("settings.bind.unbindCancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-wecom-binding-unbind="true"
              onClick={() => {
                setConfirmUnbind(true);
              }}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100"
            >
              {t("settings.bind.unbind")}
            </button>
          )}
        </div>
        {props.variant === "page" ? <p className="pt-2 text-xs text-zinc-500">{t("settings.bind.unbindNote")}</p> : null}
      </div>
    );
  }

  const codeDisabled = busy !== null || retryLeft > 0;
  return (
    <div data-wecom-binding="unbound">
      <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
        <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
          {t("settings.bind.unbound")}
        </span>
        <span className="text-xs text-zinc-500">{t("settings.bind.unboundHint")}</span>
      </p>
      {props.variant === "page" ? <p className="mt-2 text-xs leading-5 text-zinc-500">{t("settings.bind.steps")}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-wecom-binding-get-code="true"
          disabled={codeDisabled}
          onClick={() => void handleGetCode()}
          className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {busy === "code" ? t("settings.bind.codeBusy") : code === null ? t("settings.bind.getCode") : t("settings.bind.regetCode")}
        </button>
        {retryLeft > 0 ? (
          <span data-wecom-binding-rate-limit={String(retryLeft)} className="text-xs tabular-nums text-rose-600">
            {t("settings.bind.rateLimitedLeft", { seconds: retryLeft })}
          </span>
        ) : null}
      </div>
      {codeBlock}
    </div>
  );
}
