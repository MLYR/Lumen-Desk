/** Aggregate CPU counters from the first `cpu ` line of /proc/stat (jiffies). */
export interface CpuTimes {
  total: number;
  idle: number;
}

export function parseProcStat(text: string): CpuTimes | null {
  const nl = text.indexOf('\n');
  const line = nl < 0 ? text : text.slice(0, nl);
  if (!line.startsWith('cpu ')) return null;
  const f = line.slice(4).trim().split(/\s+/).map(Number);
  if (f.length < 4 || f.slice(0, 4).some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal [guest guest_nice]; guest time is already in user/nice.
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = f.map((n) => (Number.isFinite(n) ? n : 0));
  return { total: user + nice + system + idle + iowait + irq + softirq + steal, idle: idle + iowait };
}

/** Busy share between two samples, 0–100 with one decimal. Counter resets give 0. */
export function cpuUsage(prev: CpuTimes, cur: CpuTimes): number {
  const dt = cur.total - prev.total;
  const di = cur.idle - prev.idle;
  if (dt <= 0 || di < 0) return 0;
  const pct = ((dt - di) / dt) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

/** `model name` (x86) or `Hardware` (some arm) from /proc/cpuinfo; null when neither is there (arm VMs). */
export function parseCpuModel(text: string): string | null {
  let hardware: string | null = null;
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (!value) continue;
    if (key === 'model name') return value.slice(0, 120);
    if (key === 'Hardware' && hardware === null) hardware = value.slice(0, 120);
  }
  return hardware;
}

export interface LoadAvg {
  load1: number;
  load5: number;
  load15: number;
}

export function parseLoadavg(text: string): LoadAvg | null {
  const [a, b, c] = text.trim().split(/\s+/).map(Number);
  if (![a, b, c].every((n) => Number.isFinite(n))) return null;
  return { load1: a!, load5: b!, load15: c! };
}
