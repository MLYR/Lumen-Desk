import http from 'node:http';
import https from 'node:https';
import type { DB } from '../db.js';

export interface ServiceStatus {
  id: 'web' | 'aihot' | 'stats' | 'kuma';
  name: string;
  ok: boolean;
  detail?: string;
}

/** Result of one HTTP probe: a status code, or why there was none. */
export type ProbeResult = { status: number; location?: string } | { error: 'timeout' | 'unreachable' };

export interface ProbeOptions {
  /** Host header to send (Caddy routes by it once SITE_ADDRESS is a domain). */
  host?: string;
  /** TLS server name for https probes (the cert is for the domain, not the container name). */
  servername?: string;
  timeoutMs: number;
}

/** Injectable for tests. Never follows redirects. */
export type Probe = (url: string, opts: ProbeOptions) => Promise<ProbeResult>;

/**
 * One GET with node:http(s), not fetch: fetch (undici) silently replaces a custom Host header
 * with the URL's host, and the stats probe has to reach Caddy as `caddy` while presenting the
 * site's domain. Body is discarded; the socket is destroyed at the deadline.
 */
export const httpProbe: Probe = (url, { host, servername, timeoutMs }) =>
  new Promise((resolve) => {
    let done = false;
    const finish = (r: ProbeResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      { method: 'GET', headers: { ...(host ? { host } : {}), 'user-agent': 'lumen-desk-status' }, ...(servername ? { servername } : {}), timeout: timeoutMs },
      (res) => {
        res.resume();
        const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
        finish({ status: res.statusCode ?? 0, ...(location ? { location } : {}) });
        req.destroy();
      },
    );
    const timer = setTimeout(() => {
      finish({ error: 'timeout' });
      req.destroy();
    }, timeoutMs);
    timer.unref();
    req.on('timeout', () => {
      finish({ error: 'timeout' });
      req.destroy();
    });
    req.on('error', () => finish({ error: 'unreachable' }));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });

const describe = (r: ProbeResult): string => ('error' in r ? (r.error === 'timeout' ? '超时' : '无法连接') : `HTTP ${r.status}`);

export const PROBE_TIMEOUT_MS = 1500;
export const PROBE_TTL_MS = 30_000;
export const AIHOT_STALE_MS = 30 * 60_000;

export interface ProbeTargets {
  /** Caddy on the default network; it proxies /u/script.js to Umami on the stats network. */
  statsUrl: string;
  kumaUrl: string;
  /** Hostname from SITE_URL, sent as Host so Caddy's site block matches after the domain switch. */
  siteHost: string;
}

export const DEFAULT_TARGETS = { statsUrl: 'http://caddy/u/script.js', kumaUrl: 'http://uptime-kuma:3001/' };

/**
 * stats: 200 = ok. A 301/308 to https://<siteHost>/… means Caddy is up and redirects to HTTPS
 * (domain mode), so the same path is checked once more over TLS against Caddy, with the domain
 * as Host and SNI. Both steps share one deadline.
 */
export async function checkStats(probe: Probe, t: ProbeTargets, timeoutMs: number): Promise<ServiceStatus> {
  const base = { id: 'stats' as const, name: '访问统计' };
  const deadline = Date.now() + timeoutMs;
  const first = await probe(t.statsUrl, { host: t.siteHost, timeoutMs });
  if ('status' in first && first.status === 200) return { ...base, ok: true };
  if ('status' in first && (first.status === 308 || first.status === 301) && first.location?.startsWith(`https://${t.siteHost}`)) {
    const left = deadline - Date.now();
    if (left <= 0) return { ...base, ok: false, detail: '超时' };
    const u = new URL(t.statsUrl);
    const second = await probe(`https://${u.host}${u.pathname}`, { host: t.siteHost, servername: t.siteHost, timeoutMs: left });
    if ('status' in second && second.status === 200) return { ...base, ok: true };
    return { ...base, ok: false, detail: describe(second) };
  }
  return { ...base, ok: false, detail: describe(first) };
}

export async function checkKuma(probe: Probe, t: ProbeTargets, timeoutMs: number): Promise<ServiceStatus> {
  const r = await probe(t.kumaUrl, { timeoutMs });
  const ok = 'status' in r && r.status >= 200 && r.status < 400;
  return ok ? { id: 'kuma', name: '网站监控', ok } : { id: 'kuma', name: '网站监控', ok, detail: describe(r) };
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
}

/** Last successful contact with AIHOT (200 or 304): within 30 minutes is ok. */
export function checkAihot(db: DB, nowMs: number): ServiceStatus {
  const row = db.prepare('SELECT fetched_at, checked_at FROM aihot_cache WHERE id = 1').get() as { fetched_at: number | null; checked_at: number | null } | undefined;
  const last = Math.max(row?.fetched_at ?? 0, row?.checked_at ?? 0);
  const base = { id: 'aihot' as const, name: 'AIHOT 同步' };
  if (!last) return { ...base, ok: false, detail: '还没有同步' };
  const age = Math.max(0, nowMs - last);
  return { ...base, ok: age <= AIHOT_STALE_MS, detail: ago(age) };
}

/** Never waits for a probe it already has a result for: past the TTL it returns the old result and refreshes in the background. */
export class ProbeCache {
  private value: ServiceStatus[] | undefined;
  private at = 0;
  private inflight: Promise<ServiceStatus[]> | undefined;

  constructor(
    private readonly run: () => Promise<ServiceStatus[]>,
    private readonly now: () => number,
    private readonly ttlMs = PROBE_TTL_MS,
  ) {}

  private refresh(): Promise<ServiceStatus[]> {
    this.inflight ??= this.run()
      .then((v) => {
        this.value = v;
        this.at = this.now();
        return v;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  async get(): Promise<ServiceStatus[]> {
    if (this.value === undefined) return this.refresh();
    if (this.now() - this.at >= this.ttlMs) void this.refresh().catch(() => {});
    return this.value;
  }
}

/** Wraps a probe-based check so a misbehaving probe can't hold the request past the deadline. */
export function withDeadline(p: Promise<ServiceStatus>, fallback: ServiceStatus, ms: number): Promise<ServiceStatus> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve({ ...fallback, detail: '无法连接' });
      },
    );
  });
}
