import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ensureAdminUser } from './lib/auth.js';
import { createEventHub } from './lib/events.js';
import { HttpError, sameOriginWrites } from './lib/http.js';
import { openDatabase } from './db/index.js';
import { seedDemoData } from './db/seed.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function createApp(config) {
  const db = openDatabase(config.dbFile);
  if (config.seedDemoData) seedDemoData(db);
  const generatedPassword = ensureAdminUser(db, { username: config.adminUser, password: config.adminPassword });
  const events = createEventHub();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use('/api', express.json({ limit: '100kb' }), sameOriginWrites);
  app.use('/api', publicRoutes({ db, events, config }));
  app.use('/api/admin', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/admin', adminRoutes({ db, events, config }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')));

  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d', immutable: true, fallthrough: false }));
  app.get('/pedido/:code', (_req, res) => res.sendFile(path.join(config.publicDir, 'pedido.html')));
  app.use(express.static(config.publicDir, { extensions: ['html'], maxAge: config.production ? '1h' : 0 }));

  // Tratamento central de erros: responde JSON na API e texto simples no resto.
  app.use((err, req, res, _next) => {
    let status = err.status ?? err.statusCode ?? 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'Imagem muito grande (máximo 3 MB).' : 'Falha no envio da imagem.';
    } else if (err.type === 'entity.parse.failed') {
      message = 'Requisição inválida.';
    } else if (!(err instanceof HttpError) && status >= 500) {
      console.error(err);
      message = 'Erro interno. Tente novamente.';
    }
    if (req.path.startsWith('/api')) res.status(status).json({ error: message, details: err.details });
    else res.status(status).type('text').send(status === 404 ? 'Página não encontrada.' : message);
  });

  return { app, db, events, generatedPassword };
}
