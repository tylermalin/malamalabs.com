/**
 * GET  /api/advisor-portal/messages — the advisor's thread with the company
 *      (marks company messages read). 401 if not signed in.
 * POST /api/advisor-portal/messages { body } — advisor sends a message.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { currentAdvisor } from '../../lib/auth.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const a = await currentAdvisor(req);
  if (!a) return json({ ok: false, error: 'Not signed in' }, 401);

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const text = String(body.body || '').trim().slice(0, 4000);
    if (!text) return json({ ok: false, error: 'Message body required' }, 400);
    await sql`
      INSERT INTO advisor_messages (advisor_id, sender, body, read_by_advisor)
      VALUES (${a.id}, 'advisor', ${text}, true)
    `;
    return json({ ok: true });
  }

  if (req.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  const rows = await sql`
    SELECT id, sender, body, created_at
    FROM advisor_messages WHERE advisor_id = ${a.id}
    ORDER BY created_at ASC
  `;
  // Mark company -> advisor messages as read.
  await sql`UPDATE advisor_messages SET read_by_advisor = true WHERE advisor_id = ${a.id} AND sender = 'company' AND read_by_advisor = false`;
  return json({ ok: true, messages: rows });
}
