import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DB } from '../db.js';
import { cpuUsage, parseCpuModel, parseLoadavg, parseProcStat, type CpuTimes } from './cpu.js';
import { detectVirtual, parseOsRelease, type Virtual } from './host.js';
import { parseMeminfo, type Usage } from './mem.js';
import { parseNetDev, pickIface, rate, type NetCounters } from './net.js';
import {
  checkAihot,
  checkKuma,
  checkStats,
  DEFAULT_TARGETS,
  httpProbe,
  PROBE_TIMEOUT_MS,
  ProbeCache,
  withDeadline,
  type Probe,
  type ServiceStatus,
} from './services.js';

export interface ServerStatus {
  host: { name: string; os: string; kernel: string; arch: string; virtual: Virtual };
  cpu: { model: string | null; cores: number; usage: number; load1: number; load5: number; load15: number };
  mem: Usage;
  swap: Usage;
  disk: Usage & { mount: string };
  net: { iface: string; rxRate: number; txRate: number; rxTotal: number; txTotal: number } | null;
  uptime: number;
  hostUptime: number;
  services: ServiceStatus[];
}

export interface CollectorOptions {
  db: DB;
  dataDir: string;
  /** Read-only host mounts (os-release, hostname, net_dev). */
  hostRoot: string;
  /** Where proc files come from; tests point this at a fixture directory. */
  procRoot?: string;
  siteUrl: string;
  now: () => number;
  probe?: Probe;
  statsUrl?: string;
  kumaUrl?: string;
  /** Wait before the second sample of the first request. */
  firstSampleMs?: number;
  /** For tests: replaces the 200 ms timer. */
  sleep?: (ms: number) => Promise<void>;
}

interface Sample {
  at: number;
  cpu: CpuTimes | null;
  net: NetCounters | null;
}

const readText = (file: string): Promise<string | null> => fs.readFile(file, 'utf8').then((s) => s.slice(0, 256 * 1024), () => null);

/** Hostname of SITE_URL; empty → none (no Host header override). */
function siteHostOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return '';
  }
}

/**
 * Collects GET /api/private/server. One sample of /proc/stat and net_dev is shared by every request that
 * arrives while it is being taken, and the previous sample is kept for the rate/usage deltas. Static
 * facts (os, hostname, CPU model) are read once. Service probes come from a 30 s cache.
 */
export class ServerCollector {
  private readonly proc: string;
  private prev: Sample | undefined;
  private last: { sample: Sample; usage: number; rxRate: number; txRate: number } | undefined;
  private inflight: Promise<NonNullable<ServerCollector['last']>> | undefined;
  private staticInfo: Promise<{ os: string; name: string; kernel: string; virtual: Virtual; model: string | null; hostNet: boolean }> | undefined;
  private readonly probes: ProbeCache;

  constructor(private readonly o: CollectorOptions) {
    this.proc = o.procRoot ?? '/proc';
    const probe = o.probe ?? httpProbe;
    const targets = { statsUrl: o.statsUrl ?? DEFAULT_TARGETS.statsUrl, kumaUrl: o.kumaUrl ?? DEFAULT_TARGETS.kumaUrl, siteHost: siteHostOf(o.siteUrl) };
    const fallback = (id: 'stats' | 'kuma', name: string): ServiceStatus => ({ id, name, ok: false, detail: '超时' });
    this.probes = new ProbeCache(
      () =>
        Promise.all([
          withDeadline(checkStats(probe, targets, PROBE_TIMEOUT_MS), fallback('stats', '访问统计'), PROBE_TIMEOUT_MS + 100),
          withDeadline(checkKuma(probe, targets, PROBE_TIMEOUT_MS), fallback('kuma', '网站监控'), PROBE_TIMEOUT_MS + 100),
        ]),
      o.now,
    );
  }

