import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { cpuUsage, parseCpuModel, parseProcStat } from '../src/system/cpu.js';
import { detectVirtual, parseOsRelease } from '../src/system/host.js';
import { parseMeminfo } from '../src/system/mem.js';
import { parseNetDev, pickIface, rate } from '../src/system/net.js';
import { checkKuma, checkStats, httpProbe, ProbeCache, type Probe } from '../src/system/services.js';
import { SECRET, sessionCookie, SHELL_FIXTURE } from './helpers.js';
import * as OTPAuth from 'otpauth';

type Json = Record<string, any>;

const stat = (user: number, idle: number) => `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 ${user} 0 0 ${idle} 0 0 0 0 0 0\n`;
const netDev = (rows: Array<[string, number, number]>) =>
  `Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n${rows
    .map(([i, rx, tx]) => `  ${i}: ${rx} 10 0 0 0 0 0 0 ${tx} 10 0 0 0 0 0 0`)
    .join('\n')}\n`;
const MEMINFO = 'MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    9000000 kB\nSwapTotal:       4096000 kB\nSwapFree:        3072000 kB\n';

/** Fake /proc and /host under a temp dir. */
function fixture(opts: { host?: { osRelease?: string; hostname?: string; netDev?: string } | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-srv-'));
  const proc = path.join(dir, 'proc');
  const host = path.join(dir, 'host');
  fs.mkdirSync(proc);
  fs.writeFileSync(path.join(proc, 'stat'), stat(100, 900));
  fs.writeFileSync(path.join(proc, 'meminfo'), MEMINFO);
  fs.writeFileSync(path.join(proc, 'loadavg'), '0.50 0.40 0.30 1/200 12345\n');
  fs.writeFileSync(path.join(proc, 'uptime'), '432000.55 800000.00\n');
  fs.writeFileSync(path.join(proc, 'cpuinfo'), 'processor\t: 0\nBogoMIPS\t: 48.00\n');
  if (opts.host !== null) {
    fs.mkdirSync(host);
    const h = opts.host ?? {};
    if (h.osRelease !== undefined) fs.writeFileSync(path.join(host, 'os-release'), h.osRelease);
    if (h.hostname !== undefined) fs.writeFileSync(path.join(host, 'hostname'), h.hostname);
    if (h.netDev !== undefined) fs.writeFileSync(path.join(host, 'net_dev'), h.netDev);
  }
  return { dir, proc, host, write: (rel: string, s: string) => fs.writeFileSync(path.join(dir, rel), s) };
}

const okProbe: Probe = async () => ({ status: 200 });

async function serverApp(f: ReturnType<typeof fixture>, extra: { probe?: Probe; env?: NodeJS.ProcessEnv } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-api-'));
  const config = loadConfig({ DATA_DIR: dataDir, TOTP_SECRET: SECRET, SHELL_DIR: SHELL_FIXTURE, SITE_URL: 'https://site.example.test', HOST_ROOT: f.host, ...extra.env });
  const db = openDb(':memory:');
  const clock = { t: Date.UTC(2026, 9, 31, 0, 0, 0) };
  const sleeps: number[] = [];
  const app = createApp({
    config,
    db,
    now: () => clock.t,
    server: {
      procRoot: f.proc,
      probe: extra.probe ?? okProbe,
      // The "200 ms" wait advances the fake clock instead of sleeping.
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    },
  });
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(SECRET), digits: 6, period: 30 });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: totp.generate({ timestamp: clock.t }) }),
  });
  const cookie = sessionCookie(login);
  const get = async () => {
    const res = await app.request('/api/private/server', { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as Json;
  };
  return { app, db, clock, get, sleeps, cookie };
}

describe('system: parsers', () => {
  it('CPU usage from /proc/stat deltas', () => {
    const a = parseProcStat(stat(100, 900))!;
    const b = parseProcStat(stat(130, 970))!;
    expect(a).toEqual({ total: 1000, idle: 900 });
    expect(cpuUsage(a, b)).toBe(30); // 30 busy of 100
    expect(cpuUsage(a, a)).toBe(0);
    expect(cpuUsage(b, a)).toBe(0); // counters went back
    expect(parseProcStat('garbage')).toBeNull();
    // iowait counts as idle; steal as busy
    expect(parseProcStat('cpu  10 0 10 50 20 0 0 10\n')).toEqual({ total: 100, idle: 70 });
  });

  it('CPU model: model name, Hardware, or null', () => {
    expect(parseCpuModel('processor: 0\nmodel name\t: Intel(R) Xeon(R) Platinum\n')).toBe('Intel(R) Xeon(R) Platinum');
    expect(parseCpuModel('processor: 0\nHardware\t: BCM2835\n')).toBe('BCM2835');
    expect(parseCpuModel('processor\t: 0\nBogoMIPS\t: 48.00\nFeatures\t: fp asimd\n')).toBeNull();
  });

  it('meminfo: used = total − available; swap', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      mem: { total: 16384000 * 1024, used: (16384000 - 9000000) * 1024 },
      swap: { total: 4096000 * 1024, used: 1024000 * 1024 },
    });
    expect(parseMeminfo('nothing')).toBeNull();
  });

  it('picks the busiest interface, excluding lo, docker*, br-*, veth*', () => {
    const c = parseNetDev(netDev([['lo', 9e12, 9e12], ['docker0', 8e12, 8e12], ['br-abc123', 7e12, 7e12], ['veth9f', 6e12, 6e12], ['eth0', 2000, 1000], ['eth1', 500, 500]]));
    expect(pickIface(c)).toBe('eth0');
    expect(c.get('eth0')).toEqual({ rx: 2000, tx: 1000 });
    expect(pickIface(parseNetDev(netDev([['lo', 1, 1], ['docker0', 1, 1]])))).toBeNull();
  });

  it('rate: bytes/s, 0 on wrap or reset', () => {
    expect(rate(1000, 3000, 2)).toBe(1000);
    expect(rate(2 ** 32 - 10, 5, 1)).toBe(0);
    expect(rate(undefined, 5, 1)).toBe(0);
    expect(rate(1, 5, 0)).toBe(0);
  });

  it('virtual: docker-vm, container, null', () => {
    expect(detectVirtual('PRETTY_NAME="OrbStack"\n', 'orbstack')).toBe('docker-vm');
    expect(detectVirtual('PRETTY_NAME="Docker Desktop"\n', 'x')).toBe('docker-vm');
    expect(detectVirtual(null, 'docker-desktop')).toBe('docker-vm');
    expect(detectVirtual('PRETTY_NAME="Ubuntu 24.04 LTS"\n', 'VM-0-1-ubuntu')).toBeNull();
    expect(detectVirtual(null, null)).toBe('container');
    expect(parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n')).toBe('Ubuntu 24.04.1 LTS');
    expect(parseOsRelease("NAME='Alpine Linux'\n")).toBe('Alpine Linux');
  });
});

