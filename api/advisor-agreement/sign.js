/**
 * POST /api/advisor-agreement/sign
 * Body: { token, name, email, acknowledged }
 * Returns: { ok, portal_url }
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, s = 200) =>
  new Response(JSON.stringify(obj), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { token, name, email, acknowledged } = body;
  if (!token || !name || !email || !acknowledged)
    return json({ ok: false, error: 'token, name, email, and acknowledged are required' }, 400);

  const [row] = await sql`
    SELECT aa.id, aa.status, a.portal_token, a.name AS advisor_name
    FROM advisor_agreements aa
    JOIN advisors a ON a.id = aa.advisor_id
    WHERE aa.agreement_token = ${token}
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);
  if (row.status === 'signed') return json({ ok: false, error: 'Already signed' }, 409);

  // Typed name must match the advisor's name on the agreement (case/space-insensitive).
  if (String(name).trim().toLowerCase() !== String(row.advisor_name).trim().toLowerCase()) {
    return json({ ok: false, error: 'Typed name must match the name on the agreement' }, 400);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

  await sql`
    UPDATE advisor_agreements
    SET status = 'signed', signed_at = now(),
        signer_name = ${name}, signer_email = ${email}, signer_ip = ${ip}
    WHERE id = ${row.id}
  `;

  return json({
    ok: true,
    portal_url: `https://malamalabs.com/advisor-portal/?token=${row.portal_token}`,
  });
}
