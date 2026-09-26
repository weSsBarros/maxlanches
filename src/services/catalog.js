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
  return categories
    .map((c) => ({
      ...c,
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
