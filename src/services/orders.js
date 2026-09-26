import crypto from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { Validator } from '../lib/validate.js';
import { buildPixPayload } from '../lib/pix.js';
import { isOrderable } from './catalog.js';
import { getSettings } from './settings.js';

export const STATUSES = ['novo', 'preparo', 'entrega', 'pronto', 'concluido', 'cancelado'];
export const ACTIVE_STATUSES = ['novo', 'preparo', 'entrega', 'pronto'];

const MAX_ITEMS = 50;
const MAX_QTY = 50;
const MAX_ADDONS_PER_ITEM = 10;
const MAX_ADDON_QTY = 5;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomCode(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

function validateOrderInput(input, settings) {
  const v = new Validator(input)
    .string('customer_name', 'Nome', { required: true, min: 2, max: 60 })
    .string('customer_phone', 'Telefone', { required: true, max: 20 })
    .oneOf('fulfillment', 'Tipo de pedido', ['entrega', 'retirada'])
    .oneOf('payment_method', 'Forma de pagamento', ['pix', 'dinheiro', 'cartao'])
    .string('notes', 'Observações', { max: 300 })
    .int('change_for_cents', 'Troco', { min: 0, max: 10_000_00, nullable: true });

  const phone = onlyDigits(v.out.customer_phone);
  if (v.out.customer_phone !== undefined && (phone.length < 10 || phone.length > 13)) {
    v.errors.push('Telefone inválido. Informe DDD + número.');
  }
  v.out.customer_phone = phone;

  if (v.out.fulfillment === 'entrega') {
    if (!settings.delivery_enabled) v.errors.push('No momento não estamos fazendo entregas.');
    v.string('address', 'Endereço', { required: true, min: 5, max: 200 })
      .string('address_reference', 'Complemento/referência', { max: 120 })
      .int('zone_id', 'Bairro', { required: true, min: 1 });
  } else if (v.out.fulfillment === 'retirada' && !settings.pickup_enabled) {
    v.errors.push('No momento não estamos aceitando pedidos para retirada.');
  }

  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) v.errors.push('Seu carrinho está vazio.');
  if (items.length > MAX_ITEMS) v.errors.push('Pedido com itens demais.');
  const cleanItems = [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    const iv = new Validator(item)
      .int('product_id', 'Produto', { required: true, min: 1 })
      .int('quantity', 'Quantidade', { required: true, min: 1, max: MAX_QTY })
      .string('notes', 'Observação do item', { max: 140 });
    const addons = validateItemAddons(item?.addons, iv.errors);
    if (!iv.ok) v.errors.push(...iv.errors);
    else cleanItems.push({ ...iv.out, addons });
  }

  if (!v.ok) throw new HttpError(400, v.errors[0], v.errors);
  return { ...v.out, items: cleanItems };
}

/** Adicionais de um item: [{ addon_id, quantity }]. Repetidos são somados. */
function validateItemAddons(raw, errors) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ADDONS_PER_ITEM) {
    errors.push('Adicionais inválidos.');
    return [];
  }
  const byId = new Map();
  for (const a of raw) {
    const av = new Validator(a)
      .int('addon_id', 'Adicional', { required: true, min: 1 })
      .int('quantity', 'Quantidade do adicional', { required: true, min: 1, max: MAX_ADDON_QTY });
    if (!av.ok) {
      errors.push(...av.errors);
      continue;
    }
    byId.set(av.out.addon_id, (byId.get(av.out.addon_id) ?? 0) + av.out.quantity);
  }
  if ([...byId.values()].some((q) => q > MAX_ADDON_QTY)) errors.push(`Máximo de ${MAX_ADDON_QTY} unidades de cada adicional.`);
  return [...byId].map(([addon_id, quantity]) => ({ addon_id, quantity }));
}

/**
 * Cria um pedido. Preços, custos e taxa de entrega vêm sempre do banco — nunca do navegador.
 * Tudo roda numa transação para que o controle de estoque não aceite dois pedidos da última unidade.
 */
