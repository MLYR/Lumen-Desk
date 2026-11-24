import { kvGet, kvSet, type DB } from '../db.js';
import { BAD_CHARS, InputError, visible } from '../http.js';
import {
  CN_PROVINCES,
  findCnByCode,
  findCnByName,
  searchCnCities,
  stripCitySuffix,
} from './cn-cities.js';

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const PCONLINE_IP_URL = 'https://whois.pconline.com.cn/ipJson.jsp';
export const IPWHO_URL = 'https://ipwho.is';
export const IPAPI_URL = 'http://ip-api.com/json';
export const WEATHER_SOURCE = { name: 'Open-Meteo', url: 'https://open-meteo.com' } as const;
export const WEATHER_MAX_AGE_MS = 12 * 3600_000;
export const WEATHER_REFRESH_MS = 30 * 60_000;
export const IP_CACHE_TTL_MS = 6 * 3600_000;
export const IP_FAIL_TTL_MS = 60_000;

const TIMEOUT_MS = 15_000;
const GEO_TIMEOUT_MS = 4_500;
const WEATHER_SETTINGS_KEY = 'weather_settings';
const TIMEZONE_RE = /^[A-Za-z0-9_/+.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type WeatherMode = 'ip' | 'manual';

export type WeatherIcon =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunder';

export interface WeatherLocation {
  province?: string;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WeatherSettings {
  mode: WeatherMode;
  province: string;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WeatherCurrent {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
  icon: WeatherIcon;
  isDay: boolean;
}

export interface WeatherDay {
  date: string;
  weatherCode: number;
  condition: string;
  icon: WeatherIcon;
  tempMin: number;
  tempMax: number;
  precipProb: number | null;
}

export interface WeatherResponse {
  mode: WeatherMode;
  province: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
  current: WeatherCurrent | null;
  forecast: WeatherDay[];
  updatedAt: string | null;
  source: typeof WEATHER_SOURCE;
}

export interface WeatherSearchItem {
  province: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
}

interface StoredWeather {
  current: WeatherCurrent;
  forecast: WeatherDay[];
}

interface WeatherRow {
  location: string | null;
  payload: string | null;
  fetched_at: number | null;
}

type FetchFn = typeof fetch;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const charLen = (s: string): number => [...s].length;

export function inferProvince(city: string): string {
  return findCnByName('', city)?.province ?? '';
}

export function resolveProvince(loc: WeatherLocation): string {
  if (loc.province !== undefined) return loc.province.trim();
  return inferProvince(loc.city);
}

export function locationKey(loc: WeatherLocation): string {
  return JSON.stringify([resolveProvince(loc), loc.city.trim(), round2(loc.lat), round2(loc.lon), loc.timezone]);
}

export function parseLocationKey(key: string | null | undefined): WeatherLocation | null {
  if (!key) return null;
  try {
    const arr = JSON.parse(key) as unknown;
    if (!Array.isArray(arr) || arr.length !== 5) return null;
    const [province, city, lat, lon, timezone] = arr;
    if (
      typeof province !== 'string' ||
      typeof city !== 'string' ||
      !city ||
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      typeof lon !== 'number' ||
      !Number.isFinite(lon) ||
      typeof timezone !== 'string' ||
      !TIMEZONE_RE.test(timezone)
    ) {
      return null;
    }
    return { province, city, lat, lon, timezone };
  } catch {
    return null;
  }
}

/* ---------- Settings (kv.weather_settings) ---------- */

export function getWeatherSettings(db: DB, fallback: WeatherLocation): WeatherSettings {
  const def: WeatherSettings = {
    mode: 'ip',
    province: resolveProvince(fallback),
    city: fallback.city,
    lat: round2(fallback.lat),
    lon: round2(fallback.lon),
    timezone: fallback.timezone,
  };
  const raw = kvGet(db, WEATHER_SETTINGS_KEY);
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as Partial<WeatherSettings>;
    const mode: WeatherMode = parsed.mode === 'manual' ? 'manual' : 'ip';
    const province = typeof parsed.province === 'string' && !BAD_CHARS.test(parsed.province) ? parsed.province.trim().slice(0, 30) : def.province;
    const city = typeof parsed.city === 'string' && visible(parsed.city) && !BAD_CHARS.test(parsed.city) ? parsed.city.trim().slice(0, 40) : def.city;
    const lat = typeof parsed.lat === 'number' && Number.isFinite(parsed.lat) && parsed.lat >= -90 && parsed.lat <= 90 ? round2(parsed.lat) : def.lat;
    const lon = typeof parsed.lon === 'number' && Number.isFinite(parsed.lon) && parsed.lon >= -180 && parsed.lon <= 180 ? round2(parsed.lon) : def.lon;
    const timezone = typeof parsed.timezone === 'string' && TIMEZONE_RE.test(parsed.timezone.trim()) ? parsed.timezone.trim() : def.timezone;
    return { mode, province, city, lat, lon, timezone };
  } catch {
    return def;
  }
}

function cleanText(v: unknown, label: string, min: number, max: number): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new InputError(`${label}必须是文字`);
  const s = v.trim();
  if (charLen(s) < min || charLen(s) > max) {
    throw new InputError(min ? `${label}长度需在 ${min}–${max} 字之间` : `${label}最多 ${max} 字`);
  }
  if (BAD_CHARS.test(s)) throw new InputError(`${label}含有不允许的字符`);
  if (min && !visible(s)) throw new InputError(`${label}不能为空`);
  return s;
}

function cleanCoord(v: unknown, label: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label}必须在 ${min} 到 ${max} 之间`);
  return round2(n);
}

export function parseWeatherSettings(body: unknown, current: WeatherSettings): WeatherSettings {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求体必须是对象');
  const b = body as Record<string, unknown>;
  if (b.mode !== 'ip' && b.mode !== 'manual') throw new InputError('定位方式只能是 ip 或 manual');
  const mode: WeatherMode = b.mode;

  const hasManualFields = b.city !== undefined || b.lat !== undefined || b.lon !== undefined || b.province !== undefined || b.timezone !== undefined;
  if (mode === 'ip' && !hasManualFields) {
    return { ...current, mode: 'ip' };
  }

  const province = b.province === undefined ? current.province : cleanText(b.province, '省份', 0, 30);
  const city = b.city === undefined && mode === 'ip' ? current.city : cleanText(b.city, '城市', 1, 40);
  const lat = b.lat === undefined && mode === 'ip' ? current.lat : cleanCoord(b.lat, '纬度', -90, 90);
  const lon = b.lon === undefined && mode === 'ip' ? current.lon : cleanCoord(b.lon, '经度', -180, 180);
  const tzRaw = b.timezone === undefined || b.timezone === '' ? current.timezone : typeof b.timezone === 'string' ? b.timezone.trim() : '';
  if (!TIMEZONE_RE.test(tzRaw)) throw new InputError('时区格式不正确');

  return { mode, province, city, lat, lon, timezone: tzRaw };
}

export function saveWeatherSettings(db: DB, next: WeatherSettings): WeatherSettings {
  kvSet(db, WEATHER_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/* ---------- Client IP Classification & Geolocation ---------- */

export type ClassifiedIp = { kind: 'private' } | { kind: 'ipv4'; ip: string } | { kind: 'ipv6'; ip: string };

export function classifyIp(raw: string | undefined): ClassifiedIp {
  if (!raw) return { kind: 'private' };
  let ip = raw.trim().replace(/%[^%]+$/, '');
  if (!ip || ip === 'unknown') return { kind: 'private' };
  if (/^::ffff:/i.test(ip)) ip = ip.slice(7);
  // Strip port on IPv4:port if present
  const v4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4Port) ip = v4Port[1]!;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n < 0 || n > 255)) return { kind: 'private' };
    const [a, b] = octets as [number, number, number, number];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    ) {
      return { kind: 'private' };
    }
    return { kind: 'ipv4', ip };
  }

  if (ip.includes(':') && ip.length <= 45 && /^[0-9a-fA-F:]+$/.test(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/.test(lower)
    ) {
      return { kind: 'private' };
    }
    return { kind: 'ipv6', ip: lower };
  }

  return { kind: 'private' };
}

async function lookupViaPconline(cls: ClassifiedIp, fetchFn: FetchFn, siteUrl: string): Promise<WeatherLocation | null> {
  if (cls.kind === 'ipv6') return null;
  const url =
    cls.kind === 'ipv4'
      ? `${PCONLINE_IP_URL}?ip=${encodeURIComponent(cls.ip)}&json=true`
      : `${PCONLINE_IP_URL}?json=true`;
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': `lumen-desk/1.0 (+${siteUrl})` },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    let text = '';
    try {
      text = new TextDecoder('gb18030').decode(buf);
    } catch {
      text = new TextDecoder('utf-8').decode(buf);
    }
    const data = JSON.parse(text.trim()) as {
      pro?: string;
      proCode?: string;
      city?: string;
      cityCode?: string;
      region?: string;
      regionCode?: string;
    };
    const match =
      findCnByCode(data.proCode, data.cityCode, data.regionCode) ??
      findCnByName(String(data.pro ?? ''), String(data.city ?? ''));
    if (!match) return null;
    return {
      province: match.province,
      city: match.city,
      lat: match.lat,
      lon: match.lon,
      timezone: 'Asia/Shanghai',
    };
  } catch {
    return null;
  }
}

async function lookupViaIpwho(
  cls: ClassifiedIp,
  fallbackTz: string,
  fetchFn: FetchFn,
  siteUrl: string,
): Promise<WeatherLocation | null> {
  const pathPart = cls.kind === 'private' ? '' : encodeURIComponent(cls.ip);
  try {
    const res = await fetchFn(`${IPWHO_URL}/${pathPart}?lang=zh-CN`, {
      headers: { Accept: 'application/json', 'User-Agent': `lumen-desk/1.0 (+${siteUrl})` },
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data.success === false) return null;
    const lat = Number(data.latitude);
    const lon = Number(data.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    if (data.country_code === 'CN') {
      const cn = findCnByName(String(data.region ?? ''), String(data.city ?? ''));
      if (cn) return { province: cn.province, city: cn.city, lat: round2(lat), lon: round2(lon), timezone: 'Asia/Shanghai' };
    }
    const region = typeof data.region === 'string' ? data.region.trim() : '';
    const country = typeof data.country === 'string' ? data.country.trim() : '';
    const city = typeof data.city === 'string' && data.city.trim() ? data.city.trim() : region || country;
    if (!city) return null;
    const province = data.country_code === 'CN' ? region : [country, region].filter(Boolean).join(' ');
    const tzObj = data.timezone;
    const tzRaw =
      tzObj && typeof tzObj === 'object' && typeof (tzObj as { id?: unknown }).id === 'string'
        ? ((tzObj as { id: string }).id).trim()
        : typeof tzObj === 'string'
          ? tzObj.trim()
          : '';
    const timezone = TIMEZONE_RE.test(tzRaw) ? tzRaw : fallbackTz;
    return { province: province.slice(0, 30), city: city.slice(0, 40), lat: round2(lat), lon: round2(lon), timezone };
  } catch {
    return null;
  }
}

async function lookupViaIpApi(
  cls: ClassifiedIp,
  fallbackTz: string,
  fetchFn: FetchFn,
  siteUrl: string,
): Promise<WeatherLocation | null> {
  const pathPart = cls.kind === 'private' ? '' : encodeURIComponent(cls.ip);
  try {
    const res = await fetchFn(
      `${IPAPI_URL}/${pathPart}?fields=status,country,countryCode,regionName,city,lat,lon,timezone&lang=zh-CN`,
      {
        headers: { Accept: 'application/json', 'User-Agent': `lumen-desk/1.0 (+${siteUrl})` },
        signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data.status !== 'success') return null;
    const lat = Number(data.lat);
    const lon = Number(data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    if (data.countryCode === 'CN') {
      const cn = findCnByName(String(data.regionName ?? ''), String(data.city ?? ''));
      if (cn) return { province: cn.province, city: cn.city, lat: round2(lat), lon: round2(lon), timezone: 'Asia/Shanghai' };
    }
    const region = typeof data.regionName === 'string' ? data.regionName.trim() : '';
    const country = typeof data.country === 'string' ? data.country.trim() : '';
    const city = typeof data.city === 'string' && data.city.trim() ? data.city.trim() : region || country;
    if (!city) return null;
    const province = data.countryCode === 'CN' ? region : [country, region].filter(Boolean).join(' ');
    const tzRaw = typeof data.timezone === 'string' ? data.timezone.trim() : '';
    const timezone = TIMEZONE_RE.test(tzRaw) ? tzRaw : fallbackTz;
    return { province: province.slice(0, 30), city: city.slice(0, 40), lat: round2(lat), lon: round2(lon), timezone };
  } catch {
    return null;
  }
}

export class IpLocationCache {
  private readonly entries = new Map<string, { loc: WeatherLocation; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<WeatherLocation>>();

  async resolve(
    rawIp: string | undefined,
    fallback: WeatherLocation,
    opts: { fetchFn?: FetchFn; siteUrl: string; now: () => number; force?: boolean },
  ): Promise<WeatherLocation> {
    const fallbackFull: WeatherLocation = { ...fallback, province: resolveProvince(fallback) };
    if (!opts.fetchFn) return fallbackFull;

    const cls = classifyIp(rawIp);
    const key = cls.kind === 'private' ? 'self' : cls.ip;
    const t = opts.now();

    if (!opts.force) {
      const hit = this.entries.get(key);
      if (hit && hit.expiresAt > t) return hit.loc;
    }

    const pending = this.inflight.get(key);
    if (pending && !opts.force) return pending;

    const task = (async (): Promise<WeatherLocation> => {
      try {
        const resolved =
          (await lookupViaPconline(cls, opts.fetchFn!, opts.siteUrl)) ??
          (await lookupViaIpwho(cls, fallbackFull.timezone, opts.fetchFn!, opts.siteUrl)) ??
          (await lookupViaIpApi(cls, fallbackFull.timezone, opts.fetchFn!, opts.siteUrl));

        const nowMs = opts.now();
        if (this.entries.size >= 128) {
          const oldest = this.entries.keys().next().value;
          if (oldest !== undefined) this.entries.delete(oldest);
        }
        if (resolved) {
          this.entries.set(key, { loc: resolved, expiresAt: nowMs + IP_CACHE_TTL_MS });
          return resolved;
        }
        this.entries.set(key, { loc: fallbackFull, expiresAt: nowMs + IP_FAIL_TTL_MS });
        return fallbackFull;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, task);
    return task;
  }
}

/* ---------- City Search (Local CN + Open-Meteo Geocoding supplement) ---------- */

async function fetchOpenMeteoGeo(query: string, fetchFn: FetchFn, siteUrl: string): Promise<WeatherSearchItem[]> {
  const params = new URLSearchParams({ name: query, count: '8', language: 'zh', format: 'json' });
  const res = await fetchFn(`${OPEN_METEO_GEO_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': `lumen-desk/1.0 (+${siteUrl})` },
    signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  if (!Array.isArray(data.results)) return [];
  const out: WeatherSearchItem[] = [];
  for (const r of data.results) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cc = typeof r.country_code === 'string' ? r.country_code.toUpperCase() : '';
    const country = typeof r.country === 'string' ? r.country.trim() : cc;
    const admin1 = typeof r.admin1 === 'string' ? r.admin1.trim() : '';
    const admin2 = typeof r.admin2 === 'string' ? r.admin2.trim() : '';
    const tzRaw = typeof r.timezone === 'string' ? r.timezone.trim() : '';
    const timezone = TIMEZONE_RE.test(tzRaw) ? tzRaw : 'Asia/Shanghai';

    let province = admin1;
    let city = name;
    if (cc === 'CN') {
      province = findCnByName(admin1, '')?.province ?? admin1;
      if (admin2 && stripCitySuffix(admin2) === stripCitySuffix(name)) city = admin2;
    } else if (country && admin1 && admin1 !== name) {
      province = `${country} ${admin1}`;
    } else if (country && country !== name) {
      province = country;
    }
    out.push({
      province: province.slice(0, 30),
      city: city.slice(0, 40),
      country,
      lat: round2(lat),
      lon: round2(lon),
      timezone,
    });
  }
  return out;
}

