import {
  api, formatBRL, html, maskPhoneInput, parseBRL, raw, render, storage, toast, whatsappLink, STATUS_LABEL,
} from '../shared/util.js';
import { cart } from './cart.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  settings: null,
  zones: [],
  categories: [],
  productsById: new Map(),
  emojiByProduct: new Map(),
  menuLoadedAt: 0,
};

const customerStore = storage('ml_customer_v1', {});
const lastOrderStore = storage('ml_last_order_v1', null);

// ---------------------------------------------------------------- Carregamento

async function loadStore() {
  const { settings, zones } = await api('/api/store');
  state.settings = settings;
  state.zones = zones;
  renderStoreInfo();
}

async function loadMenu() {
  const { categories } = await api('/api/menu');
  state.categories = categories;
  state.productsById.clear();
  for (const c of categories) {
    for (const p of c.products) {
      state.productsById.set(p.id, p);
      state.emojiByProduct.set(p.id, c.emoji);
    }
  }
  state.menuLoadedAt = Date.now();
  cart.sync(state.productsById);
  renderMenu();
}

async function refresh() {
  try {
    await Promise.all([loadStore(), loadMenu()]);
  } catch (err) {
    if (!state.categories.length) {
      render($('#cardapio'), html`<div class="menu-loading">Não foi possível carregar o cardápio. <button class="btn btn-outline btn-sm" id="retry">Tentar de novo</button></div>`);
      $('#retry').addEventListener('click', refresh);
    }
    console.error(err);
  }
}

// ---------------------------------------------------------------- Informações da loja

function renderStoreInfo() {
  const s = state.settings;
  document.querySelectorAll('[data-store-name]').forEach((el) => (el.textContent = s.store_name));
  document.title = `${s.store_name} — Peça online`;
  $('#tagline').textContent = s.tagline;

  const pill = $('#status-pill');
  pill.hidden = false;
  pill.textContent = s.is_open ? 'Aberto agora' : 'Fechado';
  pill.classList.toggle('closed', !s.is_open);

  $('#closed-banner').hidden = s.is_open;
  $('#closed-hours').textContent = s.hours_text || 'confira no nosso Instagram';

  const info = [];
  if (s.hours_text) info.push(html`<li>🕒 ${s.hours_text}</li>`);
  if (s.address) info.push(html`<li>📍 ${s.address}</li>`);
  if (s.delivery_enabled && s.eta_text) info.push(html`<li>🛵 Entrega em ${s.eta_text}</li>`);
  if (s.free_delivery_above_cents) info.push(html`<li>🎉 Entrega grátis acima de ${formatBRL(s.free_delivery_above_cents)}</li>`);
  render($('#hero-info'), html`${info}`);

  const wa = whatsappLink(s.whatsapp, `Olá, ${s.store_name}!`);
  const heroWa = $('#hero-whatsapp');
  heroWa.hidden = !wa;
  if (wa) heroWa.href = wa;

  const insta = s.instagram.replace(/^@/, '');
  render($('#footer'), html`
    <div>
      <h3>${s.store_name}</h3>
      <p>${s.tagline}</p>
    </div>
    <div>
      <h3>Onde e quando</h3>
      ${s.address ? html`<p>📍 ${s.address}</p>` : ''}
      ${s.hours_text ? html`<p>🕒 ${s.hours_text}</p>` : ''}
    </div>
    <div>
      <h3>Fale com a gente</h3>
      ${wa ? html`<p><a href="${wa}" target="_blank" rel="noopener">WhatsApp</a></p>` : ''}
      ${insta ? html`<p><a href="https://instagram.com/${insta}" target="_blank" rel="noopener">@${insta}</a></p>` : ''}
    </div>
    <p class="footer-admin">© ${new Date().getFullYear()} ${s.store_name} · <a href="/admin/">Área do lojista</a></p>
  `);
}

// ---------------------------------------------------------------- Cardápio

