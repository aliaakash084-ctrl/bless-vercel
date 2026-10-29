'use strict';
/* Public API used by the app. Paths and response shapes match what js/api.js expects. */
const express = require('express');
const multer = require('multer');
const { q, tx } = require('./db');
const { m2, lc, rand, baseUrl, expand, karachiNow, limit, wrap } = require('./util');
const P = require('./pricing');
const S = require('./settings');

const r = express.Router();
const SID = /^[A-Za-z0-9_-]{16,64}$/;
const sid = (req) => { const v = req.get('X-Bless-Session') || ''; return SID.test(v) ? v : ''; };
const strip = (p) => { const { _raw, ...x } = p; return x; };
const emptyCart = () => ({ items: {}, coupon: '', method: 'delivery' });

async function loadCart(id) {
  if (!id) { return emptyCart(); }
  const x = await q('SELECT data FROM carts WHERE session_id=$1', [id]);
  return x.rows.length ? { ...emptyCart(), ...x.rows[0].data } : emptyCart();
}
async function saveCart(id, data) {
  await q('INSERT INTO carts(session_id,data,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT (session_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()', [id, JSON.stringify(data)]);
}
const needSession = (req, res, next) => { if (!sid(req)) { return res.status(400).json({ ok: false, errors: [{ field: 'cart', message: 'Your session could not be started. Please reload the app.' }] }); } next(); };

r.get('/session', (req, res) => res.json({ nonce: 'ok' }));

r.get('/app/config', wrap(async (req, res) => res.json(await S.buildConfig(baseUrl(req)))));

/* ---------- catalogue ---------- */
r.get('/app/products', wrap(async (req, res) => {
  const base = baseUrl(req), p = req.query, cats = await S.categoriesList();
  let rows = (await q('SELECT * FROM products WHERE active ORDER BY sort, id DESC')).rows;
  if (p.cat) {
    const want = new Set([String(p.cat)]);
    cats.rows.forEach((c) => { let x = c, n = 0; while (x && x.parent && n++ < 5) { if (x.parent === p.cat) { want.add(c.slug); break; } x = cats.by[x.parent]; } });
    rows = rows.filter((x) => (x.cats || []).some((c) => want.has(c)));
  }
  if (p.featured) { rows = rows.filter((x) => x.featured); }
  if (p.q) { const t = lc(p.q).trim(); rows = rows.filter((x) => (lc(x.name) + ' ' + lc(x.short)).indexOf(t) > -1); }
  const price = (x) => P.priceInfo(x).from;
  const sorts = { newest: (a, b) => b.id - a.id, price_asc: (a, b) => price(a) - price(b), price_desc: (a, b) => price(b) - price(a), name: (a, b) => a.name.localeCompare(b.name) };
  if (sorts[p.orderby]) { rows = rows.slice().sort(sorts[p.orderby]); }
  const per = Math.max(1, Math.min(48, parseInt(p.per_page, 10) || 20)), page = Math.max(1, parseInt(p.page, 10) || 1);
  res.json({ items: rows.slice((page - 1) * per, page * per).map((x) => P.listItem(x, base)), total: rows.length, pages: Math.ceil(rows.length / per), page });
}));

r.get('/app/products/:slug', wrap(async (req, res) => {
  const x = await q('SELECT * FROM products WHERE slug=$1 AND active', [req.params.slug]);
  if (!x.rows.length) { return res.status(404).json({ error: 'not_found' }); }
  res.json(P.detail(x.rows[0], baseUrl(req)));
}));

r.post('/quote', wrap(async (req, res) => res.json(await P.quote(req.body || {}))));

/* ---------- cart ---------- */
r.get('/cart', wrap(async (req, res) => res.json(strip(await P.cartPayload(await loadCart(sid(req)), baseUrl(req), true)))));

async function reply(req, res, state, ok, status, errors) {
  const id = sid(req);
  if (ok) { await saveCart(id, state); }
  res.status(status).json(strip(await P.cartPayload(ok ? state : await loadCart(id), baseUrl(req), ok, errors)));
}

