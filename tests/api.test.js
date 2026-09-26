import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { orderPayload, startTestServer } from './helpers.js';

let t;

before(async () => {
  t = await startTestServer();
});
after(() => t.close());

async function asAdmin(fn) {
  await t.login();
  try {
    return await fn();
  } finally {
    t.logout();
  }
}

describe('cardápio público', () => {
  test('lista categorias e produtos sem expor custo', async () => {
    const { status, data } = await t.request('GET', '/api/menu');
    assert.equal(status, 200);
    assert.ok(data.categories.length >= 4);
    const product = data.categories[0].products[0];
    assert.equal(product.cost_cents, undefined);
    assert.equal(typeof product.price_cents, 'number');
    assert.equal(product.orderable, true);
  });

  test('dados da loja não expõem a chave Pix', async () => {
    const { data } = await t.request('GET', '/api/store');
    assert.equal(data.settings.store_name, 'Max Lanches');
    assert.equal(data.settings.pix_key, undefined);
    assert.ok(data.zones.length > 0);
  });
});

describe('pedidos', () => {
  beforeEach(async () => {
    await asAdmin(() =>
      t.request('PUT', '/api/admin/settings', { is_open: true, min_order_cents: 0, free_delivery_above_cents: 0 }),
    );
  });

  test('usa o preço do banco, não o enviado pelo navegador', async () => {
    const { status, data } = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: 1, quantity: 2, price_cents: 1, notes: 'bem passado' }],
    }));
    assert.equal(status, 201);
    const order = (await t.request('GET', `/api/orders/${data.code}`)).data;
    assert.equal(order.subtotal_cents, 1800); // Espeto de carne R$ 9,00 × 2
    assert.equal(order.total_cents, 1800);
    assert.equal(order.items[0].notes, 'bem passado');
    assert.equal(order.customer_phone, '11988887777');
  });

  test('soma a taxa do bairro na entrega e aplica frete grátis acima do limite', async () => {
    const zone = (await t.request('GET', '/api/store')).data.zones[0];
    const delivery = orderPayload({ fulfillment: 'entrega', zone_id: zone.id, address: 'Rua A, 10' });
    let { data } = await t.request('POST', '/api/orders', delivery);
    let order = (await t.request('GET', `/api/orders/${data.code}`)).data;
    assert.equal(order.delivery_fee_cents, zone.fee_cents);
    assert.equal(order.total_cents, 1800 + zone.fee_cents);
    assert.equal(order.zone_name, zone.name);

    await asAdmin(() => t.request('PUT', '/api/admin/settings', { free_delivery_above_cents: 1500 }));
    ({ data } = await t.request('POST', '/api/orders', delivery));
    order = (await t.request('GET', `/api/orders/${data.code}`)).data;
    assert.equal(order.delivery_fee_cents, 0);
  });

  test('exige endereço e bairro atendido na entrega', async () => {
    let res = await t.request('POST', '/api/orders', orderPayload({ fulfillment: 'entrega' }));
    assert.equal(res.status, 400);
    res = await t.request('POST', '/api/orders', orderPayload({ fulfillment: 'entrega', zone_id: 9999, address: 'Rua B, 20' }));
    assert.equal(res.status, 409);
  });

  test('respeita pedido mínimo', async () => {
    await asAdmin(() => t.request('PUT', '/api/admin/settings', { min_order_cents: 5000 }));
    const res = await t.request('POST', '/api/orders', orderPayload());
    assert.equal(res.status, 409);
    assert.match(res.data.error, /mínimo/);
  });

  test('recusa pedidos com a loja fechada', async () => {
    await asAdmin(() => t.request('PUT', '/api/admin/settings', { is_open: false }));
    const res = await t.request('POST', '/api/orders', orderPayload());
    assert.equal(res.status, 409);
    assert.match(res.data.error, /fechada/);
  });

  test('recusa produto indisponível', async () => {
    await asAdmin(() => t.request('PATCH', '/api/admin/products/2', { available: false }));
    const res = await t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: 2, quantity: 1 }] }));
    assert.equal(res.status, 409);
    assert.match(res.data.error, /esgotar/);
    await asAdmin(() => t.request('PATCH', '/api/admin/products/2', { available: true }));
  });

  test('valida troco maior que o total', async () => {
    const res = await t.request('POST', '/api/orders', orderPayload({ payment_method: 'dinheiro', change_for_cents: 1000 }));
    assert.equal(res.status, 400);
    const ok = await t.request('POST', '/api/orders', orderPayload({ payment_method: 'dinheiro', change_for_cents: 5000 }));
    assert.equal(ok.status, 201);
  });

  test('baixa o estoque, bloqueia o excesso e devolve ao cancelar', async () => {
    await t.login();
    await t.request('PATCH', '/api/admin/products/3', { stock: 3 });
    t.logout();

    const tooMany = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: 3, quantity: 2 }, { product_id: 3, quantity: 2, notes: 'outro' }],
    }));
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.data.error, /Só restam 3/);

    const created = await t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: 3, quantity: 3 }] }));
    assert.equal(created.status, 201);
    let menu = (await t.request('GET', '/api/menu')).data;
    let product = menu.categories.flatMap((c) => c.products).find((p) => p.id === 3);
    assert.equal(product.orderable, false);

    await t.login();
    const cancel = await t.request('PATCH', `/api/admin/orders/${created.data.number}/status`, { status: 'cancelado', cancel_reason: 'Teste' });
    assert.equal(cancel.data.status, 'cancelado');
    const reopen = await t.request('PATCH', `/api/admin/orders/${created.data.number}/status`, { status: 'novo' });
    assert.equal(reopen.status, 409);
    await t.request('PATCH', '/api/admin/products/3', { stock: null });
    t.logout();

    menu = (await t.request('GET', '/api/menu')).data;
    product = menu.categories.flatMap((c) => c.products).find((p) => p.id === 3);
    assert.equal(product.orderable, true);
    const publicOrder = (await t.request('GET', `/api/orders/${created.data.code}`)).data;
    assert.equal(publicOrder.status, 'cancelado');
    assert.equal(publicOrder.cancel_reason, 'Teste');
  });

  test('gera Pix copia e cola com o valor do pedido quando há chave cadastrada', async () => {
    await asAdmin(() => t.request('PUT', '/api/admin/settings', { pix_key: 'pix@maxlanches.com' }));
    const { data } = await t.request('POST', '/api/orders', orderPayload());
    const order = (await t.request('GET', `/api/orders/${data.code}`)).data;
    assert.match(order.pix.payload, /pix@maxlanches\.com/);
    assert.match(order.pix.payload, /540518\.00/);
    assert.equal(order.cost_cents, undefined);
  });

  test('não deixa marcar "saiu para entrega" em pedido de retirada', async () => {
    const { data } = await t.request('POST', '/api/orders', orderPayload());
    await t.login();
    const res = await t.request('PATCH', `/api/admin/orders/${data.number}/status`, { status: 'entrega' });
    assert.equal(res.status, 400);
    const ok = await t.request('PATCH', `/api/admin/orders/${data.number}/status`, { status: 'pronto' });
    assert.equal(ok.data.status, 'pronto');
    t.logout();
  });

  test('pedido inexistente retorna 404', async () => {
    const res = await t.request('GET', '/api/orders/NAOEXISTE');
    assert.equal(res.status, 404);
  });
});

