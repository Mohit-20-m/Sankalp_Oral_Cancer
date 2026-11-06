import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // `npm run dev` / `npm run preview` forward API + login calls to the running backend (Docker stack by default),
  // so the browser sees one origin — exactly like production behind Traefik.
  const target = env.DEV_BACKEND_URL || "https://localhost";
  const authTarget = env.DEV_KEYCLOAK_URL || target;
  const proxy = {
    "/api": { target, changeOrigin: true, secure: false },
    "/auth": { target: authTarget, changeOrigin: false, secure: false },
    "/os-images": { target, changeOrigin: false, secure: false },
    "/os-derived": { target, changeOrigin: false, secure: false },
    "/os-models": { target, changeOrigin: false, secure: false },
  };
  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: { host: true, port: 5173, proxy },
    preview: { host: true, port: 4173, proxy },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            motion: ["framer-motion"],
            charts: ["recharts"],
          },
        },
      },
    },
  };
});
