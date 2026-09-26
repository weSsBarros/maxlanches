import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import {
  clearSessionCookie, createSession, destroySession, hashPassword, requireAuth, setSessionCookie, verifyPassword,
} from '../lib/auth.js';
import { HttpError, rateLimit } from '../lib/http.js';
import * as catalog from '../services/catalog.js';
import { getOrderById, listOrders, updateOrderStatus } from '../services/orders.js';
import { buildOrdersCsv, buildReport, resolveRange } from '../services/reports.js';
import { getSettings, updateSettings } from '../services/settings.js';

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Identificador inválido.');
  return id;
};

export function adminRoutes({ db, events, config }) {
  const r = Router();

  // ---------- Autenticação ----------
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: config.loginRateLimit, message: 'Muitas tentativas. Aguarde 15 minutos.' });

  r.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body ?? {};
    const user = typeof username === 'string' && db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    const { token, maxAge } = createSession(db, user.id);
    setSessionCookie(res, token, maxAge, config.production);
    res.json({ user: { id: user.id, username: user.username } });
  });

  r.use(requireAuth(db));

  r.post('/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    clearSessionCookie(res);
    res.status(204).end();
  });

  r.get('/me', (req, res) => res.json({ user: req.user }));

  r.post('/password', (req, res) => {
    const { current, next } = req.body ?? {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (typeof current !== 'string' || !verifyPassword(current, user.password_hash)) {
      throw new HttpError(400, 'Senha atual incorreta.');
    }
    if (typeof next !== 'string' || next.length < 8) throw new HttpError(400, 'A nova senha deve ter ao menos 8 caracteres.');
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
      // Encerra as outras sessões abertas com a senha antiga.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();
    const { token, maxAge } = createSession(db, user.id);
    setSessionCookie(res, token, maxAge, config.production);
    res.status(204).end();
  });

  // ---------- Pedidos ----------
  r.get('/events', (req, res) => events.subscribe(req, res));

  r.get('/orders', (req, res) => {
    if (req.query.scope === 'history') {
      const range = resolveRange(req.query, config.timezone);
      return res.json({ orders: listOrders(db, { scope: 'history', from: range.startUtc, to: range.endUtc, limit: 500 }) });
    }
    res.json({ orders: listOrders(db, { scope: 'active' }) });
  });

  r.get('/orders/:id', (req, res) => res.json(getOrderById(db, idParam(req))));

  r.patch('/orders/:id/status', (req, res) => {
    const order = updateOrderStatus(db, idParam(req), req.body ?? {});
    events.publish('order:update', order);
    if (order.status === 'cancelado') events.publish('menu:update', {});
    res.json(order);
  });

  // ---------- Cardápio ----------
  const menuChanged = () => events.publish('menu:update', {});

  r.get('/categories', (_req, res) => res.json({ categories: catalog.listCategories(db) }));
  r.post('/categories', (req, res) => {
    const c = catalog.createCategory(db, req.body);
    menuChanged();
    res.status(201).json(c);
  });
  r.patch('/categories/:id', (req, res) => {
    const c = catalog.updateCategory(db, idParam(req), req.body);
    menuChanged();
    res.json(c);
  });
  r.delete('/categories/:id', (req, res) => {
    catalog.deleteCategory(db, idParam(req));
    menuChanged();
    res.status(204).end();
  });

  r.get('/products', (_req, res) => res.json({ products: catalog.listProducts(db) }));
  r.post('/products', (req, res) => {
    const p = catalog.createProduct(db, req.body);
    menuChanged();
    res.status(201).json(p);
  });
  r.patch('/products/:id', (req, res) => {
    const p = catalog.updateProduct(db, idParam(req), req.body);
    menuChanged();
    res.json(p);
  });
  r.delete('/products/:id', (req, res) => {
    catalog.deleteProduct(db, idParam(req));
    menuChanged();
    res.status(204).end();
  });

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[file.mimetype]}`),
    }),
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) =>
      IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP.')),
  });

  r.post('/uploads', upload.single('image'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'Nenhuma imagem enviada.');
    res.status(201).json({ url: `/uploads/${path.basename(req.file.filename)}` });
  });

  // ---------- Entrega ----------
  r.get('/zones', (_req, res) => res.json({ zones: catalog.listZones(db) }));
  r.post('/zones', (req, res) => res.status(201).json(catalog.createZone(db, req.body)));
  r.patch('/zones/:id', (req, res) => res.json(catalog.updateZone(db, idParam(req), req.body)));
  r.delete('/zones/:id', (req, res) => {
    catalog.deleteZone(db, idParam(req));
    res.status(204).end();
  });

  // ---------- Configurações ----------
  r.get('/settings', (_req, res) => res.json(getSettings(db)));
  r.put('/settings', (req, res) => {
    const result = updateSettings(db, req.body);
    if (result.errors) throw new HttpError(400, result.errors.join(' '), result.errors);
    events.publish('store:update', result.settings);
    res.json(result.settings);
  });

  // ---------- Relatórios ----------
  r.get('/reports', (req, res) => res.json(buildReport(db, req.query, config.timezone)));

  r.get('/reports/orders.csv', (req, res) => {
    const { filename, content } = buildOrdersCsv(db, req.query, config.timezone);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(content);
  });

  return r;
}
