'use strict';
const path = require('path');
const express = require('express');
const { migrate, pool } = require('./db');
const { seedIfEmpty } = require('./seed');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  if (req.path.indexOf('/admin') === 0) { res.set({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' }); }
  next();
});

/* The app calls this API from its own address or from inside the installed phone app, so allow any origin.
   Nothing here relies on cookies (carts use a random token in a header), so this does not expose anyone's cart. */
app.use(['/api', '/admin/api'], (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Bless-Session, X-Bless-Nonce, Authorization', 'Access-Control-Max-Age': '86400' });
  if (req.method === 'OPTIONS') { return res.sendStatus(204); }
  next();
});

app.use('/api/v1', express.json({ limit: '100kb' }), require('./shop'));
app.use('/admin/api', express.json({ limit: '2mb' }), require('./admin'));
app.use(require('./pages'));

app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.get('/product/:slug', (req, res) => res.redirect('/#/product/' + encodeURIComponent(req.params.slug)));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, p) => { if (/\.(html|webmanifest)$|sw\.js$|config\.js$/.test(p)) { res.set('Cache-Control', 'no-cache'); } else if (/\/assets\//.test(p)) { res.set('Cache-Control', 'public, max-age=86400'); } }
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) { return res.status(400).json({ ok: false, errors: [{ field: 'general', message: 'Bad request.' }] }); }
  console.error(err);
  res.status(500).json({ ok: false, errors: { general: 'Something went wrong on our side. Please try again.' } });
});

async function main() {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) { console.error('Set ADMIN_PASSWORD (at least 8 characters). It protects /admin.'); process.exit(1); }
  await migrate();
  await seedIfEmpty();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`BLESS server on :${port}  ·  shop: /  ·  admin: /admin/`));
  // Abandoned carts are not worth keeping for long.
  setInterval(() => pool.query("DELETE FROM carts WHERE updated_at < now() - interval '30 days'").catch(() => {}), 6 * 3600 * 1000).unref();
}
if (require.main === module) { main().catch((e) => { console.error(e); process.exit(1); }); }
module.exports = { app, main };
