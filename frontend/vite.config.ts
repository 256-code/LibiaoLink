import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 本地联调（k6）：前端固定在 3000；会话（/auth/*）与业务接口（/api/v1）都由 Vite 代理到后端 api。
 * 后端默认 PORT=3000 与前端冲突，本地把 server/.env 的 PORT 设为 3001（见 frontend/.env.example）。
 * 生产环境没有 Vite：站点域名直接指向后端（Nginx 反代），Casdoor Redirect URL 登记站点域名。
 *
 * 2026-10-10 追订（§6.16 ⑯ 进展描述英译接线）：/api/v1/translate 单独代理到本机 LibreTranslate
 * （deploy/libretranslate/，默认 127.0.0.1:5005；TRANSLATE_ORIGIN 可覆盖）——规则必须排在通用
 * /api/v1 之前（Vite 按插入顺序匹配，先命中先生效）。生产由后端 server/ 按同契约实现（当前未实现，
 * 前端静默降级为只出中文）。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendOrigin = env.BACKEND_ORIGIN === undefined || env.BACKEND_ORIGIN === "" ? "http://127.0.0.1:3001" : env.BACKEND_ORIGIN;
  const translateOrigin = env.TRANSLATE_ORIGIN === undefined || env.TRANSLATE_ORIGIN === "" ? "http://127.0.0.1:5005" : env.TRANSLATE_ORIGIN;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/api/v1/translate": { target: translateOrigin, changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/v1\/translate/, "/translate") },
        "/api/v1": { target: backendOrigin, changeOrigin: true },
        "/auth": { target: backendOrigin, changeOrigin: true },
        "/healthz": { target: backendOrigin, changeOrigin: true },
        "/readyz": { target: backendOrigin, changeOrigin: true },
      },
    },
  };
});
