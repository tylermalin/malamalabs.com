/**
 * GET /api/advisor-agreement/data?token=<agreement_token>
 * Returns the advisor + FAST agreement terms needed to render the agreement.
 * The token is the pointer; the page itself is gated behind advisor login.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ ok: false, error: 'token required' }, 400);

  const [row] = await sql`
    SELECT
      a.id, a.name, a.email, a.title, a.bio, a.linkedin, a.headshot_url, a.links,
      a.company_stage, a.performance_level, a.equity_pct, a.security_type,
      a.hours_per_month, a.vesting_months, a.cliff_months,
      a.governing_law, a.dispute_resolution, a.arbitration_institution, a.portal_token,
      aa.agreement_token, aa.status, aa.signed_at, aa.signer_name, aa.signer_email,
      aa.company_signer_name, aa.company_signer_title, aa.company_signed_at, aa.effective_date
    FROM advisor_agreements aa
    JOIN advisors a ON a.id = aa.advisor_id
    WHERE aa.agreement_token = ${token}
    LIMIT 1
  `;
  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);

  return json({
    ok: true,
    advisor: {
      name: row.name, email: row.email, title: row.title, bio: row.bio,
      linkedin: row.linkedin, headshot_url: row.headshot_url, links: row.links,
      company_stage: row.company_stage, performance_level: row.performance_level,
      equity_pct: row.equity_pct != null ? Number(row.equity_pct) : null,
      security_type: row.security_type,
      hours_per_month: row.hours_per_month,
      vesting_months: row.vesting_months, cliff_months: row.cliff_months,
      governing_law: row.governing_law, dispute_resolution: row.dispute_resolution,
      arbitration_institution: row.arbitration_institution,
      portal_token: row.portal_token,
    },
    agreement: {
      token, status: row.status, signed_at: row.signed_at,
      signer_name: row.signer_name, signer_email: row.signer_email,
      company_signer_name: row.company_signer_name,
      company_signer_title: row.company_signer_title,
      company_signed_at: row.company_signed_at, effective_date: row.effective_date,
    },
  });
}