function productCard(p, emoji) {
  const qty = cart.quantityOf(p.id);
  return html`
    <button class="product" type="button" data-product="${p.id}" ${p.orderable ? '' : raw('disabled')}>
      <div class="product-info">
        <h3 class="product-name">${p.name}</h3>
        ${p.description ? html`<p class="product-desc">${p.description}</p>` : ''}
        <div class="product-foot">
          <span class="product-price">${formatBRL(p.price_cents)}</span>
          ${!p.orderable ? html`<span class="badge badge-red">Esgotado</span>` : ''}
          ${p.orderable && p.low_stock ? html`<span class="badge">Últimas ${p.low_stock}!</span>` : ''}
        </div>
      </div>
      <div class="product-media">
        ${p.image ? html`<img src="${p.image}" alt="" loading="lazy">` : html`<div class="placeholder" aria-hidden="true">${emoji}</div>`}
        ${qty ? html`<span class="product-qty-badge" aria-label="${qty} no carrinho">${qty}</span>` : ''}
        ${p.orderable ? html`<span class="product-add" aria-hidden="true">+</span>` : ''}
      </div>
    </button>`;
}

function renderMenu() {
  const cats = state.categories;
  if (!cats.length) {
    render($('#cardapio'), html`<div class="menu-loading">Cardápio em atualização. Volte daqui a pouco!</div>`);
    return;
  }
  render($('#cat-nav'), html`${cats.map((c, i) => html`<a class="cat-chip ${i === 0 ? 'active' : ''}" href="#cat-${c.id}">${c.emoji} ${c.name}</a>`)}`);
  render($('#cardapio'), html`${cats.map((c) => html`
    <section class="menu-section" id="cat-${c.id}" aria-labelledby="cat-title-${c.id}">
      <h2 id="cat-title-${c.id}"><span aria-hidden="true">${c.emoji}</span> ${c.name}</h2>
      <div class="products">${c.products.map((p) => productCard(p, c.emoji))}</div>
    </section>`)}`);
  observeSections();
}

let sectionObserver;
function observeSections() {
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const chip = document.querySelector(`.cat-chip[href="#${e.target.id}"]`);
        if (!chip) continue;
        document.querySelectorAll('.cat-chip.active').forEach((el) => el.classList.remove('active'));
        chip.classList.add('active');
        chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
    },
    { rootMargin: '-130px 0px -60% 0px' },
  );
  document.querySelectorAll('.menu-section').forEach((s) => sectionObserver.observe(s));
}

// ---------------------------------------------------------------- Detalhe do produto

const productDialog = $('#product-dialog');
let current = { product: null, qty: 1 };

function openProduct(id) {
  const p = state.productsById.get(id);
  if (!p?.orderable) return;
  current = { product: p, qty: 1 };
  const emoji = state.emojiByProduct.get(id);
  render($('#pd-media'), p.image ? html`<img src="${p.image}" alt="">` : html`<div class="placeholder" aria-hidden="true">${emoji}</div>`);
  $('#pd-title').textContent = p.name;
  $('#pd-desc').textContent = p.description;
  $('#pd-price').textContent = formatBRL(p.price_cents);
  $('#pd-notes').value = '';
  updateProductQty();
  productDialog.showModal();
}

function updateProductQty() {
  const { product, qty } = current;
  $('#pd-qty').textContent = qty;
  productDialog.querySelector('[data-qty="-1"]').disabled = qty <= 1;
  productDialog.querySelector('[data-qty="1"]').disabled = qty >= 50;
  $('#pd-add').textContent = `Adicionar · ${formatBRL(product.price_cents * qty)}`;
}

productDialog.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qty]');
  if (btn) {
    current.qty = Math.max(1, Math.min(50, current.qty + Number(btn.dataset.qty)));
    updateProductQty();
  }
  if (e.target.closest('[data-close]') || e.target === productDialog) productDialog.close();
});

$('#product-form').addEventListener('submit', (e) => {
  e.preventDefault();
  cart.add(current.product, current.qty, $('#pd-notes').value);
  productDialog.close();
  toast(`${current.qty}× ${current.product.name} no carrinho`, 'success');
});

$('#cardapio').addEventListener('click', (e) => {
  const card = e.target.closest('[data-product]');
  if (card) openProduct(Number(card.dataset.product));
});

// ---------------------------------------------------------------- Carrinho

const cartDialog = $('#cart-dialog');
const checkoutForm = $('#checkout-form');
let step = 'cart';

function openCart() {
  // Se o cardápio está velho, atualiza antes de fechar o pedido.
  if (Date.now() - state.menuLoadedAt > 60_000) refresh();
  cartDialog.showModal();
  showStep('cart');
}

