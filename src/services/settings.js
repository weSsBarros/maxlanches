// Configurações da loja, editáveis pelo painel. Tipos: string, bool, cents.
export const SETTINGS_SCHEMA = {
  store_name: { type: 'string', default: 'Max Lanches', max: 60, public: true },
  tagline: { type: 'string', default: 'Churrasquinho, hambúrguer e cachorro-quente feitos na hora', max: 120, public: true },
  whatsapp: { type: 'string', default: '', max: 20, public: true },
  instagram: { type: 'string', default: '', max: 60, public: true },
  address: { type: 'string', default: '', max: 200, public: true },
  hours_text: { type: 'string', default: 'Terça a domingo, das 18h às 23h30', max: 120, public: true },
  eta_text: { type: 'string', default: '40 a 60 min', max: 40, public: true },
  is_open: { type: 'bool', default: true, public: true },
  delivery_enabled: { type: 'bool', default: true, public: true },
  pickup_enabled: { type: 'bool', default: true, public: true },
  min_order_cents: { type: 'cents', default: 0, public: true },
  free_delivery_above_cents: { type: 'cents', default: 0, public: true },
  pix_key: { type: 'string', default: '', max: 77, public: false },
  pix_name: { type: 'string', default: 'MAX LANCHES', max: 25, public: false },
  pix_city: { type: 'string', default: 'SAO PAULO', max: 15, public: false },
};

function decode(def, raw) {
  if (raw === undefined) return def.default;
  if (def.type === 'bool') return raw === '1';
  if (def.type === 'cents') return Number(raw) || 0;
  return raw;
}

function encode(def, value) {
  if (def.type === 'bool') return value ? '1' : '0';
  if (def.type === 'cents') return String(value);
  return value;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) out[key] = decode(def, stored[key]);
  return out;
}

export function getPublicSettings(db) {
  const all = getSettings(db);
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) if (def.public) out[key] = all[key];
  out.pix_enabled = Boolean(all.pix_key);
  return out;
}

/** Valida e grava as chaves recebidas. Chaves desconhecidas são ignoradas. */
export function updateSettings(db, input) {
  const errors = [];
  const toSave = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    const def = SETTINGS_SCHEMA[key];
    if (!def) continue;
    if (def.type === 'bool') {
      if (typeof value !== 'boolean') errors.push(`${key}: esperado verdadeiro/falso`);
      else toSave.push([key, encode(def, value)]);
    } else if (def.type === 'cents') {
      if (!Number.isInteger(value) || value < 0 || value > 100_000_00) errors.push(`${key}: valor inválido`);
      else toSave.push([key, encode(def, value)]);
    } else {
      if (typeof value !== 'string') errors.push(`${key}: texto inválido`);
      else if (value.trim().length > def.max) errors.push(`${key}: máximo de ${def.max} caracteres`);
      else toSave.push([key, value.trim()]);
    }
  }
  if (errors.length) return { errors };
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => toSave.forEach(([k, v]) => stmt.run(k, v)))();
  return { settings: getSettings(db) };
}
