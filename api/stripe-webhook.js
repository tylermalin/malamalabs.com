/**
 * POST /api/stripe-webhook — Stripe webhook for Magic Wallet / Stripe payments.
 *
 * Listens for `payment_intent.succeeded`. Attribution works by having the
 * checkout flow pass the KOL ref code in the PaymentIntent metadata when
 * creating it on the client side (read from the `_ref` cookie):
 *
 *   stripe.createPaymentIntent({ ..., metadata: { ref_code: getCookie('_ref') } })
 *
 * Configure in Stripe Dashboard → Webhooks → Add endpoint:
 *   URL: https://malamalabs.com/api/stripe-webhook
 *   Events: payment_intent.succeeded
 *
 * Requires: DATABASE_URL, STRIPE_WEBHOOK_SECRET (whsec_...)
 */
export const config = { runtime: 'edge' };

import { recordConversion } from './conversion.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return json({ ok: false, error: 'Webhook not configured' }, 503);

  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';

  // Verify Stripe webhook signature (HMAC-SHA256)
  const valid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!valid) return json({ ok: false, error: 'Invalid signature' }, 401);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  if (event.type !== 'payment_intent.succeeded') {
    return json({ ok: true, ignored: true });
  }

  const pi = event.data?.object;
  const amount_usd = (pi?.amount_received ?? pi?.amount ?? 0) / 100; // Stripe amounts are in cents
  const order_id = pi?.id;
  const ref_code = pi?.metadata?.ref_code ?? null;

  if (!order_id || amount_usd <= 0) {
    return json({ ok: false, error: 'Missing payment intent data' }, 400);
  }

  return recordConversion({ order_id, amount_usd, payment_type: 'stripe', ref_code });
}

// Verify Stripe webhook signature using Web Crypto API (edge-compatible)
async function verifyStripeSignature(payload, header, secret) {
  try {
    // Parse: t=<timestamp>,v1=<hash>[,v1=<hash>...]
    const parts = Object.fromEntries(
      header.split(',').map(p => p.split('='))
    );
    const timestamp = parts.t;
    const expectedSigs = header
      .split(',')
      .filter(p => p.startsWith('v1='))
      .map(p => p.slice(3));

    if (!timestamp || expectedSigs.length === 0) return false;

    // Reject events older than 5 minutes to prevent replay attacks
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computed = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return expectedSigs.some(sig => timingSafeEqual(sig, computed));
  } catch {
    return false;
  }
}

// Constant-time string comparison
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
