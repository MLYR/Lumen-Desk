export interface Usage {
  total: number;
  used: number;
}

/**
 * /proc/meminfo → memory and swap in bytes. "used" for memory is Total − MemAvailable
 * (page cache doesn't count), the same number `free` shows as used.
 */
export function parseMeminfo(text: string): { mem: Usage; swap: Usage } | null {
  const kb = new Map<string, number>();
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const n = Number.parseInt(line.slice(i + 1).trim(), 10);
    if (Number.isFinite(n)) kb.set(line.slice(0, i), n * 1024);
  }
  const total = kb.get('MemTotal');
  if (total === undefined) return null;
  const available = kb.get('MemAvailable') ?? (kb.get('MemFree') ?? 0) + (kb.get('Buffers') ?? 0) + (kb.get('Cached') ?? 0);
  const swapTotal = kb.get('SwapTotal') ?? 0;
  const swapFree = kb.get('SwapFree') ?? swapTotal;
  return {
    mem: { total, used: Math.max(0, total - available) },
    swap: { total: swapTotal, used: Math.max(0, swapTotal - swapFree) },
  };
}
