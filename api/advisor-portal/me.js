/**
 * GET /api/advisor-portal/me — the logged-in advisor's profile, equity, and
 * agreement status (via session cookie). 401 if not signed in.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { currentAdvisor } from '../../lib/auth.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const a = await currentAdvisor(req);
  if (!a) return json({ ok: false, error: 'Not signed in' }, 401);

  const [ag] = await sql`
    SELECT agreement_token, status, signed_at, signer_name,
           company_signer_name, company_signed_at, effective_date
    FROM advisor_agreements WHERE advisor_id = ${a.id} LIMIT 1
  `;

  return json({
    ok: true,
    advisor: {
      id: a.id, name: a.name, email: a.email, title: a.title, bio: a.bio,
      linkedin: a.linkedin, headshot_url: a.headshot_url, links: a.links,
      company_stage: a.company_stage, performance_level: a.performance_level,
      equity_pct: a.equity_pct != null ? Number(a.equity_pct) : null,
      security_type: a.security_type,
      vesting_months: a.vesting_months, cliff_months: a.cliff_months,
      hours_per_month: a.hours_per_month, governing_law: a.governing_law,
    },
    agreement: ag ? {
      token: ag.agreement_token,
      status: ag.status,
      signed_at: ag.signed_at,
      signer_name: ag.signer_name,
      company_signer_name: ag.company_signer_name,
      company_signed_at: ag.company_signed_at,
      effective_date: ag.effective_date,
    } : null,
  });
}
