import { api, formatBRL, formatPhone, html, raw, render, toast, whatsappLink, PAYMENT_LABEL, STATUS_LABEL } from '../shared/util.js';

const code = decodeURIComponent(location.pathname.split('/').pop() || '');
const isNew = new URLSearchParams(location.search).has('novo');
const root = document.getElementById('order');
let store = null;
let pollTimer;

function steps(order) {
  const last = order.fulfillment === 'entrega' ? ['entrega', 'Saiu para entrega', '🛵'] : ['pronto', 'Pronto para retirada', '🛎️'];
  return [
    ['novo', 'Pedido recebido', '📝'],
    ['preparo', 'Em preparo', '🔥'],
    last,
    ['concluido', order.fulfillment === 'entrega' ? 'Entregue' : 'Retirado', '✅'],
  ];
}

function whatsappMessage(order) {
  const lines = [
    `*Pedido #${order.number}* — ${store?.store_name ?? 'Max Lanches'}`,
    '',
    ...order.items.map((i) => {
      const addons = i.addons.map((a) => `\n   + ${a.quantity > 1 ? `${a.quantity}x ` : ''}${a.name}`).join('');
      return `${i.quantity}x ${i.name} — ${formatBRL(i.line_total_cents)}${addons}${i.notes ? `\n   _Obs.: ${i.notes}_` : ''}`;
    }),
    '',
    `Subtotal: ${formatBRL(order.subtotal_cents)}`,
  ];
  if (order.fulfillment === 'entrega') lines.push(`Entrega (${order.zone_name}): ${order.delivery_fee_cents ? formatBRL(order.delivery_fee_cents) : 'grátis'}`);
  lines.push(`*Total: ${formatBRL(order.total_cents)}*`, '');
  lines.push(`Nome: ${order.customer_name}`);
  if (order.fulfillment === 'entrega') {
    lines.push(`Endereço: ${order.address}${order.address_reference ? ` (${order.address_reference})` : ''} — ${order.zone_name}`);
  } else {
    lines.push('Vou retirar no food truck.');
  }
  let pay = `Pagamento: ${PAYMENT_LABEL[order.payment_method]}`;
  if (order.change_for_cents) pay += ` — troco para ${formatBRL(order.change_for_cents)}`;
  lines.push(pay);
  if (order.notes) lines.push(`Obs.: ${order.notes}`);
  lines.push('', `Acompanhar: ${location.origin}/pedido/${order.code}`);
  return lines.join('\n');
}

