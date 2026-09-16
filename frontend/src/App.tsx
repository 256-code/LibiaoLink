import { useEffect, useState } from "react";

type User = {
  name: string | null;
  displayName: string | null;
  email: string | null;
  id: string | null;
  owner: string | null;
};

type MeResponse = {
  user: User;
  claims: Record<string, unknown>;
  expiresAt: number | null;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: MeResponse }
  | { kind: "error"; message: string };

const FIELD_ROWS: Array<{ key: keyof User; label: string }> = [
  { key: "name", label: "Name（登录名）" },
  { key: "displayName", label: "DisplayName（姓名）" },
  { key: "email", label: "Email（企业邮箱）" },
  { key: "id", label: "Id（用户 ID）" },
  { key: "owner", label: "Owner（所属组织）" },
];

export default function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/auth/me", { headers: { Accept: "application/json" } });
        if (cancelled) {
          return;
        }
        if (response.status === 401) {
          setState({ kind: "signed-out" });
          return;
        }
        if (!response.ok) {
          throw new Error("HTTP " + String(response.status));
        }
        const me = (await response.json()) as MeResponse;
        if (!cancelled) {
          setState({ kind: "signed-in", me });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setState({ kind: "error", message: String(error) });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.kind === "signed-out") {
      window.location.replace("/auth/login");
    }
  }, [state]);

  if (state.kind === "loading" || state.kind === "signed-out") {
    return (
      <main className="page">
        <div className="card">
          <p className="muted">正在跳转公司统一登录…</p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="page">
        <div className="card">
          <h1>加载失败</h1>
          <p className="muted">{state.message}</p>
          <p>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              重试
            </button>
          </p>
        </div>
      </main>
    );
  }

  const { me } = state;
  const expiresText = me.expiresAt === null ? "—" : new Date(me.expiresAt * 1000).toLocaleString();

  return (
    <main className="page">
      <div className="card">
        <header className="header">
          <img className="logo" src="/libiaolink-logo.svg" alt="LibiaoLink" />
          <div>
            <h1>LibiaoLink</h1>
            <p className="muted">已通过公司统一登录（Casdoor）认证</p>
          </div>
        </header>

        <dl className="fields">
          {FIELD_ROWS.map((row) => (
            <div className="row" key={row.key}>
              <dt>{row.label}</dt>
              <dd>{me.user[row.key] ?? "—"}</dd>
            </div>
          ))}
          <div className="row">
            <dt>令牌到期时间</dt>
            <dd>{expiresText}</dd>
          </div>
        </dl>

        <details className="raw">
          <summary>令牌声明（id_token，已通过 JWKS 验签）</summary>
          <pre>{JSON.stringify(me.claims, null, 2)}</pre>
        </details>

        <footer className="actions">
          <a className="button" href="/auth/logout">
            退出登录
          </a>
          <span className="muted">这是前端接入参考页，字段直接来自令牌</span>
        </footer>
      </div>
    </main>
  );
}
