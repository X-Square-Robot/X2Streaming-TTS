import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The optional proxy stays on the preview host; its destination is never bundled.
const engine = process.env.X2_DEMO_ENGINE;
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@xmultimodalinteraction/qwen3tts-browser": fileURLToPath(
        new URL("../browser-sdk/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    ...(engine
      ? {
          proxy: {
            "/engine": {
              target: engine,
              changeOrigin: true,
              ws: true,
              rewrite: (path: string) => path.replace(/^\/engine/, ""),
            },
          },
        }
      : {}),
  },
  build: { target: "es2022", sourcemap: false },
});
