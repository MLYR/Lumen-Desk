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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const backupKeep = Number(env.BACKUP_KEEP ?? 14);
  if (!Number.isInteger(backupKeep) || backupKeep < 1 || backupKeep > 200) throw new Error(`Invalid BACKUP_KEEP: ${env.BACKUP_KEEP}`);
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
  };
}
