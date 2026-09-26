// Cardápio inicial de exemplo. Preços e custos são estimativas — ajuste pelo painel.
const DEMO_MENU = [
  {
    name: 'Churrasquinhos', emoji: '🍢', products: [
      ['Espeto de carne', 'Alcatra temperada na brasa, acompanha farofa.', 900, 450],
      ['Espeto de frango', 'Peito de frango temperado com alho e ervas.', 800, 350],
      ['Espeto de linguiça', 'Linguiça toscana na brasa.', 800, 330],
      ['Espeto de queijo coalho', 'Com melaço ou orégano.', 800, 380],
      ['Espeto misto', 'Carne, frango, linguiça e pimentão.', 1000, 480],
      ['Coração de frango', 'Temperado e bem passado.', 800, 330],
    ],
  },
  {
    name: 'Hambúrgueres', emoji: '🍔', products: [
      ['X-Burger', 'Pão, hambúrguer 120g, queijo e molho da casa.', 1800, 750],
      ['X-Salada', 'Hambúrguer 120g, queijo, alface, tomate e maionese.', 2000, 820],
      ['X-Bacon', 'Hambúrguer 120g, queijo, bacon crocante e cebola caramelizada.', 2400, 1050],
      ['X-Tudo', 'Dois hambúrgueres, queijo, bacon, ovo, presunto, salada e batata palha.', 3000, 1400],
    ],
  },
  {
    name: 'Cachorros-quentes', emoji: '🌭', products: [
      ['Dog simples', 'Pão, salsicha, molho de tomate, batata palha e milho.', 1200, 450],
      ['Dog completo', 'Duas salsichas, purê, vinagrete, milho, ervilha, queijo ralado e batata palha.', 1600, 650],
      ['Dog prensado', 'Completo, prensado na chapa com queijo derretido.', 1800, 750],
    ],
  },
  {
    name: 'Bebidas', emoji: '🥤', products: [
      ['Refrigerante lata', 'Coca-Cola, Guaraná ou Fanta (350ml). Informe o sabor na observação.', 600, 300],
      ['Refrigerante 2L', 'Coca-Cola ou Guaraná.', 1400, 800],
      ['Suco natural', 'Laranja, maracujá ou limão (400ml).', 800, 300],
      ['Água mineral', 'Com ou sem gás (500ml).', 400, 150],
    ],
  },
];

const DEMO_ZONES = [
  ['Centro', 500],
  ['Vila Nova', 600],
  ['Jardim América', 700],
  ['Parque Industrial', 900],
];

// [nome, preço, custo, categorias onde aparece]
const DEMO_ADDONS = [
  ['Bacon extra', 400, 180, ['Hambúrgueres', 'Cachorros-quentes']],
  ['Cheddar', 300, 120, ['Hambúrgueres', 'Cachorros-quentes']],
  ['Ovo', 200, 70, ['Hambúrgueres']],
  ['Hambúrguer extra 120g', 700, 300, ['Hambúrgueres']],
  ['Salsicha extra', 300, 110, ['Cachorros-quentes']],
  ['Catupiry', 300, 130, ['Hambúrgueres', 'Cachorros-quentes']],
];

export function seedDemoData(db) {
  const hasData = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n > 0;
  if (hasData) return false;

  const insertCategory = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)');
  const insertProduct = db.prepare(`
    INSERT INTO products (category_id, name, description, price_cents, cost_cents, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertZone = db.prepare('INSERT INTO delivery_zones (name, fee_cents, sort_order) VALUES (?, ?, ?)');
  const insertAddon = db.prepare('INSERT INTO addons (name, price_cents, cost_cents, sort_order) VALUES (?, ?, ?, ?)');
  const linkAddon = db.prepare('INSERT INTO addon_categories (addon_id, category_id) VALUES (?, ?)');

  db.transaction(() => {
    const categoryIds = new Map();
    DEMO_MENU.forEach((cat, ci) => {
      const { lastInsertRowid } = insertCategory.run(cat.name, cat.emoji, ci);
      categoryIds.set(cat.name, lastInsertRowid);
      cat.products.forEach(([name, desc, price, cost], pi) => {
        insertProduct.run(lastInsertRowid, name, desc, price, cost, pi);
      });
    });
    DEMO_ZONES.forEach(([name, fee], i) => insertZone.run(name, fee, i));
    DEMO_ADDONS.forEach(([name, price, cost, categories], i) => {
      const { lastInsertRowid } = insertAddon.run(name, price, cost, i);
      categories.forEach((c) => linkAddon.run(lastInsertRowid, categoryIds.get(c)));
    });
  })();
  return true;
}
