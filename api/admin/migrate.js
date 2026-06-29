/**
 * GET /api/admin/migrate — Adds portal_token column to kols and backfills existing rows.
 * Safe to run multiple times (idempotent).
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
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

  await sql`
    ALTER TABLE kols
    ADD COLUMN IF NOT EXISTS portal_token TEXT UNIQUE
  `;

  // Backfill any existing KOLs that don't have a token yet
  const rows = await sql`SELECT id FROM kols WHERE portal_token IS NULL`;
  for (const row of rows) {
    const token = crypto.randomUUID();
    await sql`UPDATE kols SET portal_token = ${token} WHERE id = ${row.id}`;
  }

  return json({ ok: true, backfilled: rows.length });
}
