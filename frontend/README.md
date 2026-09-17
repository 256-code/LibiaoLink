# LibiaoLink 前端（React + Vite + TypeScript）

LibiaoLink 的前端起点，同时是**公司统一登录（Casdoor / 标准 OIDC）的接入参考实现**：
不用任何 SDK，只用 `Client ID` + `Client Secret`，`Authorization Code` 模式。

> 公司接入标准见 `docs/开发者接入注意事项(SSO接入标准).md`；本地沙箱见 `docs/本地沙箱(LibiaoLink 演练环境).md`。

## 快速开始（本地沙箱）

```powershell
cd frontend
npm install
copy .env.example .env.local   # 填上 CASDOOR_CLIENT_SECRET
npm run dev                    # http://localhost:3000
```

打开 `http://localhost:3000`：未登录会自动跳公司统一登录页，登录后回跳展示用户字段。
无浏览器回归：`npm run smoke`（7 组断言，覆盖入口 → 登录 → 免点击签发 → 换令牌 → 验签 → 登出）；账号口令从 `.env.local`（`TEST_USERNAME` / `TEST_PASSWORD`，不入库）读取，不需要写在命令行上。

本地联调用的 Casdoor 在 `deploy/casdoor/`（`docker compose up -d`），应用 `libiaolink` 需要以下配置：

| Casdoor 应用配置 | 值 |
|---|---|
| Homepage URL | `http://localhost:3000`（在 Casdoor 应用页点卡片就进这里） |
| Redirect URLs | `http://localhost:3000/auth/callback` |
| Grant Types | 只勾 `authorization_code` |
| Token format | `JWT-Custom` |
| Token fields | `Name` / `Owner` / `Id` / `DisplayName` / `Email` |

## 登录流程

```text
浏览器                        前端 /auth/*（本地由 Vite 中间件承载）        Casdoor
  |  GET /                          |                                        |
  |  ----------------------------->  | 返回 SPA                               |
  |  GET /auth/me                   |                                        |
  |  ----------------------------->  | 401（还没有会话）                       |
  |  GET /auth/login                |                                        |
  |  ----------------------------->  | 生成 state + PKCE，302                 |
  |  --------------------------------------------------------------> /login/oauth/authorize
  |                                  |      已有 SSO 会话则直接签发 code       |
  |  GET /auth/callback?code=..      |  <------------------------------------ |
  |  ----------------------------->  | code+verifier+secret 换令牌            |
  |                                  | 建会话（HttpOnly Cookie），302 回 /    |
  |  GET /auth/me                   |                                        |
  |  ----------------------------->  | JWKS 验签 id_token，返回用户字段        |
```

- 换令牌发生在服务端：`client_secret` 只存在于后端（本地开发时是 Vite 中间件），不会进浏览器。
- `state` 防 CSRF、PKCE 防授权码截获，两者都会校验。
- `id_token` 用 Casdoor 的 JWKS 验签后才采信（不是只 base64 解码）。
- 会话过期后再访问 `/auth/me` 得到 401，前端会自动重新走一遍 SSO；Casdoor 会话还在就是静默续期。

## 目录结构

```text
frontend/
  server/oidc-plugin.ts   OIDC 后端路由（本地开发用；生产环境搬到你的后端）
  src/App.tsx             页面：未登录跳 SSO，登录后展示 5 个标准字段
  src/main.tsx            入口
  .env.example            环境变量模板（复制为 .env.local）
  scripts/smoke-test.mjs  SSO 链路冒烟测试（无浏览器，npm run smoke）
  vite.config.ts          Vite 配置（端口 3000，严格端口）
```

## 生产环境怎么做

这 4 个路由就是接入的全部后端工作量，搬到你们自己的服务即可（Java 用 Spring Security 的 oauth2Login 也行）：

| 路由 | 职责 |
|---|---|
| `GET /auth/login` | 生成 `state` + PKCE，302 到 `/login/oauth/authorize` |
| `GET /auth/callback` | 校验 `state`，换令牌，建立本地会话 |
| `GET /auth/me` | 验签 `id_token`，返回用户字段 |
| `GET /auth/logout` | 清理本地会话，302 到 Casdoor `/api/logout` |

上线检查：

1. 生产用 `https`，Cookie 加 `Secure`；`client_secret` 只放后端环境变量或密钥管理，不进仓库、不进前端。
2. 应用会话超时按《接入标准》第三章设置（管理后台类 30 分钟），超时后重新走 SSO 静默续期。
3. 正式应用由 SSO 管理员创建（Homepage URL / Redirect URLs 用正式域名），改域名后同步改 `.env.local`。
4. 离职回收：员工在企业微信被删除后，Casdoor 会同步删除/禁用用户；前端在 `/auth/me` 拿不到用户时按未登录处理即可。

## 常见问题

| 现象 | 处理 |
|---|---|
| 换令牌报 `invalid_grant: redirect_uri is invalid` | Casdoor 应用的 Redirect URLs 必须包含 `.env.local` 里的 `CASDOOR_REDIRECT_URI`（逐字符一致） |
| 报 `state 校验失败` | 登录过程中换了标签页或清了 Cookie；从应用入口重新进入 |
| 启动报端口被占用 | 3000 被别的程序占了（`strictPort` 不会悄悄换端口），腾出端口再启动 |
| 页面反复跳登录 | `.env.local` 里的 `CASDOOR_CLIENT_SECRET` 不对 |
| 能登录但字段是空的 | 应用 Token fields 没勾 `Name` / `Owner` / `Id` / `DisplayName` / `Email` |
