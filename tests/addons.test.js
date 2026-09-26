import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { orderPayload, startTestServer } from './helpers.js';

// Cardápio de exemplo: X-Burger (id 7, R$ 18,00, custo R$ 7,50) em Hambúrgueres;
// Espeto de carne (id 1) em Churrasquinhos, que não tem adicionais.
// Adicionais: Bacon extra (id 1, R$ 4,00, custo R$ 1,80) e Cheddar (id 2, R$ 3,00, custo R$ 1,20).
const X_BURGER = 7;
const ESPETO = 1;
const CHURRASQUINHOS = 1; // id da categoria
const BACON = 1;
const CHEDDAR = 2;

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

const menuCategory = async (name) => (await t.request('GET', '/api/menu')).data.categories.find((c) => c.name === name);

describe('adicionais no cardápio', () => {
  test('cada categoria lista seus adicionais disponíveis, sem custo', async () => {
    const burgers = await menuCategory('Hambúrgueres');
    const bacon = burgers.addons.find((a) => a.id === BACON);
    assert.deepEqual(bacon, { id: BACON, name: 'Bacon extra', price_cents: 400 });
    assert.deepEqual((await menuCategory('Churrasquinhos')).addons, []);
  });

  test('adicional esgotado some do cardápio', async () => {
    await asAdmin(() => t.request('PATCH', `/api/admin/addons/${CHEDDAR}`, { available: false }));
    assert.ok(!(await menuCategory('Hambúrgueres')).addons.some((a) => a.id === CHEDDAR));
    await asAdmin(() => t.request('PATCH', `/api/admin/addons/${CHEDDAR}`, { available: true }));
    assert.ok((await menuCategory('Hambúrgueres')).addons.some((a) => a.id === CHEDDAR));
  });
});

describe('pedido com adicionais', () => {
  test('soma os adicionais ao preço do item, calculado no servidor', async () => {
    const { status, data } = await t.request('POST', '/api/orders', orderPayload({
      items: [{
        product_id: X_BURGER,
        quantity: 2,
        price_cents: 1,
        // Bacon repetido é somado: 2 bacons + 1 cheddar por lanche.
        addons: [{ addon_id: BACON, quantity: 1 }, { addon_id: CHEDDAR, quantity: 1 }, { addon_id: BACON, quantity: 1 }],
      }],
    }));
    assert.equal(status, 201);
    const order = (await t.request('GET', `/api/orders/${data.code}`)).data;
    // (18,00 + 2×4,00 + 3,00) × 2 = 58,00
    assert.equal(order.subtotal_cents, 5800);
    assert.equal(order.items[0].line_total_cents, 5800);
    assert.deepEqual(order.items[0].addons, [
      { name: 'Bacon extra', quantity: 2, unit_price_cents: 400 },
      { name: 'Cheddar', quantity: 1, unit_price_cents: 300 },
    ]);

    const admin = await asAdmin(() => t.request('GET', `/api/admin/orders/${data.number}`));
    // (7,50 + 2×1,80 + 1,20) × 2 = 24,60
    assert.equal(admin.data.cost_cents, 2460);
  });

  test('recusa adicional que não é da categoria do produto', async () => {
    const res = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: ESPETO, quantity: 1, addons: [{ addon_id: BACON, quantity: 1 }] }],
    }));
    assert.equal(res.status, 409);
    assert.match(res.data.error, /não está mais disponível/);
  });

  test('recusa adicional esgotado', async () => {
    await asAdmin(() => t.request('PATCH', `/api/admin/addons/${BACON}`, { available: false }));
    const res = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: X_BURGER, quantity: 1, addons: [{ addon_id: BACON, quantity: 1 }] }],
    }));
    assert.equal(res.status, 409);
    assert.match(res.data.error, /Bacon extra/);
    await asAdmin(() => t.request('PATCH', `/api/admin/addons/${BACON}`, { available: true }));
  });

  test('valida quantidade e formato dos adicionais', async () => {
    const send = (addons) => t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: X_BURGER, quantity: 1, addons }] }));
    assert.equal((await send([{ addon_id: BACON, quantity: 0 }])).status, 400);
    assert.equal((await send([{ addon_id: BACON, quantity: 6 }])).status, 400);
    assert.equal((await send([{ addon_id: BACON, quantity: 3 }, { addon_id: BACON, quantity: 3 }])).status, 400);
    assert.equal((await send('bacon')).status, 400);
    assert.equal((await send([{ addon_id: 'x', quantity: 1 }])).status, 400);
  });

  test('pedido mínimo considera o valor dos adicionais', async () => {
    await asAdmin(() => t.request('PUT', '/api/admin/settings', { min_order_cents: 2500 }));
    const plain = await t.request('POST', '/api/orders', orderPayload({ items: [{ product_id: X_BURGER, quantity: 1 }] }));
    assert.equal(plain.status, 409);
    const withAddons = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: X_BURGER, quantity: 1, addons: [{ addon_id: BACON, quantity: 2 }] }],
    }));
    assert.equal(withAddons.status, 201);
    await asAdmin(() => t.request('PUT', '/api/admin/settings', { min_order_cents: 0 }));
  });
});

