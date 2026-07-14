/**
 * POST /api/admin/upload?filename=headshot.jpg — uploads an image to Vercel Blob
 * and returns { ok, url }. Body is the raw file bytes.
 *
 * Requires a provisioned Blob store (BLOB_READ_WRITE_TOKEN). If it isn't set,
 * returns 503 so the admin UI can fall back to pasting an image URL.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
export const config = { runtime: 'edge' };
import { put } from '@vercel/blob';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return json({ ok: false, error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return json({ ok: false, error: 'blob_not_configured', message: 'Vercel Blob store not provisioned — paste an image URL instead.' }, 503);
  }

  const url = new URL(req.url);
  const name = (url.searchParams.get('filename') || 'headshot').replace(/[^a-zA-Z0-9._-]/g, '_');
  const ct = req.headers.get('content-type') || 'application/octet-stream';
  if (!ct.startsWith('image/')) return json({ ok: false, error: 'Only image uploads are allowed' }, 400);

  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) return json({ ok: false, error: 'Empty file' }, 400);
  if (bytes.byteLength > 5 * 1024 * 1024) return json({ ok: false, error: 'Max 5MB' }, 400);

  try {
    const blob = await put(`advisors/${Date.now()}-${name}`, bytes, {
      access: 'public', contentType: ct, token,
    });
    return json({ ok: true, url: blob.url });
  } catch (err) {
    return json({ ok: false, error: 'upload_failed', detail: String(err?.message || err).slice(0, 200) }, 502);
  }
}
