/**
 * POST /api/admin/upload?filename=headshot.jpg — uploads an image to Vercel Blob
 * and returns { ok, url }. Body is the raw file bytes.
 *
 * Node.js runtime (NOT edge): @vercel/blob pulls in undici/node:* modules that
 * the Edge runtime rejects. Node is the recommended default anyway.
 *
 * Requires a provisioned Blob store (BLOB_READ_WRITE_TOKEN). If it isn't set,
 * returns 503 so the admin UI can fall back to pasting an image URL.
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 */
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(503).json({ ok: false, error: 'blob_not_configured', message: 'Vercel Blob store not provisioned — paste an image URL instead.' });
  }

  const name = String(req.query?.filename || 'headshot').replace(/[^a-zA-Z0-9._-]/g, '_');
  const ct = req.headers['content-type'] || 'application/octet-stream';
  if (!ct.startsWith('image/')) return res.status(400).json({ ok: false, error: 'Only image uploads are allowed' });

  // Read the raw request body from the Node stream.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) return res.status(400).json({ ok: false, error: 'Empty file' });
  if (bytes.length > 5 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'Max 5MB' });

  try {
    const blob = await put(`advisors/${Date.now()}-${name}`, bytes, { access: 'public', contentType: ct, token });
    return res.status(200).json({ ok: true, url: blob.url });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'upload_failed', detail: String(err?.message || err).slice(0, 200) });
  }
}
