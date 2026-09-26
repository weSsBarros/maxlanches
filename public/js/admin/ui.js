import { html, raw, render } from '../shared/util.js';

function fieldHtml(f) {
  if (f.type === 'checkboxes') {
    return html`
      <fieldset class="field check-group">
        <legend class="field-label">${f.label}</legend>
        ${f.options.map((o) => html`
          <label class="check"><input type="checkbox" name="${f.name}" value="${o.value}" ${o.checked ? raw('checked') : ''}>${o.label}</label>`)}
        ${f.hint ? html`<small class="muted">${f.hint}</small>` : ''}
      </fieldset>`;
  }
  if (f.type === 'switch') {
    return html`<label class="switch"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''}><span class="track"></span>${f.label}</label>`;
  }
  const control = f.type === 'textarea'
    ? html`<textarea name="${f.name}" maxlength="${f.maxlength ?? 200}" placeholder="${f.placeholder ?? ''}" rows="3">${f.value ?? ''}</textarea>`
    : html`<input name="${f.name}" type="${f.type ?? 'text'}" value="${f.value ?? ''}" maxlength="${f.maxlength ?? 200}"
        placeholder="${f.placeholder ?? ''}" inputmode="${f.inputmode ?? 'text'}">`;
  return html`<label class="field"><span>${f.label}</span>${control}${f.hint ? html`<small>${f.hint}</small>` : ''}</label>`;
}

/**
 * Diálogo de formulário genérico.
 * `fields`: [{ name, label, value, type: text|textarea|switch|checkboxes, options, placeholder, maxlength, required, hint, row }]
 * Campos com o mesmo `row` ficam lado a lado.
 * `validate(values)` pode retornar uma mensagem de erro para manter o diálogo aberto.
 * `secondaryLabel` mostra um botão de perigo à esquerda (ex.: Excluir), que resolve com { action: 'secondary' }.
 * Resolve com os valores (checkboxes → lista, switch → boolean) ou null se cancelado.
 */
export function formDialog({
  title, fields = [], submitLabel = 'Salvar', danger = false, message = '', validate, secondaryLabel,
}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    const groups = [];
    for (const f of fields) {
      const last = groups.at(-1);
      if (f.row && last?.row === f.row) last.fields.push(f);
      else groups.push({ row: f.row, fields: [f] });
    }
    render(dialog, html`
      <form class="dialog-body" method="dialog" novalidate>
        <div class="dialog-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" data-cancel aria-label="Fechar">✕</button>
        </div>
        <div class="dialog-content form-grid">
          ${message ? html`<p>${message}</p>` : ''}
          ${groups.map((g) => (g.row ? html`<div class="form-row">${g.fields.map(fieldHtml)}</div>` : fieldHtml(g.fields[0])))}
          <p class="alert" data-error role="alert" hidden></p>
        </div>
        <div class="dialog-foot editor-foot">
          ${secondaryLabel
            ? html`<button type="button" class="btn btn-danger btn-sm" data-secondary>${secondaryLabel}</button>`
            : html`<button type="button" class="btn btn-ghost" data-cancel>Voltar</button>`}
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>
        </div>
      </form>`);
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const errorBox = form.querySelector('[data-error]');
    let result = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const values = {};
      for (const f of fields) {
        if (f.type === 'checkboxes') values[f.name] = data.getAll(f.name);
        else if (f.type === 'switch') values[f.name] = data.has(f.name);
        else values[f.name] = String(data.get(f.name) ?? '');
      }
      const missing = fields.find((f) => f.required && !String(values[f.name] ?? '').trim());
      if (missing) {
        form.elements[missing.name].focus();
        return;
      }
      const error = validate?.(values);
      if (error) {
        errorBox.textContent = error;
        errorBox.hidden = false;
        return;
      }
      result = values;
      dialog.close();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-secondary]')) {
        result = { action: 'secondary' };
        dialog.close();
      }
      if (e.target.closest('[data-cancel]') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
    form.querySelector('input:not([type=checkbox]), textarea')?.focus();
  });
}

export async function confirmDialog(message, { title = 'Confirmar', confirmLabel = 'Confirmar', danger = true } = {}) {
  return (await formDialog({ title, message, submitLabel: confirmLabel, danger })) !== null;
}

export function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `há ${h}h${String(minutes % 60).padStart(2, '0')}`;
}

export const timeOf = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
