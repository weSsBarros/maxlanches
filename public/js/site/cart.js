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

export const cart = {
  get items() {
    return items;
  },
  get count() {
    return items.reduce((n, i) => n + (i.unavailable ? 0 : i.quantity), 0);
  },
  get subtotal() {
    return items.reduce((n, i) => n + (i.unavailable ? 0 : i.price_cents * i.quantity), 0);
  },
  get hasUnavailable() {
    return items.some((i) => i.unavailable);
  },
  quantityOf(productId) {
    return items.filter((i) => i.product_id === productId).reduce((n, i) => n + i.quantity, 0);
  },

  add(product, quantity, notes) {
    const clean = normalizeNotes(notes);
    const same = items.find((i) => i.product_id === product.id && i.notes.toLowerCase() === clean.toLowerCase());
    if (same) same.quantity = Math.min(50, same.quantity + quantity);
    else {
      items.push({
        id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
        product_id: product.id,
        name: product.name,
        price_cents: product.price_cents,
        quantity,
        notes: clean,
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
  /** Atualiza nomes e preços com o cardápio atual e marca o que esgotou. */
  sync(productsById) {
    for (const item of items) {
      const p = productsById.get(item.product_id);
      item.unavailable = !p || !p.orderable;
      if (p) {
        item.name = p.name;
        item.price_cents = p.price_cents;
      }
    }
    commit();
  },
  onChange(fn) {
    listeners.add(fn);
  },
};