function showStep(next) {
  step = next;
  const isCart = step === 'cart';
  $('#cart-step').hidden = !isCart;
  checkoutForm.hidden = isCart;
  $('#checkout-back').hidden = isCart;
  $('#cart-title').textContent = isCart ? 'Seu pedido' : 'Finalizar pedido';
  if (!isCart) prepareCheckout();
  renderCart();
  cartDialog.querySelector('.dialog-content:not([hidden])').scrollTop = 0;
}

function renderCartBar() {
  const count = cart.count;
  $('#cart-bar').hidden = count === 0;
  $('#cart-bar-count').textContent = count;
  $('#cart-bar-total').textContent = formatBRL(cart.subtotal);
  const top = $('#cart-count-top');
  top.hidden = count === 0;
  top.textContent = count;
}

function renderCartItems() {
  if (!cart.items.length) {
    render($('#cart-items'), html`
      <div class="cart-empty">
        <span aria-hidden="true">🍔</span>
        <p>Seu carrinho está vazio.</p>
        <button class="btn btn-outline" type="button" data-close>Ver cardápio</button>
      </div>`);
    return;
  }
  render($('#cart-items'), html`
    ${cart.hasUnavailable ? html`<p class="alert">Alguns itens esgotaram e não serão enviados. Remova-os para continuar.</p>` : ''}
    <ul class="cart-list">
      ${cart.items.map((i) => html`
        <li class="cart-item ${i.unavailable ? 'unavailable' : ''}" data-item="${i.id}">
          <span class="cart-item-name">${i.name}${i.unavailable ? ' (esgotado)' : ''}</span>
          <span class="cart-item-price">${formatBRL(i.price_cents * i.quantity)}</span>
          <label class="cart-item-notes">
            <span class="sr-only">Observação para ${i.name}</span>
            <input data-notes value="${i.notes}" maxlength="140" placeholder="+ adicionar observação">
          </label>
          <div class="cart-item-controls">
            <div class="qty small" role="group" aria-label="Quantidade de ${i.name}">
              <button type="button" class="qty-btn" data-step="-1" aria-label="Diminuir">−</button>
              <output>${i.quantity}</output>
              <button type="button" class="qty-btn" data-step="1" aria-label="Aumentar" ${i.unavailable ? raw('disabled') : ''}>+</button>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-remove>Remover</button>
          </div>
        </li>`)}
    </ul>
    <button type="button" class="btn btn-ghost btn-sm" data-close>+ Adicionar mais itens</button>`);
}

function deliveryFee() {
  const s = state.settings;
  const form = checkoutForm.elements;
  if (step !== 'checkout' || form.fulfillment.value !== 'entrega') return null;
  const zone = state.zones.find((z) => z.id === Number(form.zone_id.value));
  if (!zone) return null;
  if (s.free_delivery_above_cents && cart.subtotal >= s.free_delivery_above_cents) return 0;
  return zone.fee_cents;
}

function renderTotals() {
  const s = state.settings;
  const subtotal = cart.subtotal;
  const fee = deliveryFee();
  const isDelivery = step === 'checkout' && checkoutForm.elements.fulfillment.value === 'entrega';
  const rows = [html`<dt>Subtotal</dt><dd>${formatBRL(subtotal)}</dd>`];
  if (isDelivery) {
    rows.push(html`<dt>Taxa de entrega</dt><dd>${fee === null ? 'escolha o bairro' : fee === 0 ? 'Grátis' : formatBRL(fee)}</dd>`);
  }
  rows.push(html`<dt class="total">Total</dt><dd class="total">${formatBRL(subtotal + (fee ?? 0))}</dd>`);
  if (s?.free_delivery_above_cents && s.delivery_enabled && subtotal < s.free_delivery_above_cents && (step === 'cart' || isDelivery)) {
    rows.push(html`<dt class="totals-hint">Faltam ${formatBRL(s.free_delivery_above_cents - subtotal)} para entrega grátis</dt>`);
  }
  render($('#cart-totals'), html`${rows}`);

  const next = $('#cart-next');
  const empty = cart.count === 0;
  const belowMin = s?.min_order_cents && subtotal < s.min_order_cents;
  if (step === 'cart') {
    next.disabled = empty || cart.hasUnavailable || !s?.is_open || belowMin;
    next.textContent = !s?.is_open
      ? 'Loja fechada no momento'
      : belowMin
        ? `Pedido mínimo: ${formatBRL(s.min_order_cents)}`
        : 'Continuar';
  } else {
    next.disabled = empty || cart.hasUnavailable;
    next.textContent = `Enviar pedido · ${formatBRL(subtotal + (fee ?? 0))}`;
  }
  $('#cart-foot').hidden = empty && step === 'cart';
}

