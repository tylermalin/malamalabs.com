/**
 * GET /api/admin/hex?action=geocode&address=...
 *   -> { lat, lon, displayName }
 * GET /api/admin/hex?action=hex&lat=..&lon=..&res=..
 *   -> { h3Index, resolution, areaKm2, boundary }
 * GET /api/admin/hex?action=address-to-hex&address=...&res=..
 *   -> combined geocode + H3 in one call
 * GET /api/admin/hex?action=health
 *   -> { ok, provider, resolution }
 *
 * Required header: Authorization: Bearer <ADMIN_SECRET>
 *
 * Geocoding provider is swappable via GEOCODE_PROVIDER:
 *   - "nominatim" (default): OpenStreetMap Nominatim, no API key, low-volume only
 *   - "google": Google Maps Geocoding API, requires GOOGLE_MAPS_API_KEY
 *   - "mapbox": Mapbox Geocoding API, requires MAPBOX_TOKEN
 *
 * Requires: ADMIN_SECRET
 */
export const config = { runtime: 'edge' };

// Import the browser build directly: Vercel's Edge bundler doesn't apply
// h3-js's package.json "browser" field remap, so the default entry point
// pulls in a Node fs/path fallback for its WASM loader that Edge rejects.
import * as h3 from 'h3-js/dist/browser/h3-js.es.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function isAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

const GEOCODE_PROVIDER = (process.env.GEOCODE_PROVIDER || 'nominatim').toLowerCase();
const H3_RESOLUTION = Number(process.env.H3_RESOLUTION || 9);
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'ops@malamalabs.com';

async function geocodeWithNominatim(address) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({ q: address, format: 'json', limit: '1', addressdetails: '1' }).toString();

  const res = await fetch(url, {
    headers: {
      // Nominatim's usage policy requires a descriptive User-Agent with contact info.
      'User-Agent': `MalamaLabsHexBuilder/1.0 (${CONTACT_EMAIL})`,
      'Accept-Language': 'en',
    },
  });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);

  const data = await res.json();
  if (!data || data.length === 0) return null;

  const best = data[0];
  return { lat: parseFloat(best.lat), lon: parseFloat(best.lon), displayName: best.display_name };
}

async function geocodeWithGoogle(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json?' +
    new URLSearchParams({ address, key }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Geocoding request failed: ${res.status}`);

  const data = await res.json();
  if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;

  const best = data.results[0];
  return { lat: best.geometry.location.lat, lon: best.geometry.location.lng, displayName: best.formatted_address };
}

async function geocodeWithMapbox(address) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error('MAPBOX_TOKEN is not set');

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?` +
    new URLSearchParams({ access_token: token, limit: '1' }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox Geocoding request failed: ${res.status}`);

  const data = await res.json();
  if (!data.features || data.features.length === 0) return null;

  const best = data.features[0];
  return { lat: best.center[1], lon: best.center[0], displayName: best.place_name };
}

async function geocode(address) {
  if (GEOCODE_PROVIDER === 'google') return geocodeWithGoogle(address);
  if (GEOCODE_PROVIDER === 'mapbox') return geocodeWithMapbox(address);
  return geocodeWithNominatim(address);
}

function toHex(lat, lon, resolution) {
  const h3Index = h3.latLngToCell(lat, lon, resolution);
  const boundary = h3.cellToBoundary(h3Index);
  const areaKm2 = h3.cellArea(h3Index, 'km2');
  return { h3Index, resolution, areaKm2, boundary };
}

export default async function handler(req) {
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'health';

  try {
    if (action === 'health') {
      return json({ ok: true, provider: GEOCODE_PROVIDER, resolution: H3_RESOLUTION });
    }

    if (action === 'geocode') {
      const address = (searchParams.get('address') || '').trim();
      if (!address) return json({ error: "Missing 'address' query parameter." }, 400);
      const result = await geocode(address);
      if (!result) return json({ error: 'Address could not be geocoded. Try a more specific address.' }, 404);
      return json(result);
    }

    if (action === 'hex') {
      const lat = parseFloat(searchParams.get('lat'));
      const lon = parseFloat(searchParams.get('lon'));
      const resolution = searchParams.get('res') ? Number(searchParams.get('res')) : H3_RESOLUTION;
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        return json({ error: "Missing or invalid 'lat'/'lon' query parameters." }, 400);
      }
      if (resolution < 0 || resolution > 15) return json({ error: 'H3 resolution must be between 0 and 15.' }, 400);
      return json(toHex(lat, lon, resolution));
    }

    if (action === 'address-to-hex') {
      const address = (searchParams.get('address') || '').trim();
      const resolution = searchParams.get('res') ? Number(searchParams.get('res')) : H3_RESOLUTION;
      if (!address) return json({ error: "Missing 'address' query parameter." }, 400);
      const geo = await geocode(address);
      if (!geo) return json({ error: 'Address could not be geocoded. Try a more specific address.' }, 404);
      return json({ ...geo, ...toHex(geo.lat, geo.lon, resolution) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[admin/hex]', action, err);
    return json({ error: err instanceof Error ? err.message : 'Server error' }, 502);
  }
}
