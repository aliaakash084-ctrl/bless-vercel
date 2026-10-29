'use strict';
/* Admin API (mounted at /admin/api). Everything except /login needs the signed token from /login. */
const express = require('express');
const multer = require('multer');
const { q, tx, setSetting } = require('./db');
const { m2, rand, slugify, crypto, wrap, limit, baseUrl, expand, karachiNow } = require('./util');
const S = require('./settings');

const r = express.Router();
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('bless-admin|' + PASSWORD + '|' + (process.env.DATABASE_URL || '')).digest('hex');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function makeToken() { const p = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url'); return p + '.' + sign(p); }
function checkToken(t) {
  const [p, sig] = String(t || '').split('.');
  if (!p || !sig || !same(sig, sign(p))) { return false; }
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
}

r.post('/login', limit('login', 8, 60000), (req, res) => {
  if (!PASSWORD) { return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server.' }); }
  if (!same(crypto.createHash('sha256').update(String((req.body || {}).password || '')).digest('hex'), crypto.createHash('sha256').update(PASSWORD).digest('hex'))) { return res.status(401).json({ error: 'Wrong password.' }); }
  res.json({ token: makeToken() });
});

r.use((req, res, next) => {
  const h = req.get('Authorization') || '', t = h.indexOf('Bearer ') === 0 ? h.slice(7) : (req.path.indexOf('/files/') === 0 ? req.query.t : '');
  if (!checkToken(t)) { return res.status(401).json({ error: 'Please sign in again.' }); }
  next();
});

const bad = (res, msg) => res.status(422).json({ error: msg });

/* ---------- dashboard ---------- */
r.get('/stats', wrap(async (req, res) => {
  const today = karachiNow().ymd;
  const a = (await q(`SELECT
    count(*) FILTER (WHERE NOT seen) AS unseen, count(*) FILTER (WHERE status='pending') AS pending,
    count(*) FILTER (WHERE delivery_date=$1 AND status NOT IN ('cancelled','delivered')) AS due_today,
    COALESCE(sum(total) FILTER (WHERE status<>'cancelled' AND created_at > now() - interval '30 days'),0) AS revenue30,
    count(*) FILTER (WHERE created_at > now() - interval '30 days') AS orders30 FROM orders`, [today])).rows[0];
  const p = (await q('SELECT count(*) AS n FROM products')).rows[0].n;
  res.json({ ...a, products: Number(p) });
}));

/* ---------- settings ---------- */
r.get('/settings', wrap(async (req, res) => res.json(await S.all())));
r.put('/settings', wrap(async (req, res) => {
  const b = req.body || {}, cur = await S.all(), out = {};
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const list = (v, n) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => str(x, n)).filter(Boolean).slice(0, 60);
  if (b.shop) { const s = b.shop; out.shop = { name: str(s.name, 80) || cur.shop.name, phone: str(s.phone, 40), whatsapp: str(s.whatsapp, 40), email: str(s.email, 120), address: str(s.address, 300) }; }
  if (b.general) { const g = b.general; out.general = { currency: str(g.currency, 8) || 'Rs.', currency_code: str(g.currency_code, 5) || 'PKR', hero_autoplay_ms: Math.max(3000, parseInt(g.hero_autoplay_ms, 10) || 6000), logo: str(g.logo, 300) }; }
  if (b.delivery) {
    const d = b.delivery, num = (v, dflt) => { const n = Number(v); return isNaN(n) || n < 0 ? dflt : n; };
    out.delivery = { fee: num(d.fee, 0), free_over: num(d.free_over, 0), pickup_enabled: !!d.pickup_enabled, cities: list(d.cities, 60), slots: list(d.slots, 40), same_day: !!d.same_day,
      cutoff_hour: Math.min(23, Math.max(0, parseInt(d.cutoff_hour, 10) || 12)), lead_days: Math.min(30, Math.max(0, parseInt(d.lead_days, 10) || 1)), max_days: Math.min(365, Math.max(1, parseInt(d.max_days, 10) || 60)) };
  }
  if (b.gateways) {
    if (!Array.isArray(b.gateways)) { return bad(res, 'Invalid payment settings.'); }
    const known = new Set(['cod', 'bank', 'jazzcash', 'easypaisa']);
    out.gateways = b.gateways.filter((g) => known.has(g.id)).map((g) => ({ id: g.id, title: str(g.title, 60) || g.id, description: str(g.description, 600), reference: g.id !== 'cod', enabled: !!g.enabled }));
    if (!out.gateways.some((g) => g.enabled)) { return bad(res, 'Keep at least one payment method turned on.'); }
  }
  if (b.hero) {
    if (!Array.isArray(b.hero)) { return bad(res, 'Invalid banners.'); }
    out.hero = b.hero.slice(0, 10).map((h) => ({ title: str(h.title, 80), subtitle: str(h.subtitle, 120), image: str(h.image, 300), link: str(h.link, 300), cta: str(h.cta, 30) })).filter((h) => h.image);
  }
  await tx(async (c) => { for (const k of Object.keys(out)) { await setSetting(k, out[k], c); } });
  res.json(await S.all());
}));

/* ---------- images ---------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
function imageMime(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) { return 'image/jpeg'; }
  if (b.length > 8 && b.slice(0, 8).toString('hex') === '89504e470d0a1a0a') { return 'image/png'; }
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') { return 'image/webp'; }
  return '';
}
r.post('/upload', upload.single('file'), wrap(async (req, res) => {
  const mime = req.file ? imageMime(req.file.buffer) : '';
  if (!mime) { return bad(res, 'Please choose a JPG, PNG or WebP image (up to 4 MB).'); }
  const key = rand(12); await q("INSERT INTO files(key,mime,data,kind) VALUES($1,$2,$3,'admin')", [key, mime, req.file.buffer]);
  res.json({ ref: 'media:' + key, url: `${baseUrl(req)}/media/${key}` });
}));
r.get('/files/:id', wrap(async (req, res) => {
  const x = await q('SELECT mime, data FROM files WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  if (!x.rows.length) { return res.sendStatus(404); }
  res.set({ 'Content-Type': x.rows[0].mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' }).send(x.rows[0].data);
}));

/* ---------- categories ---------- */
r.get('/categories', wrap(async (req, res) => res.json((await S.categoriesList()).rows)));
function catBody(b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) { return null; }
  return { name, slug: slugify(b.slug || name), type: ['product', 'occasion', 'collection'].indexOf(b.type) > -1 ? b.type : 'product', parent: String(b.parent || '').slice(0, 80), image: String(b.image || '').slice(0, 300), sort: parseInt(b.sort, 10) || 0 };
}
r.post('/categories', wrap(async (req, res) => {
  const c = catBody(req.body || {}); if (!c) { return bad(res, 'Category name is required.'); }
  if (c.parent && c.parent === c.slug) { return bad(res, 'A category cannot be its own parent.'); }
  try { const x = await q('INSERT INTO categories(slug,name,type,parent,image,sort) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [c.slug, c.name, c.type, c.parent, c.image, c.sort]); res.status(201).json(x.rows[0]); }
  catch (e) { if (e.code === '23505') { return bad(res, 'A category with that name/slug already exists.'); } throw e; }
}));
r.put('/categories/:id', wrap(async (req, res) => {
  const c = catBody(req.body || {}), id = parseInt(req.params.id, 10); if (!c) { return bad(res, 'Category name is required.'); }
  const old = (await q('SELECT slug FROM categories WHERE id=$1', [id])).rows[0]; if (!old) { return res.sendStatus(404); }
  if (c.parent === c.slug) { return bad(res, 'A category cannot be its own parent.'); }
  try {
    await tx(async (cx) => {
      await cx.query('UPDATE categories SET slug=$1,name=$2,type=$3,parent=$4,image=$5,sort=$6 WHERE id=$7', [c.slug, c.name, c.type, c.parent, c.image, c.sort, id]);
      if (old.slug !== c.slug) {
        await cx.query('UPDATE categories SET parent=$1 WHERE parent=$2', [c.slug, old.slug]);
        await cx.query(`UPDATE products SET cats = (SELECT COALESCE(jsonb_agg(CASE WHEN v = $2 THEN $1 ELSE v END), '[]'::jsonb) FROM jsonb_array_elements_text(cats) v) WHERE cats ? $2`, [c.slug, old.slug]);
      }
    });
  } catch (e) { if (e.code === '23505') { return bad(res, 'A category with that name/slug already exists.'); } throw e; }
  res.json({ ok: true });
}));
r.delete('/categories/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), c = (await q('SELECT slug FROM categories WHERE id=$1', [id])).rows[0]; if (!c) { return res.sendStatus(404); }
  await tx(async (cx) => {
    await cx.query("UPDATE categories SET parent='' WHERE parent=$1", [c.slug]);
    await cx.query(`UPDATE products SET cats = (SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements_text(cats) v WHERE v <> $1) WHERE cats ? $1`, [c.slug]);
    await cx.query('DELETE FROM categories WHERE id=$1', [id]);
  });
  res.json({ ok: true });
}));

