import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { oidcPlugin } from "./server/oidc-plugin.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), oidcPlugin(env)],
    server: {
      port: 3000,
      strictPort: true,
    },
  };
});