function renderOrder(order) {
  const cancelled = order.status === 'cancelado';
  const done = order.status === 'concluido';
  const flow = steps(order);
  const currentIndex = flow.findIndex(([s]) => s === order.status);
  const wa = whatsappLink(store?.whatsapp, whatsappMessage(order));
  const created = new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  render(root, html`
    <section class="order-hero ${cancelled ? 'cancelled' : ''}">
      <p class="order-kicker">Pedido #${order.number} · ${created}</p>
      <h1>${cancelled ? 'Pedido cancelado' : done ? 'Pedido finalizado. Bom apetite!' : isNew && order.status === 'novo' ? 'Pedido enviado!' : STATUS_LABEL[order.status]}</h1>
      ${cancelled && order.cancel_reason ? html`<p>Motivo: ${order.cancel_reason}</p>` : ''}
      ${!cancelled && !done && store?.eta_text ? html`<p>Tempo estimado: ${store.eta_text}</p>` : ''}
    </section>

    ${!cancelled ? html`
      <ol class="tracker" aria-label="Andamento do pedido">
        ${flow.map(([s, label, icon], i) => html`
          <li class="${i < currentIndex ? 'done' : i === currentIndex ? 'current' : ''}" ${i === currentIndex ? raw('aria-current="step"') : ''}>
            <span class="tracker-icon" aria-hidden="true">${icon}</span>
            <span>${label}</span>
          </li>`)}
      </ol>` : ''}

    ${wa && !cancelled && !done ? html`
      <div class="card wa-card">
        <p><strong>${isNew ? 'Falta pouco!' : 'Precisa falar com a gente?'}</strong>
        ${isNew ? 'Envie o pedido no nosso WhatsApp para confirmar mais rápido.' : 'Chame no WhatsApp.'}</p>
        <a class="btn btn-whatsapp btn-block" href="${wa}" target="_blank" rel="noopener">Enviar pedido no WhatsApp</a>
      </div>` : ''}

    ${order.pix && !cancelled && !done ? html`
      <div class="card pix-card">
        <h2>Pague com Pix</h2>
        <p class="pix-amount">${formatBRL(order.total_cents)}</p>
        <label class="field">
          <span>Pix copia e cola</span>
          <textarea readonly rows="3" id="pix-payload">${order.pix.payload}</textarea>
        </label>
        <button class="btn btn-primary btn-block" type="button" id="copy-pix">Copiar código Pix</button>
        <p class="muted pix-help">Abra o app do seu banco, escolha <strong>Pix copia e cola</strong> e cole o código.
          Chave: <strong>${order.pix.key}</strong> (${order.pix.name}). Depois envie o comprovante no WhatsApp.</p>
      </div>` : ''}

    <div class="card">
      <h2>Resumo</h2>
      <ul class="summary-items">
        ${order.items.map((i) => html`
          <li>
            <span><strong>${i.quantity}×</strong> ${i.name}
              ${i.addons.map((a) => html`<small class="addon-line">+ ${a.quantity > 1 ? `${a.quantity}× ` : ''}${a.name}</small>`)}
              ${i.notes ? html`<small>Obs.: ${i.notes}</small>` : ''}</span>
            <span>${formatBRL(i.line_total_cents)}</span>
          </li>`)}
      </ul>
      <dl class="totals">
        <dt>Subtotal</dt><dd>${formatBRL(order.subtotal_cents)}</dd>
        ${order.fulfillment === 'entrega' ? html`<dt>Entrega (${order.zone_name})</dt><dd>${order.delivery_fee_cents ? formatBRL(order.delivery_fee_cents) : 'Grátis'}</dd>` : ''}
        <dt class="total">Total</dt><dd class="total">${formatBRL(order.total_cents)}</dd>
      </dl>
    </div>

    <div class="card details">
      <div><h3>Cliente</h3><p>${order.customer_name}<br>${formatPhone(order.customer_phone)}</p></div>
      <div>
        <h3>${order.fulfillment === 'entrega' ? 'Entrega' : 'Retirada'}</h3>
        <p>${order.fulfillment === 'entrega'
          ? html`${order.address}${order.address_reference ? html`<br>${order.address_reference}` : ''}<br>${order.zone_name}`
          : store?.address || 'No food truck'}</p>
      </div>
      <div>
        <h3>Pagamento</h3>
        <p>${PAYMENT_LABEL[order.payment_method]}${order.change_for_cents ? html`<br>Troco para ${formatBRL(order.change_for_cents)}` : ''}</p>
      </div>
      ${order.notes ? html`<div><h3>Observações</h3><p>${order.notes}</p></div>` : ''}
    </div>

    <a class="btn btn-outline btn-block" href="/">Voltar ao cardápio</a>
  `);

  document.getElementById('copy-pix')?.addEventListener('click', async () => {
    const text = order.pix.payload;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.getElementById('pix-payload');
      ta.select();
      document.execCommand('copy');
    }
    toast('Código Pix copiado!', 'success');
  });
}

async function load() {
  try {
    const order = await api(`/api/orders/${encodeURIComponent(code)}`);
    renderOrder(order);
    clearTimeout(pollTimer);
    if (!['concluido', 'cancelado'].includes(order.status)) pollTimer = setTimeout(load, 15_000);
  } catch (err) {
    if (err.status === 404) {
      render(root, html`<div class="card"><h1>Pedido não encontrado</h1><p class="muted">Confira o link ou fale com a gente.</p><a class="btn btn-primary" href="/">Ir para o cardápio</a></div>`);
    } else {
      pollTimer = setTimeout(load, 15_000);
    }
  }
}

async function init() {
  try {
    store = (await api('/api/store')).settings;
    document.querySelectorAll('.logo-text strong').forEach((el) => (el.textContent = store.store_name));
  } catch {
    /* segue com o nome padrão */
  }
  await load();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
}

init();
