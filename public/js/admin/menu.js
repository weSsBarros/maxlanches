import { centsToInput, formatBRL, html, parseBRL, raw, render, toast } from '../shared/util.js';
import { confirmDialog, formDialog } from './ui.js';

let el;
let ctx;
let categories = [];
let products = [];
let search = '';
let dirty = false;

export function mount(element, context) {
  el = element;
  ctx = context;
  render(el, html`
    <div class="panel-head">
      <h1>Cardápio</h1>
      <button class="btn btn-outline btn-sm" type="button" data-act="new-category">+ Categoria</button>
      <button class="btn btn-primary btn-sm" type="button" data-act="new-product">+ Produto</button>
    </div>
    <div class="menu-toolbar">
      <input class="input" type="search" id="menu-search" placeholder="Buscar produto…" aria-label="Buscar produto">
      <button class="btn btn-ghost btn-sm" type="button" data-act="all-available">Marcar tudo como disponível</button>
    </div>
    <div id="menu-body"><p class="empty">Carregando…</p></div>`);
  el.querySelector('#menu-search').addEventListener('input', (e) => {
    search = e.target.value.trim().toLowerCase();
    renderList();
  });
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  // Estoque muda quando entram pedidos: recarrega se a aba estiver aberta.
  ctx.bus.addEventListener('menu:update', () => (el.hidden ? (dirty = true) : load()));
  ctx.bus.addEventListener('order:new', () => (el.hidden ? (dirty = true) : load()));
  setupEditor();
  load();
}

export function onShow() {
  if (dirty) load();
}

