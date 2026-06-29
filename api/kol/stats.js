/**
 * GET /api/kol/stats?token=<portal_token>
 *
 * Returns real-time stats for the authenticated KOL.
 * Token is the unique portal_token assigned at KOL creation.
 *
 * Response:
 *   {
 *     ok: true,
 *     kol: { name, email, ref_code, commission_pct, ref_url, portal_url },
 *     stats: {
 *       total_clicks, total_conversions, total_sales_usd, total_commission_usd,
 *       unpaid_commission_usd,
 *       mtd_conversions, mtd_sales_usd, mtd_commission_usd,
 *       monthly: [{ month, conversions, sales_usd, commission_usd }]  // last 6 months
 *     }
 *   }
 */
export const config = { runtime: 'edge' };

import { sql } from '../../lib/db.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ ok: false, error: 'token required' }, 400);

  // Verify token and get KOL + ref link
  const [row] = await sql`
    SELECT k.id, k.name, k.email, k.commission_pct, rl.code AS ref_code, k.portal_token,
           a.agreement_token, a.status AS agreement_status, a.signed_at
    FROM kols k
    JOIN ref_links rl ON rl.kol_id = k.id
    LEFT JOIN agreements a ON a.kol_id = k.id
    WHERE k.portal_token = ${token} AND k.active = true
    LIMIT 1
  `;

  if (!row) return json({ ok: false, error: 'Invalid or expired token' }, 401);

  const ref_code = row.ref_code;

  // Fetch all stats in parallel
  const [clickRow, convRow, mtdRow, monthlyRows] = await Promise.all([
    // Total clicks
    sql`SELECT COUNT(*) AS total FROM clicks WHERE ref_code = ${ref_code}`,

    // All-time conversion stats
    sql`
      SELECT
        COUNT(*) AS total_conversions,
        COALESCE(SUM(amount_usd), 0) AS total_sales_usd,
        COALESCE(SUM(commission_usd), 0) AS total_commission_usd,
        COALESCE(SUM(commission_usd) FILTER (WHERE NOT settled), 0) AS unpaid_commission_usd
      FROM conversions
      WHERE ref_code = ${ref_code}
    `,

    // Month-to-date stats
    sql`
      SELECT
        COUNT(*) AS mtd_conversions,
        COALESCE(SUM(amount_usd), 0) AS mtd_sales_usd,
        COALESCE(SUM(commission_usd), 0) AS mtd_commission_usd
      FROM conversions
      WHERE ref_code = ${ref_code}
        AND created_at >= date_trunc('month', now())
    `,

    // Last 6 months breakdown
    sql`
      SELECT
        to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) AS conversions,
        COALESCE(SUM(amount_usd), 0) AS sales_usd,
        COALESCE(SUM(commission_usd), 0) AS commission_usd
      FROM conversions
      WHERE ref_code = ${ref_code}
        AND created_at >= date_trunc('month', now()) - interval '5 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `,
  ]);

  return json({
    ok: true,
    kol: {
      name: row.name,
      email: row.email,
      ref_code,
      commission_pct: Number(row.commission_pct),
      ref_url: `https://malamalabs.com/ref/${ref_code}`,
      portal_url: `https://malamalabs.com/portal/?token=${token}`,
    },
    agreement: row.agreement_token ? {
      token: row.agreement_token,
      status: row.agreement_status,
      signed_at: row.signed_at,
    } : null,
    stats: {
      total_clicks: Number(clickRow[0]?.total ?? 0),
      total_conversions: Number(convRow[0]?.total_conversions ?? 0),
      total_sales_usd: Number(convRow[0]?.total_sales_usd ?? 0),
      total_commission_usd: Number(convRow[0]?.total_commission_usd ?? 0),
      unpaid_commission_usd: Number(convRow[0]?.unpaid_commission_usd ?? 0),
      mtd_conversions: Number(mtdRow[0]?.mtd_conversions ?? 0),
      mtd_sales_usd: Number(mtdRow[0]?.mtd_sales_usd ?? 0),
      mtd_commission_usd: Number(mtdRow[0]?.mtd_commission_usd ?? 0),
      monthly: monthlyRows.map(r => ({
        month: r.month,
        conversions: Number(r.conversions),
        sales_usd: Number(r.sales_usd),
        commission_usd: Number(r.commission_usd),
      })),
    },
  });
}
