export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Limitador simples em memória (por IP) — suficiente para uma única instância do servidor. */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) return next(new HttpError(429, message));
    next();
  };
}

/** Bloqueia requisições de escrita vindas de outros sites (proteção CSRF adicional ao cookie SameSite). */
export function sameOriginWrites(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new HttpError(403, 'Origem inválida.'));
    }
    if (host !== req.headers.host) return next(new HttpError(403, 'Origem não permitida.'));
  }
  next();
}
