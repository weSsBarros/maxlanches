import { storage } from '../shared/util.js';

// Carrinho salvo no navegador do cliente, para não perder o pedido se ele fechar a página.
const saved = storage('ml_cart_v1', []);
let items = Array.isArray(saved.get()) ? saved.get() : [];
const listeners = new Set();

function commit() {
  saved.set(items);
  listeners.forEach((fn) => fn());
}

const normalizeNotes = (s) => String(s ?? '').trim().slice(0, 140);

/** Preço de uma unidade do item: produto + adicionais escolhidos. */
export const unitPrice = (item) =>
  item.price_cents + (item.addons ?? []).reduce((n, a) => n + a.price_cents * a.quantity, 0);

const addonsKey = (addons) =>
  (addons ?? [])
    .map((a) => `${a.id}:${a.quantity}`)
    .sort()
    .join(',');

export const cart = {
  get items() {
    return items;
  },
  get count() {
    return items.reduce((n, i) => n + (i.unavailable ? 0 : i.quantity), 0);
  },
  get subtotal() {
    return items.reduce((n, i) => n + (i.unavailable ? 0 : unitPrice(i) * i.quantity), 0);
  },
  get hasUnavailable() {
    return items.some((i) => i.unavailable);
  },
  quantityOf(productId) {
    return items.filter((i) => i.product_id === productId).reduce((n, i) => n + i.quantity, 0);
  },

  /** `addons`: [{ id, name, price_cents, quantity }] */
  add(product, quantity, notes, addons = []) {
    const clean = normalizeNotes(notes);
    const key = addonsKey(addons);
    const same = items.find(
      (i) => i.product_id === product.id && i.notes.toLowerCase() === clean.toLowerCase() && addonsKey(i.addons) === key,
    );
    if (same) same.quantity = Math.min(50, same.quantity + quantity);
    else {
      items.push({
        id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
        product_id: product.id,
        name: product.name,
        price_cents: product.price_cents,
        quantity,
        notes: clean,
        addons: addons.map(({ id, name, price_cents, quantity: q }) => ({ id, name, price_cents, quantity: q })),
      });
    }
    commit();
  },
  setQuantity(id, quantity) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (quantity <= 0) items = items.filter((i) => i.id !== id);
    else item.quantity = Math.min(50, quantity);
    commit();
  },
  setNotes(id, notes) {
    const item = items.find((i) => i.id === id);
    if (item) {
      item.notes = normalizeNotes(notes);
      commit();
    }
  },
  remove(id) {
    items = items.filter((i) => i.id !== id);
    commit();
  },
  clear() {
    items = [];
    commit();
  },
  /** Atualiza nomes e preços com o cardápio atual e marca o que esgotou (produto ou adicional). */
  sync(productsById) {
    for (const item of items) {
      const p = productsById.get(item.product_id);
      item.addons ??= [];
      item.unavailable = !p || !p.orderable;
      if (!p) continue;
      item.name = p.name;
      item.price_cents = p.price_cents;
      for (const a of item.addons) {
        const current = p.addons.find((x) => x.id === a.id);
        if (!current) item.unavailable = true;
        else {
          a.name = current.name;
          a.price_cents = current.price_cents;
        }
      }
    }
    commit();
  },
  onChange(fn) {
    listeners.add(fn);
  },
};