/* ---------- products ---------- */
const OPT_TYPES = ['select', 'radio', 'checkbox', 'text', 'textarea', 'color', 'image_upload'];
function productBody(b) {
  const name = String(b.name || '').trim().slice(0, 160);
  if (!name) { return { error: 'Product name is required.' }; }
  const num = (v) => { const n = Number(v); return isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100; };
  const attributes = {};
  Object.keys(b.attributes || {}).slice(0, 4).forEach((k) => { const vals = (b.attributes[k] || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30); if (k.trim() && vals.length) { attributes[k.trim().slice(0, 40)] = vals; } });
  const names = Object.keys(attributes);
  const variations = (names.length ? (b.variations || []) : []).slice(0, 120).map((v) => {
    const at = {}; names.forEach((n) => { at[n] = String((v.attributes || {})[n] || '').trim(); });
    return { attributes: at, price: num(v.price), image: String(v.image || '').slice(0, 300), in_stock: v.in_stock !== false };
  }).filter((v) => names.every((n) => v.attributes[n]));
  if (names.length && !variations.length) { return { error: 'Add at least one price row for the sizes/variants, or remove the variants.' }; }
  const seen = new Set();
  const options = (b.options || []).slice(0, 20).map((o) => {
    const label = String(o.label || '').trim().slice(0, 60); if (!label) { return null; }
    let key = slugify(o.key || label).replace(/-/g, ''); while (seen.has(key)) { key += 'x'; } seen.add(key);
    const type = OPT_TYPES.indexOf(o.type) > -1 ? o.type : 'text';
    return { key, label, type, required: !!o.required, extra: num(o.extra), max: type === 'text' ? 120 : type === 'textarea' ? 500 : 0,
      choices: (type === 'select' || type === 'radio') ? (o.choices || []).slice(0, 40).map((c) => ({ value: String(c.label || c.value || '').trim().slice(0, 60), label: String(c.label || c.value || '').trim().slice(0, 60), extra: num(c.extra) })).filter((c) => c.label) : [] };
  }).filter(Boolean);
  const base = names.length && variations.length ? Math.max(...variations.map((v) => v.price)) : num(b.base_price);
  return { p: {
    name, slug: slugify(b.slug || name), short: String(b.short || '').slice(0, 300), description: String(b.description || '').slice(0, 8000),
    base_price: num(b.base_price) || base, regular_price: b.regular_price === '' || b.regular_price == null ? null : num(b.regular_price), on_sale: !!b.on_sale,
    availability: ['made_to_order', 'in_stock', 'out_of_stock'].indexOf(b.availability) > -1 ? b.availability : 'made_to_order',
    images: (b.images || []).map((x) => String(x).trim()).filter((x) => /^(https?:\/\/|media:|assets\/)/.test(x)).slice(0, 10), attributes, variations, options,
    cats: [...new Set((b.cats || []).map((x) => String(x)))].slice(0, 30), featured: !!b.featured, active: b.active !== false, sort: parseInt(b.sort, 10) || 0 } };
}
const pcols = ['slug', 'name', 'short', 'description', 'base_price', 'regular_price', 'on_sale', 'availability', 'images', 'attributes', 'variations', 'options', 'cats', 'featured', 'active', 'sort'];
const pvals = (p) => pcols.map((k) => (['images', 'attributes', 'variations', 'options', 'cats'].indexOf(k) > -1 ? JSON.stringify(p[k]) : p[k]));
const pcast = (k, i) => (['images', 'attributes', 'variations', 'options', 'cats'].indexOf(k) > -1 ? `$${i + 1}::jsonb` : `$${i + 1}`);

