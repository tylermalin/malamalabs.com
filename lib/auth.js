// Passwordless (magic-link) session helpers for the advisor portal.
// Sessions are opaque random tokens stored server-side in advisor_sessions;
// the cookie carries only the token, so there is nothing to forge.
import { sql } from './db.js';

export const SESSION_COOKIE = 'adv_session';
const SESSION_DAYS = 30;
const LOGIN_TTL_MIN = 20;

// 256 bits of randomness as hex (edge-compatible).
export function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function parseCookies(req) {
  const raw = req.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Create a one-time login token for magic-link email.
export async function createLoginToken(advisorId) {
  const token = randomToken();
  const expires = new Date(Date.now() + LOGIN_TTL_MIN * 60 * 1000).toISOString();
  await sql`INSERT INTO login_tokens (token, advisor_id, expires_at) VALUES (${token}, ${advisorId}, ${expires})`;
  return token;
}

// Redeem a login token (single-use, unexpired) -> a new session token, or null.
export async function redeemLoginToken(token) {
  if (!token) return null;
  const [row] = await sql`
    SELECT advisor_id FROM login_tokens
    WHERE token = ${token} AND used = false AND expires_at > now()
    LIMIT 1
  `;
  if (!row) return null;
  await sql`UPDATE login_tokens SET used = true WHERE token = ${token}`;
  const session = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await sql`INSERT INTO advisor_sessions (token, advisor_id, expires_at) VALUES (${session}, ${row.advisor_id}, ${expires})`;
  return session;
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

// Resolve the logged-in advisor from the session cookie, or null. Only active
// advisors with an unexpired session are returned.
export async function currentAdvisor(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const [row] = await sql`
    SELECT a.*
    FROM advisor_sessions s
    JOIN advisors a ON a.id = s.advisor_id
    WHERE s.token = ${token} AND s.expires_at > now() AND a.active = true
    LIMIT 1
  `;
  return row || null;
}

export async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await sql`DELETE FROM advisor_sessions WHERE token = ${token}`.catch(() => {});
}
