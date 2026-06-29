/**
 * GET /api/admin/migrate2 — Adds agreements table + twitter_handle/followers to kols.
 * Also auto-creates a pending agreement record for any KOL that doesn't have one yet.
 * Safe to re-run.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const json = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ ok: false, error: 'Unauthorized' }, 401);

  await sql`ALTER TABLE kols ADD COLUMN IF NOT EXISTS twitter_handle TEXT`;
  await sql`ALTER TABLE kols ADD COLUMN IF NOT EXISTS followers_count INTEGER`;

  await sql`
    CREATE TABLE IF NOT EXISTS agreements (
      id               SERIAL PRIMARY KEY,
      kol_id           INTEGER     NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
      agreement_token  TEXT        NOT NULL UNIQUE,
      status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed')),
      signed_at        TIMESTAMPTZ,
      signer_name      TEXT,
      signer_email     TEXT,
      signer_ip        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS agreements_kol_id_idx ON agreements(kol_id)`;

  // Backfill any existing KOLs that don't have an agreement yet
  const kols = await sql`SELECT id FROM kols WHERE id NOT IN (SELECT kol_id FROM agreements)`;
  for (const k of kols) {
    await sql`
      INSERT INTO agreements (kol_id, agreement_token)
      VALUES (${k.id}, ${crypto.randomUUID()})
      ON CONFLICT DO NOTHING
    `;
  }

  return json({ ok: true, backfilled: kols.length });
}
