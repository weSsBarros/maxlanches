import { HttpError } from '../lib/http.js';
import { Validator } from '../lib/validate.js';

const MAX_PRICE = 10_000_00;

/** Um produto pode ser pedido se está marcado como disponível e não zerou o estoque (quando controlado). */
export const isOrderable = (p) => Boolean(p.available) && (p.stock === null || p.stock > 0);

function productRow(p) {
  return {
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    description: p.description,
    price_cents: p.price_cents,
    cost_cents: p.cost_cents,
    image: p.image,
    available: Boolean(p.available),
    stock: p.stock,
    sort_order: p.sort_order,
    orderable: isOrderable(p),
  };
}

/** Cardápio público: categorias ativas com seus produtos (sem custo). */
export function getPublicMenu(db) {
  const categories = db.prepare('SELECT id, name, emoji FROM categories WHERE active = 1 ORDER BY sort_order, id').all();
  const products = db.prepare('SELECT * FROM products ORDER BY sort_order, id').all();
  const addons = db
    .prepare(`SELECT a.id, a.name, a.price_cents, ac.category_id FROM addons a
              JOIN addon_categories ac ON ac.addon_id = a.id
              WHERE a.available = 1 ORDER BY a.sort_order, a.id`)
    .all();
  return categories
    .map((c) => ({
      ...c,
      addons: addons.filter((a) => a.category_id === c.id).map(({ id, name, price_cents }) => ({ id, name, price_cents })),
      products: products
        .filter((p) => p.category_id === c.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price_cents: p.price_cents,
          image: p.image,
          orderable: isOrderable(p),
          // Mostra "últimas unidades" sem expor o estoque exato quando ele é grande.
          low_stock: p.stock !== null && p.stock > 0 && p.stock <= 5 ? p.stock : null,
        })),
    }))
    .filter((c) => c.products.length > 0);
}

// ---------- Categorias ----------

export function listCategories(db) {
  return db
    .prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
              FROM categories c ORDER BY sort_order, id`)
    .all()
    .map((c) => ({ ...c, active: Boolean(c.active) }));
}

function validateCategory(input, partial) {
  const v = new Validator(input)
    .string('name', 'Nome', { required: !partial, max: 40 })
    .string('emoji', 'Ícone', { max: 8 })
    .int('sort_order', 'Ordem', { min: 0, max: 9999 })
    .bool('active', 'Ativa');
  if (!v.ok) throw new HttpError(400, v.errors.join(' '), v.errors);
  if (partial) for (const k of Object.keys(v.out)) if (!(k in input)) delete v.out[k];
  return v.out;
}

export function createCategory(db, input) {
  const data = validateCategory(input, false);
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories').get().n;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO categories (name, emoji, sort_order, active) VALUES (?, ?, ?, ?)')
    .run(data.name, data.emoji ?? '', data.sort_order ?? nextOrder, data.active === false ? 0 : 1);
  return listCategories(db).find((c) => c.id === Number(lastInsertRowid));
}

export function updateCategory(db, id, input) {
  const data = validateCategory(input, true);
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Categoria não encontrada.');
  const next = { ...current, ...data };
  db.prepare('UPDATE categories SET name = ?, emoji = ?, sort_order = ?, active = ? WHERE id = ?')
    .run(next.name, next.emoji, next.sort_order, next.active ? 1 : 0, id);
  return listCategories(db).find((c) => c.id === id);
}

export function deleteCategory(db, id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id).n;
  if (used > 0) throw new HttpError(409, 'Mova ou exclua os produtos desta categoria antes de removê-la.');
  const { changes } = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'Categoria não encontrada.');
}

// ---------- Produtos ----------

export function listProducts(db) {
  return db.prepare('SELECT * FROM products ORDER BY sort_order, id').all().map(productRow);
}

export function getProduct(db, id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  return productRow(p);
}

function validateProduct(db, input, partial) {
  const v = new Validator(input)
    .int('category_id', 'Categoria', { required: !partial, min: 1 })
    .string('name', 'Nome', { required: !partial, max: 80 })
    .string('description', 'Descrição', { max: 300 })
    .int('price_cents', 'Preço', { required: !partial, min: 0, max: MAX_PRICE })
    .int('cost_cents', 'Custo', { min: 0, max: MAX_PRICE })
    .bool('available', 'Disponível')
    .int('stock', 'Estoque', { min: 0, max: 100_000, nullable: true })
    .int('sort_order', 'Ordem', { min: 0, max: 9999 });
  if (input && 'image' in input) {
    const img = input.image;
    if (img === null || img === '') v.out.image = null;
    else if (typeof img === 'string' && /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(img)) v.out.image = img;
    else v.errors.push('Imagem inválida.');
  }
  if (!v.ok) throw new HttpError(400, v.errors.join(' '), v.errors);
  if (partial) for (const k of Object.keys(v.out)) if (!(k in input)) delete v.out[k];
  if (v.out.category_id && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(v.out.category_id)) {
    throw new HttpError(400, 'Categoria não existe.');
  }
  return v.out;
}

export function createProduct(db, input) {
  const d = validateProduct(db, input, false);
  const nextOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM products WHERE category_id = ?')
    .get(d.category_id).n;
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO products (category_id, name, description, price_cents, cost_cents, image, available, stock, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.category_id, d.name, d.description ?? '', d.price_cents, d.cost_cents ?? 0, d.image ?? null,
      d.available === false ? 0 : 1, d.stock ?? null, d.sort_order ?? nextOrder);
  return getProduct(db, Number(lastInsertRowid));
}

export function updateProduct(db, id, input) {
  const data = validateProduct(db, input, true);
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Produto não encontrado.');
  const n = { ...current, ...data };
  db.prepare(`UPDATE products SET category_id = ?, name = ?, description = ?, price_cents = ?, cost_cents = ?, image = ?,
              available = ?, stock = ?, sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(n.category_id, n.name, n.description, n.price_cents, n.cost_cents, n.image, n.available ? 1 : 0,
      n.stock, n.sort_order, id);
  return getProduct(db, id);
}