export async function searchWeatherLocations(
  query: string,
  opts: { fetchFn?: FetchFn; siteUrl: string },
): Promise<WeatherSearchItem[]> {
  const q = query.trim().slice(0, 40);
  if (!q) return [];
  const out: WeatherSearchItem[] = searchCnCities(q, 10);
  if (out.length >= 6 || !opts.fetchFn) return out;

  try {
    let remote = await fetchOpenMeteoGeo(q, opts.fetchFn, opts.siteUrl);
    const stripped = stripCitySuffix(q);
    if (remote.length === 0 && stripped !== q) {
      remote = await fetchOpenMeteoGeo(stripped, opts.fetchFn, opts.siteUrl);
    }
    for (const item of remote) {
      const dup = out.some((x) => Math.abs(x.lat - item.lat) < 0.08 && Math.abs(x.lon - item.lon) < 0.08);
      if (!dup) out.push(item);
      if (out.length >= 12) break;
    }
  } catch {
    // Open-Meteo geocoding may fail/reset on some networks; local CN results still work.
  }
  return out;
}

export function listCnProvinceOptions(): Array<{ name: string; cities: Array<{ name: string; lat: number; lon: number }> }> {
  return CN_PROVINCES.map((p) => ({
    name: p.name,
    cities: p.cities.map((c) => ({ name: c.name, lat: c.lat, lon: c.lon })),
  }));
}

