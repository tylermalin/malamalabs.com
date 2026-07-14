/**
 * POST /api/auth/request-link  { email }
 * Sends a one-time magic sign-in link to a known advisor's email (via Resend).
 * Always returns { ok: true } — never reveals whether an email is registered.
 */
export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';
import { createLoginToken } from '../../lib/auth.js';

const RESEND = process.env.RESEND_BASE_URL || 'https://api.resend.com/emails';
const FROM = 'Mālama Labs <noreply@malamalabs.com>';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

function origin(req) {
  // Prefer the request origin so links work on any deployment/host.
  try { return new URL(req.url).origin; } catch { return 'https://malamalabs.com'; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'A valid email is required' }, 400);
  }

  const [advisor] = await sql`SELECT id, name, email FROM advisors WHERE lower(email) = ${email} AND active = true LIMIT 1`;
  // Only send if the advisor exists; response is identical either way.
  if (advisor) {
    const token = await createLoginToken(advisor.id);
    const link = `${origin(req)}/api/auth/callback?t=${token}`;
    const key = process.env.RESEND_API_KEY;
    if (key) {
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;font-size:15px;line-height:1.6;color:#1a1a1a">
        <p>Hi ${advisor.name ? String(advisor.name).split(' ')[0] : 'there'},</p>
        <p>Use the button below to sign in to your Mālama Labs advisor portal. This link expires in 20 minutes and can be used once.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#0a0e0a;color:#c4f061;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Sign in to your portal →</a></p>
        <p style="color:#5f6c5f;font-size:13px">If you didn't request this, you can ignore this email.</p>
      </div>`;
      await fetch(RESEND, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [advisor.email || email],
          subject: 'Your Mālama Labs advisor sign-in link',
          html, text: `Sign in to your Mālama advisor portal (expires in 20 min): ${link}`,
        }),
      }).catch(() => {});
    }
  }

  return json({ ok: true });
}
