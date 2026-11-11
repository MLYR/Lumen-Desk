import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// 试验场内容模型（ROADMAP P3-1）：一个实验一个 md 文件。
// 加实验 = 建 src/content/lab/<slug>.md + 一个页面；/lab/ 卡片墙、首页试验场模块和
// /sitemap.xml 里的实验条目都从这份数据来，不用改别的代码。
const lab = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/lab" }),
  schema: z.object({
    name: z.string(),
    summary: z.string(),
    /** 卡片左上角小字，例如 THREE.JS · 交互 3D */
    kicker: z.string(),
    /** 卡片底部状态，例如 WebGL · 已完成 */
    status: z.string(),
    /** 卡片封面，放 public 下的路径；没有就只显示文字 */
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    /** 主打卡片只认一个；多个 featured 时按 order 取第一个 */
    featured: z.boolean().default(false),
    order: z.number().default(50),
  }),
});

export const collections = { lab };
