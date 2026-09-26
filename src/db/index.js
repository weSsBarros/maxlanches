import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Cada migração roda uma única vez, em ordem. Para alterar o banco, adicione uma nova entrada no fim.
const migrations = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
    image       TEXT,
    available   INTEGER NOT NULL DEFAULT 1,
    stock       INTEGER CHECK (stock IS NULL OR stock >= 0),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_products_category ON products(category_id);

  CREATE TABLE delivery_zones (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    fee_cents  INTEGER NOT NULL CHECK (fee_cents >= 0),
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    code               TEXT NOT NULL UNIQUE,
    status             TEXT NOT NULL DEFAULT 'novo'
                       CHECK (status IN ('novo','preparo','entrega','pronto','concluido','cancelado')),
    customer_name      TEXT NOT NULL,
    customer_phone     TEXT NOT NULL,
    fulfillment        TEXT NOT NULL CHECK (fulfillment IN ('entrega','retirada')),
    address            TEXT NOT NULL DEFAULT '',
    address_reference  TEXT NOT NULL DEFAULT '',
    zone_id            INTEGER REFERENCES delivery_zones(id) ON DELETE SET NULL,
    zone_name          TEXT NOT NULL DEFAULT '',
    payment_method     TEXT NOT NULL CHECK (payment_method IN ('pix','dinheiro','cartao')),
    change_for_cents   INTEGER,
    notes              TEXT NOT NULL DEFAULT '',
    subtotal_cents     INTEGER NOT NULL,
    cost_cents         INTEGER NOT NULL,
    delivery_fee_cents INTEGER NOT NULL,
    total_cents        INTEGER NOT NULL,
    cancel_reason      TEXT NOT NULL DEFAULT '',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );
  CREATE INDEX idx_orders_created ON orders(created_at);
  CREATE INDEX idx_orders_status ON orders(status);

  CREATE TABLE order_items (
    id               INTEGER PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name     TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    unit_cost_cents  INTEGER NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity > 0),
    notes            TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_order_items_order ON order_items(order_id);

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  `,
  // 2 — Adicionais pagos (bacon extra, cheddar, ovo…), oferecidos por categoria.
  `
  CREATE TABLE addons (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
    available   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE addon_categories (
    addon_id    INTEGER NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (addon_id, category_id)
  );
  CREATE INDEX idx_addon_categories_category ON addon_categories(category_id);

  -- Cópia do adicional no momento da venda (nome, preço e custo), por unidade do item.
  CREATE TABLE order_item_addons (
    id               INTEGER PRIMARY KEY,
    order_item_id    INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    addon_id         INTEGER REFERENCES addons(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    unit_cost_cents  INTEGER NOT NULL,
    quantity         INTEGER NOT NULL CHECK (quantity > 0)
  );
  CREATE INDEX idx_order_item_addons_item ON order_item_addons(order_item_id);
  `,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
