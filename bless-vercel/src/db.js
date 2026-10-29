'use strict';
const pg = require('pg');
const { Pool } = pg;
pg.types.setTypeParser(1082, (v) => v); // keep DATE columns as plain YYYY-MM-DD strings

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (example: postgres://user:pass@host:5432/bless)'); process.exit(1); }
/* Managed hosts (Neon, Render, Railway…) hand out URLs like ...?sslmode=require&channel_binding=require.
   node-postgres does not support those query options, so they are removed and SSL is switched on instead. */
let connectionString = url, ssl;
try {
  const u = new URL(url);
  const off = u.searchParams.get('sslmode') === 'disable';
  if (!off && (u.searchParams.has('sslmode') || u.searchParams.has('channel_binding') || /\.(neon\.tech|render\.com|railway\.app|supabase\.co)$/.test(u.hostname))) { ssl = { rejectUnauthorized: false }; }
  ['sslmode', 'channel_binding', 'sslcert', 'sslkey', 'sslrootcert'].forEach((k) => u.searchParams.delete(k));
  connectionString = u.toString();
} catch (e) { console.error('DATABASE_URL does not look like a valid address.'); process.exit(1); }
if (process.env.PGSSL === '1') { ssl = { rejectUnauthorized: false }; }
const pool = new Pool({ connectionString, ssl, max: 3 });
pool.on('error', (e) => console.error('pg pool error', e.message));

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ } throw e; }
  finally { c.release(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
  type text NOT NULL DEFAULT 'product', parent text NOT NULL DEFAULT '', image text NOT NULL DEFAULT '', sort int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, short text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
  base_price numeric(12,2) NOT NULL DEFAULT 0, regular_price numeric(12,2), on_sale boolean NOT NULL DEFAULT false,
  availability text NOT NULL DEFAULT 'made_to_order', images jsonb NOT NULL DEFAULT '[]', attributes jsonb NOT NULL DEFAULT '{}',
  variations jsonb NOT NULL DEFAULT '[]', options jsonb NOT NULL DEFAULT '[]', cats jsonb NOT NULL DEFAULT '[]',
  featured boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS carts (session_id text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS coupons (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, type text NOT NULL DEFAULT 'percent', value numeric(12,2) NOT NULL DEFAULT 0,
  min_subtotal numeric(12,2) NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, expires date, max_uses int, uses int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS files (id serial PRIMARY KEY, key text UNIQUE NOT NULL, mime text NOT NULL, data bytea NOT NULL, kind text NOT NULL DEFAULT 'admin', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY, key text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'pending', payment_status text NOT NULL DEFAULT 'unpaid',
  customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT '', recipient_phone text NOT NULL DEFAULT '',
  delivery_method text NOT NULL DEFAULT 'delivery', delivery_address text NOT NULL DEFAULT '', delivery_city text NOT NULL DEFAULT '',
  delivery_date date NOT NULL, delivery_time text NOT NULL DEFAULT '', gift_message text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  payment_method text NOT NULL, payment_reference text NOT NULL DEFAULT '', video_whatsapp text NOT NULL DEFAULT '',
  coupon_code text NOT NULL DEFAULT '', items jsonb NOT NULL DEFAULT '[]',
  subtotal numeric(12,2) NOT NULL, discount numeric(12,2) NOT NULL DEFAULT 0, delivery_fee numeric(12,2) NOT NULL DEFAULT 0, total numeric(12,2) NOT NULL,
  admin_note text NOT NULL DEFAULT '', history jsonb NOT NULL DEFAULT '[]', seen boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_phone ON orders (customer_phone);
CREATE INDEX IF NOT EXISTS products_cats ON products USING gin (cats);
`;

async function migrate() {
  await q(SCHEMA);
  // Order numbers start at 1001 so they look like real shop numbers.
  await q("SELECT setval(pg_get_serial_sequence('orders','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM orders), 1000))");
}

async function getSetting(key, dflt) {
  const r = await q('SELECT value FROM settings WHERE key=$1', [key]);
  return r.rows.length ? r.rows[0].value : dflt;
}
async function setSetting(key, value, c) {
  await (c || pool).query('INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);
}

module.exports = { pool, q, tx, migrate, getSetting, setSetting };