  private loadStatic() {
    this.staticInfo ??= (async () => {
      const [hostOs, hostName, ownOs, cpuinfo, hostNet] = await Promise.all([
        readText(path.join(this.o.hostRoot, 'os-release')),
        readText(path.join(this.o.hostRoot, 'hostname')),
        readText('/etc/os-release'),
        readText(path.join(this.proc, 'cpuinfo')),
        fs.access(path.join(this.o.hostRoot, 'net_dev')).then(() => true, () => false),
      ]);
      const hostNameTrim = hostName?.trim() || null;
      return {
        os: (hostOs && parseOsRelease(hostOs)) || (ownOs && parseOsRelease(ownOs)) || os.type(),
        name: (hostNameTrim ?? os.hostname()).slice(0, 120),
        kernel: os.release(),
        virtual: detectVirtual(hostOs, hostNameTrim),
        model: cpuinfo ? parseCpuModel(cpuinfo) : null,
        hostNet,
      };
    })();
    return this.staticInfo;
  }

  private async read(): Promise<Sample> {
    const [stat, net] = await Promise.all([readText(path.join(this.proc, 'stat')), readText(path.join(this.o.hostRoot, 'net_dev'))]);
    return { at: this.o.now(), cpu: stat ? parseProcStat(stat) : null, net: net ? parseNetDev(net) : null };
  }

  private derive(prev: Sample, cur: Sample) {
    const secs = (cur.at - prev.at) / 1000;
    let rxRate = 0;
    let txRate = 0;
    const iface = cur.net ? pickIface(cur.net) : null;
    if (iface && cur.net && prev.net) {
      const a = prev.net.get(iface);
      const b = cur.net.get(iface)!;
      rxRate = rate(a?.rx, b.rx, secs);
      txRate = rate(a?.tx, b.tx, secs);
    }
    const usage = prev.cpu && cur.cpu ? cpuUsage(prev.cpu, cur.cpu) : 0;
    return { sample: cur, usage, rxRate, txRate };
  }

  /** At most one sample in flight; the first ever request takes two samples firstSampleMs apart. */
  private sample() {
    this.inflight ??= (async () => {
      if (!this.prev) {
        this.prev = await this.read();
        await (this.o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.o.firstSampleMs ?? 200);
      }
      const cur = await this.read();
      // Same-millisecond samples (or a clock that went back) would divide by ~0: reuse the last result.
      if (cur.at <= this.prev.at && this.last) return this.last;
      const out = this.derive(this.prev, cur);
      this.prev = cur;
      this.last = out;
      return out;
    })().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  async collect(): Promise<ServerStatus> {
    const [info, s, services, loadText, memText, uptimeText, disk] = await Promise.all([
      this.loadStatic(),
      this.sample(),
      this.probes.get(),
      readText(path.join(this.proc, 'loadavg')),
      readText(path.join(this.proc, 'meminfo')),
      readText(path.join(this.proc, 'uptime')),
      fs.statfs(this.o.dataDir).then(
        (st) => ({ total: st.blocks * st.bsize, used: (st.blocks - st.bfree) * st.bsize }),
        () => ({ total: 0, used: 0 }),
      ),
    ]);
    const load = (loadText && parseLoadavg(loadText)) || (([load1, load5, load15]) => ({ load1: load1!, load5: load5!, load15: load15! }))(os.loadavg());
    const mem = (memText && parseMeminfo(memText)) || { mem: { total: os.totalmem(), used: os.totalmem() - os.freemem() }, swap: { total: 0, used: 0 } };
    const hostUptime = Number(uptimeText?.trim().split(/\s+/)[0]);
    const iface = s.sample.net ? pickIface(s.sample.net) : null;
    const counters = iface ? s.sample.net!.get(iface)! : null;
    return {
      host: { name: info.name, os: info.os, kernel: info.kernel, arch: os.arch(), virtual: info.virtual },
      cpu: { model: info.model, cores: os.availableParallelism(), usage: s.usage, ...load },
      mem: mem.mem,
      swap: mem.swap,
      disk: { ...disk, mount: '/data' },
      net: iface && counters && info.hostNet ? { iface, rxRate: s.rxRate, txRate: s.txRate, rxTotal: counters.rx, txTotal: counters.tx } : null,
      uptime: Math.round(process.uptime() * 10) / 10,
      hostUptime: Number.isFinite(hostUptime) ? hostUptime : os.uptime(),
      services: [{ id: 'web', name: '网站', ok: true }, checkAihot(this.o.db, this.o.now()), ...services],
    };
  }
}
