import { api, ApiError, toast } from '../shared/util.js';
import * as ordersTab from './orders.js';
import * as menuTab from './menu.js';
import * as deliveryTab from './delivery.js';
import * as reportsTab from './reports.js';
import * as settingsTab from './settings.js';

const $ = (sel) => document.querySelector(sel);

const TABS = {
  pedidos: ordersTab,
  cardapio: menuTab,
  entrega: deliveryTab,
  relatorios: reportsTab,
  config: settingsTab,
};

/** Contexto compartilhado entre as abas. */
const ctx = {
  bus: new EventTarget(),
  settings: null,
  async call(url, opts) {
    try {
      return await api(url, opts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) showLogin();
      throw err;
    }
  },
  async saveSettings(patch) {
    ctx.settings = await ctx.call('/api/admin/settings', { method: 'PUT', body: patch });
    renderStoreSwitch();
    return ctx.settings;
  },
  emit(name, detail) {
    ctx.bus.dispatchEvent(new CustomEvent(name, { detail }));
  },
};

// ---------------------------------------------------------------- Login

function showLogin() {
  eventSource?.close();
  eventSource = null;
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-form').elements.password.focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#login-error');
  error.hidden = true;
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: { username: form.elements.username.value, password: form.elements.password.value },
    });
    form.elements.password.value = '';
    await startApp();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

// ---------------------------------------------------------------- Loja aberta/fechada

function renderStoreSwitch() {
  const open = Boolean(ctx.settings?.is_open);
  $('#store-open').checked = open;
  $('#store-open-label').textContent = open ? 'Loja aberta' : 'Loja fechada';
}

$('#store-open').addEventListener('change', async (e) => {
  const next = e.target.checked;
  try {
    await ctx.saveSettings({ is_open: next });
    toast(next ? 'Loja aberta para pedidos!' : 'Loja fechada. O cardápio continua visível.', next ? 'success' : 'info');
  } catch (err) {
    e.target.checked = !next;
    toast(err.message, 'error');
  }
});

// ---------------------------------------------------------------- Abas

const mounted = new Set();

function currentTab() {
  const name = location.hash.slice(1);
  return TABS[name] ? name : 'pedidos';
}

function showTab() {
  const name = currentTab();
  document.querySelectorAll('[data-tab]').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === name);
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  const el = document.querySelector(`[data-panel="${name}"]`);
  if (!mounted.has(name)) {
    mounted.add(name);
    TABS[name].mount(el, ctx);
  } else {
    TABS[name].onShow?.();
  }
}

window.addEventListener('hashchange', showTab);

// ---------------------------------------------------------------- Tempo real e alertas

let eventSource = null;
let audioCtx = null;

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx ??= new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  $('#sound-btn').hidden = audioCtx.state === 'running';
}

function playAlert() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  [0, 0.22, 0.44].forEach((offset, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = i === 2 ? 1175 : 880;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.22);
  });
}

$('#sound-btn').addEventListener('click', async () => {
  ensureAudio();
  playAlert();
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission().catch(() => {});
  }
});
document.addEventListener('pointerdown', () => audioCtx?.state === 'running' || ensureAudio(), { once: true });

function notifyNewOrder(order) {
  playAlert();
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    const n = new Notification(`Novo pedido #${order.id}`, {
      body: `${order.customer_name} · ${order.items.length} item(ns)`,
      icon: '/img/favicon.svg',
      tag: `order-${order.id}`,
    });
    n.onclick = () => {
      window.focus();
      location.hash = '#pedidos';
    };
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource('/api/admin/events');
  let wasDown = false;
  eventSource.addEventListener('open', () => {
    $('#conn-banner').hidden = true;
    if (wasDown) ctx.emit('resync');
    wasDown = false;
  });
  eventSource.addEventListener('error', () => {
    wasDown = true;
    $('#conn-banner').hidden = false;
    // Se a sessão expirou, o EventSource não mostra o 401: confere pela API.
    ctx.call('/api/admin/me').catch(() => {});
  });
  eventSource.addEventListener('order:new', (e) => {
    const order = JSON.parse(e.data);
    ctx.emit('order:new', order);
    notifyNewOrder(order);
  });
  eventSource.addEventListener('order:update', (e) => ctx.emit('order:update', JSON.parse(e.data)));
  eventSource.addEventListener('menu:update', () => ctx.emit('menu:update'));
  eventSource.addEventListener('store:update', (e) => {
    ctx.settings = JSON.parse(e.data);
    renderStoreSwitch();
    ctx.emit('settings:update', ctx.settings);
  });
}

/** Contador de pedidos novos na aba e no título da página. */
ctx.bus.addEventListener('orders:count', (e) => {
  const n = e.detail;
  const badge = $('#new-count');
  badge.hidden = n === 0;
  badge.textContent = n;
  document.title = n ? `(${n}) Novo pedido — Painel` : 'Painel — Max Lanches';
});

// ---------------------------------------------------------------- Início

async function startApp() {
  ctx.settings = await ctx.call('/api/admin/settings');
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  renderStoreSwitch();
  connectEvents();
  ensureAudio();
  $('#sound-btn').hidden = audioCtx?.state === 'running';
  showTab();
}

(async () => {
  try {
    await api('/api/admin/me');
    await startApp();
  } catch {
    showLogin();
  }
})();