export function createOrder(db, rawInput) {
  const settings = getSettings(db);
  if (!settings.is_open) throw new HttpError(409, 'A loja está fechada no momento. Volte no nosso horário de funcionamento!');
  const input = validateOrderInput(rawInput, settings);

  const tx = db.transaction(() => {
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const products = new Map();
    const qtyByProduct = new Map();
    for (const item of input.items) {
      const p = products.get(item.product_id) ?? getProduct.get(item.product_id);
      if (!p) throw new HttpError(409, 'Um dos produtos do carrinho não existe mais. Revise seu pedido.');
      if (!isOrderable(p)) throw new HttpError(409, `"${p.name}" acabou de esgotar. Remova-o do carrinho para continuar.`);
      products.set(p.id, p);
      qtyByProduct.set(p.id, (qtyByProduct.get(p.id) ?? 0) + item.quantity);
    }
    for (const [id, qty] of qtyByProduct) {
      const p = products.get(id);
      if (p.stock !== null && qty > p.stock) {
        throw new HttpError(409, `Só restam ${p.stock} unidade(s) de "${p.name}".`);
      }
    }

    // Adicionais: precisam estar disponíveis e liberados para a categoria do produto.
    const getAddon = db.prepare(`
      SELECT a.* FROM addons a JOIN addon_categories ac ON ac.addon_id = a.id
      WHERE a.id = ? AND ac.category_id = ?`);
    for (const item of input.items) {
      const p = products.get(item.product_id);
      item.resolvedAddons = item.addons.map(({ addon_id, quantity }) => {
        const addon = getAddon.get(addon_id, p.category_id);
        if (!addon) throw new HttpError(409, `Um adicional escolhido para "${p.name}" não está mais disponível. Revise o item.`);
        if (!addon.available) throw new HttpError(409, `O adicional "${addon.name}" acabou. Remova-o de "${p.name}" para continuar.`);
        return { addon, quantity };
      });
    }

    let subtotal = 0;
    let cost = 0;
    for (const item of input.items) {
      const p = products.get(item.product_id);
      const addonsPrice = item.resolvedAddons.reduce((n, a) => n + a.addon.price_cents * a.quantity, 0);
      const addonsCost = item.resolvedAddons.reduce((n, a) => n + a.addon.cost_cents * a.quantity, 0);
      subtotal += (p.price_cents + addonsPrice) * item.quantity;
      cost += (p.cost_cents + addonsCost) * item.quantity;
    }

    if (settings.min_order_cents > 0 && subtotal < settings.min_order_cents) {
      throw new HttpError(409, `O pedido mínimo é de ${formatBRL(settings.min_order_cents)}.`);
    }

    let deliveryFee = 0;
    let zone = null;
    if (input.fulfillment === 'entrega') {
      zone = db.prepare('SELECT * FROM delivery_zones WHERE id = ? AND active = 1').get(input.zone_id);
      if (!zone) throw new HttpError(409, 'Não entregamos nesse bairro. Escolha outro ou retire no local.');
      const freeAbove = settings.free_delivery_above_cents;
      deliveryFee = freeAbove > 0 && subtotal >= freeAbove ? 0 : zone.fee_cents;
    }
    const total = subtotal + deliveryFee;

    let changeFor = null;
    if (input.payment_method === 'dinheiro' && input.change_for_cents) {
      if (input.change_for_cents < total) throw new HttpError(400, 'O valor para troco deve ser maior que o total do pedido.');
      changeFor = input.change_for_cents;
    }

    const now = new Date().toISOString();
    const insertOrder = db.prepare(`
      INSERT INTO orders (code, customer_name, customer_phone, fulfillment, address, address_reference, zone_id, zone_name,
        payment_method, change_for_cents, notes, subtotal_cents, cost_cents, delivery_fee_cents, total_cents, created_at, updated_at)
      VALUES (@code, @customer_name, @customer_phone, @fulfillment, @address, @address_reference, @zone_id, @zone_name,
        @payment_method, @change_for_cents, @notes, @subtotal, @cost, @delivery_fee, @total, @now, @now)`);
    const orderData = {
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      fulfillment: input.fulfillment,
      address: zone ? input.address : '',
      address_reference: zone ? input.address_reference ?? '' : '',
      zone_id: zone?.id ?? null,
      zone_name: zone?.name ?? '',
      payment_method: input.payment_method,
      change_for_cents: changeFor,
      notes: input.notes ?? '',
      subtotal,
      cost,
      delivery_fee: deliveryFee,
      total,
      now,
    };
    let orderId;
    for (let attempt = 0; ; attempt++) {
      try {
        orderId = Number(insertOrder.run({ ...orderData, code: randomCode() }).lastInsertRowid);
        break;
      } catch (err) {
        if (attempt < 3 && err.code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
        throw err;
      }
    }

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, unit_cost_cents, quantity, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertItemAddon = db.prepare(`
      INSERT INTO order_item_addons (order_item_id, addon_id, name, unit_price_cents, unit_cost_cents, quantity)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of input.items) {
      const p = products.get(item.product_id);
      const itemId = insertItem.run(orderId, p.id, p.name, p.price_cents, p.cost_cents, item.quantity, item.notes ?? '').lastInsertRowid;
      for (const { addon, quantity } of item.resolvedAddons) {
        insertItemAddon.run(itemId, addon.id, addon.name, addon.price_cents, addon.cost_cents, quantity);
      }
    }
    const decrement = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL');
    for (const [id, qty] of qtyByProduct) decrement.run(qty, id);

    return orderId;
  });

  return getOrderById(db, tx());
}

function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function hydrate(db, orders) {
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  const addonsByItem = new Map();
  if (items.length) {
    const itemIds = items.map((it) => it.id);
    const addons = db
      .prepare(`SELECT * FROM order_item_addons WHERE order_item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY id`)
      .all(...itemIds);
    for (const a of addons) {
      if (!addonsByItem.has(a.order_item_id)) addonsByItem.set(a.order_item_id, []);
      addonsByItem.get(a.order_item_id).push(a);
    }
  }
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const it of items) {
    const addons = addonsByItem.get(it.id) ?? [];
    const addonsPrice = addons.reduce((n, a) => n + a.unit_price_cents * a.quantity, 0);
    byOrder.get(it.order_id).push({ ...it, addons, line_total_cents: (it.unit_price_cents + addonsPrice) * it.quantity });
  }
  return orders.map((o) => ({ ...o, items: byOrder.get(o.id) }));
}

export function getOrderById(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) throw new HttpError(404, 'Pedido não encontrado.');
  return hydrate(db, [order])[0];
}

/** Visão do pedido para o cliente (link com código aleatório). Não inclui custos. */
export function getPublicOrder(db, code) {
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(String(code).toUpperCase());
  if (!order) throw new HttpError(404, 'Pedido não encontrado.');
  const [full] = hydrate(db, [order]);
  const settings = getSettings(db);
  const pix =
    full.payment_method === 'pix' && settings.pix_key
      ? {
          key: settings.pix_key,
          name: settings.pix_name,
          payload: buildPixPayload({
            key: settings.pix_key,
            name: settings.pix_name,
            city: settings.pix_city,
            amountCents: full.total_cents,
            txid: `ML${full.id}`,
          }),
        }
      : null;
  return {
    number: full.id,
    code: full.code,
    status: full.status,
    cancel_reason: full.cancel_reason,
    customer_name: full.customer_name,
    customer_phone: full.customer_phone,
    fulfillment: full.fulfillment,
    address: full.address,
    address_reference: full.address_reference,
    zone_name: full.zone_name,
    payment_method: full.payment_method,
    change_for_cents: full.change_for_cents,
    notes: full.notes,
    subtotal_cents: full.subtotal_cents,
    delivery_fee_cents: full.delivery_fee_cents,
    total_cents: full.total_cents,
    created_at: full.created_at,
    items: full.items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      line_total_cents: i.line_total_cents,
      notes: i.notes,
      addons: i.addons.map((a) => ({ name: a.name, quantity: a.quantity, unit_price_cents: a.unit_price_cents })),
    })),
    pix,
  };
}

export function listOrders(db, { scope = 'active', from, to, limit = 200 } = {}) {
  let rows;
  if (scope === 'active') {
    rows = db
      .prepare(`SELECT * FROM orders WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) ORDER BY id`)
      .all(...ACTIVE_STATUSES);
  } else {
    rows = db
      .prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT ?')
      .all(from, to, limit);
  }
  return hydrate(db, rows);
}

/**
 * Altera o status. "cancelado" é final e devolve os itens ao estoque;
 * entre os demais status a troca é livre, para corrigir um clique errado.
 */
export function updateOrderStatus(db, id, { status, cancel_reason } = {}) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
  const tx = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (order.status === status) return;
    if (order.status === 'cancelado') throw new HttpError(409, 'Pedido cancelado não pode ser reaberto.');
    if (status === 'entrega' && order.fulfillment !== 'entrega') throw new HttpError(400, 'Este pedido é para retirada.');
    if (status === 'pronto' && order.fulfillment !== 'retirada') throw new HttpError(400, 'Este pedido é para entrega.');

    if (status === 'cancelado') {
      const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL');
      for (const item of db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(id)) {
        if (item.product_id) restore.run(item.quantity, item.product_id);
      }
    }
    const reason = status === 'cancelado' && typeof cancel_reason === 'string' ? cancel_reason.trim().slice(0, 200) : '';
    db.prepare('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, reason, new Date().toISOString(), id);
  });
  tx();
  return getOrderById(db, id);
}
