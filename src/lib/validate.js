// Validadores pequenos que acumulam mensagens de erro em português.
export class Validator {
  constructor(input) {
    this.input = input && typeof input === 'object' ? input : {};
    this.errors = [];
    this.out = {};
  }

  string(key, label, { required = false, max = 200, min = 0 } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push(`${label} é obrigatório.`);
      else this.out[key] = '';
      return this;
    }
    if (typeof raw !== 'string') {
      this.errors.push(`${label} inválido.`);
      return this;
    }
    const value = raw.trim();
    if (required && !value) this.errors.push(`${label} é obrigatório.`);
    else if (value.length < min) this.errors.push(`${label} deve ter ao menos ${min} caracteres.`);
    else if (value.length > max) this.errors.push(`${label} deve ter no máximo ${max} caracteres.`);
    else this.out[key] = value;
    return this;
  }

  int(key, label, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push(`${label} é obrigatório.`);
      else if (nullable) this.out[key] = null;
      return this;
    }
    if (!Number.isInteger(raw) || raw < min || raw > max) this.errors.push(`${label} inválido.`);
    else this.out[key] = raw;
    return this;
  }

  bool(key, label, { required = false } = {}) {
    const raw = this.input[key];
    if (raw === undefined) {
      if (required) this.errors.push(`${label} é obrigatório.`);
      return this;
    }
    if (typeof raw !== 'boolean') this.errors.push(`${label} inválido.`);
    else this.out[key] = raw;
    return this;
  }

  oneOf(key, label, options, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined && !required) return this;
    if (!options.includes(raw)) this.errors.push(`${label} inválido.`);
    else this.out[key] = raw;
    return this;
  }

  get ok() {
    return this.errors.length === 0;
  }
}