function renderCart() {
  renderCartBar();
  if (step === 'cart') renderCartItems();
  renderTotals();
}

cart.onChange(() => {
  renderCart();
  if (state.categories.length) renderMenu();
});

$('#cart-items').addEventListener('click', (e) => {
  const li = e.target.closest('[data-item]');
  if (!li) return;
  const item = cart.items.find((i) => i.id === li.dataset.item);
  if (e.target.closest('[data-step]')) cart.setQuantity(item.id, item.quantity + Number(e.target.closest('[data-step]').dataset.step));
  if (e.target.closest('[data-remove]')) cart.remove(item.id);
});
$('#cart-items').addEventListener('change', (e) => {
  const li = e.target.closest('[data-item]');
  if (li && e.target.matches('[data-notes]')) cart.setNotes(li.dataset.item, e.target.value);
});

cartDialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === cartDialog) cartDialog.close();
});
$('#checkout-back').addEventListener('click', () => showStep('cart'));
$('#cart-bar').addEventListener('click', openCart);
$('#cart-open-top').addEventListener('click', openCart);
$('#cart-next').addEventListener('click', () => {
  if (step === 'cart') showStep('checkout');
  else checkoutForm.requestSubmit();
});

// ---------------------------------------------------------------- Finalização

function prepareCheckout() {
  const s = state.settings;
  const f = checkoutForm.elements;
  const saved = customerStore.get();

  const zoneSelect = f.zone_id;
  const prevZone = zoneSelect.value || String(saved.zone_id ?? '');
  render(zoneSelect, html`
    <option value="">Selecione o bairro</option>
    ${state.zones.map((z) => html`<option value="${z.id}">${z.name} — ${z.fee_cents ? formatBRL(z.fee_cents) : 'grátis'}</option>`)}`);
  if (state.zones.some((z) => String(z.id) === prevZone)) zoneSelect.value = prevZone;

  const deliveryRadio = checkoutForm.querySelector('input[value="entrega"]');
  const pickupRadio = checkoutForm.querySelector('input[value="retirada"]');
  deliveryRadio.disabled = !s.delivery_enabled || state.zones.length === 0;
  pickupRadio.disabled = !s.pickup_enabled;
  if (!f.fulfillment.value || checkoutForm.querySelector('input[name="fulfillment"]:checked')?.disabled) {
    const preferred = saved.fulfillment === 'retirada' ? pickupRadio : deliveryRadio;
    const fallback = preferred.disabled ? (preferred === pickupRadio ? deliveryRadio : pickupRadio) : preferred;
    if (!fallback.disabled) fallback.checked = true;
  }

  if (!f.customer_name.value) f.customer_name.value = saved.customer_name ?? '';
  if (!f.customer_phone.value) f.customer_phone.value = saved.customer_phone ?? '';
  if (!f.address.value) f.address.value = saved.address ?? '';
  if (!f.address_reference.value) f.address_reference.value = saved.address_reference ?? '';

  $('#pickup-info').textContent = s.address ? `Retire no food truck: ${s.address}` : 'Retire no food truck.';
  $('#checkout-error').hidden = true;
  updateCheckoutFields();
}

function updateCheckoutFields() {
  const f = checkoutForm.elements;
  const isDelivery = f.fulfillment.value === 'entrega';
  $('#delivery-fields').hidden = !isDelivery;
  $('#pickup-info').hidden = f.fulfillment.value !== 'retirada';
  $('#change-field').hidden = f.payment_method.value !== 'dinheiro';
  renderTotals();
}

checkoutForm.addEventListener('change', updateCheckoutFields);
maskPhoneInput(checkoutForm.elements.customer_phone);