describe('gestão de adicionais no painel', () => {
  test('exige login', async () => {
    assert.equal((await t.request('GET', '/api/admin/addons')).status, 401);
    assert.equal((await t.request('POST', '/api/admin/addons', { name: 'X', price_cents: 1, category_ids: [] })).status, 401);
  });

  test('cria, liga a categorias, edita e exclui mantendo o histórico', async () => {
    await t.login();
    const bad = await t.request('POST', '/api/admin/addons', { name: 'Vinagrete', price_cents: 200, category_ids: [999] });
    assert.equal(bad.status, 400);

    const created = await t.request('POST', '/api/admin/addons', {
      name: 'Vinagrete', price_cents: 200, cost_cents: 50, category_ids: [CHURRASQUINHOS],
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.category_ids, [CHURRASQUINHOS]);
    t.logout();

    const churrasco = await menuCategory('Churrasquinhos');
    assert.ok(churrasco.addons.some((a) => a.name === 'Vinagrete'));

    const order = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: ESPETO, quantity: 1, addons: [{ addon_id: created.data.id, quantity: 1 }] }],
    }));
    assert.equal(order.status, 201);

    await t.login();
    const moved = await t.request('PATCH', `/api/admin/addons/${created.data.id}`, { category_ids: [2], price_cents: 250 });
    assert.deepEqual(moved.data.category_ids, [2]);
    assert.equal(moved.data.price_cents, 250);
    assert.equal(moved.data.name, 'Vinagrete');
    assert.equal((await t.request('DELETE', `/api/admin/addons/${created.data.id}`)).status, 204);

    // O pedido antigo mantém nome e preço do adicional.
    const old = await t.request('GET', `/api/admin/orders/${order.data.number}`);
    assert.equal(old.data.items[0].addons[0].name, 'Vinagrete');
    assert.equal(old.data.items[0].addons[0].unit_price_cents, 200);
    assert.equal(old.data.items[0].addons[0].addon_id, null);
    assert.equal(old.data.subtotal_cents, 900 + 200);
    t.logout();
  });

  test('relatório separa vendas de adicionais e ignora cancelados', async () => {
    await t.login();
    const before = (await t.request('GET', '/api/admin/reports')).data;
    t.logout();

    const kept = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: X_BURGER, quantity: 3, addons: [{ addon_id: CHEDDAR, quantity: 1 }] }],
    }));
    const dropped = await t.request('POST', '/api/orders', orderPayload({
      items: [{ product_id: X_BURGER, quantity: 1, addons: [{ addon_id: CHEDDAR, quantity: 5 }] }],
    }));

    await t.login();
    await t.request('PATCH', `/api/admin/orders/${dropped.data.number}/status`, { status: 'cancelado' });
    const report = (await t.request('GET', '/api/admin/reports')).data;
    const cheddarBefore = before.top_addons.find((a) => a.name === 'Cheddar') ?? { quantity: 0, revenue_cents: 0, profit_cents: 0 };
    const cheddar = report.top_addons.find((a) => a.name === 'Cheddar');
    assert.equal(cheddar.quantity - cheddarBefore.quantity, 3);
    assert.equal(cheddar.revenue_cents - cheddarBefore.revenue_cents, 900);
    assert.equal(cheddar.profit_cents - cheddarBefore.profit_cents, 540);
    assert.equal(report.summary.addons_revenue_cents - before.summary.addons_revenue_cents, 900);
    // Vendas de produtos no resumo incluem os adicionais: 3 × (18,00 + 3,00)
    assert.equal(report.summary.products_revenue_cents - before.summary.products_revenue_cents, 6300);

    const csv = await t.requestBytes('/api/admin/reports/orders.csv');
    assert.match(csv.bytes.toString('utf8'), new RegExp(`\\n${kept.data.number};[^\\n]*3x X-Burger \\[\\+Cheddar\\]`));
    t.logout();
  });
});
