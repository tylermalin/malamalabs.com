/**
 * GET  /api/admin/kols — List all KOLs with their ref links and conversion totals.
 * POST /api/admin/kols — Create a new KOL and generate their ref link.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * POST body:
 *   {
 *     name:            string   — KOL display name
 *     email:           string   — for payout contact
 *     commission_pct:  number   — e.g. 10 for 10%
 *     code:            string   — desired ref code (e.g. "jane", "cryptokai")
 *     target_url?:     string   — override default landing page
 *     payment_details?: string  — USDC wallet address or bank info for payouts
 *   }
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
  if (!isAuthorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);

  if (req.method === 'GET') return listKols();
  if (req.method === 'POST') return createKol(req);
  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function listKols() {
  const rows = await sql`
    SELECT
      k.id, k.name, k.email, k.commission_pct, k.payment_details,
      k.active, k.created_at, k.portal_token, k.twitter_handle,
      rl.code AS ref_code, rl.target_url, rl.active AS link_active,
      COUNT(c.id)                                                       AS total_conversions,
      COALESCE(SUM(c.amount_usd), 0)                                    AS total_sales_usd,
      COALESCE(SUM(c.commission_usd), 0)                                AS total_commission_usd,
      COALESCE(SUM(c.commission_usd) FILTER (WHERE NOT c.settled), 0)  AS unpaid_commission_usd,
      a.agreement_token, a.status AS agreement_status, a.signed_at
    FROM kols k
    LEFT JOIN ref_links rl ON rl.kol_id = k.id
    LEFT JOIN conversions c ON c.ref_code = rl.code
    LEFT JOIN agreements a ON a.kol_id = k.id
    GROUP BY k.id, rl.id, a.id
    ORDER BY k.created_at DESC
  `;
  return json({ ok: true, kols: rows });
}

async function createKol(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { name, email, commission_pct, code, target_url, payment_details, twitter_handle, followers_count } = body;

  if (!name || !email || commission_pct == null || !code) {
    return json({ ok: false, error: 'name, email, commission_pct, and code are required' }, 400);
  }

  // Validate code format: lowercase alphanumeric + hyphens only
  if (!/^[a-z0-9-]{2,32}$/.test(code)) {
    return json({ ok: false, error: 'code must be 2-32 lowercase alphanumeric characters or hyphens' }, 400);
  }

  const pct = Number(commission_pct);
  if (isNaN(pct) || pct <= 0 || pct > 100) {
    return json({ ok: false, error: 'commission_pct must be between 0 and 100' }, 400);
  }

  const target = target_url || 'https://malamalabs.com/platform/';
  const portal_token = crypto.randomUUID();

  // Insert KOL and ref link in a transaction-like sequence (Neon HTTP is single-statement)
  const [kol] = await sql`
    INSERT INTO kols (name, email, commission_pct, payment_details, portal_token, twitter_handle, followers_count)
    VALUES (${name}, ${email}, ${pct}, ${payment_details ?? null}, ${portal_token},
            ${twitter_handle ?? null}, ${followers_count ? Number(followers_count) : null})
    RETURNING id
  `;

  await sql`INSERT INTO ref_links (code, kol_id, target_url) VALUES (${code}, ${kol.id}, ${target})`;

  const agreement_token = crypto.randomUUID();
  await sql`INSERT INTO agreements (kol_id, agreement_token) VALUES (${kol.id}, ${agreement_token})`;

  return json({
    ok: true,
    kol_id: kol.id,
    ref_url: `https://malamalabs.com/ref/${code}`,
    portal_url: `https://malamalabs.com/portal/?token=${portal_token}`,
    agreement_url: `https://malamalabs.com/agreement/?token=${agreement_token}`,
  }, 201);
}