describe('painel administrativo', () => {
  test('exige login', async () => {
    assert.equal((await t.request('GET', '/api/admin/orders')).status, 401);
    assert.equal((await t.request('GET', '/api/admin/reports')).status, 401);
    assert.equal((await t.request('PATCH', '/api/admin/products/1', { available: false })).status, 401);
  });

  test('recusa senha errada', async () => {
    const res = await t.request('POST', '/api/admin/login', { username: 'admin', password: 'errada' });
    assert.equal(res.status, 401);
  });

  test('cookie de sessão é httpOnly', async () => {
    const res = await t.login();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
    t.logout();
  });

  test('bloqueia escrita vinda de outro site', async () => {
    await t.login();
    const res = await t.request('PUT', '/api/admin/settings', { is_open: false }, { Origin: 'https://site-malicioso.com' });
    assert.equal(res.status, 403);
    t.logout();
  });

  test('valida produto e calcula disponibilidade', async () => {
    await t.login();
    const bad = await t.request('POST', '/api/admin/products', { name: '', price_cents: -1, category_id: 1 });
    assert.equal(bad.status, 400);
    const created = await t.request('POST', '/api/admin/products', {
      name: 'Batata frita', category_id: 1, price_cents: 1500, cost_cents: 500, stock: 0,
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.orderable, false);
    const restocked = await t.request('PATCH', `/api/admin/products/${created.data.id}`, { stock: 10 });
    assert.equal(restocked.data.orderable, true);
    assert.equal(restocked.data.name, 'Batata frita');
    assert.equal((await t.request('DELETE', `/api/admin/products/${created.data.id}`)).status, 204);
    t.logout();
  });

  test('não exclui categoria com produtos', async () => {
    await t.login();
    const res = await t.request('DELETE', '/api/admin/categories/1');
    assert.equal(res.status, 409);
    t.logout();
  });

  test('relatório soma faturamento, custo e lucro e ignora cancelados', async () => {
    await t.login();
    await t.request('PUT', '/api/admin/settings', { is_open: true, min_order_cents: 0, free_delivery_above_cents: 0 });
    const before = (await t.request('GET', '/api/admin/reports')).data.summary;

    // X-Burger (id 7): R$ 18,00, custo R$ 7,50
    const kept = await t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: 7, quantity: 2 }] }));
    const dropped = await t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: 7, quantity: 5 }] }));
    await t.request('PATCH', `/api/admin/orders/${dropped.data.number}/status`, { status: 'cancelado' });

    const report = (await t.request('GET', '/api/admin/reports')).data;
    const s = report.summary;
    assert.equal(s.orders - before.orders, 1);
    assert.equal(s.cancelled - before.cancelled, 1);
    assert.equal(s.products_revenue_cents - before.products_revenue_cents, 3600);
    assert.equal(s.cost_cents - before.cost_cents, 1500);
    assert.equal(s.gross_profit_cents - before.gross_profit_cents, 2100);
    assert.ok(report.top_products.some((p) => p.name === 'X-Burger'));
    assert.equal(report.by_day.length, 1);
    assert.equal(report.by_hour.length, 24);
    assert.ok(kept.data.code);
    t.logout();
  });

  test('exporta planilha CSV', async () => {
    await t.login();
    const res = await t.requestBytes('/api/admin/reports/orders.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="pedidos_/);
    // BOM no início para o Excel abrir os acentos corretamente.
    assert.deepEqual([...res.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(res.bytes.subarray(3).toString('utf8'), /^Pedido;Data;Status/);
    t.logout();
  });

  test('rejeita período inválido no relatório', async () => {
    await t.login();
    const res = await t.request('GET', '/api/admin/reports?from=2026-09-10&to=2026-09-01');
    assert.equal(res.status, 400);
    t.logout();
  });

  test('troca de senha invalida sessões antigas', async () => {
    await t.login();
    const res = await t.request('POST', '/api/admin/password', { current: 'senha-de-teste-123', next: 'nova-senha-456' });
    assert.equal(res.status, 204);
    assert.equal((await t.request('GET', '/api/admin/me')).status, 200); // sessão nova segue válida
    await t.request('POST', '/api/admin/password', { current: 'nova-senha-456', next: 'senha-de-teste-123' });
    t.logout();
  });
});
