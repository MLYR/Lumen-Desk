import { getCollection } from "astro:content";

/** 试验场里一个实验的卡片数据，页面路由由文件名决定：/lab/<slug>/ */
export interface LabItem {
  id: string;
  href: string;
  name: string;
  summary: string;
  kicker: string;
  status: string;
  cover?: string;
  coverAlt?: string;
  featured: boolean;
  order: number;
}

/** 全部实验，按 order 再按名字排。列表页、首页和 sitemap 都用这一份。 */
export async function labItems(): Promise<LabItem[]> {
  const entries = await getCollection("lab");
  return entries
    .map((entry) => ({ id: entry.id, href: `/lab/${entry.id}/`, ...entry.data }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

/** 主打卡片：标了 featured 的第一个，没标就用排第一的。 */
export function featuredOf(items: LabItem[]): LabItem | undefined {
  return items.find((item) => item.featured) ?? items[0];
}

/** 首页只放主打卡片加最多三张小卡，剩下的走「全部实验」。 */
export function homeLabItems(items: LabItem[], max = 4): LabItem[] {
  const featured = featuredOf(items);
  if (!featured) return [];
  return [featured, ...items.filter((item) => item !== featured).slice(0, Math.max(0, max - 1))];
}
