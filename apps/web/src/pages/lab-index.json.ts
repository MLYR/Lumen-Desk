import type { APIRoute } from "astro";
import { labItems } from "../lib/lab";

// 构建时把试验场里所有已做出来的路由写成 dist/lab-index.json，
// 由 scripts/split-private.mjs 搬进 dist-shell，api 读它来生成 /sitemap.xml。
// 不放公开目录：这份清单只是内部数据，没必要成为可下载的站点地图副本。
export const GET: APIRoute = async () => {
  const items = await labItems();
  const routes = ["/lab/", ...items.map((item) => item.href)];
  return new Response(JSON.stringify({ routes }, null, 2) + "\n", {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
