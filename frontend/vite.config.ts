import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * 本地联调（k6）：前端固定在 3000；会话等根路径由 Vite 代理到后端 api。
 * 后端默认 PORT=3000 与前端冲突，本地把 server/.env 的 PORT 设为 3001（见 frontend/.env.example）。
 * 生产环境没有 Vite：站点域名直接指向后端（Nginx 反代），Casdoor Redirect URL 登记站点域名。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendOrigin = env.BACKEND_ORIGIN === undefined || env.BACKEND_ORIGIN === "" ? "http://127.0.0.1:3001" : env.BACKEND_ORIGIN;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/auth": { target: backendOrigin, changeOrigin: true },
        "/healthz": { target: backendOrigin, changeOrigin: true },
        "/readyz": { target: backendOrigin, changeOrigin: true },
      },
    },
  };
});
