// Cópia de segurança do banco (segura mesmo com o servidor rodando).
// Uso: npm run backup  → data/backups/maxlanches-AAAA-MM-DD_HHhMM.db (mantém os 30 mais recentes)
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';

const KEEP = 30;
const config = loadConfig();
if (!fs.existsSync(config.dbFile)) {
  console.error(`Banco não encontrado em ${config.dbFile}`);
  process.exit(1);
}
const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toLocaleString('sv-SE', { timeZone: config.timezone }).slice(0, 16).replace(' ', '_').replace(':', 'h');
const target = path.join(dir, `maxlanches-${stamp}.db`);

const db = new Database(config.dbFile, { readonly: true });
await db.backup(target);
db.close();

const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(dir, f));
console.log(`Backup salvo em ${target}`);
