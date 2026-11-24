import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  totpSecret: string | undefined;
  totpIssuer: string;
  totpLabel: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  siteUrl: string;
  /** Directory holding blog.html (built by apps/web as dist-shell). */
  shellDir: string;
  /** Read-only host files for the server card (os-release, hostname, net_dev). Default /host. */
  hostRoot: string;
  /** 32-byte key (base64) for AES-256-GCM encryption of secrets in the database; undefined = plaintext. */
  secretKey: string | undefined;
  /** 定时备份落盘的目录（默认 DATA_DIR/backups）。 */
  backupDir: string;
  /** 保留多少份，超出的从最旧的删。 */
  backupKeep: number;
  /** 控制台天气小组件配置（Open-Meteo，免 Key）。 */
  weatherCity: string;
  weatherLat: number;
  weatherLon: number;
  weatherTimezone: string;
  /** 公开主页 GitHub 贡献热力图配置（两者都设才启用）。 */
  githubUsername: string | undefined;
  githubToken: string | undefined;
}

const GITHUB_USER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const TIMEZONE_RE = /^[A-Za-z0-9_/+.-]{1,64}$/;

function parseCoord(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const backupKeep = Number(env.BACKUP_KEEP ?? 14);
  if (!Number.isInteger(backupKeep) || backupKeep < 1 || backupKeep > 200) throw new Error(`Invalid BACKUP_KEEP: ${env.BACKUP_KEEP}`);
  const weatherLat = parseCoord(env.WEATHER_LAT, 31.23, -90, 90, 'WEATHER_LAT');
  const weatherLon = parseCoord(env.WEATHER_LON, 121.47, -180, 180, 'WEATHER_LON');
  const weatherTimezone = env.WEATHER_TIMEZONE?.trim() || 'Asia/Shanghai';
  if (!TIMEZONE_RE.test(weatherTimezone)) throw new Error(`Invalid WEATHER_TIMEZONE: ${env.WEATHER_TIMEZONE}`);
  const githubUsername = env.GITHUB_USERNAME?.trim() || undefined;
  if (githubUsername && !GITHUB_USER_RE.test(githubUsername)) throw new Error(`Invalid GITHUB_USERNAME: ${env.GITHUB_USERNAME}`);
  return {
    port,
    dataDir,
    backupDir: path.resolve(env.BACKUP_DIR || path.join(dataDir, 'backups')),
    backupKeep,
    totpSecret: env.TOTP_SECRET?.trim() || undefined,
    totpIssuer: env.TOTP_ISSUER || 'Lumen Desk',
    totpLabel: env.TOTP_LABEL || 'zreo',
    // Secure by default; only an explicit "false" disables it (local http dev).
    cookieSecure: env.COOKIE_SECURE?.toLowerCase() !== 'false',
    // Only trust X-Forwarded-For when explicitly enabled (behind Caddy).
    trustProxy: env.TRUST_PROXY?.toLowerCase() === 'true',
    siteUrl: (env.SITE_URL || 'https://example.com').replace(/\/+$/, ''),
    shellDir: path.resolve(env.SHELL_DIR || '../web/dist-shell'),
    hostRoot: path.resolve(env.HOST_ROOT || '/host'),
    secretKey: env.SECRET_KEY?.trim() || undefined,
    weatherCity: env.WEATHER_CITY?.trim() || '上海',
    weatherLat,
    weatherLon,
    weatherTimezone,
    githubUsername,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
  };
}
