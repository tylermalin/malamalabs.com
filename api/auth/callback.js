/**
 * GET /api/auth/callback?t=<login_token>
 * Redeems a one-time magic-link token, sets the session cookie, and redirects
 * to the advisor portal. Invalid/expired tokens redirect to the login page.
 */
export const config = { runtime: 'edge' };
import { redeemLoginToken, sessionCookie } from '../../lib/auth.js';

export default async function handler(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const session = await redeemLoginToken(token);

  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/advisor-portal/?error=expired' } });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: '/advisor-portal/', 'Set-Cookie': sessionCookie(session) },
  });
}
