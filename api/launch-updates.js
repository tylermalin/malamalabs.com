/**
 * POST /api/launch-updates
 * Body: JSON { name?: string, email: string, source?: string }
 * Forwards to Formspree when FORMSPREE_HEX_LAUNCH_ID is set in Vercel env.
 */
export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const email = String(payload.email || '').trim();
  const name = String(payload.name || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Valid email is required' }, 400);
  }

  const formId = process.env.FORMSPREE_HEX_LAUNCH_ID;
  if (!formId) {
    return json(
      {
        ok: false,
        error: 'not_configured',
        message: 'Add FORMSPREE_HEX_LAUNCH_ID in Vercel project env (Formspree form id).',
      },
      503
    );
  }

  const r = await fetch(`https://formspree.io/f/${formId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      email,
      name: name || '(not provided)',
      _subject: 'Hex Node launchpad — get updates',
      source: payload.source || 'malamalabs.com',
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    return json({ ok: false, error: 'delivery_failed', detail: t.slice(0, 200) }, 502);
  }

  return json({ ok: true }, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
