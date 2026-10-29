'use strict';
/* Vercel entry point: the same Express app, started lazily on the first request of each function instance. */
const { app } = require('../src/index');
let ready = null;
function boot() {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 8) { throw new Error('Set ADMIN_PASSWORD (at least 8 characters) in the Vercel project settings.'); }
  if (!process.env.DATABASE_URL) { throw new Error('Set DATABASE_URL in the Vercel project settings.'); }
  const { migrate } = require('../src/db'), { seedIfEmpty } = require('../src/seed');
  return migrate().then(seedIfEmpty);
}
module.exports = async (req, res) => {
  try {
    if (!ready) { ready = Promise.resolve().then(boot).catch((e) => { ready = null; throw e; }); }
    await ready;
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.setHeader('Content-Type', 'text/plain');
    return res.end('The shop could not start: ' + e.message);
  }
  return app(req, res);
};
