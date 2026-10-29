'use strict';
/* Price a product configuration and build the cart payload. Same rules as the app's demo engine,
   but run on the server so a customer can never change a price from the phone. */
const { q } = require('./db');
const { m2, lc, crypto, expand } = require('./util');
const S = require('./settings');

const MAX_QTY = 20, MAX_TEXT = 120, MAX_TEXTAREA = 500;

function priceInfo(p) {
  const prices = (p.variations || []).map((v) => Number(v.price)).filter((n) => !isNaN(n));
  const from = prices.length ? Math.min(...prices) : Number(p.base_price);
  return { from, range: prices.length > 0 && Math.max(...prices) !== Math.min(...prices) };
}
function listItem(p, base) {
  const pi = priceInfo(p), onSale = p.on_sale && p.regular_price && Number(p.regular_price) > pi.from;
  return { id: p.id, slug: p.slug, name: p.name, short: p.short, image: expand((p.images || [])[0], base), price_from: m2(pi.from), was_price: onSale ? m2(p.regular_price) : '', has_range: pi.range, sold_out: p.availability === 'out_of_stock', availability: p.availability };
}
function detail(p, base) {
  return {
    id: p.id, slug: p.slug, name: p.name, short: p.short, description: p.description, base_price: m2(p.base_price), regular_price: m2(p.regular_price || p.base_price),
    on_sale: !!p.on_sale, availability: p.availability, images: (p.images || []).map((u) => expand(u, base)), attributes: p.attributes || {},
    variations: (p.variations || []).map((v) => ({ attributes: v.attributes || {}, price: m2(v.price), image: expand(v.image || '', base), in_stock: v.in_stock !== false })),
    options: (p.options || []).map((o) => ({ key: o.key, label: o.label, type: o.type, required: !!o.required, extra: m2(o.extra || 0), max: Number(o.max) || 0, choices: (o.choices || []).map((c) => ({ value: c.value, label: c.label, extra: m2(c.extra || 0) })) }))
  };
}

async function loadProduct(id) {
  const r = await q('SELECT * FROM products WHERE id=$1 AND active', [Number(id) || 0]);
  return r.rows[0] || null;
}

