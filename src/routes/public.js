import { Router } from 'express';
import { rateLimit } from '../lib/http.js';
import { getPublicMenu, listZones } from '../services/catalog.js';
import { createOrder, getPublicOrder } from '../services/orders.js';
import { getPublicSettings } from '../services/settings.js';

export function publicRoutes({ db, events, config }) {
  const r = Router();

  r.get('/store', (_req, res) => {
    const zones = listZones(db, { onlyActive: true }).map(({ id, name, fee_cents }) => ({ id, name, fee_cents }));
    res.json({ settings: getPublicSettings(db), zones });
  });

  r.get('/menu', (_req, res) => {
    res.json({ categories: getPublicMenu(db) });
  });

  r.post(
    '/orders',
    rateLimit({ windowMs: 10 * 60_000, max: config.orderRateLimit, message: 'Muitos pedidos em sequência. Aguarde alguns minutos ou chame no WhatsApp.' }),
    (req, res) => {
      const order = createOrder(db, req.body);
      events.publish('order:new', order);
      res.status(201).json({ code: order.code, number: order.id });
    },
  );

  r.get('/orders/:code', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getPublicOrder(db, req.params.code));
  });

  return r;
}
