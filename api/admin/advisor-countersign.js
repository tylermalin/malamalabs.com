/**
 * POST /api/admin/advisor-countersign
 * Body: { agreement_token, company_signer_name, company_signer_title? }
 * Company counter-signs an advisor-signed FAST agreement -> status 'countersigned'.
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return json({ ok: false, error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body; try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
  const { agreement_token, company_signer_name, company_signer_title } = body;
  if (!agreement_token || !company_signer_name) return json({ ok: false, error: 'agreement_token and company_signer_name required' }, 400);

  const [row] = await sql`SELECT id, status FROM advisor_agreements WHERE agreement_token = ${agreement_token} LIMIT 1`;
  if (!row) return json({ ok: false, error: 'Agreement not found' }, 404);
  if (row.status === 'pending') return json({ ok: false, error: 'Advisor has not signed yet' }, 409);
  if (row.status === 'countersigned') return json({ ok: false, error: 'Already counter-signed' }, 409);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  await sql`
    UPDATE advisor_agreements
    SET status = 'countersigned', company_signer_name = ${company_signer_name},
        company_signer_title = ${company_signer_title ?? null},
        company_signed_at = now(), company_signer_ip = ${ip},
        effective_date = COALESCE(effective_date, CURRENT_DATE)
    WHERE id = ${row.id}
  `;
  return json({ ok: true });
}
