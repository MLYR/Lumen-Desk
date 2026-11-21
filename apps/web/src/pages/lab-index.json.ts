import type { APIRoute } from "astro";

// 试验场具体实验路由已由 API 从 SQLite labs 表动态合并到 /sitemap.xml，
// 由 scripts/split-private.mjs 搬进 dist-shell，api 读它来生成 /sitemap.xml。
export const GET: APIRoute = async () =>
  new Response(JSON.stringify({ routes: ["/lab/"] }, null, 2) + "\n", {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
