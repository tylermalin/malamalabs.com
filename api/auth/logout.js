/**
 * POST /api/auth/logout — destroys the current advisor session and clears the cookie.
 */
export const config = { runtime: 'edge' };
import { destroySession, clearCookie } from '../../lib/auth.js';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  await destroySession(req);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  });
}