async function load() {
  dirty = false;
  try {
    const [c, p] = await Promise.all([ctx.call('/api/admin/categories'), ctx.call('/api/admin/products')]);
    categories = c.categories;
    products = p.products;
    // Não redesenha enquanto o usuário edita um campo de estoque.
    if (!el.contains(document.activeElement) || !document.activeElement.matches('.stock-input')) renderList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function productRow(p, cat) {
  const margin = p.price_cents ? (p.price_cents - p.cost_cents) / p.price_cents : 0;
  return html`
    <div class="prod-row ${p.orderable ? '' : 'off'}" data-product="${p.id}">
      <div class="prod-thumb">${p.image ? html`<img src="${p.image}" alt="" loading="lazy">` : cat.emoji}</div>
      <div>
        <div class="prod-name">${p.name}</div>
        <div class="prod-sub">
          <span>${formatBRL(p.price_cents)}</span>
          ${p.cost_cents ? html`<span>lucro ${formatBRL(p.price_cents - p.cost_cents)} (${Math.round(margin * 100)}%)</span>` : html`<span>sem custo cadastrado</span>`}
          ${!p.available ? html`<span class="badge badge-red">Indisponível</span>` : p.stock === 0 ? html`<span class="badge badge-red">Esgotado</span>` : ''}
        </div>
      </div>
      <div class="prod-controls">
        ${p.stock !== null ? html`
          <label class="stock-label">Estoque
            <input class="stock-input" type="number" min="0" max="100000" inputmode="numeric" value="${p.stock}" data-stock aria-label="Estoque de ${p.name}">
          </label>` : ''}
        <label class="switch" title="Disponível no cardápio">
          <input type="checkbox" data-available ${p.available ? raw('checked') : ''} aria-label="${p.name} disponível">
          <span class="track"></span>
          <span class="avail-text" aria-hidden="true">${p.available ? 'Disponível' : 'Esgotado'}</span>
        </label>
        <button class="btn btn-outline btn-sm" type="button" data-act="edit">Editar</button>
      </div>
    </div>`;
}

function renderList() {
  const body = el.querySelector('#menu-body');
  if (!categories.length) {
    render(body, html`<div class="card empty">Crie uma categoria (ex.: Hambúrgueres) para começar.</div>`);
    return;
  }
  render(body, html`${categories.map((c, index) => {
    const all = products.filter((p) => p.category_id === c.id);
    const items = all.filter((p) => !search || p.name.toLowerCase().includes(search));
    if (search && !items.length) return '';
    return html`
      <section class="cat-block" data-category="${c.id}">
        <div class="cat-head">
          <h2>${c.emoji} ${c.name}</h2>
          ${!c.active ? html`<span class="badge badge-red">Oculta no site</span>` : ''}
          <button class="icon-btn" type="button" data-act="cat-up" aria-label="Subir categoria" ${index === 0 ? raw('disabled') : ''}>↑</button>
          <button class="icon-btn" type="button" data-act="cat-down" aria-label="Descer categoria" ${index === categories.length - 1 ? raw('disabled') : ''}>↓</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="edit-category">Editar</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="toggle-category">${c.active ? 'Ocultar' : 'Mostrar'}</button>
          ${all.length === 0 ? html`<button class="btn btn-danger btn-sm" type="button" data-act="delete-category">Excluir</button>` : ''}
        </div>
        <div class="prod-list">
          ${items.length ? items.map((p) => productRow(p, c)) : html`<p class="empty">Nenhum produto. <button class="btn btn-ghost btn-sm" type="button" data-act="new-product" data-cat="${c.id}">+ Adicionar</button></p>`}
        </div>
      </section>`;
  })}`);
}

async function patchProduct(id, body) {
  const updated = await ctx.call(`/api/admin/products/${id}`, { method: 'PATCH', body });
  products = products.map((p) => (p.id === id ? updated : p));
  return updated;
}

async function onChange(e) {
  const row = e.target.closest('[data-product]');
  if (!row) return;
  const id = Number(row.dataset.product);
  try {
    if (e.target.matches('[data-available]')) {
      const p = await patchProduct(id, { available: e.target.checked });
      toast(p.available ? `${p.name} disponível` : `${p.name} marcado como esgotado`);
    } else if (e.target.matches('[data-stock]')) {
      const stock = Number.parseInt(e.target.value, 10);
      if (!Number.isInteger(stock) || stock < 0) throw new Error('Estoque inválido.');
      const p = await patchProduct(id, { stock });
      toast(`Estoque de ${p.name}: ${p.stock}`);
    }
    renderList();
  } catch (err) {
    toast(err.message, 'error');
    renderList();
  }
}

async function editCategory(cat) {
  const values = await formDialog({
    title: cat ? 'Editar categoria' : 'Nova categoria',
    fields: [
      { name: 'name', label: 'Nome', value: cat?.name ?? '', maxlength: 40, required: true, placeholder: 'Ex.: Porções' },
      { name: 'emoji', label: 'Ícone (emoji)', value: cat?.emoji ?? '', maxlength: 8, placeholder: '🍟' },
    ],
    submitLabel: cat ? 'Salvar' : 'Criar',
  });
  if (!values) return;
  const body = { name: values.name.trim(), emoji: values.emoji.trim() };
  await ctx.call(cat ? `/api/admin/categories/${cat.id}` : '/api/admin/categories', { method: cat ? 'PATCH' : 'POST', body });
  toast('Categoria salva!', 'success');
  load();
}

async function moveCategory(cat, dir) {
  const index = categories.findIndex((c) => c.id === cat.id);
  const other = categories[index + dir];
  if (!other) return;
  // Normaliza a ordem para 0..n e troca as duas posições.
  const order = categories.map((c) => c.id);
  [order[index], order[index + dir]] = [order[index + dir], order[index]];
  await Promise.all(order.map((id, i) => ctx.call(`/api/admin/categories/${id}`, { method: 'PATCH', body: { sort_order: i } })));
  load();
}

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const catId = Number(btn.closest('[data-category]')?.dataset.category);
  const cat = categories.find((c) => c.id === catId);
  try {
    switch (btn.dataset.act) {
      case 'new-product':
        openEditor(null, Number(btn.dataset.cat) || categories[0]?.id);
        break;
      case 'edit':
        openEditor(products.find((p) => p.id === Number(btn.closest('[data-product]').dataset.product)));
        break;
      case 'new-category':
        await editCategory(null);
        break;
      case 'edit-category':
        await editCategory(cat);
        break;
      case 'delete-category':
        if (await confirmDialog(`Excluir a categoria "${cat.name}"?`, { title: 'Excluir categoria', confirmLabel: 'Excluir' })) {
          await ctx.call(`/api/admin/categories/${cat.id}`, { method: 'DELETE' });
          toast('Categoria excluída.');
          load();
        }
        break;
      case 'toggle-category':
        await ctx.call(`/api/admin/categories/${cat.id}`, { method: 'PATCH', body: { active: !cat.active } });
        load();
        break;
      case 'cat-up':
        await moveCategory(cat, -1);
        break;
      case 'cat-down':
        await moveCategory(cat, 1);
        break;
      case 'all-available': {
        const off = products.filter((p) => !p.available);
        if (!off.length) return toast('Todos os produtos já estão disponíveis.');
        await Promise.all(off.map((p) => ctx.call(`/api/admin/products/${p.id}`, { method: 'PATCH', body: { available: true } })));
        toast(`${off.length} produto(s) disponível(is) novamente.`, 'success');
        load();
        break;
      }
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------- Editor de produto

const editor = document.getElementById('product-editor');
const form = document.getElementById('product-editor-form');
let editing = null;
let image = null;

function setupEditor() {
  editor.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === editor) editor.close();
  });
  form.addEventListener('input', updateMargin);
  form.elements.track_stock.addEventListener('change', updateStockField);
  document.getElementById('pe-image-input').addEventListener('change', onImagePicked);
  document.getElementById('pe-image-remove').addEventListener('click', () => {
    image = null;
    renderImage();
  });
  document.getElementById('pe-delete').addEventListener('click', deleteProduct);
  form.addEventListener('submit', saveProduct);
}

function openEditor(product, categoryId) {
  if (!categories.length) {
    toast('Crie uma categoria primeiro.', 'error');
    return;
  }
  editing = product;
  image = product?.image ?? null;
  const f = form.elements;
  document.getElementById('pe-title').textContent = product ? 'Editar produto' : 'Novo produto';
  render(f.category_id, html`${categories.map((c) => html`<option value="${c.id}">${c.emoji} ${c.name}</option>`)}`);
  f.name.value = product?.name ?? '';
  f.category_id.value = String(product?.category_id ?? categoryId);
  f.description.value = product?.description ?? '';
  f.price.value = centsToInput(product?.price_cents);
  f.cost.value = centsToInput(product?.cost_cents);
  f.available.checked = product ? product.available : true;
  f.track_stock.checked = product ? product.stock !== null : false;
  f.stock.value = product?.stock ?? '';
  document.getElementById('pe-delete').hidden = !product;
  document.getElementById('pe-error').hidden = true;
  updateStockField();
  updateMargin();
  renderImage();
  editor.showModal();
}

function updateStockField() {
  document.getElementById('pe-stock-field').hidden = !form.elements.track_stock.checked;
}

function updateMargin() {
  const price = parseBRL(form.elements.price.value);
  const cost = parseBRL(form.elements.cost.value) ?? 0;
  const out = document.getElementById('pe-margin');
  if (!price) {
    out.textContent = '';
    return;
  }
  const profit = price - cost;
  out.textContent = `Lucro por unidade: ${formatBRL(profit)} (${Math.round((profit / price) * 100)}% de margem)`;
}

function renderImage() {
  const cat = categories.find((c) => c.id === Number(form.elements.category_id.value));
  render(document.getElementById('pe-image-preview'), image ? html`<img src="${image}" alt="">` : html`${cat?.emoji ?? '📷'}`);
  document.getElementById('pe-image-remove').hidden = !image;
}

/** Reduz a foto no próprio navegador antes de enviar (economiza dados e espaço). */
async function resizeImage(file, maxSize = 1000) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (blob?.type === 'image/webp') return { blob, name: 'foto.webp' };
  return { blob: await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85)), name: 'foto.jpg' };
}

