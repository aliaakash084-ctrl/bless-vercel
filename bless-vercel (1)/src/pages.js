'use strict';
/* Server-rendered pages: public order status, order lookup, and image files. */
const express = require('express');
const { q } = require('./db');
const { m2, esc, wrap, limit } = require('./util');
const S = require('./settings');

const r = express.Router();
const STATUSES = [['pending', 'Order received'], ['confirmed', 'Confirmed'], ['preparing', 'Being prepared'], ['out_for_delivery', 'On the way'], ['delivered', 'Delivered']];
const LABEL = { pending: 'Order received', confirmed: 'Confirmed', preparing: 'Being prepared', out_for_delivery: 'On the way', ready: 'Ready for pickup', delivered: 'Delivered', cancelled: 'Cancelled' };

function shell(title, body, shop) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
:root{--cream:#F7F3EC;--burgundy:#6F1728;--gold:#C9A66B;--ink:#1E1B19;--line:#E1D6C4;--muted:#6f6560}
*{box-sizing:border-box}body{margin:0;background:#EDE5D8;color:var(--ink);font:15px/1.55 'Helvetica Neue',Arial,sans-serif}
.wrap{max-width:520px;margin:0 auto;min-height:100vh;background:var(--cream)}
header{background:var(--burgundy);color:var(--cream);text-align:center;padding:16px;border-bottom:2px solid var(--gold);font:600 22px Georgia,serif;letter-spacing:.08em}
main{padding:20px 18px 40px}h1{font:600 28px Georgia,serif;color:var(--burgundy);margin:0 0 4px}h2{font:600 19px Georgia,serif;color:var(--burgundy);margin:26px 0 8px}
.muted{color:var(--muted);font-size:13px}.card{background:#fff;border:1px solid var(--line);padding:14px;margin-top:10px}
.row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
.steps{display:flex;margin:18px 0 4px}.steps div{flex:1;text-align:center;font-size:10.5px;color:var(--muted);position:relative;padding-top:20px}
.steps div:before{content:"";position:absolute;top:0;left:50%;width:14px;height:14px;margin-left:-7px;border-radius:50%;border:2px solid var(--line);background:#fff}
.steps div.on{color:var(--burgundy);font-weight:600}.steps div.on:before{background:var(--gold);border-color:var(--gold)}
.badge{display:inline-block;padding:3px 10px;background:var(--burgundy);color:var(--cream);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.badge.bad{background:#a4161a}input,button{font:inherit;padding:12px;border:1px solid var(--line);width:100%;margin-top:8px;background:#fff}
button{background:var(--burgundy);color:var(--cream);border:0;cursor:pointer;letter-spacing:.1em;text-transform:uppercase}.err{color:#a4161a}
small{display:block;color:var(--muted)}
</style></head><body><div class="wrap"><header>${esc((shop && shop.name) || 'BLESS')}</header><main>${body}</main></div></body></html>`;
}

r.get('/order/:key', wrap(async (req, res) => {
  const x = await q('SELECT * FROM orders WHERE key=$1', [String(req.params.key).slice(0, 40)]), cfg = await S.all();
  if (!x.rows.length) { return res.status(404).send(shell('Order not found', '<h1>Order not found</h1><p class="muted">Please check the link, or use Track order with your mobile number.</p>', cfg.shop)); }
  const o = x.rows[0], cancelled = o.status === 'cancelled', idx = STATUSES.findIndex((s) => s[0] === (o.status === 'ready' ? 'out_for_delivery' : o.status));
  const steps = cancelled ? '' : `<div class="steps">${STATUSES.map((s, i) => `<div class="${i <= idx ? 'on' : ''}">${esc(o.delivery_method === 'pickup' && s[0] === 'out_for_delivery' ? 'Ready' : s[1])}</div>`).join('')}</div>`;
  const gw = cfg.gateways.find((g) => g.id === o.payment_method), pay = gw ? gw.title : o.payment_method;
  const items = o.items.map((i) => `<div class="row"><span>${esc(i.name)} × ${i.qty}${Object.values(i.variation || {}).map((v) => `<small>${esc(v)}</small>`).join('')}${(i.options || []).map((p) => `<small>${esc(p.label)}: ${esc(p.type === 'image_upload' ? 'Photo uploaded' : p.value)}</small>`).join('')}</span><b>${esc(cfg.general.currency)} ${m2(i.line_total)}</b></div>`).join('');
  const unpaidNote = o.payment_status !== 'paid' && gw && gw.reference ? `<div class="card"><b>How to pay</b><p class="muted">${esc(gw.description)}</p>${o.payment_reference ? '' : '<p class="muted">After paying, send your transaction number by WhatsApp so we can confirm quickly.</p>'}</div>` : '';
  const cur = esc(cfg.general.currency);
  res.send(shell(`Order #${o.id}`, `<h1>Order #${o.id}</h1><span class="badge ${cancelled ? 'bad' : ''}">${esc(LABEL[o.status] || o.status)}</span>${steps}
<p class="muted">${o.delivery_method === 'pickup' ? 'Pickup' : 'Delivery'} on <b>${esc(o.delivery_date)}</b>${o.delivery_time ? ', ' + esc(o.delivery_time) : ''}</p>
<h2>Items</h2><div class="card">${items}</div>
<div class="card"><div class="row"><span>Subtotal</span><span>${cur} ${m2(o.subtotal)}</span></div>${Number(o.discount) > 0 ? `<div class="row"><span>Discount${o.coupon_code ? ' (' + esc(o.coupon_code) + ')' : ''}</span><span>− ${cur} ${m2(o.discount)}</span></div>` : ''}<div class="row"><span>${o.delivery_method === 'pickup' ? 'Pickup' : 'Delivery'}</span><span>${Number(o.delivery_fee) > 0 ? cur + ' ' + m2(o.delivery_fee) : 'Free'}</span></div><div class="row"><b>Total</b><b>${cur} ${m2(o.total)}</b></div></div>
<h2>Payment</h2><div class="card"><div class="row"><span>${esc(pay)}</span><span>${o.payment_status === 'paid' ? 'Paid' : 'Not paid yet'}</span></div></div>${unpaidNote}
${o.delivery_method === 'delivery' ? `<h2>Delivering to</h2><div class="card">${esc(o.recipient_name || o.customer_name)}<br>${esc(o.delivery_address)}, ${esc(o.delivery_city)}</div>` : ''}
${cfg.shop.whatsapp ? `<p><a href="https://wa.me/${esc(String(cfg.shop.whatsapp).replace(/\D+/g, ''))}?text=${encodeURIComponent('Hello, about my order #' + o.id)}">Message us on WhatsApp</a></p>` : ''}`, cfg.shop));
}));

r.get(['/track-order', '/track-order/', '/account', '/account/'], wrap(async (req, res) => {
  const cfg = await S.all();
  res.send(shell('Track your order', `<h1>Track your order</h1><p class="muted">Enter the mobile number you ordered with and your order number.</p>
<form method="post" action="/track-order/"><input name="phone" inputmode="tel" placeholder="Mobile number" required><input name="number" inputmode="numeric" placeholder="Order number (e.g. 1001)" required><button>Track</button></form>`, cfg.shop));
}));
r.post('/track-order/', express.urlencoded({ extended: false, limit: '2kb' }), limit('track', 15, 60000), wrap(async (req, res) => {
  const cfg = await S.all(), d = (s) => String(s || '').replace(/\D+/g, '').slice(-10), num = parseInt(req.body.number, 10) || 0;
  const x = await q('SELECT key, customer_phone FROM orders WHERE id=$1', [num]);
  if (x.rows.length && d(x.rows[0].customer_phone) === d(req.body.phone) && d(req.body.phone).length >= 10) { return res.redirect('/order/' + x.rows[0].key); }
  res.status(404).send(shell('Track your order', '<h1>Track your order</h1><p class="err">We could not find an order with those details.</p><p><a href="/track-order/">Try again</a></p>', cfg.shop));
}));

/* Product photos and banners (customer uploads are private and only served to the admin). */
r.get('/media/:key', wrap(async (req, res) => {
  const x = await q("SELECT mime, data FROM files WHERE key=$1 AND kind='admin'", [String(req.params.key).slice(0, 40)]);
  if (!x.rows.length) { return res.sendStatus(404); }
  res.set({ 'Content-Type': x.rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(x.rows[0].data);
}));

module.exports = r;
