/**
 * GET    /api/admin/advisor-meetings — all meetings (upcoming first).
 * POST   /api/admin/advisor-meetings { title, scheduled_at, advisor_id?, location?, notes? }
 *          advisor_id omitted/null = network-wide meeting (all advisors).
 * DELETE /api/admin/advisor-meetings?id=
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

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT m.id, m.advisor_id, m.title, m.scheduled_at, m.location, m.notes, a.name AS advisor_name
      FROM advisor_meetings m LEFT JOIN advisors a ON a.id = m.advisor_id
      ORDER BY m.scheduled_at ASC
    `;
    return json({ ok: true, meetings: rows });
  }
  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const title = String(b.title || '').trim();
    const when = b.scheduled_at ? new Date(b.scheduled_at) : null;
    if (!title || !when || isNaN(when.getTime())) return json({ ok: false, error: 'title and valid scheduled_at required' }, 400);
    const advisorId = b.advisor_id ? Number(b.advisor_id) : null;
    await sql`
      INSERT INTO advisor_meetings (advisor_id, title, scheduled_at, location, notes)
      VALUES (${advisorId}, ${title}, ${when.toISOString()}, ${b.location ?? null}, ${b.notes ?? null})
    `;
    return json({ ok: true }, 201);
  }
  if (req.method === 'DELETE') {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) return json({ ok: false, error: 'id required' }, 400);
    await sql`DELETE FROM advisor_meetings WHERE id = ${id}`;
    return json({ ok: true });
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
