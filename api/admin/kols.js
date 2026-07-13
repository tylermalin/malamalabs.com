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
  if (req.method === 'PATCH') return updateKol(req);
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
      (SELECT COUNT(*) FROM clicks cl WHERE cl.ref_code = rl.code)      AS total_clicks,
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

async function updateKol(req) {
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
  const { kol_id, commission_pct, active, payment_details } = body;
  if (!kol_id) return json({ ok: false, error: 'kol_id required' }, 400);

  if (commission_pct != null) {
    const pct = Number(commission_pct);
    if (isNaN(pct) || pct <= 0 || pct > 100) return json({ ok: false, error: 'invalid commission_pct' }, 400);
    await sql`UPDATE kols SET commission_pct = ${pct} WHERE id = ${kol_id}`;
  }
  if (active != null) await sql`UPDATE kols SET active = ${Boolean(active)} WHERE id = ${kol_id}`;
  if (payment_details != null) await sql`UPDATE kols SET payment_details = ${payment_details} WHERE id = ${kol_id}`;

  return json({ ok: true });
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

  // Reject duplicates up front with a clear 409 (both columns are UNIQUE) so a
  // constraint violation can't crash the function or leave a partial write.
  const [dupEmail] = await sql`SELECT 1 FROM kols WHERE email = ${email} LIMIT 1`;
  if (dupEmail) return json({ ok: false, error: 'A KOL with that email already exists' }, 409);
  const [dupCode] = await sql`SELECT 1 FROM ref_links WHERE code = ${code} LIMIT 1`;
  if (dupCode) return json({ ok: false, error: 'That ref code is already taken' }, 409);

  // Neon HTTP can't wrap these in one transaction, so guard the follow-up inserts:
  // if either fails, remove the KOL we just created to avoid an orphaned row.
  const [kol] = await sql`
    INSERT INTO kols (name, email, commission_pct, payment_details, portal_token, twitter_handle, followers_count)
    VALUES (${name}, ${email}, ${pct}, ${payment_details ?? null}, ${portal_token},
            ${twitter_handle ?? null}, ${followers_count ? Number(followers_count) : null})
    RETURNING id
  `;

  const agreement_token = crypto.randomUUID();
  try {
    await sql`INSERT INTO ref_links (code, kol_id, target_url) VALUES (${code}, ${kol.id}, ${target})`;
    await sql`INSERT INTO agreements (kol_id, agreement_token) VALUES (${kol.id}, ${agreement_token})`;
  } catch (err) {
    await sql`DELETE FROM kols WHERE id = ${kol.id}`.catch(() => {});
    // 23505 = unique_violation (e.g. code taken in a race between the check and insert)
    if (err?.code === '23505') return json({ ok: false, error: 'That ref code is already taken' }, 409);
    return json({ ok: false, error: 'Could not create KOL' }, 500);
  }

  return json({
    ok: true,
    kol_id: kol.id,
    ref_url: `https://malamalabs.com/ref/${code}`,
    portal_url: `https://malamalabs.com/portal/?token=${portal_token}`,
    agreement_url: `https://malamalabs.com/agreement/?token=${agreement_token}`,
  }, 201);
}
