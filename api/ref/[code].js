/**
 * GET /ref/:code  (rewritten from /api/ref/:code via vercel.json)
 *
 * 1. Looks up the ref link in the DB to get the target URL.
 * 2. Sets a `_ref` cookie (30-day attribution window).
 * 3. Logs the click.
 * 4. Redirects to the target page (Hex Node purchase page by default).
 *
 * Requires: DATABASE_URL (Neon connection string)
 */
export const config = { runtime: 'edge' };

import { sql } from '../../lib/db.js';

const DEFAULT_TARGET = 'https://malamalabs.com/platform/';

export default async function handler(req) {
  // Parse the code from the URL path: /api/ref/xyz → xyz
  const url = new URL(req.url);
  const code = url.pathname.split('/').filter(Boolean).pop() || '';

  if (!code || code === '[code]') {
    return Response.redirect('https://malamalabs.com/', 302);
  }

  // Look up the ref link
  let target = DEFAULT_TARGET;
  try {
    const [link] = await sql`
      SELECT rl.target_url
      FROM ref_links rl
      WHERE rl.code = ${code} AND rl.active = true
      LIMIT 1
    `;
    if (link?.target_url) target = link.target_url;
  } catch {
    // DB unavailable — still redirect to default
  }

  // Log the click (best-effort; don't fail the redirect if this errors)
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    const ua = req.headers.get('user-agent') ?? '';
    const referrer = req.headers.get('referer') ?? '';
    await sql`
      INSERT INTO clicks (ref_code, ip, user_agent, referrer)
      VALUES (${code}, ${ip}, ${ua}, ${referrer})
    `;
  } catch {
    // Non-fatal
  }

  // Set 30-day attribution cookie and redirect
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Set-Cookie': `_ref=${encodeURIComponent(code)}; Path=/; Expires=${expires}; SameSite=Lax; Secure`,
    },
  });
}
