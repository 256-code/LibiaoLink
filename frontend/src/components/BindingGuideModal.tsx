import { useEffect, useState } from "react";
import { loadWecomDmBinding } from "../bindingApi";
import { isBindingGuideSkipped, skipBindingGuide } from "../bindingGuide";
import { useT } from "../i18n";
import { lockBodyScroll } from "../scrollLock";
import type { MeResponse } from "../types";
import { SETTINGS_BASE_HASH } from "../useHashRoute";
import { Toast } from "./Toast";
import { WecomBindingPanel, type BindingNotice } from "./WecomBindingPanel";
import { useFocusTrap } from "./useFocusTrap";

/** 引导弹窗账号键（User.id 可能为空：回落到 name / owner，再兜底 anon —— 与顶栏展示同一套取值习惯）。 */
function guideKeyOf(me: MeResponse): string {
  return me.user.id ?? me.user.name ?? me.user.owner ?? "anon";
}

/**
 * 首登「绑定企业微信」引导弹窗（D5 · Push 250）。
 *
 * 何时弹：登录后**未绑定**且本机未跳过（`../bindingGuide`）。已绑定 / 已跳过 = 不弹（静默返回 null）。
 * 可跳过：弹窗内「稍后再说」= 记下跳过（本机 + 本账号）并关闭；设置页仍可补绑（D5 定案口径）。
 * 「前往设置」= 记跳过 + 跳 `#/settings`（绑定面板的完整入口，含解绑）。
 * 取码 / 倒计时 / 复制与 429 置灰复用 WecomBindingPanel（与设置页同一份实现）。
 */
export function BindingGuideModal({ me }: { me: MeResponse }) {
  const t = useT();
  const accountKey = guideKeyOf(me);
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState<BindingNotice | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(visible, visible);

  useEffect(() => {
    setVisible(false);
    if (isBindingGuideSkipped(accountKey)) {
      return;
    }
    let cancelled = false;
    void loadWecomDmBinding()
      .then((state) => {
        if (!cancelled && !state.bound) {
          setVisible(true);
        }
      })
      .catch(() => {
        // 读态失败（后端不可达 / 混布窗口）：不弹引导，避免挡路 —— 设置页仍可自助绑定
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    return lockBodyScroll();
  }, [visible]);

  const close = (): void => {
    setVisible(false);
  };

  const handleSkip = (): void => {
    skipBindingGuide(accountKey);
    close();
  };

  const handleGoSettings = (): void => {
    skipBindingGuide(accountKey);
    close();
    window.location.hash = SETTINGS_BASE_HASH.slice(1);
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-[75] flex items-center justify-center bg-zinc-900/50 p-6" role="presentation">
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("settings.guide.title")}
          data-wecom-binding-guide="true"
          className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
        >
          <h2 className="text-lg font-bold text-zinc-900">{t("settings.guide.title")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("settings.guide.desc")}</p>
          <ol className="mt-4 space-y-1.5 text-sm leading-6 text-zinc-700">
            <li>{t("settings.guide.step1")}</li>
            <li>{t("settings.guide.step2")}</li>
          </ol>
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <WecomBindingPanel
              variant="guide"
              onNotice={(next) => {
                setNotice(next);
              }}
              onBoundChange={(bound) => {
                if (bound) {
                  skipBindingGuide(accountKey);
                }
              }}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              data-wecom-binding-guide-skip="true"
              onClick={handleSkip}
              className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100"
            >
              {t("settings.guide.skip")}
            </button>
            <button
              type="button"
              data-wecom-binding-guide-goto="true"
              onClick={handleGoSettings}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              {t("settings.guide.go")}
            </button>
          </div>
        </div>
      </div>
      {notice === null ? null : (
        <Toast
          kind={notice.kind}
          text={notice.text}
          onClose={() => {
            setNotice(null);
          }}
        />
      )}
    </>
  );
}
