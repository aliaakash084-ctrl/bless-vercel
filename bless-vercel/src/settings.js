'use strict';
const { q, getSetting } = require('./db');
const { karachiNow, addDays, expand, m2 } = require('./util');

const DEFAULTS = {
  shop: { name: 'BLESS Pakistan', phone: '', whatsapp: '', email: '', address: '' },
  general: { currency: 'Rs.', currency_code: 'PKR', hero_autoplay_ms: 6000, logo: '' },
  delivery: { fee: 250, free_over: 5000, pickup_enabled: true, cities: ['Karachi', 'Hyderabad', 'Nawabshah'], slots: ['10am - 1pm', '1pm - 4pm', '4pm - 7pm', '7pm - 10pm'], same_day: false, cutoff_hour: 12, lead_days: 1, max_days: 60 },
  gateways: [
    { id: 'cod', title: 'Cash on delivery', description: 'Pay in cash when your order arrives.', reference: false, enabled: true },
    { id: 'bank', title: 'Bank transfer', description: 'Transfer to: [Bank name] · Account title: [title] · IBAN: [IBAN]. Your order is confirmed once we see the payment.', reference: true, enabled: true },
    { id: 'jazzcash', title: 'JazzCash', description: 'Send the total to JazzCash number [03XX XXXXXXX] (account name: [name]). Your order is confirmed once we see the payment.', reference: true, enabled: false },
    { id: 'easypaisa', title: 'Easypaisa', description: 'Send the total to Easypaisa number [03XX XXXXXXX] (account name: [name]). Your order is confirmed once we see the payment.', reference: true, enabled: false }
  ],
  hero: []
};

async function all() {
  const r = await q('SELECT key, value FROM settings');
  const o = {}; r.rows.forEach((x) => { o[x.key] = x.value; });
  return {
    shop: { ...DEFAULTS.shop, ...(o.shop || {}) },
    general: { ...DEFAULTS.general, ...(o.general || {}) },
    delivery: { ...DEFAULTS.delivery, ...(o.delivery || {}) },
    gateways: o.gateways || DEFAULTS.gateways,
    hero: o.hero || DEFAULTS.hero
  };
}

function dateWindow(d) {
  const now = karachiNow();
  const same = d.same_day && now.hour < Number(d.cutoff_hour);
  const min = same ? now.ymd : addDays(now.ymd, Math.max(1, Number(d.lead_days) || 1));
  return { min, max: addDays(now.ymd, Math.max(1, Number(d.max_days) || 60)) };
}

async function categoriesList() {
  const r = await q('SELECT id, slug, name, type, parent, image, sort FROM categories ORDER BY sort, id');
  const by = {}; r.rows.forEach((c) => { by[c.slug] = c; });
  return { rows: r.rows, by };
}

async function buildConfig(base) {
  const s = await all(), cats = await categoriesList(), w = dateWindow(s.delivery);
  const depth = (c) => { let n = 0, p = c; while (p.parent && by_(p.parent) && n < 5) { p = by_(p.parent); n++; } return n; };
  const by_ = (slug) => cats.by[slug];
  return {
    currency: s.general.currency, currency_code: s.general.currency_code,
    cities: s.delivery.cities, slots: s.delivery.slots, min: w.min, max: w.max,
    pickup_enabled: !!s.delivery.pickup_enabled, delivery_fee: m2(s.delivery.fee), free_delivery_over: m2(s.delivery.free_over),
    gateways: s.gateways.filter((g) => g.enabled).map((g) => ({ id: g.id, title: g.title, description: g.description, reference: !!g.reference })),
    categories: cats.rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, type: c.type, parent: c.parent, depth: depth(c), image: expand(c.image, base) })),
    hero: s.hero.filter((h) => h.image).map((h) => ({ title: h.title || '', subtitle: h.subtitle || '', image: expand(h.image, base), link: h.link || '', cta: h.cta || '' })),
    hero_autoplay_ms: Number(s.general.hero_autoplay_ms) || 6000,
    shop: s.shop, site_url: base + '/', logo: expand(s.general.logo, base)
  };
}

module.exports = { DEFAULTS, all, dateWindow, buildConfig, categoriesList };