/* ---------- Open-Meteo Forecast Mapping & SQLite Cache ---------- */

/** Maps WMO 4677 weather codes returned by Open-Meteo to Simplified Chinese + minimal icon key. */
export function describeWmo(code: number, isDay = true): { condition: string; icon: WeatherIcon } {
  const clear: WeatherIcon = isDay ? 'clear-day' : 'clear-night';
  switch (code) {
    case 0: return { condition: '晴', icon: clear };
    case 1: return { condition: '大部晴朗', icon: clear };
    case 2: return { condition: '多云', icon: 'partly-cloudy' };
    case 3: return { condition: '阴', icon: 'cloudy' };
    case 45: return { condition: '雾', icon: 'fog' };
    case 48: return { condition: '冻雾', icon: 'fog' };
    case 51: return { condition: '毛毛雨', icon: 'rain' };
    case 53: return { condition: '细雨', icon: 'rain' };
    case 55: return { condition: '密毛毛雨', icon: 'rain' };
    case 56: return { condition: '冻毛毛雨', icon: 'rain' };
    case 57: return { condition: '强冻毛毛雨', icon: 'rain' };
    case 61: return { condition: '小雨', icon: 'rain' };
    case 63: return { condition: '中雨', icon: 'rain' };
    case 65: return { condition: '大雨', icon: 'rain' };
    case 66: return { condition: '冻雨', icon: 'rain' };
    case 67: return { condition: '强冻雨', icon: 'rain' };
    case 71: return { condition: '小雪', icon: 'snow' };
    case 73: return { condition: '中雪', icon: 'snow' };
    case 75: return { condition: '大雪', icon: 'snow' };
    case 77: return { condition: '米雪', icon: 'snow' };
    case 80: return { condition: '阵雨', icon: 'rain' };
    case 81: return { condition: '强阵雨', icon: 'rain' };
    case 82: return { condition: '暴雨', icon: 'rain' };
    case 85: return { condition: '阵雪', icon: 'snow' };
    case 86: return { condition: '强阵雪', icon: 'snow' };
    case 95: return { condition: '雷阵雨', icon: 'thunder' };
    case 96: return { condition: '雷阵雨伴冰雹', icon: 'thunder' };
    case 99: return { condition: '强雷阵雨伴冰雹', icon: 'thunder' };
    default: return { condition: '多云', icon: 'cloudy' };
  }
}

