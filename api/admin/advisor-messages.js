/**
 * GET  /api/admin/advisor-messages?advisor_id=  — thread with one advisor (marks advisor msgs read).
 * POST /api/admin/advisor-messages { advisor_id, body } — company sends a message.
 * Also GET (no advisor_id) returns per-advisor unread counts for the admin inbox badge.
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

  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const advisorId = Number(body.advisor_id);
    const text = String(body.body || '').trim().slice(0, 4000);
    if (!advisorId || !text) return json({ ok: false, error: 'advisor_id and body required' }, 400);
    await sql`INSERT INTO advisor_messages (advisor_id, sender, body, read_by_admin) VALUES (${advisorId}, 'company', ${text}, true)`;
    return json({ ok: true });
  }

  if (req.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  const advisorId = new URL(req.url).searchParams.get('advisor_id');
  if (!advisorId) {
    const counts = await sql`
      SELECT advisor_id, COUNT(*) AS unread FROM advisor_messages
      WHERE sender = 'advisor' AND read_by_admin = false GROUP BY advisor_id
    `;
    return json({ ok: true, unread: counts });
  }
  const rows = await sql`
    SELECT id, sender, body, created_at FROM advisor_messages
    WHERE advisor_id = ${Number(advisorId)} ORDER BY created_at ASC
  `;
  await sql`UPDATE advisor_messages SET read_by_admin = true WHERE advisor_id = ${Number(advisorId)} AND sender = 'advisor' AND read_by_admin = false`;
  return json({ ok: true, messages: rows });
}
