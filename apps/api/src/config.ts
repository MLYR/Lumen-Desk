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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  return {
    port,
    dataDir: path.resolve(env.DATA_DIR || './data'),
    totpSecret: env.TOTP_SECRET?.trim() || undefined,
    totpIssuer: env.TOTP_ISSUER || 'Lumen Desk',
    totpLabel: env.TOTP_LABEL || 'zreo',
    // Secure by default; only an explicit "false" disables it (local http dev).
    cookieSecure: env.COOKIE_SECURE?.toLowerCase() !== 'false',
    // Only trust X-Forwarded-For when explicitly enabled (behind Caddy).
    trustProxy: env.TRUST_PROXY?.toLowerCase() === 'true',
    siteUrl: env.SITE_URL || 'https://example.com',
  };
}