export function mapWeather(payload: unknown): StoredWeather | null {
  if (!payload || typeof payload !== 'object') return null;
  const cur = (payload as { current?: Record<string, unknown> }).current;
  if (!cur || typeof cur !== 'object') return null;

  const temp = Number(cur.temperature_2m);
  const code = Number(cur.weather_code);
  if (!Number.isFinite(temp) || !Number.isFinite(code)) return null;

  const apparentRaw = Number(cur.apparent_temperature);
  const humidityRaw = Number(cur.relative_humidity_2m);
  const windRaw = Number(cur.wind_speed_10m);
  const isDay = Number(cur.is_day) !== 0;
  const desc = describeWmo(Math.trunc(code), isDay);

  const current: WeatherCurrent = {
    temperature: round1(temp),
    apparentTemperature: Number.isFinite(apparentRaw) ? round1(apparentRaw) : round1(temp),
    humidity: Number.isFinite(humidityRaw) ? Math.max(0, Math.min(100, Math.round(humidityRaw))) : 0,
    windSpeed: Number.isFinite(windRaw) ? Math.max(0, round1(windRaw)) : 0,
    weatherCode: Math.trunc(code),
    condition: desc.condition,
    icon: desc.icon,
    isDay,
  };

  const daily = (payload as { daily?: Record<string, unknown> }).daily;
  const forecast: WeatherDay[] = [];
  if (daily && typeof daily === 'object' && Array.isArray(daily.time)) {
    const codes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
    const maxs = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const mins = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    const probs = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max : [];
    const len = Math.min(daily.time.length, 3);
    for (let i = 0; i < len; i++) {
      const date = typeof daily.time[i] === 'string' ? daily.time[i].trim() : '';
      const dc = Number(codes[i]);
      const tMax = Number(maxs[i]);
      const tMin = Number(mins[i]);
      if (!DATE_RE.test(date) || !Number.isFinite(dc) || !Number.isFinite(tMax) || !Number.isFinite(tMin)) continue;
      const probRaw = probs[i] === null || probs[i] === undefined ? Number.NaN : Number(probs[i]);
      const dDesc = describeWmo(Math.trunc(dc), true);
      forecast.push({
        date,
        weatherCode: Math.trunc(dc),
        condition: dDesc.condition,
        icon: dDesc.icon,
        tempMin: round1(tMin),
        tempMax: round1(tMax),
        precipProb: Number.isFinite(probRaw) ? Math.max(0, Math.min(100, Math.round(probRaw))) : null,
      });
    }
  }

  return { current, forecast };
}