function showCheckoutError(message, field) {
  const el = $('#checkout-error');
  el.textContent = message;
  el.hidden = false;
  if (field) field.focus();
  else el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function collectOrder() {
  const f = checkoutForm.elements;
  const s = state.settings;
  const phone = f.customer_phone.value.replace(/\D/g, '');
  if (f.customer_name.value.trim().length < 2) return showCheckoutError('Informe seu nome.', f.customer_name);
  if (phone.length < 10) return showCheckoutError('Informe seu WhatsApp com DDD.', f.customer_phone);
  if (!f.fulfillment.value) return showCheckoutError('Escolha entrega ou retirada.');
  const isDelivery = f.fulfillment.value === 'entrega';
  if (isDelivery && !f.zone_id.value) return showCheckoutError('Escolha seu bairro.', f.zone_id);
  if (isDelivery && f.address.value.trim().length < 5) return showCheckoutError('Informe rua e número.', f.address);
  if (!f.payment_method.value) return showCheckoutError('Escolha a forma de pagamento.');
  if (s.min_order_cents && cart.subtotal < s.min_order_cents) {
    return showCheckoutError(`O pedido mínimo é de ${formatBRL(s.min_order_cents)}.`);
  }

  let changeFor = null;
  if (f.payment_method.value === 'dinheiro' && f.change_for.value.trim()) {
    changeFor = parseBRL(f.change_for.value);
    const total = cart.subtotal + (deliveryFee() ?? 0);
    if (changeFor === null) return showCheckoutError('Valor de troco inválido.', f.change_for);
    if (changeFor < total) return showCheckoutError(`O troco deve ser para um valor acima de ${formatBRL(total)}.`, f.change_for);
  }

  return {
    customer_name: f.customer_name.value.trim(),
    customer_phone: phone,
    fulfillment: f.fulfillment.value,
    zone_id: isDelivery ? Number(f.zone_id.value) : undefined,
    address: isDelivery ? f.address.value.trim() : undefined,
    address_reference: isDelivery ? f.address_reference.value.trim() : undefined,
    payment_method: f.payment_method.value,
    change_for_cents: changeFor,
    notes: f.notes.value.trim(),
    items: cart.items
      .filter((i) => !i.unavailable)
      .map((i) => ({ product_id: i.product_id, quantity: i.quantity, notes: i.notes })),
  };
}

let submitting = false;
checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;
  $('#checkout-error').hidden = true;
  const order = collectOrder();
  if (!order) return;

  submitting = true;
  const btn = $('#cart-next');
  btn.disabled = true;
  btn.textContent = 'Enviando pedido…';
  try {
    const { code, number } = await api('/api/orders', { method: 'POST', body: order });
    customerStore.set({
      customer_name: order.customer_name,
      customer_phone: checkoutForm.elements.customer_phone.value,
      fulfillment: order.fulfillment,
      zone_id: order.zone_id,
      address: order.address ?? customerStore.get().address,
      address_reference: order.address_reference ?? customerStore.get().address_reference,
    });
    lastOrderStore.set({ code, number, at: Date.now() });
    cart.clear();
    location.href = `/pedido/${code}?novo=1`;
  } catch (err) {
    showCheckoutError(err.message);
    // Estoque/disponibilidade pode ter mudado: recarrega o cardápio.
    if (err.status === 409) refresh();
    submitting = false;
    renderTotals();
  }
});

// ---------------------------------------------------------------- Pedido em andamento

async function showTrackBanner() {
  const last = lastOrderStore.get();
  if (!last?.code || Date.now() - last.at > 8 * 3600_000) return;
  try {
    const order = await api(`/api/orders/${encodeURIComponent(last.code)}`);
    if (['concluido', 'cancelado'].includes(order.status)) return;
    const el = $('#track-banner');
    render(el, html`
      <span>Pedido #${order.number}: <strong>${STATUS_LABEL[order.status]}</strong></span>
      <a class="btn btn-sm btn-accent" href="/pedido/${order.code}">Acompanhar</a>`);
    el.hidden = false;
  } catch {
    /* pedido antigo ou removido: ignora */
  }
}

// ---------------------------------------------------------------- Início

refresh();
showTrackBanner();
renderCart();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.menuLoadedAt > 60_000) refresh();
});
setInterval(() => {
  if (document.visibilityState === 'visible') refresh();
}, 120_000);