const withUrls = (p, base) => ({ ...p, image_urls: (p.images || []).map((u) => expand(u, base)) });
r.get('/products', wrap(async (req, res) => {
  const per = 30, page = Math.max(1, parseInt(req.query.page, 10) || 1), term = '%' + String(req.query.q || '').trim().replace(/[%_]/g, '') + '%', cat = String(req.query.cat || '');
  const where = ['(name ILIKE $1 OR slug ILIKE $1)'], params = [term];
  if (cat) { params.push(JSON.stringify([cat])); where.push(`cats @> $${params.length}::jsonb`); }
  const w = where.join(' AND '), base = baseUrl(req);
  const total = Number((await q(`SELECT count(*) n FROM products WHERE ${w}`, params)).rows[0].n);
  const rows = (await q(`SELECT id,slug,name,base_price,availability,images,cats,featured,active,variations FROM products WHERE ${w} ORDER BY id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, params)).rows;
  res.json({ items: rows.map((p) => withUrls(p, base)), total, pages: Math.ceil(total / per) || 1, page });
}));
r.get('/products/:id', wrap(async (req, res) => {
  const x = await q('SELECT * FROM products WHERE id=$1', [parseInt(req.params.id, 10) || 0]); if (!x.rows.length) { return res.sendStatus(404); }
  res.json(withUrls(x.rows[0], baseUrl(req)));
}));
async function uniqueSlug(slug, exceptId) {
  let s = slug, n = 1;
  while ((await q('SELECT 1 FROM products WHERE slug=$1 AND id<>$2', [s, exceptId || 0])).rows.length) { s = `${slug}-${++n}`; }
  return s;
}
r.post('/products', wrap(async (req, res) => {
  const { p, error } = productBody(req.body || {}); if (error) { return bad(res, error); }
  p.slug = await uniqueSlug(p.slug);
  const x = await q(`INSERT INTO products(${pcols.join(',')}) VALUES(${pcols.map(pcast).join(',')}) RETURNING id`, pvals(p));
  res.status(201).json({ id: x.rows[0].id, slug: p.slug });
}));
r.put('/products/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), { p, error } = productBody(req.body || {}); if (error) { return bad(res, error); }
  p.slug = await uniqueSlug(p.slug, id);
  const x = await q(`UPDATE products SET ${pcols.map((k, i) => `${k}=${pcast(k, i)}`).join(',')} WHERE id=$${pcols.length + 1} RETURNING id`, [...pvals(p), id]);
  if (!x.rows.length) { return res.sendStatus(404); }
  res.json({ id, slug: p.slug });
}));
r.delete('/products/:id', wrap(async (req, res) => { await q('DELETE FROM products WHERE id=$1', [parseInt(req.params.id, 10) || 0]); res.json({ ok: true }); }));

/* ---------- orders ---------- */
const ORDER_STATUS = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'ready', 'delivered', 'cancelled'];
r.get('/orders', wrap(async (req, res) => {
  const per = 30, page = Math.max(1, parseInt(req.query.page, 10) || 1), params = [], where = [];
  if (ORDER_STATUS.indexOf(req.query.status) > -1) { params.push(req.query.status); where.push(`status=$${params.length}`); }
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) { params.push(req.query.date); where.push(`delivery_date=$${params.length}`); }
  const term = String(req.query.q || '').trim();
  if (term) { params.push('%' + term.replace(/[%_]/g, '') + '%'); params.push(term.replace(/\D/g, '') || '-1'); where.push(`(customer_name ILIKE $${params.length - 1} OR customer_phone ILIKE $${params.length - 1} OR id::text = $${params.length})`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = Number((await q(`SELECT count(*) n FROM orders ${w}`, params)).rows[0].n);
  const rows = (await q(`SELECT id,status,payment_status,payment_method,customer_name,customer_phone,delivery_method,delivery_date,delivery_time,delivery_city,total,seen,created_at,jsonb_array_length(items) AS item_count FROM orders ${w} ORDER BY id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, params)).rows;
  res.json({ items: rows, total, pages: Math.ceil(total / per) || 1, page });
}));
r.get('/orders/:id', wrap(async (req, res) => {
  const x = await q('UPDATE orders SET seen=true WHERE id=$1 RETURNING *', [parseInt(req.params.id, 10) || 0]); if (!x.rows.length) { return res.sendStatus(404); }
  res.json(x.rows[0]);
}));
r.patch('/orders/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0, b = req.body || {}, cur = (await q('SELECT * FROM orders WHERE id=$1', [id])).rows[0]; if (!cur) { return res.sendStatus(404); }
  const status = ORDER_STATUS.indexOf(b.status) > -1 ? b.status : cur.status, pay = ['unpaid', 'paid', 'refunded'].indexOf(b.payment_status) > -1 ? b.payment_status : cur.payment_status;
  const hist = cur.history.slice(); const now = new Date().toISOString();
  if (status !== cur.status) { hist.push({ at: now, status, note: String(b.note || '').slice(0, 200) }); }
  if (pay !== cur.payment_status) { hist.push({ at: now, status: 'payment_' + pay, note: '' }); }
  await q('UPDATE orders SET status=$1,payment_status=$2,admin_note=$3,payment_reference=$4,history=$5::jsonb,seen=true WHERE id=$6', [status, pay, b.admin_note == null ? cur.admin_note : String(b.admin_note).slice(0, 1000), b.payment_reference == null ? cur.payment_reference : String(b.payment_reference).slice(0, 100), JSON.stringify(hist), id]);
  res.json({ ok: true });
}));