export function buildWeatherUrl(loc: WeatherLocation): string {
  const params = new URLSearchParams({
    latitude: String(round2(loc.lat)),
    longitude: String(round2(loc.lon)),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: loc.timezone,
    forecast_days: '3',
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

export type WeatherRefreshResult = 'updated' | 'error';

export async function refreshWeather(
  db: DB,
  loc: WeatherLocation,
  opts: { siteUrl: string; fetchFn?: FetchFn; now?: () => number },
): Promise<WeatherRefreshResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  db.prepare('INSERT OR IGNORE INTO weather_cache (id) VALUES (1)').run();

  try {
    const res = await fetchFn(buildWeatherUrl(loc), {
      headers: {
        Accept: 'application/json',
        'User-Agent': `lumen-desk/1.0 (+${opts.siteUrl})`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[weather] fetch failed: HTTP ${res.status}`);
      return 'error';
    }
    const mapped = mapWeather(await res.json());
    if (!mapped) {
      console.warn('[weather] unexpected Open-Meteo payload');
      return 'error';
    }
    db.prepare('UPDATE weather_cache SET location = ?, payload = ?, fetched_at = ? WHERE id = 1').run(
      locationKey(loc),
      JSON.stringify(mapped),
      now(),
    );
    return 'updated';
  } catch (e) {
    console.warn(`[weather] fetch failed: ${(e as Error).message}`);
    return 'error';
  }
}

export function getCachedLocation(db: DB): WeatherLocation | null {
  const row = db.prepare('SELECT location FROM weather_cache WHERE id = 1').get() as { location: string | null } | undefined;
  return parseLocationKey(row?.location);
}

export function needsWeatherRefresh(db: DB, loc: WeatherLocation, now = Date.now()): boolean {
  const row = db.prepare('SELECT location, payload, fetched_at FROM weather_cache WHERE id = 1').get() as
    | WeatherRow
    | undefined;
  if (!row?.payload || !row.fetched_at || row.location !== locationKey(loc)) return true;
  return now - row.fetched_at >= WEATHER_REFRESH_MS;
}

export function getWeather(
  db: DB,
  loc: WeatherLocation,
  now = Date.now(),
  mode: WeatherMode = 'ip',
): WeatherResponse {
  const empty: WeatherResponse = {
    mode,
    province: resolveProvince(loc),
    city: loc.city,
    latitude: round2(loc.lat),
    longitude: round2(loc.lon),
    timezone: loc.timezone,
    current: null,
    forecast: [],
    updatedAt: null,
    source: WEATHER_SOURCE,
  };
  const row = db.prepare('SELECT location, payload, fetched_at FROM weather_cache WHERE id = 1').get() as
    | WeatherRow
    | undefined;
  if (!row?.payload || !row.fetched_at || row.location !== locationKey(loc)) return empty;
  if (now - row.fetched_at > WEATHER_MAX_AGE_MS) return empty;
  try {
    const parsed = JSON.parse(row.payload) as StoredWeather;
    if (!parsed?.current) return empty;
    return {
      ...empty,
      current: parsed.current,
      forecast: Array.isArray(parsed.forecast) ? parsed.forecast : [],
      updatedAt: new Date(row.fetched_at).toISOString(),
    };
  } catch {
    return empty;
  }
}
