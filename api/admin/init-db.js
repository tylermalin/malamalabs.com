/**
 * GET /api/admin/init-db — Creates all KOL referral tables. Run once after setup.
 *
 * Safe to re-run (uses IF NOT EXISTS). Does not drop or alter existing data.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * Requires: DATABASE_URL, ADMIN_SECRET
 */
export const config = { runtime: 'edge' };

import { sql } from '../../lib/db.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  // Neon HTTP driver executes one statement per call, so run them sequentially
  await sql`
    CREATE TABLE IF NOT EXISTS kols (
      id               SERIAL PRIMARY KEY,
      name             TEXT        NOT NULL,
      email            TEXT        NOT NULL UNIQUE,
      commission_pct   NUMERIC(5,2) NOT NULL DEFAULT 10.00,
      payment_details  TEXT,
      active           BOOLEAN     NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ref_links (
      id         SERIAL PRIMARY KEY,
      code       TEXT    NOT NULL UNIQUE,
      kol_id     INTEGER NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
      target_url TEXT    NOT NULL DEFAULT 'https://malamalabs.com/platform/',
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clicks (
      id         SERIAL PRIMARY KEY,
      ref_code   TEXT NOT NULL,
      ip         TEXT,
      user_agent TEXT,
      referrer   TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS clicks_ref_code_idx ON clicks(ref_code)`;

  await sql`
    CREATE TABLE IF NOT EXISTS conversions (
      id             SERIAL PRIMARY KEY,
      ref_code       TEXT          NOT NULL,
      order_id       TEXT          NOT NULL UNIQUE,
      payment_type   TEXT          NOT NULL CHECK (payment_type IN ('crypto','stripe')),
      amount_usd     NUMERIC(10,2) NOT NULL,
      commission_pct NUMERIC(5,2)  NOT NULL,
      commission_usd NUMERIC(10,2) NOT NULL,
      settled        BOOLEAN       NOT NULL DEFAULT false,
      settled_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS conversions_ref_code_idx ON conversions(ref_code)`;
  await sql`CREATE INDEX IF NOT EXISTS conversions_settled_idx ON conversions(settled)`;
  await sql`CREATE INDEX IF NOT EXISTS conversions_created_at_idx ON conversions(created_at)`;

  return json({ ok: true, message: 'All KOL referral tables created (or already exist).' });
}