describe('system: GET /api/private/server', () => {
  it('401 without a session', async () => {
    const f = fixture();
    const { app } = await serverApp(f);
    expect((await app.request('/api/private/server')).status).toBe(401);
  });

  it('full structure on OrbStack-like mounts, rates and usage from deltas', async () => {
    const f = fixture({ host: { osRelease: 'PRETTY_NAME="OrbStack"\n', hostname: 'orbstack\n', netDev: netDev([['lo', 1, 1], ['eth0', 1_000_000, 500_000]]) } });
    const { get, clock, sleeps } = await serverApp(f);
    const first = await get();
    expect(sleeps).toEqual([200]); // first request samples twice, 200 ms apart
    expect(first.host).toEqual({ name: 'orbstack', os: 'OrbStack', kernel: os.release(), arch: os.arch(), virtual: 'docker-vm' });
    expect(first.cpu).toMatchObject({ model: null, cores: os.availableParallelism(), usage: 0, load1: 0.5, load5: 0.4, load15: 0.3 });
    expect(first.mem).toEqual({ total: 16384000 * 1024, used: 7384000 * 1024 });
    expect(first.swap).toEqual({ total: 4096000 * 1024, used: 1024000 * 1024 });
    expect(first.disk.mount).toBe('/data');
    expect(first.disk.total).toBeGreaterThan(0);
    expect(first.net).toEqual({ iface: 'eth0', rxRate: 0, txRate: 0, rxTotal: 1_000_000, txTotal: 500_000 });
    expect(first.hostUptime).toBe(432000.55);
    expect(typeof first.uptime).toBe('number');

    // 5 s later: CPU 30 busy of 100 jiffies, eth0 +50 KB/s down, +10 KB/s up.
    clock.t += 5000;
    f.write('proc/stat', stat(130, 970));
    f.write('host/net_dev', netDev([['lo', 1, 1], ['eth0', 1_250_000, 550_000]]));
    const second = await get();
    expect(sleeps).toEqual([200]);
    expect(second.cpu.usage).toBe(30);
    expect(second.net).toEqual({ iface: 'eth0', rxRate: 50_000, txRate: 10_000, rxTotal: 1_250_000, txTotal: 550_000 });

    // Counter reset (interface restarted): rate 0, no negative numbers.
    clock.t += 5000;
    f.write('host/net_dev', netDev([['eth0', 100, 50]]));
    expect((await get()).net).toMatchObject({ rxRate: 0, txRate: 0, rxTotal: 100 });
  });

  it('real server: virtual null, OS from the host file', async () => {
    const f = fixture({ host: { osRelease: 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n', hostname: 'VM-0-8-ubuntu\n', netDev: netDev([['eth0', 10, 10]]) } });
    const { get } = await serverApp(f);
    expect((await get()).host).toMatchObject({ name: 'VM-0-8-ubuntu', os: 'Ubuntu 24.04.1 LTS', virtual: null });
  });

  it('degrades when /host is missing: container, own OS and hostname, net null', async () => {
    const f = fixture({ host: null });
    const { get } = await serverApp(f);
    const s = await get();
    expect(s.host.virtual).toBe('container');
    expect(s.host.name).toBe(os.hostname());
    expect(typeof s.host.os).toBe('string');
    expect(s.host.os.length).toBeGreaterThan(0);
    expect(s.net).toBeNull();
    // Missing proc files too: falls back to os module values, still 200.
    for (const p of ['stat', 'meminfo', 'loadavg', 'uptime', 'cpuinfo']) fs.rmSync(path.join(f.proc, p));
    const f2 = fixture({ host: null });
    for (const p of ['stat', 'meminfo', 'loadavg', 'uptime', 'cpuinfo']) fs.rmSync(path.join(f2.proc, p));
    const s2 = await (await serverApp(f2)).get();
    expect(s2.cpu.usage).toBe(0);
    expect(s2.mem.total).toBe(os.totalmem());
    expect(s2.cpu.model).toBeNull();
  });

  it('concurrent requests share one sample', async () => {
    const f = fixture({ host: { netDev: netDev([['eth0', 1, 1]]) } });
    const { get, sleeps } = await serverApp(f);
    const reads: string[] = [];
    const orig = fs.promises.readFile;
    // Count /proc/stat reads during 5 parallel first requests.
    (fs.promises as any).readFile = (p: any, ...rest: any[]) => {
      if (String(p).endsWith(`${path.sep}stat`)) reads.push(String(p));
      return (orig as any).call(fs.promises, p, ...rest);
    };
    try {
      const all = await Promise.all([get(), get(), get(), get(), get()]);
      expect(sleeps).toEqual([200]);
      expect(reads).toHaveLength(2); // prev + cur, once
      expect(new Set(all.map((s) => JSON.stringify(s.cpu))).size).toBe(1);
    } finally {
      (fs.promises as any).readFile = orig;
    }
  });

  it('aihot: ok within 30 minutes with "N 分钟前", not ok after', async () => {
    const f = fixture();
    const { get, db, clock } = await serverApp(f);
    db.exec('INSERT OR IGNORE INTO aihot_cache (id) VALUES (1)');
    db.prepare('UPDATE aihot_cache SET fetched_at = ?, checked_at = ? WHERE id = 1').run(clock.t - 60 * 60_000, clock.t - 3 * 60_000);
    const svc = (s: Json) => Object.fromEntries((s.services as Json[]).map((x) => [x.id, x]));
    expect(svc(await get()).aihot).toEqual({ id: 'aihot', name: 'AIHOT 同步', ok: true, detail: '3 分钟前' });
    clock.t += 28 * 60_000;
    expect(svc(await get()).aihot).toMatchObject({ ok: false, detail: '31 分钟前' });
    expect(svc(await get()).web).toEqual({ id: 'web', name: '网站', ok: true });
    db.exec('UPDATE aihot_cache SET fetched_at = NULL, checked_at = NULL');
    expect(svc(await get()).aihot).toMatchObject({ ok: false, detail: '还没有同步' });
  });

  it('never returns secrets or environment values', async () => {
    const f = fixture({ host: { osRelease: 'PRETTY_NAME="OrbStack"\n', hostname: 'orbstack\n', netDev: netDev([['eth0', 1, 1]]) } });
    process.env.LD_TEST_CANARY = 'canary-value-7f3a';
    try {
      const { app, cookie } = await serverApp(f, { env: { ADMIN_PASSWORD_HASH: 'hash-canary-9b2c' } });
      const body = await (await app.request('/api/private/server', { headers: { cookie } })).text();
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain('canary-value-7f3a');
      expect(body).not.toContain('hash-canary-9b2c');
      expect(Object.keys(JSON.parse(body)).sort()).toEqual(['cpu', 'disk', 'host', 'hostUptime', 'mem', 'net', 'services', 'swap', 'uptime']);
    } finally {
      delete process.env.LD_TEST_CANARY;
    }
  });

  it('a warm request is fast', async () => {
    const f = fixture({ host: { netDev: netDev([['eth0', 1, 1]]) } });
    const { get, clock } = await serverApp(f);
    await get();
    clock.t += 5000;
    const t0 = performance.now();
    await get();
    expect(performance.now() - t0).toBeLessThan(20);
  });
});

describe('system: stats and kuma probes', () => {
  const targets = { statsUrl: 'http://caddy/u/script.js', kumaUrl: 'http://uptime-kuma:3001/', siteHost: 'site.example.test' };

  it('stats: sends the site Host, 200 ok, 308 to https retries over TLS, other codes fail', async () => {
    const calls: Array<[string, Json]> = [];
    const probe = (results: Array<Awaited<ReturnType<Probe>>>): Probe => async (url, o) => {
      calls.push([url, o]);
      return results.shift()!;
    };
    expect(await checkStats(probe([{ status: 200 }]), targets, 1500)).toEqual({ id: 'stats', name: '访问统计', ok: true });
    expect(calls[0]).toEqual(['http://caddy/u/script.js', { host: 'site.example.test', timeoutMs: 1500 }]);

    calls.length = 0;
    const r = await checkStats(probe([{ status: 308, location: 'https://site.example.test/u/script.js' }, { status: 200 }]), targets, 1500);
    expect(r.ok).toBe(true);
    expect(calls[1]![0]).toBe('https://caddy/u/script.js');
    expect(calls[1]![1]).toMatchObject({ host: 'site.example.test', servername: 'site.example.test' });

    // Redirect somewhere else is not followed.
    calls.length = 0;
    expect(await checkStats(probe([{ status: 308, location: 'https://evil.test/' }]), targets, 1500)).toMatchObject({ ok: false, detail: 'HTTP 308' });
    expect(calls).toHaveLength(1);
    expect(await checkStats(probe([{ status: 404 }]), targets, 1500)).toMatchObject({ ok: false, detail: 'HTTP 404' });
    expect(await checkStats(probe([{ error: 'timeout' }]), targets, 1500)).toMatchObject({ ok: false, detail: '超时' });
    expect(await checkStats(probe([{ status: 308, location: 'https://site.example.test/u/script.js' }, { status: 502 }]), targets, 1500)).toMatchObject({ ok: false, detail: 'HTTP 502' });
  });

  it('kuma: 2xx/3xx ok, else not', async () => {
    for (const [status, ok] of [[200, true], [302, true], [399, true], [401, false], [500, false]] as const) {
      expect((await checkKuma(async () => ({ status }), targets, 1500)).ok, String(status)).toBe(ok);
    }
    expect(await checkKuma(async () => ({ error: 'unreachable' }), targets, 1500)).toEqual({ id: 'kuma', name: '网站监控', ok: false, detail: '无法连接' });
  });

  it('httpProbe: real Host header, no redirect following, times out at the deadline', async () => {
    const seen: string[] = [];
    const srv = http.createServer((req, res) => {
      seen.push(`${req.headers.host} ${req.url}`);
      if (req.url === '/slow') return; // never answers
      if (req.url === '/redir') {
        res.writeHead(308, { location: 'https://site.example.test/u/script.js' });
        return res.end();
      }
      res.end('ok');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      expect(await httpProbe(`http://127.0.0.1:${port}/u/script.js`, { host: 'site.example.test', timeoutMs: 1500 })).toEqual({ status: 200 });
      expect(seen[0]).toBe('site.example.test /u/script.js');
      expect(await httpProbe(`http://127.0.0.1:${port}/redir`, { timeoutMs: 1500 })).toEqual({ status: 308, location: 'https://site.example.test/u/script.js' });
      expect(seen).toHaveLength(2); // the redirect was not followed
      const t0 = Date.now();
      expect(await httpProbe(`http://127.0.0.1:${port}/slow`, { timeoutMs: 150 })).toEqual({ error: 'timeout' });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(await httpProbe('http://127.0.0.1:1/', { timeoutMs: 500 })).toEqual({ error: 'unreachable' });
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });

  it('probe results are cached 30 s and refreshed in the background', async () => {
    const t = { now: 0 };
    let runs = 0;
    const cache = new ProbeCache(async () => [{ id: 'kuma', name: 'k', ok: true, detail: String(++runs) }], () => t.now);
    expect((await cache.get())[0]!.detail).toBe('1');
    t.now += 29_000;
    expect((await cache.get())[0]!.detail).toBe('1');
    t.now += 2_000;
    expect((await cache.get())[0]!.detail).toBe('1'); // stale value returned at once…
    await new Promise((r) => setTimeout(r, 0));
    expect((await cache.get())[0]!.detail).toBe('2'); // …and refreshed behind it
    expect(runs).toBe(2);
  });

  it('through the endpoint: a hanging probe costs at most the 1.5 s timeout once, then is cached', async () => {
    const f = fixture();
    let calls = 0;
    const hanging: Probe = (url) => {
      calls++;
      return url.includes('kuma') ? new Promise(() => {}) : Promise.resolve({ status: 200 });
    };
    const { get } = await serverApp(f, { probe: hanging });
    const t0 = Date.now();
    const s = await get();
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(1400);
    expect(took).toBeLessThan(2500);
    const svc = Object.fromEntries((s.services as Json[]).map((x) => [x.id, x]));
    expect(svc.kuma).toEqual({ id: 'kuma', name: '网站监控', ok: false, detail: '超时' });
    expect(svc.stats).toEqual({ id: 'stats', name: '访问统计', ok: true });
    const t1 = Date.now();
    await get();
    expect(Date.now() - t1).toBeLessThan(100);
    expect(calls).toBe(2);
  }, 10_000);
});
