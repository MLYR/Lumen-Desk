// 控制台天气小组件（Open-Meteo，经由 /api/private/weather 缓存代理，默认按访问 IP 定位）。
// 所有文本通过 textContent 写入，图标为固定内置 SVG 模板，不拼外部 HTML。
type WeatherIcon = "clear-day" | "clear-night" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "thunder";

type WeatherCurrent = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
  icon: WeatherIcon;
  isDay: boolean;
};

type WeatherDay = {
  date: string;
  weatherCode: number;
  condition: string;
  icon: WeatherIcon;
  tempMin: number;
  tempMax: number;
  precipProb: number | null;
};

type WeatherPayload = {
  mode?: "ip" | "manual";
  province?: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  current: WeatherCurrent | null;
  forecast: WeatherDay[];
  updatedAt: string | null;
  source?: { name: string; url: string };
};

const ICON_SVG: Record<WeatherIcon, string> = {
  "clear-day": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>`,
  "clear-night": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>`,
  "partly-cloudy": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v1.5M5.6 5.6l1.1 1.1M3 12h1.5M18.4 5.6l-1.1 1.1"/><path d="M9.5 10.2a3.5 3.5 0 0 1 5.9-1.5"/><path d="M8 19h9a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.8 12.6 3.2 3.2 0 0 0 8 19Z"/></svg>`,
  cloudy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 19h9.5a4.5 4.5 0 0 0 .8-8.93A6 6 0 0 0 6.3 11.4 3.8 3.8 0 0 0 7.5 19Z"/></svg>`,
  fog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 9h16M3 13h18M6 17h12"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.9 8.2 3.5 3.5 0 0 0 7 15Z"/><path d="M8.5 18l-1 3M13 18l-1 3M17.5 18l-1 3"/></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.9 8.2 3.5 3.5 0 0 0 7 15Z"/><path d="M9 18.5h.01M12.5 20.5h.01M16 18.5h.01"/></svg>`,
  thunder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 14.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.9 7.7 3.5 3.5 0 0 0 7 14.5Z"/><path d="M13 13l-2.5 4.5h3L11.5 22"/></svg>`,
};

const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg>`;

const WEEK = "日一二三四五六";
const REFRESH_MS = 15 * 60_000;
const DIRECT_CITIES = new Set(["北京", "天津", "上海", "重庆", "香港", "澳门"]);
const PROV_SUFFIX_RE = /(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/;
const CITY_SUFFIX_RE = /(?:自治州|地区|特别行政区|市|盟|县|区)$/;

const fmtTemp = (n: number) => `${Math.round(n)}°`;

function stripProv(s: string): string {
  const t = s.trim();
  const r = t.replace(PROV_SUFFIX_RE, "");
  return r.length >= 2 ? r : t;
}

function stripCity(s: string): string {
  const t = s.trim();
  if (t.length <= 2) return t;
  const r = t.replace(CITY_SUFFIX_RE, "");
  return r.length >= 2 ? r : t;
}

export function formatProvinceCity(province?: string, city?: string): string {
  const p = (province || "").trim();
  const c = (city || "").trim();
  if (!p) return c;
  if (!c) return p;
  const pShort = stripProv(p);
  if (p === c || (DIRECT_CITIES.has(pShort) && pShort === stripCity(c))) {
    return p.length >= c.length ? p : c;
  }
  if (c.startsWith(p)) return `${p} ${c.slice(p.length).trim()}`.trim();
  return `${p} ${c}`;
}

function formatCoord(label: string, lat: number, lon: number): string {
  const ns = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `// ${label} · ${ns} ${ew}`;
}

function dayLabel(dateStr: string, index: number): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  if (dateStr === fmt(new Date(y, m, d))) return "今天";
  if (dateStr === fmt(new Date(y, m, d + 1))) return "明天";
  if (dateStr === fmt(new Date(y, m, d + 2))) return "后天";
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (!Number.isNaN(parsed.getTime())) return `周${WEEK[parsed.getDay()]}`;
  return ["今天", "明天", "后天"][index] ?? dateStr;
}

function makeIcon(icon: WeatherIcon, cls: string): HTMLSpanElement {
  const span = document.createElement("span");
  const safeIcon: WeatherIcon = Object.prototype.hasOwnProperty.call(ICON_SVG, icon) ? icon : "cloudy";
  span.className = cls + (safeIcon === "clear-day" || safeIcon === "thunder" ? " accent" : "");
  span.innerHTML = ICON_SVG[safeIcon];
  return span;
}

