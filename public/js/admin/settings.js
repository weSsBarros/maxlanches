import { api, html, render, toast } from '../shared/util.js';

let el;
let ctx;

const STORE_FIELDS = ['store_name', 'tagline', 'whatsapp', 'instagram', 'address', 'hours_text'];
const PIX_FIELDS = ['pix_key', 'pix_name', 'pix_city'];

export function mount(element, context) {
  el = element;
  ctx = context;
  render(el, html`
    <div class="panel-head"><h1>Configurações</h1><a class="btn btn-outline btn-sm" href="/" target="_blank" rel="noopener">Ver site ↗</a></div>
    <div class="settings-grid">
      <form class="card form-grid" id="store-form">
        <h2>Dados da loja</h2>
        <label class="field"><span>Nome</span><input name="store_name" maxlength="60" required></label>
        <label class="field"><span>Frase de destaque</span><input name="tagline" maxlength="120"></label>
        <div class="form-row">
          <label class="field"><span>WhatsApp (com DDD)</span><input name="whatsapp" inputmode="tel" maxlength="20" placeholder="(11) 99999-9999"><small>Recebe o pedido dos clientes.</small></label>
          <label class="field"><span>Instagram</span><input name="instagram" maxlength="60" placeholder="@maxlanches"></label>
        </div>
        <label class="field"><span>Endereço / ponto do food truck</span><input name="address" maxlength="200" placeholder="Rua, número — referência"></label>
        <label class="field"><span>Horário de funcionamento</span><input name="hours_text" maxlength="120" placeholder="Terça a domingo, das 18h às 23h30"></label>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Salvar dados</button></div>
      </form>

      <div>
        <form class="card form-grid" id="pix-form">
          <h2>Pix</h2>
          <p class="card-sub">Com a chave preenchida, o cliente que escolher Pix recebe um código "copia e cola" com o valor exato do pedido. Confira o pagamento no app do banco.</p>
          <label class="field"><span>Chave Pix</span><input name="pix_key" maxlength="77" placeholder="CNPJ, celular, e-mail ou chave aleatória"><small>Celular no formato +5511999999999.</small></label>
          <div class="form-row">
            <label class="field"><span>Nome do recebedor</span><input name="pix_name" maxlength="25"></label>
            <label class="field"><span>Cidade</span><input name="pix_city" maxlength="15"></label>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Salvar Pix</button></div>
        </form>

        <form class="card form-grid" id="password-form">
          <h2>Trocar senha</h2>
          <label class="field"><span>Senha atual</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>Nova senha</span><input name="next" type="password" autocomplete="new-password" minlength="8" required><small>Mínimo de 8 caracteres.</small></label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Trocar senha</button></div>
        </form>
      </div>
    </div>`);

  fill();
  ctx.bus.addEventListener('settings:update', fill);
  el.querySelector('#store-form').addEventListener('submit', (e) => save(e, STORE_FIELDS, 'Dados da loja salvos!'));
  el.querySelector('#pix-form').addEventListener('submit', (e) => save(e, PIX_FIELDS, 'Pix salvo!'));
  el.querySelector('#password-form').addEventListener('submit', changePassword);
}

function fill() {
  for (const form of el.querySelectorAll('#store-form, #pix-form')) {
    for (const input of form.elements) {
      if (input.name && input.name in ctx.settings) input.value = ctx.settings[input.name];
    }
  }
}

async function save(e, fields, message) {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const body = Object.fromEntries(fields.map((k) => [k, f[k].value.trim()]));
  if ('whatsapp' in body) body.whatsapp = body.whatsapp.replace(/\D/g, '');
  if ('pix_key' in body && /^\(\d{2}\)\s?9?\d{4}-?\d{4}$/.test(body.pix_key)) {
    // Celular digitado como "(11) 99999-9999": o Pix exige o formato +5511999999999.
    body.pix_key = `+55${body.pix_key.replace(/\D/g, '')}`;
  }
  try {
    await ctx.saveSettings(body);
    fill();
    toast(message, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function changePassword(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const f = form.elements;
  if (f.next.value.length < 8) return toast('A nova senha deve ter ao menos 8 caracteres.', 'error');
  try {
    await api('/api/admin/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    form.reset();
    toast('Senha alterada!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}
