/**
 * GET /api/advisor-portal/data?token=<portal_token>
 *
 * Public endpoint — returns an advisor's terms + agreement status for the
 * advisor portal. The portal_token is the secret (mirrors /api/kol/stats).
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ ok: false, error: 'token required' }, 400);

  const [row] = await sql`
    SELECT
      a.name, a.email, a.address, a.shares, a.per_share_price, a.purchase_price,
      a.vesting_months, a.cliff_months, a.hours_per_month, a.services, a.exclusive,
      a.governing_law, a.dispute_resolution, a.arbitration_institution, a.active,
      aa.agreement_token, aa.status, aa.signed_at, aa.signer_name, aa.signer_email
    FROM advisors a
    LEFT JOIN advisor_agreements aa ON aa.advisor_id = a.id
    WHERE a.portal_token = ${token} AND a.active = true
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Invalid or expired token' }, 401);

  const shares = Number(row.shares);
  const pct = ((shares / 1000000000) * 100).toFixed(2); // assumes 1B authorized

  return json({
    ok: true,
    advisor: {
      name: row.name,
      email: row.email,
      address: row.address,
      shares,
      per_share_price: Number(row.per_share_price),
      purchase_price: Number(row.purchase_price),
      vesting_months: row.vesting_months,
      cliff_months: row.cliff_months,
      hours_per_month: row.hours_per_month,
      services: row.services,
      exclusive: row.exclusive,
      governing_law: row.governing_law,
      dispute_resolution: row.dispute_resolution,
      arbitration_institution: row.arbitration_institution,
      equity_pct: `${pct}%`,
    },
    agreement: row.agreement_token ? {
      token: row.agreement_token,
      status: row.status,
      signed_at: row.signed_at,
      signer_name: row.signer_name,
      signer_email: row.signer_email,
    } : null,
  });
}
