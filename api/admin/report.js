/**
 * GET /api/admin/report?month=YYYY-MM[&settle=true]
 *
 * Returns a CSV of all conversions for the given month, grouped by KOL.
 * Passing `settle=true` marks all unsettled conversions in that month as settled.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * CSV columns:
 *   KOL Name, Email, Ref Code, Payment Details,
 *   # Conversions, Total Sales (USD), Commission %, Total Commission (USD),
 *   Already Settled (USD), Owed This Run (USD)
 *
 * Requires: DATABASE_URL, ADMIN_SECRET
 */
export const config = { runtime: 'edge' };

import { sql } from '../../lib/db.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function isAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!isAuthorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const month = url.searchParams.get('month'); // e.g. "2026-06"
  const settle = url.searchParams.get('settle') === 'true';

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return json({ ok: false, error: 'month param required (YYYY-MM)' }, 400);
  }

  const [year, mo] = month.split('-').map(Number);
  if (mo < 1 || mo > 12) {
    return json({ ok: false, error: 'month must be 01-12' }, 400);
  }
  const start = new Date(year, mo - 1, 1).toISOString();
  const end   = new Date(year, mo, 1).toISOString(); // exclusive

  const rows = await sql`
    SELECT
      k.name,
      k.email,
      k.payment_details,
      rl.code                                                             AS ref_code,
      k.commission_pct,
      COUNT(c.id)                                                         AS conversions,
      COALESCE(SUM(c.amount_usd), 0)                                      AS total_sales_usd,
      COALESCE(SUM(c.commission_usd), 0)                                  AS total_commission_usd,
      COALESCE(SUM(c.commission_usd) FILTER (WHERE c.settled), 0)        AS already_settled_usd,
      COALESCE(SUM(c.commission_usd) FILTER (WHERE NOT c.settled), 0)    AS owed_usd
    FROM conversions c
    JOIN ref_links rl ON rl.code = c.ref_code
    JOIN kols k ON k.id = rl.kol_id
    WHERE c.created_at >= ${start} AND c.created_at < ${end}
    GROUP BY k.id, rl.id
    ORDER BY k.name
  `;

  // Mark conversions as settled if requested
  if (settle && rows.length > 0) {
    await sql`
      UPDATE conversions
      SET settled = true, settled_at = now()
      WHERE settled = false
        AND created_at >= ${start}
        AND created_at < ${end}
        AND ref_code IN (
          SELECT code FROM ref_links WHERE kol_id IN (
            SELECT id FROM kols
          )
        )
    `;
  }

  // Build CSV
  const headers = [
    'KOL Name', 'Email', 'Ref Code', 'Commission %', 'Payment Details',
    'Conversions', 'Total Sales (USD)', 'Total Commission (USD)',
    'Already Settled (USD)', 'Owed This Run (USD)',
  ];

  const csvRows = rows.map(r => [
    r.name,
    r.email,
    r.ref_code,
    r.commission_pct,
    r.payment_details ?? '',
    r.conversions,
    Number(r.total_sales_usd).toFixed(2),
    Number(r.total_commission_usd).toFixed(2),
    Number(r.already_settled_usd).toFixed(2),
    Number(r.owed_usd).toFixed(2),
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  // Totals row
  const totalOwed = rows.reduce((sum, r) => sum + Number(r.owed_usd), 0);
  const totalCommission = rows.reduce((sum, r) => sum + Number(r.total_commission_usd), 0);
  const totalSales = rows.reduce((sum, r) => sum + Number(r.total_sales_usd), 0);
  csvRows.push(`"TOTAL","","","","",` +
    `"${rows.reduce((s, r) => s + Number(r.conversions), 0)}",` +
    `"${totalSales.toFixed(2)}","${totalCommission.toFixed(2)}","","${totalOwed.toFixed(2)}"`);

  const csv = [headers.join(','), ...csvRows].join('\n');
  const filename = `kol-report-${month}${settle ? '-settled' : ''}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
