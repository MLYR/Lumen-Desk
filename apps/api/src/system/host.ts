export type Virtual = 'docker-vm' | 'container' | null;

/** PRETTY_NAME (or NAME) from an os-release file. Values may be quoted. */
export function parseOsRelease(text: string): string | null {
  let name: string | null = null;
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    if (!v) continue;
    if (key === 'PRETTY_NAME') return v.slice(0, 120);
    if (key === 'NAME' && name === null) name = v.slice(0, 120);
  }
  return name;
}

const VM_HOSTNAMES = new Set(['orbstack', 'docker-desktop']);

/**
 * docker-vm: the host is Docker's own VM (OrbStack, Docker Desktop).
 * container: the /host mounts are missing, so only the container itself is visible.
 * null: a real server.
 */
export function detectVirtual(hostOsRelease: string | null, hostHostname: string | null): Virtual {
  if (hostOsRelease === null && hostHostname === null) return 'container';
  const os = (hostOsRelease ?? '').toLowerCase();
  if (os.includes('orbstack') || os.includes('docker desktop')) return 'docker-vm';
  if (hostHostname !== null && VM_HOSTNAMES.has(hostHostname.trim().toLowerCase())) return 'docker-vm';
  return null;
}
