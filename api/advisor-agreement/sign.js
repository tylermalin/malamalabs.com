/**
 * POST /api/advisor-agreement/sign  { token, name, acknowledged }
 * Records the advisor's electronic signature on their FAST agreement.
 * Requires a valid advisor session that OWNS this agreement (login-gated).
 * Returns { ok, portal_url }.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { currentAdvisor } from '../../lib/auth.js';

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

  const me = await currentAdvisor(req);
  if (!me) return json({ ok: false, error: 'You must be signed in to sign the agreement' }, 401);

  let body; try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
  const { token, name, acknowledged } = body;
  if (!token || !name || !acknowledged) return json({ ok: false, error: 'token, name, and acknowledged are required' }, 400);

  const [row] = await sql`
    SELECT aa.id, aa.status, aa.advisor_id, a.name AS advisor_name, a.portal_token
    FROM advisor_agreements aa JOIN advisors a ON a.id = aa.advisor_id
    WHERE aa.agreement_token = ${token} LIMIT 1
  `;
  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);
  if (row.advisor_id !== me.id) return json({ ok: false, error: 'This agreement belongs to another advisor' }, 403);
  if (row.status !== 'pending') return json({ ok: false, error: 'Already signed' }, 409);

  if (String(name).trim().toLowerCase() !== String(row.advisor_name).trim().toLowerCase()) {
    return json({ ok: false, error: 'Typed name must match the name on the agreement' }, 400);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  await sql`
    UPDATE advisor_agreements
    SET status = 'signed', signed_at = now(),
        signer_name = ${name}, signer_email = ${me.email}, signer_ip = ${ip}
    WHERE id = ${row.id}
  `;
  return json({ ok: true, portal_url: '/advisor-portal/' });
}
