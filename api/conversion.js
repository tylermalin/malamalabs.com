/**
 * POST /api/conversion — Record a Hex Node sale and attribute it to a KOL ref.
 *
 * Called by the checkout flow after a confirmed payment. Two payment paths:
 *
 *   Crypto (USDC via MetaMask / Coinbase):
 *     After on-chain tx confirmation, client-side JS reads the `_ref` cookie
 *     and POSTs here. Pass `tx_hash` as the order_id.
 *     ⚠  For production: verify the tx_hash on-chain before trusting amount_usd.
 *
 *   Stripe (Magic Wallet):
 *     Use /api/stripe-webhook instead — that path verifies Stripe's signature
 *     and cannot be spoofed.
 *
 * Required headers:
 *   Authorization: Bearer <CONVERSION_SECRET>
 *
 * Body JSON:
 *   {
 *     order_id:     string  — tx hash (crypto) or Stripe payment_intent id
 *     amount_usd:   number  — total sale amount in USD
 *     payment_type: "crypto" | "stripe"
 *     ref_code?:    string  — value from _ref cookie (omit if unknown)
 *   }
 *
 * Returns:
 *   { ok: true, commission_usd: number }  or  { ok: false, error: string }
 *
 * Requires: DATABASE_URL, CONVERSION_SECRET
 */
export const config = { runtime: 'edge' };

import { sql } from '../lib/db.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  // Auth
  const authHeader = req.headers.get('authorization') ?? '';
  const secret = process.env.CONVERSION_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { order_id, amount_usd, payment_type, ref_code } = body;
  if (!order_id || typeof amount_usd !== 'number' || amount_usd <= 0) {
    return json({ ok: false, error: 'order_id and amount_usd are required' }, 400);
  }
  if (!['crypto', 'stripe'].includes(payment_type)) {
    return json({ ok: false, error: 'payment_type must be "crypto" or "stripe"' }, 400);
  }

  return recordConversion({ order_id, amount_usd, payment_type, ref_code: ref_code ?? null });
}

// Shared conversion logic — also called by stripe-webhook.js
export async function recordConversion({ order_id, amount_usd, payment_type, ref_code }) {
  if (!ref_code) {
    // No attribution — record as organic sale (no commission)
    return json({ ok: true, attributed: false, commission_usd: 0 });
  }

  // Look up the KOL's commission rate via the ref link
  const [row] = await sql`
    SELECT k.commission_pct
    FROM ref_links rl
    JOIN kols k ON k.id = rl.kol_id
    WHERE rl.code = ${ref_code} AND rl.active = true AND k.active = true
    LIMIT 1
  `;

  if (!row) {
    return json({ ok: true, attributed: false, commission_usd: 0 });
  }

  const commission_pct = Number(row.commission_pct);
  const commission_usd = parseFloat(((amount_usd * commission_pct) / 100).toFixed(2));

  // Upsert to handle duplicate webhook deliveries gracefully
  await sql`
    INSERT INTO conversions (ref_code, order_id, payment_type, amount_usd, commission_pct, commission_usd)
    VALUES (${ref_code}, ${order_id}, ${payment_type}, ${amount_usd}, ${commission_pct}, ${commission_usd})
    ON CONFLICT (order_id) DO NOTHING
  `;

  return json({ ok: true, attributed: true, ref_code, commission_usd });
}
