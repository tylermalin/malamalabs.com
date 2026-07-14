/**
 * GET /api/advisor-portal/directory — the shared advisory-network directory.
 * Visible only to signed-in advisors. Returns profile info (no equity/comp).
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { currentAdvisor } from '../../lib/auth.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const me = await currentAdvisor(req);
  if (!me) return json({ ok: false, error: 'Not signed in' }, 401);

  // Only advisors who have signed (or been countersigned) appear in the network.
  const rows = await sql`
    SELECT a.id, a.name, a.title, a.bio, a.linkedin, a.headshot_url, a.links,
           a.performance_level, aa.status
    FROM advisors a
    JOIN advisor_agreements aa ON aa.advisor_id = a.id
    WHERE a.active = true AND aa.status IN ('signed','countersigned')
    ORDER BY a.name
  `;

  return json({
    ok: true,
    me_id: me.id,
    advisors: rows.map((r) => ({
      id: r.id, name: r.name, title: r.title, bio: r.bio,
      linkedin: r.linkedin, headshot_url: r.headshot_url, links: r.links,
      performance_level: r.performance_level, is_me: r.id === me.id,
    })),
  });
}
