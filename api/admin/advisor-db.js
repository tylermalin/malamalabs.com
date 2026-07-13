/**
 * GET /api/admin/advisor-db — Creates advisors + advisor_agreements tables.
 * Safe to re-run.
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const json = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return json({ ok: false, error: 'Unauthorized' }, 401);

  await sql`
    CREATE TABLE IF NOT EXISTS advisors (
      id                SERIAL PRIMARY KEY,
      name              TEXT        NOT NULL,
      email             TEXT        NOT NULL,
      address           TEXT,
      shares            BIGINT      NOT NULL DEFAULT 10000000,
      per_share_price   NUMERIC(12,4) NOT NULL DEFAULT 0.0001,
      purchase_price    NUMERIC(12,2) NOT NULL DEFAULT 1000.00,
      vesting_months    INTEGER     NOT NULL DEFAULT 24,
      cliff_months      INTEGER     NOT NULL DEFAULT 0,
      hours_per_month   INTEGER     NOT NULL DEFAULT 5,
      services          TEXT        NOT NULL DEFAULT 'Expert advisory services in business development, partnerships, sales, compliance, strategy',
      exclusive         BOOLEAN     NOT NULL DEFAULT false,
      governing_law     TEXT        NOT NULL DEFAULT 'Delaware',
      dispute_resolution TEXT       NOT NULL DEFAULT 'Arbitration',
      arbitration_institution TEXT  NOT NULL DEFAULT 'American Arbitration Association (AAA)',
      portal_token      TEXT        UNIQUE NOT NULL,
      active            BOOLEAN     NOT NULL DEFAULT true,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS advisor_agreements (
      id               SERIAL PRIMARY KEY,
      advisor_id       INTEGER     NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      agreement_token  TEXT        NOT NULL UNIQUE,
      status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed')),
      signed_at        TIMESTAMPTZ,
      signer_name      TEXT,
      signer_email     TEXT,
      signer_ip        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS advisor_agreements_advisor_id_idx ON advisor_agreements(advisor_id)`;

  return json({ ok: true, message: 'Advisor tables ready' });
}
