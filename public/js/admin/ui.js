import { html, render } from '../shared/util.js';

/**
 * Diálogo de formulário genérico. `fields`: [{ name, label, value, type, placeholder, maxlength, required }].
 * Resolve com os valores preenchidos ou null se cancelado.
 */
export function formDialog({ title, fields = [], submitLabel = 'Salvar', danger = false, message = '' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    render(dialog, html`
      <form class="dialog-body" method="dialog">
        <div class="dialog-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" data-cancel aria-label="Fechar">✕</button>
        </div>
        <div class="dialog-content form-grid">
          ${message ? html`<p>${message}</p>` : ''}
          ${fields.map((f) => html`
            <label class="field">
              <span>${f.label}</span>
              ${f.type === 'textarea'
                ? html`<textarea name="${f.name}" maxlength="${f.maxlength ?? 200}" placeholder="${f.placeholder ?? ''}" rows="3">${f.value ?? ''}</textarea>`
                : html`<input name="${f.name}" type="${f.type ?? 'text'}" value="${f.value ?? ''}" maxlength="${f.maxlength ?? 200}" placeholder="${f.placeholder ?? ''}">`}
            </label>`)}
        </div>
        <div class="dialog-foot editor-foot">
          <button type="button" class="btn btn-ghost" data-cancel>Voltar</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>
        </div>
      </form>`);
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    let result = null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const missing = fields.find((f) => f.required && !String(values[f.name] ?? '').trim());
      if (missing) {
        form.elements[missing.name].focus();
        return;
      }
      result = values;
      dialog.close();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-cancel]') || e.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
    form.querySelector('input, textarea')?.focus();
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
