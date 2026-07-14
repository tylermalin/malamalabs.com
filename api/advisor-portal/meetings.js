/**
 * GET /api/advisor-portal/meetings — meetings for the signed-in advisor plus
 * network-wide meetings (advisor_id IS NULL), upcoming first. 401 if not signed in.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { currentAdvisor } from '../../lib/auth.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const a = await currentAdvisor(req);
  if (!a) return json({ ok: false, error: 'Not signed in' }, 401);

  const rows = await sql`
    SELECT id, advisor_id, title, scheduled_at, location, notes
    FROM advisor_meetings
    WHERE advisor_id = ${a.id} OR advisor_id IS NULL
    ORDER BY scheduled_at ASC
  `;
  return json({
    ok: true,
    meetings: rows.map((r) => ({
      id: r.id, title: r.title, scheduled_at: r.scheduled_at,
      location: r.location, notes: r.notes,
      scope: r.advisor_id ? 'personal' : 'network',
    })),
  });
}
