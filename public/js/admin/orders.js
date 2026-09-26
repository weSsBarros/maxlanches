import { formatBRL, formatPhone, html, render, toast, whatsappLink, PAYMENT_LABEL, STATUS_LABEL } from '../shared/util.js';
import { formDialog, timeAgo, timeOf, todayYmd } from './ui.js';

let el;
let ctx;
const orders = new Map();
let view = 'active';
let historyDate = todayYmd();
let flashIds = new Set();

const COLUMNS = [
  { title: 'Novos', statuses: ['novo'], empty: 'Nenhum pedido novo.' },
  { title: 'Em preparo', statuses: ['preparo'], empty: 'Nada no fogo agora.' },
  { title: 'Prontos / a caminho', statuses: ['pronto', 'entrega'], empty: 'Nenhum pedido aguardando entrega.' },
];

const NEXT = {
  novo: () => ['preparo', 'Aceitar e preparar'],
  preparo: (o) => (o.fulfillment === 'entrega' ? ['entrega', 'Saiu para entrega 🛵'] : ['pronto', 'Pronto para retirada 🛎️']),
  entrega: () => ['concluido', 'Entregue ✓'],
  pronto: () => ['concluido', 'Retirado ✓'],
};
const PREV = { preparo: 'novo', entrega: 'preparo', pronto: 'preparo' };

export function mount(element, context) {
  el = element;
  ctx = context;
  ctx.bus.addEventListener('order:new', (e) => {
    orders.set(e.detail.id, e.detail);
    flashIds.add(e.detail.id);
    if (view === 'active') renderBoard();
    emitCount();
    toast(`Novo pedido #${e.detail.id} de ${e.detail.customer_name}!`, 'success');
  });
  ctx.bus.addEventListener('order:update', (e) => {
    const o = e.detail;
    if (['concluido', 'cancelado'].includes(o.status)) orders.delete(o.id);
    else orders.set(o.id, o);
    if (view === 'active') renderBoard();
    else loadHistory();
    emitCount();
  });
  ctx.bus.addEventListener('resync', loadActive);
  el.addEventListener('click', onClick);
  setInterval(() => {
    if (view === 'active' && !el.hidden) el.querySelectorAll('[data-ago]').forEach((s) => (s.textContent = timeAgo(s.dataset.ago)));
  }, 30_000);
  renderShell();
  loadActive();
}

export function onShow() {
  if (view === 'active') loadActive();
  else loadHistory();
}

function emitCount() {
  ctx.emit('orders:count', [...orders.values()].filter((o) => o.status === 'novo').length);
}

function renderShell() {
  render(el, html`
    <div class="panel-head">
      <h1>Pedidos</h1>
      <div class="segmented" role="group" aria-label="Visualização">
        <button type="button" data-view="active" aria-pressed="${view === 'active'}">Em andamento</button>
        <button type="button" data-view="history" aria-pressed="${view === 'history'}">Histórico</button>
      </div>
    </div>
    <div id="orders-body"></div>`);
}

