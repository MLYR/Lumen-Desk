import { defineConfig } from "astro/config";

// 纯静态输出。/console 构建成 dist/console/index.html，随后由 scripts/split-private.mjs 移到 dist-private/。
export default defineConfig({
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  vite: {
    server: {
      proxy: { "/api": "http://localhost:3000" },
    },
    preview: {
      proxy: { "/api": "http://localhost:3000" },
    },
  },
});
