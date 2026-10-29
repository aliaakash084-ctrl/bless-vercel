'use strict';
const crypto = require('crypto');

const m2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const lc = (s) => String(s == null ? '' : s).toLowerCase();
const rand = (bytes) => crypto.randomBytes(bytes).toString('hex');

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'; }

/* Karachi calendar helpers (the shop works in Pakistan time whatever the server clock says). */
const TZ = 'Asia/Karachi';
function karachiNow() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10) };
}
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/* Where this server is reached from, used to turn "media:KEY" into a full image URL. */
function baseUrl(req) {
  if (process.env.PUBLIC_URL) { return process.env.PUBLIC_URL.replace(/\/+$/, ''); }
  return `${req.protocol}://${req.get('host')}`;
}
function expand(u, base) {
  const s = String(u || '');
  return s.indexOf('media:') === 0 ? `${base}/media/${s.slice(6)}` : s;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Tiny in-memory rate limiter (per IP + bucket). Enough to blunt form spam and password guessing. */
const hits = new Map();
function limit(bucket, max, windowMs) {
  return (req, res, next) => {
    const k = bucket + '|' + req.ip, now = Date.now(), r = hits.get(k);
    if (!r || now > r.reset) { hits.set(k, { n: 1, reset: now + windowMs }); return next(); }
    if (++r.n > max) { return res.status(429).json({ ok: false, errors: { general: 'Too many attempts. Please wait a minute and try again.' } }); }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) { if (now > v.reset) { hits.delete(k); } } }, 60000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { m2, lc, rand, slugify, karachiNow, addDays, baseUrl, expand, esc, limit, wrap, crypto };
