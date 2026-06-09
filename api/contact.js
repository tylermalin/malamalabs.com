/**
 * POST /api/contact — Resend-backed form capture for malamalabs.com.
 * Body JSON: { email (required), name?, firm?, source?, allocation?, materials?[], accredited?, message? }
 * Sends a notification to Info@malamaproject.org (reply-to the sender) + a confirmation to the sender.
 * Requires RESEND_API_KEY in the Vercel project env. From domain (malamalabs.com) must be verified in Resend.
 */
export const config = { runtime: 'edge' };

const FROM   = 'Mālama Labs <noreply@malamalabs.com>';
const NOTIFY = ['info@malamaproject.org', 'tyler@malamalabs.com', 'jeffrey@malamalabs.com'];
const RESEND = 'https://api.resend.com/emails';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function send(key, { to, subject, html, text, replyTo }) {
  const body = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  const r = await fetch(RESEND, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let p;
  try { p = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const email = String(p.email || '').trim();
  const name = String(p.name || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'A valid email is required' }, 400);
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return json({ ok: false, error: 'Email is not configured yet. Please reach tyler@malamalabs.com directly.' }, 503);
  }

  const source = String(p.source || 'Website').trim().slice(0, 80);
  const firm = String(p.firm || '').trim().slice(0, 200);
  const allocation = String(p.allocation || '').trim().slice(0, 80);
  const materials = Array.isArray(p.materials) ? p.materials.join(' · ') : String(p.materials || '').slice(0, 500);
  const accredited = p.accredited ? 'Certified (Rule 501, Reg D)' : '';
  const message = String(p.message || '').trim().slice(0, 4000);

  const rows = [['Source', source], ['Name', name], ['Firm', firm], ['Email', email],
                ['Allocation', allocation], ['Materials', materials], ['Accredited', accredited], ['Message', message]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:5px 14px 5px 0;color:#5f6c5f;font-family:monospace;font-size:12px;vertical-align:top;text-transform:uppercase;letter-spacing:.05em">${k}</td><td style="padding:5px 0;color:#111;font-size:14px;line-height:1.5">${esc(v)}</td></tr>`)
    .join('');

  const notifyHtml = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:620px"><h2 style="font-size:18px;margin:0 0 14px;color:#111">New ${esc(source)} lead — malamalabs.com</h2><table style="border-collapse:collapse">${rows}</table></div>`;
  const confirmHtml = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;font-size:14px;line-height:1.65;color:#1a1a1a"><p>${name ? `Thanks, ${esc(name.split(' ')[0])}` : 'Thanks'} — we received your ${esc(source.toLowerCase())} request.</p><p>The Mālama Labs team will follow up shortly. For anything time-sensitive, reply to this email or reach tyler@malamalabs.com.</p><p style="color:#5f6c5f">Mālama Labs · Hardware-signed truth for physical-world data.</p></div>`;

  const notified = await send(key, {
    to: NOTIFY, replyTo: email,
    subject: `New ${source} lead — ${name || email}${firm ? ` (${firm})` : ''}`,
    html: notifyHtml, text: `${source} lead\nName: ${name}\nEmail: ${email}\nFirm: ${firm}\nAllocation: ${allocation}\nMaterials: ${materials}\nMessage: ${message}`,
  });
  // Confirmation is best-effort; don't fail the request if it bounces.
  await send(key, { to: email, subject: 'We received your request — Mālama Labs', html: confirmHtml, text: 'Thanks — we received your request. The Mālama Labs team will follow up shortly.' }).catch(() => false);

  if (!notified) return json({ ok: false, error: 'Could not send right now. Please email tyler@malamalabs.com.' }, 502);
  return json({ ok: true });
}