r.post('/cart/add', needSession, wrap(async (req, res) => {
  const b = req.body || {}, qd = await P.quote(b);
  if (!qd.ok) { return reply(req, res, null, false, 422, qd.errors); }
  const s = await loadCart(sid(req)), nb = { product_id: Number(b.product_id), attributes: qd.variation ? qd.variation.attributes : {}, options: {} };
  qd.lines.forEach((x) => { nb.options[x.key] = x.value; });
  const id = P.lineId(nb);
  if (s.items[id]) { s.items[id].qty = Math.min(P.MAX_QTY, s.items[id].qty + qd.qty); } else { nb.qty = qd.qty; s.items[id] = nb; }
  if (Object.keys(s.items).length > 40) { return reply(req, res, null, false, 422, [{ field: 'cart', message: 'Your cart is full.' }]); }
  reply(req, res, s, true, 200);
}));
r.post('/cart/update', needSession, wrap(async (req, res) => {
  const s = await loadCart(sid(req)), b = req.body || {};
  if (!s.items[b.line_id]) { return reply(req, res, null, false, 422, [{ field: 'cart', message: 'That item is no longer in your cart.' }]); }
  s.items[b.line_id].qty = Math.max(1, Math.min(P.MAX_QTY, parseInt(b.qty, 10) || 1));
  reply(req, res, s, true, 200);
}));
r.post('/cart/remove', needSession, wrap(async (req, res) => { const s = await loadCart(sid(req)); delete s.items[(req.body || {}).line_id]; reply(req, res, s, true, 200); }));
r.post('/cart/coupon', needSession, wrap(async (req, res) => {
  const s = await loadCart(sid(req)), code = String((req.body || {}).code || '').trim().slice(0, 40);
  if (code) {
    const pay = await P.cartPayload({ ...s, coupon: code }, baseUrl(req), true);
    if (pay.coupon_error) { return reply(req, res, null, false, 422, [{ field: 'coupon', message: pay.coupon_error }]); }
  }
  s.coupon = code; reply(req, res, s, true, 200);
}));
r.post('/cart/delivery', needSession, wrap(async (req, res) => {
  const s = await loadCart(sid(req)), cfg = await S.all();
  s.method = (req.body || {}).method === 'pickup' && cfg.delivery.pickup_enabled ? 'pickup' : 'delivery'; reply(req, res, s, true, 200);
}));
r.post('/cart/video', needSession, wrap(async (req, res) => {
  const s = await loadCart(sid(req)), b = req.body || {};
  if (!b.video_approval) { delete s.video; return reply(req, res, s, true, 200); }
  const d = String(b.video_whatsapp || '').replace(/\D+/g, '');
  if (d.length < 10 || d.length > 15) { delete s.video; await saveCart(sid(req), s); return reply(req, res, null, false, 422, [{ field: 'video_whatsapp', message: 'Please enter a valid WhatsApp number (for example 0300 1234567).' }]); }
  s.video = String(b.video_whatsapp).trim().slice(0, 30); reply(req, res, s, true, 200);
}));

