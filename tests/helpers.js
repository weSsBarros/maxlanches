import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const ADMIN_PASSWORD = 'senha-de-teste-123';

/** Sobe o app numa porta livre com banco temporário e cardápio de exemplo. */
export async function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlanches-test-'));
  const config = loadConfig({ dataDir, dbFile: path.join(dataDir, 'test.db') });
  config.adminPassword = ADMIN_PASSWORD;
  config.adminUser = 'admin';
  config.seedDemoData = true;
  config.orderRateLimit = 1000;
  config.loginRateLimit = 1000;
  const { app, db, events } = createApp(config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function request(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* resposta não JSON (CSV, HTML) */
    }
    return { status: res.status, data, headers: res.headers };
  }

  /** Corpo bruto da resposta (o fetch remove o BOM ao ler como texto). */
  async function requestBytes(url) {
    const res = await fetch(base + url, { headers: cookie ? { Cookie: cookie } : {} });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  }

  return {
    db,
    base,
    request,
    requestBytes,
    login: () => request('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PASSWORD }),
    logout: () => {
      cookie = '';
    },
    async close() {
      events.close();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function orderPayload(overrides = {}) {
  return {
    customer_name: 'Cliente Teste',
    customer_phone: '(11) 98888-7777',
    fulfillment: 'retirada',
    payment_method: 'pix',
    items: [{ product_id: 1, quantity: 2 }],
    ...overrides,
  };
}