async function loadActive() {
  try {
    const data = await ctx.call('/api/admin/orders');
    orders.clear();
    for (const o of data.orders) orders.set(o.id, o);
    emitCount();
    if (view === 'active') renderBoard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderBoard() {
  const body = el.querySelector('#orders-body');
  const list = [...orders.values()].sort((a, b) => a.id - b.id);
  render(body, html`
    <div class="board">
      ${COLUMNS.map((col) => {
        const items = list.filter((o) => col.statuses.includes(o.status));
        return html`
          <section aria-label="${col.title}">
            <div class="column-head"><span>${col.title}</span><span class="badge badge-dark">${items.length}</span></div>
            <div class="column-list">
              ${items.length ? items.map(orderCard) : html`<p class="empty card">${col.empty}</p>`}
            </div>
          </section>`;
      })}
    </div>`);
  flashIds = new Set();
}

function orderCard(o) {
  const next = NEXT[o.status]?.(o);
  const change = o.change_for_cents ? o.change_for_cents - o.total_cents : 0;
  return html`
    <article class="order-card ${flashIds.has(o.id) ? 'flash' : ''}" data-status="${o.status}" data-order="${o.id}">
      <div class="order-top">
        <span class="order-num">#${o.id}</span>
        <span class="badge ${o.fulfillment === 'entrega' ? '' : 'badge-ok'}">${o.fulfillment === 'entrega' ? `🛵 ${o.zone_name}` : '🏃 Retirada'}</span>
        <span class="order-time">${timeOf(o.created_at)} · <span data-ago="${o.created_at}">${timeAgo(o.created_at)}</span></span>
      </div>
      <div class="order-customer">
        <span>${o.customer_name}</span>
        <a href="${whatsappLink(o.customer_phone)}" target="_blank" rel="noopener">${formatPhone(o.customer_phone)}</a>
      </div>
      <ul class="order-items">
        ${o.items.map((i) => html`
          <li><span class="qty-tag">${i.quantity}×</span>${i.product_name}
            ${i.notes ? html`<span class="obs">⚠ ${i.notes}</span>` : ''}</li>`)}
      </ul>
      ${o.notes ? html`<p class="order-notes">📝 ${o.notes}</p>` : ''}
      <div class="order-meta">
        ${o.fulfillment === 'entrega' ? html`<span>📍 ${o.address}${o.address_reference ? ` — ${o.address_reference}` : ''}</span>` : ''}
        <span>💳 ${PAYMENT_LABEL[o.payment_method]}${o.change_for_cents ? html` · troco p/ ${formatBRL(o.change_for_cents)} (<strong>levar ${formatBRL(change)}</strong>)` : ''}</span>
      </div>
      <div class="order-total"><span>Total</span><span>${formatBRL(o.total_cents)}</span></div>
      <div class="order-actions">
        ${next ? html`<button class="btn btn-primary" data-act="status" data-status="${next[0]}">${next[1]}</button>` : ''}
        <button class="btn btn-outline btn-sm" data-act="print">🖨 Imprimir</button>
        <button class="btn btn-outline btn-sm" data-act="whatsapp">WhatsApp</button>
        ${PREV[o.status] ? html`<button class="btn btn-ghost btn-sm" data-act="status" data-status="${PREV[o.status]}" title="Voltar para a etapa anterior">↩ Voltar</button>` : ''}
        <button class="btn btn-danger btn-sm" data-act="cancel">Cancelar</button>
      </div>
    </article>`;
}

async function setStatus(id, status, cancel_reason) {
  try {
    const updated = await ctx.call(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: { status, cancel_reason } });
    // O evento em tempo real também chega, mas atualizamos já para resposta imediata.
    if (['concluido', 'cancelado'].includes(updated.status)) orders.delete(id);
    else orders.set(id, updated);
    if (view === 'active') renderBoard();
    emitCount();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const CUSTOMER_MESSAGES = {
  novo: (o, store) => `Olá, ${o.customer_name}! Recebemos seu pedido #${o.id} no ${store}. Já já começamos a preparar!`,
  preparo: (o, store) => `Olá, ${o.customer_name}! Seu pedido #${o.id} do ${store} já está sendo preparado 🔥`,
  entrega: (o, store) => `Olá, ${o.customer_name}! Seu pedido #${o.id} do ${store} saiu para entrega 🛵`,
  pronto: (o, store) => `Olá, ${o.customer_name}! Seu pedido #${o.id} do ${store} está pronto para retirada 🛎️`,
};

async function onClick(e) {
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) {
    view = viewBtn.dataset.view;
    renderShell();
    if (view === 'active') loadActive();
    else loadHistory();
    return;
  }
  if (e.target.closest('[data-history-nav]')) {
    const input = el.querySelector('#history-date');
    historyDate = input.value || todayYmd();
    loadHistory();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('[data-order]').dataset.order);
  const order = orders.get(id) ?? historyCache.get(id);
  if (!order) return;

  switch (btn.dataset.act) {
    case 'status':
      btn.disabled = true;
      await setStatus(id, btn.dataset.status);
      break;
    case 'cancel': {
      const values = await formDialog({
        title: `Cancelar pedido #${id}?`,
        message: 'Os itens voltam para o estoque. O cliente verá o pedido como cancelado.',
        fields: [{ name: 'reason', label: 'Motivo (aparece para o cliente)', placeholder: 'Ex.: acabou o pão, fora da área de entrega…', maxlength: 200 }],
        submitLabel: 'Cancelar pedido',
        danger: true,
      });
      if (values) await setStatus(id, 'cancelado', values.reason);
      break;
    }
    case 'print':
      printOrder(order);
      break;
    case 'whatsapp': {
      const msg = CUSTOMER_MESSAGES[order.status]?.(order, ctx.settings.store_name) ?? `Olá, ${order.customer_name}!`;
      window.open(whatsappLink(order.customer_phone, msg), '_blank', 'noopener');
      break;
    }
  }
}

// ---------------------------------------------------------------- Histórico

const historyCache = new Map();

async function loadHistory() {
  const body = el.querySelector('#orders-body');
  if (!body.querySelector('#history-date')) {
    render(body, html`
      <div class="filters">
        <label class="field-label" for="history-date">Dia</label>
        <input class="input date-input" type="date" id="history-date" value="${historyDate}">
        <button class="btn btn-outline btn-sm" type="button" data-history-nav>Ver pedidos</button>
      </div>
      <div class="card table-wrap" id="history-list"><p class="empty">Carregando…</p></div>`);
  }
  try {
    const { orders: list } = await ctx.call(`/api/admin/orders?scope=history&from=${historyDate}&to=${historyDate}`);
    historyCache.clear();
    list.forEach((o) => historyCache.set(o.id, o));
    renderHistory(list);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderHistory(list) {
  const target = el.querySelector('#history-list');
  if (!list.length) {
    render(target, html`<p class="empty">Nenhum pedido neste dia.</p>`);
    return;
  }
  const valid = list.filter((o) => o.status !== 'cancelado');
  render(target, html`
    <p class="history-summary">${valid.length} pedido(s) · ${formatBRL(valid.reduce((n, o) => n + o.total_cents, 0))}
      ${list.length - valid.length ? ` · ${list.length - valid.length} cancelado(s)` : ''}</p>
    <table class="history-table">
      <thead><tr><th>#</th><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${list.map((o) => html`
          <tr data-order="${o.id}">
            <td><strong>${o.id}</strong></td>
            <td>${timeOf(o.created_at)}</td>
            <td>${o.customer_name}<br><small class="muted">${o.fulfillment === 'entrega' ? o.zone_name : 'Retirada'}</small></td>
            <td><small>${o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}</small></td>
            <td>${PAYMENT_LABEL[o.payment_method]}</td>
            <td class="num">${formatBRL(o.total_cents)}</td>
            <td><span class="badge ${o.status === 'cancelado' ? 'badge-red' : o.status === 'concluido' ? 'badge-ok' : ''}">${STATUS_LABEL[o.status]}</span>
              ${o.cancel_reason ? html`<br><small class="muted">${o.cancel_reason}</small>` : ''}</td>
            <td><button class="btn btn-ghost btn-sm" data-act="print" aria-label="Imprimir pedido ${o.id}">🖨</button></td>
          </tr>`)}
      </tbody>
    </table>`);
}

// ---------------------------------------------------------------- Comanda

function printOrder(o) {
  const area = document.getElementById('print-area');
  const created = new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const change = o.change_for_cents ? o.change_for_cents - o.total_cents : 0;
  render(area, html`
    <h1>${ctx.settings.store_name}</h1>
    <p class="center">Pedido <span class="big">#${o.id}</span><br>${created}</p>
    <hr>
    <p class="big">${o.fulfillment === 'entrega' ? 'ENTREGA' : 'RETIRADA'}</p>
    <p>${o.customer_name} · ${formatPhone(o.customer_phone)}</p>
    ${o.fulfillment === 'entrega' ? html`<p>${o.address}${o.address_reference ? html`<br>${o.address_reference}` : ''}<br>Bairro: ${o.zone_name}</p>` : ''}
    <hr>
    ${o.items.map((i) => html`
      <div class="row"><span>${i.quantity}x ${i.product_name}</span><span>${formatBRL(i.unit_price_cents * i.quantity)}</span></div>
      ${i.notes ? html`<p>  &gt;&gt; ${i.notes}</p>` : ''}`)}
    ${o.notes ? html`<hr><p>OBS: ${o.notes}</p>` : ''}
    <hr>
    <div class="row"><span>Subtotal</span><span>${formatBRL(o.subtotal_cents)}</span></div>
    ${o.fulfillment === 'entrega' ? html`<div class="row"><span>Entrega</span><span>${formatBRL(o.delivery_fee_cents)}</span></div>` : ''}
    <div class="row big"><span>TOTAL</span><span>${formatBRL(o.total_cents)}</span></div>
    <p>Pagamento: ${PAYMENT_LABEL[o.payment_method]}</p>
    ${o.change_for_cents ? html`<p>Troco para ${formatBRL(o.change_for_cents)} → levar ${formatBRL(change)}</p>` : ''}
    <hr>
    <p class="center">Obrigado pela preferência!</p>`);
  window.print();
}
