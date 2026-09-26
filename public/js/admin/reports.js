import { formatBRL, html, render, toast, PAYMENT_LABEL } from '../shared/util.js';
import { columnChart } from './charts.js';
import { shiftYmd, todayYmd } from './ui.js';

let el;
let ctx;
let preset = 'today';
let range = presetRange('today');
let disposers = [];
let requestId = 0;

const PRESETS = [
  ['today', 'Hoje'],
  ['yesterday', 'Ontem'],
  ['7d', '7 dias'],
  ['30d', '30 dias'],
  ['month', 'Este mês'],
  ['last-month', 'Mês passado'],
  ['custom', 'Personalizado'],
];

function presetRange(name) {
  const today = todayYmd();
  const [y, m] = today.split('-').map(Number);
  const ymd = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  switch (name) {
    case 'yesterday':
      return { from: shiftYmd(today, -1), to: shiftYmd(today, -1) };
    case '7d':
      return { from: shiftYmd(today, -6), to: today };
    case '30d':
      return { from: shiftYmd(today, -29), to: today };
    case 'month':
      return { from: ymd(y, m, 1), to: today };
    case 'last-month': {
      const first = new Date(y, m - 2, 1);
      const last = new Date(y, m - 1, 0);
      return { from: ymd(first.getFullYear(), first.getMonth() + 1, 1), to: ymd(last.getFullYear(), last.getMonth() + 1, last.getDate()) };
    }
    default:
      return { from: today, to: today };
  }
}

const compactBRL = (cents) => {
  const v = cents / 100;
  if (v >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};
const pct = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dayLabel = (ymd) => ymd.slice(8, 10) + '/' + ymd.slice(5, 7);
const weekday = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

export function mount(element, context) {
  el = element;
  ctx = context;
  render(el, html`
    <div class="panel-head"><h1>Relatórios</h1></div>
    <div class="filters">
      <div class="segmented" role="group" aria-label="Período">
        ${PRESETS.map(([key, label]) => html`<button type="button" data-preset="${key}" aria-pressed="${key === preset}">${label}</button>`)}
      </div>
      <div class="custom-range" id="custom-range" hidden>
        <input type="date" id="range-from" aria-label="Data inicial">
        <span>até</span>
        <input type="date" id="range-to" aria-label="Data final">
      </div>
      <a class="btn btn-outline btn-sm" id="csv-link" download>⬇ Exportar planilha</a>
    </div>
    <div class="report-body" id="report-body"><p class="empty">Carregando…</p></div>`);

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    preset = btn.dataset.preset;
    el.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    el.querySelector('#custom-range').hidden = preset !== 'custom';
    if (preset !== 'custom') range = presetRange(preset);
    syncInputs();
    load();
  });
  el.querySelector('#custom-range').addEventListener('change', () => {
    const from = el.querySelector('#range-from').value;
    const to = el.querySelector('#range-to').value;
    if (from && to) {
      range = from <= to ? { from, to } : { from: to, to: from };
      load();
    }
  });
  ctx.bus.addEventListener('order:new', () => !el.hidden && load());
  ctx.bus.addEventListener('order:update', () => !el.hidden && load());
  syncInputs();
  load();
}

export function onShow() {
  if (preset !== 'custom') range = presetRange(preset);
  syncInputs();
  load();
}

function syncInputs() {
  el.querySelector('#range-from').value = range.from;
  el.querySelector('#range-to').value = range.to;
  el.querySelector('#csv-link').href = `/api/admin/reports/orders.csv?from=${range.from}&to=${range.to}`;
}

async function load() {
  const id = ++requestId;
  const body = el.querySelector('#report-body');
  body.classList.add('loading');
  try {
    const report = await ctx.call(`/api/admin/reports?from=${range.from}&to=${range.to}`);
    if (id !== requestId) return;
    renderReport(report);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (id === requestId) body.classList.remove('loading');
  }
}

function tile(label, value, note, hero = false) {
  return html`
    <div class="tile ${hero ? 'hero' : ''}">
      <div class="tile-label">${label}</div>
      <div class="tile-value">${value}</div>
      ${note ? html`<div class="tile-note">${note}</div>` : ''}
    </div>`;
}