/* ---------- coupons ---------- */
r.get('/coupons', wrap(async (req, res) => res.json((await q('SELECT * FROM coupons ORDER BY id DESC')).rows)));
function couponBody(b) {
  const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30); if (!code) { return null; }
  const type = b.type === 'fixed' ? 'fixed' : 'percent', num = (v) => { const n = Number(v); return isNaN(n) || n < 0 ? 0 : n; };
  const value = type === 'percent' ? Math.min(100, num(b.value)) : num(b.value);
  return { code, type, value, min_subtotal: num(b.min_subtotal), active: b.active !== false, expires: /^\d{4}-\d{2}-\d{2}$/.test(b.expires || '') ? b.expires : null, max_uses: b.max_uses === '' || b.max_uses == null ? null : Math.max(1, parseInt(b.max_uses, 10) || 1) };
}
r.post('/coupons', wrap(async (req, res) => {
  const c = couponBody(req.body || {}); if (!c) { return bad(res, 'Enter a coupon code.'); } if (!c.value) { return bad(res, 'Enter the discount amount.'); }
  try { await q('INSERT INTO coupons(code,type,value,min_subtotal,active,expires,max_uses) VALUES($1,$2,$3,$4,$5,$6,$7)', [c.code, c.type, c.value, c.min_subtotal, c.active, c.expires, c.max_uses]); res.status(201).json({ ok: true }); }
  catch (e) { if (e.code === '23505') { return bad(res, 'That code already exists.'); } throw e; }
}));
r.put('/coupons/:id', wrap(async (req, res) => {
  const c = couponBody(req.body || {}); if (!c || !c.value) { return bad(res, 'Check the code and discount amount.'); }
  try { await q('UPDATE coupons SET code=$1,type=$2,value=$3,min_subtotal=$4,active=$5,expires=$6,max_uses=$7 WHERE id=$8', [c.code, c.type, c.value, c.min_subtotal, c.active, c.expires, c.max_uses, parseInt(req.params.id, 10) || 0]); res.json({ ok: true }); }
  catch (e) { if (e.code === '23505') { return bad(res, 'That code already exists.'); } throw e; }
}));
r.delete('/coupons/:id', wrap(async (req, res) => { await q('DELETE FROM coupons WHERE id=$1', [parseInt(req.params.id, 10) || 0]); res.json({ ok: true }); }));

module.exports = r;
