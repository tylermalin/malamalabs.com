/**
 * GET  /api/admin/advisors — list advisors (FAST fields + agreement status) + pool summary.
 * POST /api/admin/advisors — create an advisor + FAST offer, validated against the equity pool.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * POST body: { name, email, title?, bio?, linkedin?, headshot_url?, links?,
 *              company_stage: 'idea'|'startup'|'growth',
 *              performance_level: 'standard'|'strategic'|'expert',
 *              security_type?: 'restricted'|'option' }
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { equityPct, HOURS, STAGES, LEVELS } from '../../lib/fast.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function authed(req) {
  const secret = process.env.ADMIN_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function poolSummary() {
  const [pool] = await sql`SELECT total_pct FROM advisor_pool WHERE id = 1`;
  const [{ granted }] = await sql`
    SELECT COALESCE(SUM(equity_pct), 0) AS granted FROM advisors WHERE active = true AND equity_pct IS NOT NULL
  `;
  const total = Number(pool?.total_pct ?? 0);
  const used = Number(granted);
  return { total_pct: total, granted_pct: used, remaining_pct: Math.round((total - used) * 10000) / 10000 };
}

export default async function handler(req) {
  if (!authed(req)) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (req.method === 'GET') return listAdvisors();
  if (req.method === 'POST') return createAdvisor(req);
  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function listAdvisors() {
  const rows = await sql`
    SELECT
      a.id, a.name, a.email, a.title, a.bio, a.linkedin, a.headshot_url, a.links,
      a.company_stage, a.performance_level, a.equity_pct, a.security_type,
      a.hours_per_month, a.portal_token, a.active, a.created_at,
      aa.agreement_token, aa.status AS agreement_status, aa.signed_at,
      aa.company_signer_name, aa.company_signed_at
    FROM advisors a
    LEFT JOIN advisor_agreements aa ON aa.advisor_id = a.id
    ORDER BY a.created_at DESC
  `;
  return json({ ok: true, advisors: rows, pool: await poolSummary() });
}

async function createAdvisor(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { name, email, title, bio, linkedin, headshot_url, links,
          company_stage, performance_level, security_type } = body;

  if (!name || !email) return json({ ok: false, error: 'name and email are required' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return json({ ok: false, error: 'valid email required' }, 400);
  if (!STAGES.includes(company_stage)) return json({ ok: false, error: `company_stage must be one of ${STAGES.join(', ')}` }, 400);
  if (!LEVELS.includes(performance_level)) return json({ ok: false, error: `performance_level must be one of ${LEVELS.join(', ')}` }, 400);

  const pct = equityPct(performance_level, company_stage);
  if (pct == null) return json({ ok: false, error: 'invalid level/stage combination' }, 400);

  // Reject duplicate email + validate against the remaining pool.
  const [dup] = await sql`SELECT 1 FROM advisors WHERE lower(email) = ${String(email).toLowerCase()} LIMIT 1`;
  if (dup) return json({ ok: false, error: 'An advisor with that email already exists' }, 409);

  const pool = await poolSummary();
  if (pct > pool.remaining_pct + 1e-9) {
    return json({ ok: false, error: `Offer ${pct}% exceeds remaining pool (${pool.remaining_pct}%)` }, 400);
  }

  const hours = HOURS[performance_level];
  const sec = security_type === 'option' ? 'option' : 'restricted';
  const portal_token = crypto.randomUUID();
  const agreement_token = crypto.randomUUID();

  const [advisor] = await sql`
    INSERT INTO advisors (
      name, email, title, bio, linkedin, headshot_url, links,
      company_stage, performance_level, equity_pct, security_type,
      hours_per_month, vesting_months, cliff_months, shares, portal_token
    ) VALUES (
      ${name}, ${email}, ${title ?? null}, ${bio ?? null}, ${linkedin ?? null},
      ${headshot_url ?? null}, ${links ?? null},
      ${company_stage}, ${performance_level}, ${pct}, ${sec},
      ${hours}, 24, 3, 0, ${portal_token}
    ) RETURNING id
  `;

  try {
    await sql`INSERT INTO advisor_agreements (advisor_id, agreement_token) VALUES (${advisor.id}, ${agreement_token})`;
  } catch (err) {
    await sql`DELETE FROM advisors WHERE id = ${advisor.id}`.catch(() => {});
    return json({ ok: false, error: 'Could not create advisor agreement' }, 500);
  }

  return json({
    ok: true,
    advisor_id: advisor.id,
    equity_pct: pct,
    agreement_url: `https://malamalabs.com/advisor-agreement/?token=${agreement_token}`,
    portal_url: `https://malamalabs.com/advisor-portal/`,
    pool: await poolSummary(),
  }, 201);
}