/* ---------- customer photo upload (for "photo cake" style options) ---------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
function imageMime(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) { return 'image/jpeg'; }
  if (buf.length > 8 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') { return 'image/png'; }
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') { return 'image/webp'; }
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString())) { return 'image/gif'; }
  return '';
}
r.post('/upload', limit('upload', 20, 60000), needSession, upload.single('file'), wrap(async (req, res) => {
  const mime = req.file ? imageMime(req.file.buffer) : '';
  if (!mime) { return res.status(422).json({ ok: false, errors: [{ field: 'file', message: 'Please choose a JPG, PNG or WebP photo (up to 4 MB).' }] }); }
  const key = rand(12), x = await q('INSERT INTO files(key,mime,data,kind) VALUES($1,$2,$3,$4) RETURNING id', [key, mime, req.file.buffer, 'customer']);
  res.json({ id: x.rows[0].id, thumb: '' });
}));
r.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') { return res.status(422).json({ ok: false, errors: [{ field: 'file', message: 'That photo is too large (4 MB maximum).' }] }); }
  next(err);
});

/* ---------- checkout ---------- */
r.post('/checkout', limit('checkout', 12, 60000), needSession, wrap(async (req, res) => {
  const b = req.body || {}, base = baseUrl(req), cfgAll = await S.all();
  if (b.website) { return res.status(201).json({ ok: true, redirect: '' }); } // honeypot: bots fill hidden fields
  const state = await loadCart(sid(req)), c = await P.cartPayload(state, base, true);
  const fail = (code, errors) => res.status(code).json({ ok: false, errors });
  if (!c.lines.length) { return fail(409, { cart: 'Your cart is empty.' }); }
  if (!c.valid) { return fail(409, { cart: 'Some items in your cart need attention: ' + c.issues.join(' ') }); }
  const e = {}, pickup = state.method === 'pickup';
  const str = (k, n) => String(b[k] == null ? '' : b[k]).trim().slice(0, n);
  if (str('customer_name', 100).length < 2) { e.customer_name = 'Please enter your name.'; }
  const digits = str('customer_phone', 30).replace(/\D+/g, '');
  if (digits.length < 10 || digits.length > 15) { e.customer_phone = 'Please enter a valid phone number (for example 0300 1234567).'; }
  if (str('customer_email', 120) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str('customer_email', 120))) { e.customer_email = 'That email address does not look right.'; }
  if (!pickup) {
    if (str('delivery_address', 500).length < 8) { e.delivery_address = 'Please enter the full delivery address.'; }
    const city = str('delivery_city', 80);
    if (!city) { e.delivery_city = 'Please enter the city.'; }
    else if (cfgAll.delivery.cities.length && cfgAll.delivery.cities.indexOf(city) < 0) { e.delivery_city = 'We do not deliver to that city yet.'; }
  }
  if (c.video_approval && !state.video) { e.general = 'You asked for video approval but no valid WhatsApp number is saved. Please go back to the cart and enter it.'; }
  const w = S.dateWindow(cfgAll.delivery), label = pickup ? 'pickup' : 'delivery', date = str('delivery_date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { e.delivery_date = `Please choose a ${label} date.`; }
  else if (date < w.min) { e.delivery_date = `The earliest ${label} date is ${w.min}.`; }
  else if (date > w.max) { e.delivery_date = 'Please choose a date within the next ' + (Number(cfgAll.delivery.max_days) || 60) + ' days.'; }
  const slot = str('delivery_time', 40);
  if (cfgAll.delivery.slots.length && cfgAll.delivery.slots.indexOf(slot) < 0) { e.delivery_time = 'Please choose a time slot.'; }
  const gw = cfgAll.gateways.find((g) => g.enabled && g.id === b.payment_method);
  if (!gw) { e.payment_method = 'Please choose a payment method.'; }
  if (Object.keys(e).length) { return fail(422, e); }

  const items = c._raw.lines.map((l) => ({ name: l.name, product_id: l._pid, qty: l.qty, unit_price: l.unit_price, line_total: l.line_total, image: l.image,
    variation: l.variation, options: l._qd.lines.map((x) => ({ key: x.key, label: x.label, type: x.type, value: x.value, price: x.price })) }));
  const key = rand(16);
  const order = await tx(async (cx) => {
    if (c.coupon_code) {
      const u = await cx.query('UPDATE coupons SET uses = uses + 1 WHERE lower(code)=lower($1) AND (max_uses IS NULL OR uses < max_uses) RETURNING id', [c.coupon_code]);
      if (!u.rows.length) { throw Object.assign(new Error('coupon'), { coupon: true }); }
    }
    const ins = await cx.query(
      `INSERT INTO orders(key,customer_name,customer_phone,customer_email,recipient_name,recipient_phone,delivery_method,delivery_address,delivery_city,delivery_date,delivery_time,
        gift_message,notes,payment_method,payment_reference,video_whatsapp,coupon_code,items,subtotal,discount,delivery_fee,total,history)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23::jsonb) RETURNING id`,
      [key, str('customer_name', 100), str('customer_phone', 30), str('customer_email', 120), pickup ? '' : str('recipient_name', 100), pickup ? '' : str('recipient_phone', 30),
        pickup ? 'pickup' : 'delivery', pickup ? '' : str('delivery_address', 500), pickup ? '' : str('delivery_city', 80), date, slot, str('gift_message', 300), str('order_notes', 500),
        gw.id, gw.reference ? str('payment_reference', 100) : '', c.video_approval ? state.video : '', c.coupon_code, JSON.stringify(items), c.subtotal, c.discount, c.delivery_fee, c.total,
        JSON.stringify([{ at: new Date().toISOString(), status: 'pending', note: 'Order placed' }])]);
    await cx.query('DELETE FROM carts WHERE session_id=$1', [sid(req)]);
    return ins.rows[0];
  }).catch((err) => { if (err.coupon) { return null; } throw err; });
  if (!order) { return fail(409, { cart: 'The discount code you used has just been fully used. Please remove it and try again.' }); }
  res.status(201).json({ ok: true, order_number: order.id, redirect: `${base}/order/${key}` });
}));

r.get('/orders/:key', wrap(async (req, res) => {
  const x = await q('SELECT * FROM orders WHERE key=$1', [req.params.key]);
  if (!x.rows.length) { return res.status(404).json({ error: 'not_found' }); }
  const o = x.rows[0]; res.json({ number: o.id, status: o.status, payment_status: o.payment_status, total: m2(o.total), delivery_date: o.delivery_date, history: o.history });
}));

module.exports = r;
