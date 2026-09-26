import { HttpError } from '../lib/http.js';
import { addDays, isYmd, localDate, localHour, startOfLocalDay } from '../lib/time.js';

const MAX_DAYS = 366;

/** Converte um período local (datas inclusivas) em limites UTC. */
export function resolveRange({ from, to }, timeZone) {
  const today = localDate(new Date(), timeZone);
  const start = isYmd(from) ? from : today;
  const end = isYmd(to) ? to : start;
  if (end < start) throw new HttpError(400, 'A data final deve ser depois da inicial.');
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1;
  if (days > MAX_DAYS) throw new HttpError(400, 'Escolha um período de até 1 ano.');
  return {
    from: start,
    to: end,
    days,
    startUtc: startOfLocalDay(start, timeZone).toISOString(),
    endUtc: startOfLocalDay(addDays(end, 1), timeZone).toISOString(),
  };
}

/**
 * Relatório de vendas. Pedidos cancelados não entram no faturamento.
 * Lucro bruto = vendas de produtos − custo dos produtos (taxa de entrega fica separada).
 */
export function buildReport(db, query, timeZone) {
  const range = resolveRange(query, timeZone);
  const orders = db
    .prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at')
    .all(range.startUtc, range.endUtc);
  const valid = orders.filter((o) => o.status !== 'cancelado');
  const validIds = new Set(valid.map((o) => o.id));

  const sum = (list, key) => list.reduce((acc, o) => acc + o[key], 0);
  const productsRevenue = sum(valid, 'subtotal_cents');
  const cost = sum(valid, 'cost_cents');
  const deliveryFees = sum(valid, 'delivery_fee_cents');
  const revenue = sum(valid, 'total_cents');
  const grossProfit = productsRevenue - cost;

  const byDay = new Map();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) byDay.set(d, { date: d, orders: 0, revenue_cents: 0, profit_cents: 0 });
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue_cents: 0 }));
  const byPayment = { pix: { orders: 0, total_cents: 0 }, dinheiro: { orders: 0, total_cents: 0 }, cartao: { orders: 0, total_cents: 0 } };
  const byFulfillment = { entrega: 0, retirada: 0 };
  const byZone = new Map();

  for (const o of valid) {
    const at = new Date(o.created_at);
    const day = byDay.get(localDate(at, timeZone));
    if (day) {
      day.orders++;
      day.revenue_cents += o.total_cents;
      day.profit_cents += o.subtotal_cents - o.cost_cents;
    }
    const hour = byHour[localHour(at, timeZone)];
    hour.orders++;
    hour.revenue_cents += o.total_cents;
    byPayment[o.payment_method].orders++;
    byPayment[o.payment_method].total_cents += o.total_cents;
    byFulfillment[o.fulfillment]++;
    if (o.fulfillment === 'entrega') {
      const z = byZone.get(o.zone_name) ?? { zone: o.zone_name, orders: 0, fees_cents: 0 };
      z.orders++;
      z.fees_cents += o.delivery_fee_cents;
      byZone.set(o.zone_name, z);
    }
  }

  const products = new Map();
  if (validIds.size) {
    const items = db
      .prepare(`SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelado'`)
      .all(range.startUtc, range.endUtc);
    for (const it of items) {
      const p = products.get(it.product_name) ?? { name: it.product_name, quantity: 0, revenue_cents: 0, profit_cents: 0 };
      p.quantity += it.quantity;
      p.revenue_cents += it.unit_price_cents * it.quantity;
      p.profit_cents += (it.unit_price_cents - it.unit_cost_cents) * it.quantity;
      products.set(it.product_name, p);
    }
  }

  return {
    range: { from: range.from, to: range.to, days: range.days },
    summary: {
      orders: valid.length,
      cancelled: orders.length - valid.length,
      revenue_cents: revenue,
      products_revenue_cents: productsRevenue,
      cost_cents: cost,
      gross_profit_cents: grossProfit,
      margin: productsRevenue ? grossProfit / productsRevenue : 0,
      delivery_fees_cents: deliveryFees,
      avg_ticket_cents: valid.length ? Math.round(revenue / valid.length) : 0,
      items_sold: [...products.values()].reduce((acc, p) => acc + p.quantity, 0),
    },
    by_day: [...byDay.values()],
    by_hour: byHour,
    by_payment: byPayment,
    by_fulfillment: byFulfillment,
    by_zone: [...byZone.values()].sort((a, b) => b.orders - a.orders),
    top_products: [...products.values()].sort((a, b) => b.quantity - a.quantity || b.revenue_cents - a.revenue_cents),
  };
}

const PAYMENT_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão' };
const STATUS_LABEL = {
  novo: 'Novo', preparo: 'Em preparo', entrega: 'Saiu para entrega', pronto: 'Pronto p/ retirada',
  concluido: 'Concluído', cancelado: 'Cancelado',
};

/** CSV no formato do Excel brasileiro (separador ";" e vírgula decimal). */
export function buildOrdersCsv(db, query, timeZone) {
  const range = resolveRange(query, timeZone);
  const orders = db
    .prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at')
    .all(range.startUtc, range.endUtc);
  const itemsStmt = db.prepare('SELECT product_name, quantity, notes FROM order_items WHERE order_id = ? ORDER BY id');
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });

  const header = ['Pedido', 'Data', 'Status', 'Cliente', 'Telefone', 'Tipo', 'Bairro', 'Pagamento', 'Itens',
    'Produtos (R$)', 'Taxa entrega (R$)', 'Total (R$)', 'Custo (R$)', 'Lucro bruto (R$)'];
  const lines = [header.join(';')];
  for (const o of orders) {
    const items = itemsStmt.all(o.id).map((i) => `${i.quantity}x ${i.product_name}${i.notes ? ` (${i.notes})` : ''}`).join(' | ');
    lines.push([
      o.id, dateFmt.format(new Date(o.created_at)), STATUS_LABEL[o.status], o.customer_name, o.customer_phone,
      o.fulfillment === 'entrega' ? 'Entrega' : 'Retirada', o.zone_name, PAYMENT_LABEL[o.payment_method], items,
      money(o.subtotal_cents), money(o.delivery_fee_cents), money(o.total_cents), money(o.cost_cents),
      money(o.subtotal_cents - o.cost_cents),
    ].map(cell).join(';'));
  }
  return { filename: `pedidos_${range.from}_a_${range.to}.csv`, content: '﻿' + lines.join('\r\n') + '\r\n' };
}
