/**
 * GET   /api/admin/advisor-pool — pool total, granted, remaining.
 * PATCH /api/admin/advisor-pool { total_pct } — set the advisory equity pool size.
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

function authed(req) {
  const secret = process.env.ADMIN_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

async function summary() {
  const [pool] = await sql`SELECT total_pct, label FROM advisor_pool WHERE id = 1`;
  const [{ granted }] = await sql`SELECT COALESCE(SUM(equity_pct),0) AS granted FROM advisors WHERE active = true AND equity_pct IS NOT NULL`;
  const total = Number(pool?.total_pct ?? 0), used = Number(granted);
  return { total_pct: total, granted_pct: used, remaining_pct: Math.round((total - used) * 10000) / 10000, label: pool?.label };
}

export default async function handler(req) {
  if (!authed(req)) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (req.method === 'GET') return json({ ok: true, pool: await summary() });
  if (req.method === 'PATCH') {
    let body; try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    const total = Number(body.total_pct);
    if (isNaN(total) || total < 0 || total > 100) return json({ ok: false, error: 'total_pct must be 0-100' }, 400);
    const cur = await summary();
    if (total < cur.granted_pct - 1e-9) return json({ ok: false, error: `total (${total}%) is below already-granted (${cur.granted_pct}%)` }, 400);
    await sql`UPDATE advisor_pool SET total_pct = ${total}, updated_at = now() WHERE id = 1`;
    return json({ ok: true, pool: await summary() });
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