function renderReport(r) {
  disposers.forEach((d) => d());
  disposers = [];
  const s = r.summary;
  const body = el.querySelector('#report-body');
  const period = r.range.from === r.range.to ? weekday(r.range.from) : `${dayLabel(r.range.from)} a ${dayLabel(r.range.to)}`;

  const activeHours = r.by_hour.filter((h) => h.orders > 0).map((h) => h.hour);
  const hourRange = activeHours.length
    ? r.by_hour.slice(Math.max(0, Math.min(...activeHours) - 1), Math.min(24, Math.max(...activeHours) + 2))
    : [];
  const maxQty = Math.max(1, ...r.top_products.map((p) => p.quantity));
  const paymentRows = Object.entries(r.by_payment).filter(([, v]) => v.orders > 0);

  render(body, html`
    <div class="tiles">
      ${tile('Faturamento', formatBRL(s.revenue_cents), `${period} · produtos ${formatBRL(s.products_revenue_cents)} + entregas ${formatBRL(s.delivery_fees_cents)}`, true)}
      ${tile('Pedidos', s.orders, s.cancelled ? `${s.cancelled} cancelado(s) fora da conta` : 'nenhum cancelado')}
      ${tile('Lucro bruto', formatBRL(s.gross_profit_cents), `margem de ${pct(s.margin)} sobre os produtos`)}
      ${tile('Ticket médio', formatBRL(s.avg_ticket_cents), 'por pedido')}
      ${tile('Custo dos produtos', formatBRL(s.cost_cents), 'ingredientes + embalagens')}
      ${tile('Itens vendidos', s.items_sold, '')}
    </div>

    ${s.orders === 0 ? html`<div class="card empty">Nenhum pedido neste período.</div>` : html`
      <div class="report-grid ${r.range.days > 1 ? 'two' : ''}">
        ${r.range.days > 1 ? html`
          <div class="card">
            <h2>Faturamento por dia</h2>
            <p class="card-sub">Passe o dedo ou o mouse nas colunas para ver pedidos e lucro.</p>
            <div id="chart-days"></div>
            <details class="data-table-toggle"><summary>Ver em tabela</summary>
              <table class="history-table">
                <thead><tr><th>Dia</th><th class="num">Pedidos</th><th class="num">Faturamento</th><th class="num">Lucro bruto</th></tr></thead>
                <tbody>${r.by_day.map((d) => html`<tr><td>${weekday(d.date)}</td><td class="num">${d.orders}</td><td class="num">${formatBRL(d.revenue_cents)}</td><td class="num">${formatBRL(d.profit_cents)}</td></tr>`)}</tbody>
              </table>
            </details>
          </div>` : ''}
        <div class="card">
          <h2>Pedidos por horário</h2>
          <p class="card-sub">Ajuda a planejar o preparo e a equipe nos horários de pico.</p>
          <div id="chart-hours"></div>
          <details class="data-table-toggle"><summary>Ver em tabela</summary>
            <table class="history-table">
              <thead><tr><th>Horário</th><th class="num">Pedidos</th><th class="num">Faturamento</th></tr></thead>
              <tbody>${hourRange.map((h) => html`<tr><td>${h.hour}h–${h.hour + 1}h</td><td class="num">${h.orders}</td><td class="num">${formatBRL(h.revenue_cents)}</td></tr>`)}</tbody>
            </table>
          </details>
        </div>
      </div>

      <div class="report-grid two">
        <div class="card table-wrap">
          <h2>Mais vendidos</h2>
          <table class="history-table">
            <thead><tr><th>Produto</th><th>Qtd.</th><th class="num">Vendas</th><th class="num">Lucro</th></tr></thead>
            <tbody>
              ${r.top_products.map((p) => html`
                <tr>
                  <td>${p.name}</td>
                  <td><span class="bar-cell"><span class="bar-inline" style="width: ${Math.round((p.quantity / maxQty) * 80)}px"></span>${p.quantity}</span></td>
                  <td class="num">${formatBRL(p.revenue_cents)}</td>
                  <td class="num">${formatBRL(p.profit_cents)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div>
          <div class="card table-wrap">
            <h2>Formas de pagamento</h2>
            <table class="history-table">
              <thead><tr><th>Forma</th><th class="num">Pedidos</th><th class="num">Total</th><th class="num">%</th></tr></thead>
              <tbody>${paymentRows.map(([k, v]) => html`<tr><td>${PAYMENT_LABEL[k]}</td><td class="num">${v.orders}</td><td class="num">${formatBRL(v.total_cents)}</td><td class="num">${pct(v.total_cents / s.revenue_cents)}</td></tr>`)}</tbody>
            </table>
          </div>
          <div class="card table-wrap">
            <h2>Entregas por bairro</h2>
            <p class="card-sub">${r.by_fulfillment.entrega} entrega(s) · ${r.by_fulfillment.retirada} retirada(s) no food truck</p>
            ${r.by_zone.length ? html`
              <table class="history-table">
                <thead><tr><th>Bairro</th><th class="num">Pedidos</th><th class="num">Taxas</th></tr></thead>
                <tbody>${r.by_zone.map((z) => html`<tr><td>${z.zone}</td><td class="num">${z.orders}</td><td class="num">${formatBRL(z.fees_cents)}</td></tr>`)}</tbody>
              </table>` : ''}
          </div>
        </div>
      </div>
      <p class="card-sub report-note">Lucro bruto = vendas de produtos − custo cadastrado de cada produto. Não inclui taxa de entrega,
        gás, motoboy, taxas da maquininha e outras despesas fixas. Pedidos cancelados não entram em nenhum número.</p>
    `}`);

  if (s.orders === 0) return;
  if (r.range.days > 1) {
    disposers.push(columnChart(body.querySelector('#chart-days'), {
      ariaLabel: 'Faturamento por dia',
      format: compactBRL,
      data: r.by_day.map((d) => ({
        label: dayLabel(d.date),
        value: d.revenue_cents,
        title: weekday(d.date),
        lines: [formatBRL(d.revenue_cents), `${d.orders} pedido(s)`, `lucro bruto ${formatBRL(d.profit_cents)}`],
      })),
    }));
  }
  disposers.push(columnChart(body.querySelector('#chart-hours'), {
    ariaLabel: 'Pedidos por horário',
    format: (v) => String(v),
    axisFormat: (v) => (Number.isInteger(v) ? String(v) : ''),
    data: hourRange.map((h) => ({
      label: `${h.hour}h`,
      value: h.orders,
      title: `${h.hour}h às ${h.hour + 1}h`,
      lines: [`${h.orders} pedido(s)`, formatBRL(h.revenue_cents)],
    })),
  }));
}
