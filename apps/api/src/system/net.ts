export type NetCounters = Map<string, { rx: number; tx: number }>;

/** /proc/net/dev: "  eth0: rxBytes rxPackets … (8 rx fields) txBytes …". */
export function parseNetDev(text: string): NetCounters {
  const out: NetCounters = new Map();
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const iface = line.slice(0, i).trim();
    if (!iface || iface.includes('|')) continue;
    const f = line.slice(i + 1).trim().split(/\s+/);
    const rx = Number(f[0]);
    const tx = Number(f[8]);
    if (Number.isFinite(rx) && Number.isFinite(tx)) out.set(iface, { rx, tx });
  }
  return out;
}

/** Ignored: loopback and Docker's own bridges/veths, which double-count container traffic. */
export function isPhysicalCandidate(iface: string): boolean {
  return iface !== 'lo' && !iface.startsWith('docker') && !iface.startsWith('br-') && !iface.startsWith('veth');
}

/** The remaining interface with the most traffic so far. */
export function pickIface(counters: NetCounters): string | null {
  let best: string | null = null;
  let bestBytes = -1;
  for (const [iface, c] of counters) {
    if (!isPhysicalCandidate(iface)) continue;
    const bytes = c.rx + c.tx;
    if (bytes > bestBytes) {
      best = iface;
      bestBytes = bytes;
    }
  }
  return best;
}

/** Bytes per second, one decimal. A counter that went backwards (wrap or reset) gives 0. */
export function rate(prev: number | undefined, cur: number, seconds: number): number {
  if (prev === undefined || seconds <= 0 || cur < prev) return 0;
  return Math.round(((cur - prev) / seconds) * 10) / 10;
}