function makeLocBadge(label: string, mode?: "ip" | "manual"): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "wx-loc";
  a.href = "/console/settings#weather";
  a.title = mode === "manual" ? "手动指定位置 · 点击前往设置修改" : "按访问 IP 自动定位 · 点击前往设置修改";
  const ic = document.createElement("span");
  ic.className = "wx-loc-ic";
  ic.innerHTML = PIN_SVG;
  const txt = document.createElement("span");
  txt.className = "wx-loc-t";
  txt.textContent = label;
  a.append(ic, txt);
  return a;
}

function render(data: WeatherPayload) {
  const locLabel = formatProvinceCity(data.province, data.city);
  const coord = document.getElementById("heroCoord");
  if (coord && locLabel && Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
    coord.textContent = formatCoord(locLabel, data.latitude, data.longitude);
  }

  const box = document.getElementById("weather");
  const nowEl = document.getElementById("wxNow");
  const daysEl = document.getElementById("wxDays");
  if (!box || !nowEl || !daysEl) return;

  box.hidden = false;
  nowEl.replaceChildren();
  daysEl.replaceChildren();

  if (locLabel) {
    nowEl.append(makeLocBadge(locLabel, data.mode));
  }

  if (!data.current) {
    const msg = document.createElement("span");
    msg.className = "wx-empty";
    msg.textContent = "天气暂不可用";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wx-retry";
    btn.textContent = "重试";
    btn.addEventListener("click", () => { void load(true); });
    nowEl.append(msg, btn);
    daysEl.hidden = true;
    return;
  }

  const c = data.current;
  const main = document.createElement("div");
  main.className = "wx-main";
  const temp = document.createElement("span");
  temp.className = "wx-temp";
  temp.textContent = fmtTemp(c.temperature);
  const cond = document.createElement("span");
  cond.className = "wx-cond";
  cond.textContent = c.condition;
  main.append(makeIcon(c.icon, "wx-ic"), temp, cond);

  const meta = document.createElement("div");
  meta.className = "wx-meta";
  meta.textContent = `体感 ${fmtTemp(c.apparentTemperature)} · 湿度 ${c.humidity}% · 风 ${Math.round(c.windSpeed)} km/h`;
  if (data.updatedAt) {
    const t = new Date(data.updatedAt);
    if (!Number.isNaN(t.getTime())) {
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      box.title = `Open-Meteo 更新于 ${hh}:${mm}`;
    }
  }
  nowEl.append(main, meta);

  const days = Array.isArray(data.forecast) ? data.forecast.slice(0, 3) : [];
  daysEl.hidden = days.length === 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "wx-day-n";
    name.textContent = dayLabel(d.date, i);
    const desc = document.createElement("span");
    desc.className = "wx-day-c";
    desc.textContent = d.condition;
    const range = document.createElement("span");
    range.className = "wx-day-r";
    range.textContent = `${fmtTemp(d.tempMin)}/${fmtTemp(d.tempMax)}`;
    li.append(name, makeIcon(d.icon, "wx-ic sm"), desc, range);
    if (d.precipProb !== null && d.precipProb >= 10) {
      const prob = document.createElement("span");
      prob.className = "wx-day-p";
      prob.textContent = `${d.precipProb}%`;
      prob.title = `降水概率 ${d.precipProb}%`;
      li.append(prob);
    }
    daysEl.append(li);
  }
}

function renderFail() {
  const box = document.getElementById("weather");
  const nowEl = document.getElementById("wxNow");
  const daysEl = document.getElementById("wxDays");
  if (!box || !nowEl || !daysEl) return;
  box.hidden = false;
  nowEl.replaceChildren();
  daysEl.replaceChildren();
  daysEl.hidden = true;
  const msg = document.createElement("span");
  msg.className = "wx-empty";
  msg.textContent = "天气加载失败";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wx-retry";
  btn.textContent = "重试";
  btn.addEventListener("click", () => { void load(true); });
  nowEl.append(msg, btn);
}

let busy = false;
let lastLoaded = 0;

async function load(force = false) {
  if (busy) return;
  if (!force && lastLoaded && Date.now() - lastLoaded < 60_000) return;
  busy = true;
  try {
    const res = await fetch("/api/private/weather", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) {
      location.href = "/login";
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()) as WeatherPayload);
    lastLoaded = Date.now();
  } catch {
    renderFail();
  } finally {
    busy = false;
  }
}

export function startWeatherCard() {
  if (!document.hidden) void load(true);
  setInterval(() => {
    if (!document.hidden) void load(true);
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoaded >= REFRESH_MS) void load(true);
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) void load(true);
  });
}
