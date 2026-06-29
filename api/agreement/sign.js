/**
 * POST /api/agreement/sign
 *
 * Records electronic signature for a KOL agreement.
 *
 * Body: {
 *   token:        string   — agreement_token
 *   name:         string   — typed full name (must match KOL name)
 *   email:        string   — email confirmation
 *   acknowledged: boolean  — all 3 checkboxes confirmed client-side
 * }
 *
 * On success: returns { ok: true, portal_url } so the client can redirect.
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
  if (!token || !name || !email || !acknowledged) {
    return json({ ok: false, error: 'token, name, email, and acknowledged are required' }, 400);
  }

  // Look up agreement
  const [row] = await sql`
    SELECT a.id, a.status, a.kol_id, k.name AS kol_name, k.portal_token,
           rl.code AS ref_code
    FROM agreements a
    JOIN kols k ON k.id = a.kol_id
    LEFT JOIN ref_links rl ON rl.kol_id = k.id AND rl.active = true
    WHERE a.agreement_token = ${token}
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);
  if (row.status === 'signed') return json({ ok: false, error: 'Already signed' }, 409);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

  await sql`
    UPDATE agreements
    SET status = 'signed',
        signed_at = now(),
        signer_name = ${name},
        signer_email = ${email},
        signer_ip = ${ip}
    WHERE id = ${row.id}
  `;

  const portal_url = row.portal_token
    ? `https://malamalabs.com/portal/?token=${row.portal_token}`
    : 'https://malamalabs.com/';

  return json({ ok: true, portal_url, ref_url: `https://malamalabs.com/ref/${row.ref_code}` });
}