export function deleteProduct(db, id) {
  const { changes } = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'Produto não encontrado.');
}

// ---------- Bairros / taxas de entrega ----------

export function listZones(db, { onlyActive = false } = {}) {
  const where = onlyActive ? 'WHERE active = 1' : '';
  return db
    .prepare(`SELECT * FROM delivery_zones ${where} ORDER BY sort_order, name`)
    .all()
    .map((z) => ({ ...z, active: Boolean(z.active) }));
}

function validateZone(input, partial) {
  const v = new Validator(input)
    .string('name', 'Bairro', { required: !partial, max: 60 })
    .int('fee_cents', 'Taxa', { required: !partial, min: 0, max: MAX_PRICE })
    .bool('active', 'Ativo')
    .int('sort_order', 'Ordem', { min: 0, max: 9999 });
  if (!v.ok) throw new HttpError(400, v.errors.join(' '), v.errors);
  if (partial) for (const k of Object.keys(v.out)) if (!(k in input)) delete v.out[k];
  return v.out;
}

export function createZone(db, input) {
  const d = validateZone(input, false);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO delivery_zones (name, fee_cents, active, sort_order) VALUES (?, ?, ?, ?)')
    .run(d.name, d.fee_cents, d.active === false ? 0 : 1, d.sort_order ?? 0);
  return listZones(db).find((z) => z.id === Number(lastInsertRowid));
}

export function updateZone(db, id, input) {
  const d = validateZone(input, true);
  const current = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Bairro não encontrado.');
  const n = { ...current, ...d };
  db.prepare('UPDATE delivery_zones SET name = ?, fee_cents = ?, active = ?, sort_order = ? WHERE id = ?')
    .run(n.name, n.fee_cents, n.active ? 1 : 0, n.sort_order, id);
  return listZones(db).find((z) => z.id === id);
}

export function deleteZone(db, id) {
  const { changes } = db.prepare('DELETE FROM delivery_zones WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'Bairro não encontrado.');
}

// ---------- Adicionais ----------

export function listAddons(db) {
  const links = new Map();
  for (const r of db.prepare('SELECT addon_id, category_id FROM addon_categories ORDER BY category_id').all()) {
    if (!links.has(r.addon_id)) links.set(r.addon_id, []);
    links.get(r.addon_id).push(r.category_id);
  }
  return db
    .prepare('SELECT * FROM addons ORDER BY sort_order, id')
    .all()
    .map((a) => ({ ...a, available: Boolean(a.available), category_ids: links.get(a.id) ?? [] }));
}

function getAddon(db, id) {
  const addon = listAddons(db).find((a) => a.id === id);
  if (!addon) throw new HttpError(404, 'Adicional não encontrado.');
  return addon;
}

function validateAddon(db, input, partial) {
  const v = new Validator(input)
    .string('name', 'Nome', { required: !partial, max: 40 })
    .int('price_cents', 'Preço', { required: !partial, min: 0, max: MAX_PRICE })
    .int('cost_cents', 'Custo', { min: 0, max: MAX_PRICE })
    .bool('available', 'Disponível')
    .int('sort_order', 'Ordem', { min: 0, max: 9999 });
  if (input && 'category_ids' in input) {
    const ids = input.category_ids;
    if (!Array.isArray(ids) || ids.length > 50 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      v.errors.push('Categorias inválidas.');
    } else {
      const unique = [...new Set(ids)];
      const found = unique.length
        ? db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE id IN (${unique.map(() => '?').join(',')})`).get(...unique).n
        : 0;
      if (found !== unique.length) v.errors.push('Categoria não existe.');
      else v.out.category_ids = unique;
    }
  }
  if (!v.ok) throw new HttpError(400, v.errors.join(' '), v.errors);
  if (partial) for (const k of Object.keys(v.out)) if (!(k in input)) delete v.out[k];
  return v.out;
}

function setAddonCategories(db, addonId, categoryIds) {
  db.prepare('DELETE FROM addon_categories WHERE addon_id = ?').run(addonId);
  const link = db.prepare('INSERT INTO addon_categories (addon_id, category_id) VALUES (?, ?)');
  for (const id of categoryIds) link.run(addonId, id);
}

export function createAddon(db, input) {
  const d = validateAddon(db, input, false);
  const id = db.transaction(() => {
    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM addons').get().n;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO addons (name, price_cents, cost_cents, available, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(d.name, d.price_cents, d.cost_cents ?? 0, d.available === false ? 0 : 1, d.sort_order ?? nextOrder);
    setAddonCategories(db, Number(lastInsertRowid), d.category_ids ?? []);
    return Number(lastInsertRowid);
  })();
  return getAddon(db, id);
}

export function updateAddon(db, id, input) {
  const d = validateAddon(db, input, true);
  const current = db.prepare('SELECT * FROM addons WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Adicional não encontrado.');
  const n = { ...current, ...d };
  db.transaction(() => {
    db.prepare('UPDATE addons SET name = ?, price_cents = ?, cost_cents = ?, available = ?, sort_order = ? WHERE id = ?')
      .run(n.name, n.price_cents, n.cost_cents, n.available ? 1 : 0, n.sort_order, id);
    if (d.category_ids) setAddonCategories(db, id, d.category_ids);
  })();
  return getAddon(db, id);
}

export function deleteAddon(db, id) {
  const { changes } = db.prepare('DELETE FROM addons WHERE id = ?').run(id);
  if (!changes) throw new HttpError(404, 'Adicional não encontrado.');
}
