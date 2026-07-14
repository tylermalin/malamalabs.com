/**
 * GET /api/advisor-agreement/data?token=<agreement_token>
 * Returns advisor + agreement data for rendering the FAST deal memo.
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
      a.id, a.name, a.email, a.address, a.shares, a.per_share_price, a.purchase_price,
      a.vesting_months, a.cliff_months, a.hours_per_month, a.services, a.exclusive,
      a.governing_law, a.dispute_resolution, a.arbitration_institution, a.portal_token,
      aa.agreement_token, aa.status, aa.signed_at, aa.signer_name, aa.signer_email
    FROM advisor_agreements aa
    JOIN advisors a ON a.id = aa.advisor_id
    WHERE aa.agreement_token = ${token}
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);

  const purchase_price = Number(row.purchase_price);
  const per_share_price = Number(row.per_share_price);
  const shares = Number(row.shares);
  const pct = ((shares / 1000000000) * 100).toFixed(2); // assumes 1B authorized; shown as ~1%

  return json({
    ok: true,
    advisor: {
      name: row.name,
      email: row.email,
      address: row.address,
      shares,
      per_share_price,
      purchase_price,
      vesting_months: row.vesting_months,
      cliff_months: row.cliff_months,
      hours_per_month: row.hours_per_month,
      services: row.services,
      exclusive: row.exclusive,
      governing_law: row.governing_law,
      dispute_resolution: row.dispute_resolution,
      arbitration_institution: row.arbitration_institution,
      equity_pct: `${pct}%`,
      portal_token: row.portal_token,
    },
    agreement: {
      token,
      status: row.status,
      signed_at: row.signed_at,
      signer_name: row.signer_name,
      signer_email: row.signer_email,
    },
  });
}