/* Returns the quote for one cart line. `d` is a products row. */
function quoteFor(d, b) {
  const errors = [];
  const fail = (f, m) => errors.push({ field: f, message: m });
  if (!d) { return { ok: false, errors: [{ field: 'product', message: 'This product is not available.' }], product_id: 0 }; }
  if (d.availability === 'out_of_stock') { fail('product', 'This product is currently out of stock.'); }
  let qty = parseInt(b.qty, 10) || 1;
  if (qty < 1) { qty = 1; }
  if (qty > MAX_QTY) { fail('qty', `You can order up to ${MAX_QTY} of this item at a time.`); qty = MAX_QTY; }

  let base = Number(d.base_price), variation = null;
  const attrs = b.attributes && typeof b.attributes === 'object' ? b.attributes : {};
  const vars = d.variations || [];
  if (vars.length) {
    const names = Object.keys(d.attributes || {}), missing = names.filter((n) => !attrs[n] || !String(attrs[n]).trim());
    if (missing.length) { fail('variation', `Please choose: ${missing.join(', ')}.`); } else {
      const hit = vars.find((v) => names.every((n) => lc((v.attributes || {})[n]) === lc(attrs[n])));
      if (!hit) { fail('variation', 'That combination is not available.'); }
      else if (hit.in_stock === false) { fail('qty', 'This choice is out of stock.'); }
      else { variation = hit; base = Number(hit.price); }
    }
  }
  const given = b.options && typeof b.options === 'object' ? b.options : {}, lines = [];
  let extra = 0;
  (d.options || []).forEach((o) => {
    const raw = given[o.key] == null ? '' : given[o.key];
    let shown = '', add = 0;
    const ex = Number(o.extra) || 0;
    if (o.type === 'select' || o.type === 'radio') {
      const lab = String(raw).trim();
      if (lab) { const c = (o.choices || []).find((x) => lc(x.label) === lc(lab) || lc(x.value) === lc(lab)); if (!c) { fail(o.key, `Please choose a valid ${o.label}.`); } else { shown = c.label; add = Number(c.extra) || 0; } }
    } else if (o.type === 'checkbox') {
      if (raw && ['0', 'false', 'no'].indexOf(lc(raw)) < 0) { shown = 'Yes'; add = ex; }
    } else if (o.type === 'text' || o.type === 'textarea') {
      let t = String(raw).trim(); const limit = o.type === 'text' ? MAX_TEXT : MAX_TEXTAREA;
      if (t.length > limit) { fail(o.key, `${o.label} must be ${limit} characters or fewer.`); t = t.slice(0, limit); }
      if (t) { shown = t; add = ex; }
    } else if (o.type === 'color') {
      const hx = lc(raw).trim();
      if (hx) { if (!/^#[0-9a-f]{6}$/.test(hx)) { fail(o.key, `Please choose a valid colour for ${o.label}.`); } else { shown = hx; add = ex; } }
    } else if (o.type === 'image_upload') {
      const id = parseInt(raw, 10); if (id > 0) { shown = String(id); add = ex; }
    }
    if (!shown && o.required && !errors.some((e) => e.field === o.key)) { fail(o.key, `${o.label} is required.`); }
    if (shown) { extra += add; lines.push({ key: o.key, label: o.label, type: o.type, value: shown, price: m2(add) }); }
  });
  const unit = base + extra;
  return { ok: !errors.length, errors, product_id: d.id, qty, variation: variation ? { attributes: variation.attributes } : null, base_price: m2(base), options_total: m2(extra), unit_price: m2(unit), line_total: m2(unit * qty), lines };
}

async function quote(b) { return quoteFor(await loadProduct(b.product_id), b); }

function lineId(b) {
  return 'l' + crypto.createHash('sha1').update(JSON.stringify([Number(b.product_id), b.attributes, b.options])).digest('hex').slice(0, 12);
}

async function findCoupon(code) {
  const r = await q('SELECT * FROM coupons WHERE lower(code)=lower($1)', [String(code || '').trim()]);
  return r.rows[0] || null;
}
function couponCheck(c, subtotal, todayYmd) {
  if (!c || !c.active) { return 'That discount code is not valid.'; }
  if (c.expires && String(c.expires.toISOString ? c.expires.toISOString().slice(0, 10) : c.expires) < todayYmd) { return 'That discount code has expired.'; }
  if (c.max_uses != null && c.uses >= c.max_uses) { return 'That discount code has been fully used.'; }
  if (Number(c.min_subtotal) > subtotal) { return `This code needs a minimum order of ${m2(c.min_subtotal)}.`; }
  return '';
}

/* Build the full cart payload from the stored session cart. */
async function cartPayload(state, base, ok, errors) {
  const cfg = await S.all(), d = cfg.delivery;
  const s = state || {}, items = s.items || {}, lines = [], issues = [];
  let subtotal = 0, count = 0, valid = true;
  const ids = Object.keys(items), prodIds = [...new Set(ids.map((i) => items[i].product_id))];
  const prods = {};
  if (prodIds.length) { (await q('SELECT * FROM products WHERE id = ANY($1::int[]) AND active', [prodIds])).rows.forEach((p) => { prods[p.id] = p; }); }
  for (const id of ids) {
    const l = items[id], p = prods[l.product_id];
    if (!p) { valid = false; issues.push('An item in your cart is no longer available.'); lines.push({ id, name: 'Unavailable item', url: '', image: '', qty: l.qty, ok: false, error: 'This item is no longer available.', variation: {}, options: [], unit_price: '0.00', line_total: '0.00', price_changed: false, was_price: '0.00' }); continue; }
    const qd = quoteFor(p, l);
    if (qd.ok) { subtotal += Number(qd.line_total); } else { valid = false; issues.push(qd.errors[0].message); }
    count += qd.qty;
    lines.push({ id, name: p.name, url: `${base}/product/${p.slug}/`, image: expand((p.images || [])[0], base), qty: qd.qty, ok: qd.ok, error: qd.ok ? '' : qd.errors[0].message,
      variation: qd.variation ? qd.variation.attributes : {}, options: qd.lines.map((x) => ({ label: x.label, type: x.type, value: x.type === 'image_upload' ? 'Photo uploaded' : x.value, price: x.price })),
      unit_price: qd.unit_price, line_total: qd.line_total, price_changed: false, was_price: qd.unit_price, _qd: qd, _pid: p.id });
  }
  let discount = 0, couponErr = '', couponCode = '';
  if (s.coupon) {
    const c = await findCoupon(s.coupon);
    couponErr = couponCheck(c, subtotal, require('./util').karachiNow().ymd);
    if (!couponErr) { couponCode = c.code; discount = c.type === 'fixed' ? Math.min(Number(c.value), subtotal) : Math.round(subtotal * Number(c.value)) / 100; }
  }
  const net = subtotal - discount, pickup = s.method === 'pickup';
  let fee = 0, gap = 0; const perFee = Number(d.fee) || 0, free = Number(d.free_over) || 0;
  if (!pickup && lines.length) { fee = free > 0 && net >= free ? 0 : perFee; if (fee > 0 && free > 0) { gap = free - net; } }
  return {
    ok: !!ok, errors: errors || [], video_approval: s.video ? 1 : 0, video_whatsapp: s.video || '', lines: lines.map(({ _qd, _pid, ...x }) => x), count, valid: valid && lines.length > 0, issues,
    subtotal: m2(subtotal), discount: m2(discount), delivery_fee: m2(fee), total: m2(net + fee), coupon_code: couponCode, coupon_error: couponErr,
    delivery_method: pickup ? 'pickup' : 'delivery', free_delivery_gap: m2(Math.max(0, gap)), pickup_enabled: !!d.pickup_enabled, currency: cfg.general.currency,
    _raw: { lines, subtotal, discount, fee, net }
  };
}

module.exports = { MAX_QTY, listItem, detail, loadProduct, quote, quoteFor, lineId, cartPayload, findCoupon, couponCheck, priceInfo };
