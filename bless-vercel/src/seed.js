'use strict';
/* Loads a starter catalogue (the same sample shop the app ships with) the first time the database is empty.
   Replace it with your own products from the admin panel; delete the samples there. */
const fs = require('fs');
const path = require('path');
const { q, tx, setSetting } = require('./db');
const S = require('./settings');

async function seedIfEmpty() {
  const n = Number((await q('SELECT count(*) n FROM categories')).rows[0].n) + Number((await q('SELECT count(*) n FROM products')).rows[0].n);
  if (n > 0 || process.env.SEED_DEMO === '0') { return false; }
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed-data.json'), 'utf8'));
  await tx(async (c) => {
    let i = 0;
    for (const cat of D.config.categories) {
      await c.query('INSERT INTO categories(slug,name,type,parent,image,sort) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [cat.slug, cat.name, cat.type, cat.parent || '', cat.image || '', i++]);
    }
    const meta = {}; D.items.forEach((it) => { meta[it.id] = it; });
    for (const d of Object.values(D.details)) {
      const it = meta[d.id] || {};
      await c.query(`INSERT INTO products(slug,name,short,description,base_price,regular_price,on_sale,availability,images,attributes,variations,options,cats,featured,active,sort)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,true,$15) ON CONFLICT DO NOTHING`,
      [d.slug, d.name, d.short, d.description, d.base_price, d.regular_price, !!d.on_sale, d.availability || 'made_to_order', JSON.stringify(d.images || []), JSON.stringify(d.attributes || {}),
        JSON.stringify((d.variations || []).map((v) => ({ ...v, price: Number(v.price) }))), JSON.stringify(d.options || []), JSON.stringify(it._cats || []), !!it._featured, d.id]);
    }
    await c.query("INSERT INTO coupons(code,type,value) VALUES('BLESS10','percent',10) ON CONFLICT DO NOTHING");
    await setSetting('hero', D.config.hero, c);
    await setSetting('shop', { ...S.DEFAULTS.shop, ...D.config.shop }, c);
  });
  console.log('Loaded the starter catalogue (22 sample products). Replace them from /admin.');
  return true;
}
module.exports = { seedIfEmpty };
if (require.main === module) { require('./db').migrate().then(seedIfEmpty).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); }); }
