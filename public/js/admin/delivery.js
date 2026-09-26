import { centsToInput, formatBRL, html, parseBRL, raw, render, toast } from '../shared/util.js';
import { confirmDialog } from './ui.js';

let el;
let ctx;
let zones = [];

export function mount(element, context) {
  el = element;
  ctx = context;
  render(el, html`
    <div class="panel-head"><h1>Entrega e retirada</h1></div>
    <div class="settings-grid">
      <form class="card form-grid" id="delivery-options">
        <h2>Opções</h2>
        <label class="switch"><input type="checkbox" name="delivery_enabled"><span class="track"></span>Fazer entregas</label>
        <label class="switch"><input type="checkbox" name="pickup_enabled"><span class="track"></span>Aceitar retirada no food truck</label>
        <div class="form-row">
          <label class="field"><span>Pedido mínimo (R$)</span><input name="min_order" inputmode="decimal" placeholder="Sem mínimo"></label>
          <label class="field"><span>Entrega grátis acima de (R$)</span><input name="free_delivery_above" inputmode="decimal" placeholder="Desativado"></label>
        </div>
        <label class="field"><span>Tempo estimado de entrega</span><input name="eta_text" maxlength="40" placeholder="Ex.: 40 a 60 min"></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Salvar opções</button></div>
      </form>

      <div class="card">
        <h2>Bairros e taxas</h2>
        <p class="card-sub">O cliente escolhe o bairro no carrinho e a taxa entra no total. Desative um bairro para parar de atender temporariamente.</p>
        <div class="zones" id="zones"></div>
        <form class="zone-row zone-new" id="zone-new">
          <input class="input" name="name" placeholder="Novo bairro" maxlength="60" aria-label="Nome do bairro" required>
          <input class="input" name="fee" placeholder="Taxa (R$)" inputmode="decimal" aria-label="Taxa de entrega" required>
          <button class="btn btn-primary btn-sm" type="submit">Adicionar</button>
        </form>
      </div>
    </div>`);

  fillOptions();
  el.querySelector('#delivery-options').addEventListener('submit', saveOptions);
  el.querySelector('#zone-new').addEventListener('submit', addZone);
  el.querySelector('#zones').addEventListener('change', onZoneChange);
  el.querySelector('#zones').addEventListener('click', onZoneClick);
  ctx.bus.addEventListener('settings:update', fillOptions);
  loadZones();
}

function fillOptions() {
  const s = ctx.settings;
  const f = el.querySelector('#delivery-options').elements;
  f.delivery_enabled.checked = s.delivery_enabled;
  f.pickup_enabled.checked = s.pickup_enabled;
  f.min_order.value = centsToInput(s.min_order_cents);
  f.free_delivery_above.value = centsToInput(s.free_delivery_above_cents);
  f.eta_text.value = s.eta_text;
}

async function saveOptions(e) {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const min = f.min_order.value.trim() ? parseBRL(f.min_order.value) : 0;
  const free = f.free_delivery_above.value.trim() ? parseBRL(f.free_delivery_above.value) : 0;
  if (min === null || free === null) return toast('Valor inválido. Use o formato 30,00.', 'error');
  if (!f.delivery_enabled.checked && !f.pickup_enabled.checked) return toast('Deixe ao menos entrega ou retirada ativa.', 'error');
  try {
    await ctx.saveSettings({
      delivery_enabled: f.delivery_enabled.checked,
      pickup_enabled: f.pickup_enabled.checked,
      min_order_cents: min,
      free_delivery_above_cents: free,
      eta_text: f.eta_text.value,
    });
    toast('Opções de entrega salvas!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadZones() {
  try {
    zones = (await ctx.call('/api/admin/zones')).zones;
    renderZones();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderZones() {
  render(el.querySelector('#zones'), zones.length
    ? html`${zones.map((z) => html`
        <div class="zone-row" data-zone="${z.id}">
          <input class="input" name="name" value="${z.name}" maxlength="60" aria-label="Nome do bairro">
          <input class="input" name="fee" value="${centsToInput(z.fee_cents) || '0,00'}" inputmode="decimal" aria-label="Taxa de ${z.name}">
          <label class="switch" title="Atender este bairro">
            <input type="checkbox" name="active" ${z.active ? raw('checked') : ''} aria-label="Atender ${z.name}"><span class="track"></span>
          </label>
          <button class="icon-btn" type="button" data-delete aria-label="Excluir ${z.name}">🗑</button>
        </div>`)}`
    : html`<p class="empty">Nenhum bairro cadastrado. Sem bairros, só é possível pedir para retirada.</p>`);
}

async function onZoneChange(e) {
  const row = e.target.closest('[data-zone]');
  if (!row) return;
  const id = Number(row.dataset.zone);
  const field = e.target.name;
  let body;
  if (field === 'name') {
    if (!e.target.value.trim()) return renderZones();
    body = { name: e.target.value.trim() };
  } else if (field === 'fee') {
    const fee = parseBRL(e.target.value || '0');
    if (fee === null) {
      toast('Taxa inválida. Use o formato 5,00.', 'error');
      return renderZones();
    }
    body = { fee_cents: fee };
  } else if (field === 'active') body = { active: e.target.checked };
  try {
    const z = await ctx.call(`/api/admin/zones/${id}`, { method: 'PATCH', body });
    zones = zones.map((x) => (x.id === id ? z : x));
    toast(`${z.name}: ${z.active ? formatBRL(z.fee_cents) : 'não atendido'}`, 'success');
    renderZones();
  } catch (err) {
    toast(err.message, 'error');
    renderZones();
  }
}

async function onZoneClick(e) {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  const id = Number(btn.closest('[data-zone]').dataset.zone);
  const zone = zones.find((z) => z.id === id);
  if (!(await confirmDialog(`Excluir o bairro "${zone.name}"?`, { title: 'Excluir bairro', confirmLabel: 'Excluir' }))) return;
  try {
    await ctx.call(`/api/admin/zones/${id}`, { method: 'DELETE' });
    zones = zones.filter((z) => z.id !== id);
    renderZones();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function addZone(e) {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const fee = parseBRL(f.fee.value || '0');
  if (!f.name.value.trim()) return f.name.focus();
  if (fee === null) return toast('Taxa inválida. Use o formato 5,00.', 'error');
  try {
    const z = await ctx.call('/api/admin/zones', { method: 'POST', body: { name: f.name.value.trim(), fee_cents: fee, sort_order: zones.length } });
    zones.push(z);
    e.currentTarget.reset();
    renderZones();
    f.name.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}
