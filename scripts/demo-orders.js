// Gera pedidos fictícios nos últimos dias para testar os relatórios.
// Uso: npm run demo -- 30   (quantidade de dias; padrão 30)
// ATENÇÃO: use apenas em um banco de testes (DATA_DIR separado), nunca no banco real da loja.
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/index.js';
import { seedDemoData } from '../src/db/seed.js';
import { createOrder } from '../src/services/orders.js';
import { updateSettings } from '../src/services/settings.js';

const days = Number(process.argv[2]) || 30;
const config = loadConfig();
const db = openDatabase(config.dbFile);
if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n > 0 && !process.argv.includes('--force')) {
  console.error('Este banco já tem pedidos. Para não misturar dados reais com fictícios, use um DATA_DIR de teste');
  console.error('(ex.: DATA_DIR=./data-demo npm run demo) ou rode com --force se tiver certeza.');
  process.exit(1);
}
seedDemoData(db);
updateSettings(db, { is_open: true });

const names = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elaine', 'Felipe', 'Gabi', 'Hugo', 'Iara', 'João', 'Karina', 'Lucas'];
const products = db.prepare('SELECT id FROM products').all().map((p) => p.id);
const zones = db.prepare('SELECT id FROM delivery_zones WHERE active = 1').all().map((z) => z.id);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const setDate = db.prepare('UPDATE orders SET created_at = ?, updated_at = ?, status = ? WHERE id = ?');

let count = 0;
for (let d = days - 1; d >= 0; d--) {
  const weekday = new Date(Date.now() - d * 86400_000).getDay();
  if (weekday === 1) continue; // segunda: food truck fechado
  const ordersToday = 6 + Math.floor(Math.random() * (weekday === 5 || weekday === 6 ? 22 : 12));
  for (let n = 0; n < ordersToday; n++) {
    const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
      product_id: pick(products),
      quantity: 1 + Math.floor(Math.random() * 3),
    }));
    const delivery = Math.random() < 0.6 && zones.length;
    const order = createOrder(db, {
      customer_name: pick(names),
      customer_phone: '119' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'),
      fulfillment: delivery ? 'entrega' : 'retirada',
      zone_id: delivery ? pick(zones) : undefined,
      address: delivery ? 'Rua de Teste, 123' : undefined,
      payment_method: pick(['pix', 'pix', 'dinheiro', 'cartao', 'cartao']),
      items,
    });
    // Horário entre 18h e 23h59 (horário de Brasília = UTC-3).
    const at = new Date(Date.now() - d * 86400_000);
    at.setUTCHours(21 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);
    if (at > new Date()) at.setUTCDate(at.getUTCDate() - 1);
    const status = d === 0 && n >= ordersToday - 3 ? 'novo' : Math.random() < 0.04 ? 'cancelado' : 'concluido';
    setDate.run(at.toISOString(), at.toISOString(), status, order.id);
    count++;
  }
}
db.close();
console.log(`${count} pedidos de demonstração criados em ${config.dbFile}`);
