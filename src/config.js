import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const env = process.env;
  const dataDir = overrides.dataDir ?? env.DATA_DIR ?? path.join(rootDir, 'data');
  return {
    rootDir,
    port: Number(env.PORT) || 3000,
    production: env.NODE_ENV === 'production',
    dataDir,
    dbFile: overrides.dbFile ?? env.DB_FILE ?? path.join(dataDir, 'maxlanches.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    publicDir: path.join(rootDir, 'public'),
    timezone: env.TIMEZONE || 'America/Sao_Paulo',
    // Número de proxies reversos à frente do app (nginx, Caddy, Railway...). Usado para obter o IP real.
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    seedDemoData: env.SEED_DEMO_DATA !== 'false',
    // Limites anti-abuso por IP: pedidos a cada 10 min e tentativas de login a cada 15 min.
    orderRateLimit: Number(env.ORDER_RATE_LIMIT) || 8,
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT) || 10,
    ...overrides,
  };
}
