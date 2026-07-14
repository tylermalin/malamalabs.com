/**
 * GET /api/admin/advisor-migrate — Extends the advisor schema for the FAST-based
 * advisory workflow: richer advisor profile fields, an equity pool, magic-link
 * auth (login tokens + sessions), messaging, and meetings. Idempotent.
 *
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

  // ── advisors: FAST profile + offer fields ────────────────────────────────
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS bio TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS linkedin TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS headshot_url TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS links TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS title TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS company_stage TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS performance_level TEXT`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS equity_pct NUMERIC(6,4)`;
  await sql`ALTER TABLE advisors ADD COLUMN IF NOT EXISTS security_type TEXT DEFAULT 'restricted'`;

  // ── advisor_agreements: company counter-signature + effective date ────────
  await sql`ALTER TABLE advisor_agreements ADD COLUMN IF NOT EXISTS company_signer_name TEXT`;
  await sql`ALTER TABLE advisor_agreements ADD COLUMN IF NOT EXISTS company_signer_title TEXT`;
  await sql`ALTER TABLE advisor_agreements ADD COLUMN IF NOT EXISTS company_signed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE advisor_agreements ADD COLUMN IF NOT EXISTS company_signer_ip TEXT`;
  await sql`ALTER TABLE advisor_agreements ADD COLUMN IF NOT EXISTS effective_date DATE`;
  // widen status check to allow 'countersigned'
  await sql`ALTER TABLE advisor_agreements DROP CONSTRAINT IF EXISTS advisor_agreements_status_check`;
  await sql`ALTER TABLE advisor_agreements ADD CONSTRAINT advisor_agreements_status_check
            CHECK (status IN ('pending','signed','countersigned'))`;

  // ── advisory equity pool (singleton row id=1) ─────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS advisor_pool (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      total_pct   NUMERIC(6,4) NOT NULL DEFAULT 5.0000,
      label       TEXT NOT NULL DEFAULT 'Advisory equity pool (% fully diluted)',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT advisor_pool_singleton CHECK (id = 1)
    )
  `;
  await sql`INSERT INTO advisor_pool (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  // ── magic-link auth: one-time login tokens + sessions ─────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS login_tokens (
      token       TEXT PRIMARY KEY,
      advisor_id  INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS advisor_sessions (
      token       TEXT PRIMARY KEY,
      advisor_id  INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS advisor_sessions_advisor_idx ON advisor_sessions(advisor_id)`;

  // ── messaging (advisor <-> company) ───────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS advisor_messages (
      id              SERIAL PRIMARY KEY,
      advisor_id      INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
      sender          TEXT NOT NULL CHECK (sender IN ('advisor','company')),
      body            TEXT NOT NULL,
      read_by_admin   BOOLEAN NOT NULL DEFAULT false,
      read_by_advisor BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS advisor_messages_advisor_idx ON advisor_messages(advisor_id, created_at)`;

  // ── meetings (advisor-specific or network-wide when advisor_id IS NULL) ────
  await sql`
    CREATE TABLE IF NOT EXISTS advisor_meetings (
      id            SERIAL PRIMARY KEY,
      advisor_id    INTEGER REFERENCES advisors(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      scheduled_at  TIMESTAMPTZ NOT NULL,
      location      TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS advisor_meetings_time_idx ON advisor_meetings(scheduled_at)`;

  return json({ ok: true, message: 'Advisory OS schema ready' });
}