async function onImagePicked(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const preview = document.getElementById('pe-image-preview');
  preview.textContent = '⏳';
  try {
    const { blob, name } = await resizeImage(file);
    const data = new FormData();
    data.append('image', blob, name);
    const { url } = await ctx.call('/api/admin/uploads', { method: 'POST', form: data });
    image = url;
  } catch (err) {
    toast(err.message || 'Não foi possível usar essa imagem.', 'error');
  }
  renderImage();
}

async function saveProduct(e) {
  e.preventDefault();
  const f = form.elements;
  const error = document.getElementById('pe-error');
  error.hidden = true;
  const price = parseBRL(f.price.value);
  const cost = f.cost.value.trim() ? parseBRL(f.cost.value) : 0;
  const fail = (msg, field) => {
    error.textContent = msg;
    error.hidden = false;
    field?.focus();
  };
  if (!f.name.value.trim()) return fail('Informe o nome do produto.', f.name);
  if (price === null) return fail('Preço inválido. Use o formato 12,50.', f.price);
  if (cost === null) return fail('Custo inválido. Use o formato 5,00.', f.cost);
  let stock = null;
  if (f.track_stock.checked) {
    stock = Number.parseInt(f.stock.value, 10);
    if (!Number.isInteger(stock) || stock < 0) return fail('Informe a quantidade em estoque.', f.stock);
  }
  const body = {
    name: f.name.value.trim(),
    category_id: Number(f.category_id.value),
    description: f.description.value.trim(),
    price_cents: price,
    cost_cents: cost,
    available: f.available.checked,
    stock,
    image,
  };
  try {
    await ctx.call(editing ? `/api/admin/products/${editing.id}` : '/api/admin/products', {
      method: editing ? 'PATCH' : 'POST',
      body,
    });
    editor.close();
    toast('Produto salvo!', 'success');
    load();
  } catch (err) {
    fail(err.message);
  }
}

async function deleteProduct() {
  if (!editing) return;
  const ok = await confirmDialog(
    `Excluir "${editing.name}"? Os pedidos antigos continuam nos relatórios. Se for algo temporário, prefira desmarcar "Disponível".`,
    { title: 'Excluir produto', confirmLabel: 'Excluir' },
  );
  if (!ok) return;
  try {
    await ctx.call(`/api/admin/products/${editing.id}`, { method: 'DELETE' });
    editor.close();
    toast('Produto excluído.');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}
