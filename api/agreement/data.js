/**
 * GET /api/agreement/data?token=<agreement_token>
 *
 * Public endpoint — returns KOL and agreement data needed to render the deal memo.
 * Does not require auth; the token is the secret.
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
      k.id, k.name, k.email, k.commission_pct,
      k.twitter_handle, k.followers_count,
      k.portal_token,
      rl.code AS ref_code,
      a.agreement_token, a.status, a.signed_at, a.signer_name, a.signer_email
    FROM agreements a
    JOIN kols k ON k.id = a.kol_id
    LEFT JOIN ref_links rl ON rl.kol_id = k.id AND rl.active = true
    WHERE a.agreement_token = ${token}
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);

  const pct = Number(row.commission_pct);
  const per_node = parseFloat(((2000 * pct) / 100).toFixed(2));

  return json({
    ok: true,
    kol: {
      name: row.name,
      email: row.email,
      commission_pct: pct,
      commission_per_node: per_node,
      twitter_handle: row.twitter_handle || `@${row.ref_code}`,
      followers_count: row.followers_count,
      ref_code: row.ref_code,
      ref_url: `malamalabs.com/ref/${row.ref_code}`,
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
