// 公开主页 GitHub 贡献热力图：运行时从 /api/github 拉取缓存数据，未配置时保持隐藏。
// 所有外部文本走 textContent，链接严格校验 https://github.com/。
export type ContributionDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type GithubPayload = {
  enabled: boolean;
  username: string | null;
  profileUrl: string | null;
  totalContributions: number;
  weeks: ContributionDay[][];
  updatedAt: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function safeGithubUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "github.com" ? u.href : null;
  } catch {
    return null;
  }
}

function computeStats(weeks: ContributionDay[][]) {
  const flat: ContributionDay[] = [];
  for (const w of weeks) {
    for (const d of w) {
      if (d && DATE_RE.test(d.date) && Number.isFinite(d.count)) flat.push(d);
    }
  }
  flat.sort((a, b) => a.date.localeCompare(b.date));

  let activeDays = 0;
  let longest = 0;
  let run = 0;
  for (const d of flat) {
    if (d.count > 0) {
      activeDays++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  // 当前连续：从最后一天往回数；若当天还没提交（count === 0），允许从前一天续算。
  let current = 0;
  let idx = flat.length - 1;
  if (idx >= 0 && flat[idx]!.count === 0) idx--;
  while (idx >= 0 && flat[idx]!.count > 0) {
    current++;
    idx--;
  }

  return {
    activeDays,
    longest,
    current,
    firstDate: flat[0]?.date ?? "",
    lastDate: flat[flat.length - 1]?.date ?? "",
  };
}

function dayOfWeek(dateStr: string): number {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(t) ? 0 : new Date(t).getUTCDay();
}

export function renderGithubHeatmap(data: GithubPayload, root: HTMLElement): boolean {
  if (!data?.enabled || !Array.isArray(data.weeks) || !data.weeks.length) {
    root.hidden = true;
    return false;
  }

  const weeks = data.weeks
    .map((w) =>
      Array.isArray(w)
        ? w.filter((d) => d && typeof d.date === "string" && DATE_RE.test(d.date) && Number.isFinite(d.count))
        : [],
    )
    .filter((w) => w.length > 0);
  if (!weeks.length) {
    root.hidden = true;
    return false;
  }

  const stats = computeStats(weeks);
  const total = Number.isFinite(data.totalContributions) ? Math.max(0, Math.trunc(data.totalContributions)) : 0;

  const linkEl = root.querySelector<HTMLAnchorElement>("#ghProfileLink");
  const href = safeGithubUrl(data.profileUrl);
  if (linkEl) {
    if (href && data.username) {
      linkEl.href = href;
      linkEl.textContent = `@${data.username} →`;
      linkEl.hidden = false;
    } else {
      linkEl.hidden = true;
    }
  }

  const setNum = (id: string, val: string) => {
    const el = root.querySelector<HTMLElement>(`#${id}`);
    if (el) el.textContent = val;
  };
  setNum("ghTotal", total.toLocaleString("zh-CN"));
  setNum("ghActive", `${stats.activeDays} 天`);
  setNum("ghLongest", `${stats.longest} 天`);
  setNum("ghCurrent", `${stats.current} 天`);

  const monthsEl = root.querySelector<HTMLElement>("#ghMonths");
  const cellsEl = root.querySelector<HTMLElement>("#ghCells");
  const readoutEl = root.querySelector<HTMLElement>("#ghReadout");
  const scrollEl = root.querySelector<HTMLElement>("#ghScroll");
  if (!monthsEl || !cellsEl || !readoutEl) return false;

  const colCount = weeks.length;
  monthsEl.style.setProperty("--weeks", String(colCount));
  cellsEl.style.setProperty("--weeks", String(colCount));
  monthsEl.replaceChildren();
  cellsEl.replaceChildren();

  let prevMonth = "";
  let lastLabelCol = -4;
  const cellsFrag = document.createDocumentFragment();
  const monthsFrag = document.createDocumentFragment();

  weeks.forEach((week, col) => {
    const first = week[0]!;
    const month = first.date.slice(0, 7);
    if (month !== prevMonth) {
      prevMonth = month;
      if (col - lastLabelCol >= 3 && (col < colCount - 1 || colCount <= 4)) {
        const mNum = Number(first.date.slice(5, 7));
        const span = document.createElement("span");
        span.className = "gh-m";
        span.style.gridColumn = String(col + 1);
        span.textContent = `${mNum}月`;
        monthsFrag.append(span);
        lastLabelCol = col;
      }
    }

    for (const day of week) {
      const lv = Math.max(0, Math.min(4, Math.trunc(day.level))) as 0 | 1 | 2 | 3 | 4;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gh-cell lv-${lv}`;
      btn.style.gridColumn = String(col + 1);
      btn.style.gridRow = String(dayOfWeek(day.date) + 1);
      const label = `${day.date} · ${day.count} 次贡献`;
      btn.dataset.info = label;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      cellsFrag.append(btn);
    }
  });

  monthsEl.append(monthsFrag);
  cellsEl.append(cellsFrag);

  const defaultReadout = stats.firstDate && stats.lastDate ? `${stats.firstDate} — ${stats.lastDate}` : "近一年贡献记录";
  readoutEl.textContent = defaultReadout;
  cellsEl.dataset.defaultReadout = defaultReadout;

  if (!cellsEl.dataset.bound) {
    cellsEl.dataset.bound = "1";
    const showCell = (target: EventTarget | null) => {
      const cell = (target as HTMLElement | null)?.closest?.<HTMLElement>(".gh-cell");
      if (cell?.dataset.info) readoutEl.textContent = cell.dataset.info;
    };
    const resetReadout = () => {
      readoutEl.textContent = cellsEl.dataset.defaultReadout ?? "";
    };
    cellsEl.addEventListener("pointerover", (e) => showCell(e.target));
    cellsEl.addEventListener("focusin", (e) => showCell(e.target));
    cellsEl.addEventListener("click", (e) => showCell(e.target));
    cellsEl.addEventListener("pointerleave", resetReadout);
    cellsEl.addEventListener("focusout", resetReadout);
  }

  root.hidden = false;
  if (scrollEl) {
    requestAnimationFrame(() => {
      scrollEl.scrollLeft = scrollEl.scrollWidth;
    });
  }
  return true;
}

export async function startGithubHeatmap() {
  const root = document.getElementById("github");
  if (!root) return;
  try {
    const res = await fetch("/api/github");
    if (!res.ok) return;
    renderGithubHeatmap((await res.json()) as GithubPayload, root);
  } catch {
    root.hidden = true;
  }
}
