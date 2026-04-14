// Vercel Edge Function: /api/live
// Unified Cardano on-chain + sensor telemetry endpoint.
// Blockfrost primary, Koios fallback. Cached at the edge for 30s.
// Recent transactions come from the Mālama wallet via Blockfrost/Koios only.
//
// Env vars (set in Vercel dashboard):
//   BLOCKFROST_PROJECT_ID_PREPROD  (required for preprod reads)
//   BLOCKFROST_PROJECT_ID_MAINNET  (required for mainnet reads)
//   MALAMA_ADDR_PREPROD            (Mālama wallet on preprod)
//   MALAMA_ADDR_MAINNET            (Mālama wallet on mainnet, when live)
//   SENSOR_PAGE_URL                (optional: HTML page URL to scrape for field telemetry)

export const config = {
  runtime: 'edge',
};

const BLOCKFROST = {
  preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
};

const KOIOS = {
  preprod: 'https://preprod.koios.rest/api/v1',
  mainnet: 'https://api.koios.rest/api/v1',
};

const DEFAULT_ADDRS = {
  preprod: 'addr_test1vznxx493suqqj4p2my7p4lvsr0xvnu30v9y8363hdr4ax5qv7rlts',
  mainnet: '', // set when live
};

// Edge cache: collapses concurrent visitor requests into one upstream fetch
const CACHE_TTL_SECONDS = 30;

function decodeAssetName(hex) {
  if (!hex) return '';
  try {
    let s = '';
    for (let i = 0; i < hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return s;
  } catch {
    return '';
  }
}

function classifyAsset(decodedName) {
  if (decodedName.startsWith('Sr_')) return 'savecard';
  if (decodedName.startsWith('BA_')) return 'biochar';
  if (decodedName.startsWith('ST_')) return 'soiltest';
  if (decodedName.startsWith('BC_')) return 'credit';
  return 'other';
}

// ---------- BLOCKFROST ----------

async function blockfrostFetch(network, path, projectId) {
  const url = `${BLOCKFROST[network]}${path}`;
  const r = await fetch(url, {
    headers: { project_id: projectId },
    cf: { cacheTtl: CACHE_TTL_SECONDS },
  });
  if (!r.ok) throw new Error(`Blockfrost ${network} ${path}: ${r.status}`);
  return r.json();
}

async function loadFromBlockfrost(network, addr, projectId) {
  // Get address asset inventory + latest block in parallel
  const [addrData, latestBlock] = await Promise.all([
    blockfrostFetch(network, `/addresses/${addr}`, projectId),
    blockfrostFetch(network, `/blocks/latest`, projectId),
  ]);

  // Tally assets by class
  const counts = { savecard: 0, biochar: 0, soiltest: 0, credit: 0, other: 0 };
  const assets = addrData.amount || [];
  for (const a of assets) {
    if (a.unit === 'lovelace') continue;
    // unit = policy_id (56 hex) + asset_name (hex)
    const assetNameHex = a.unit.length > 56 ? a.unit.slice(56) : '';
    const decoded = decodeAssetName(assetNameHex);
    const cls = classifyAsset(decoded);
    counts[cls]++;
  }

  // Pull recent transactions on the address for the feed
  let recentTxs = [];
  try {
    const txs = await blockfrostFetch(
      network,
      `/addresses/${addr}/transactions?count=8&order=desc`,
      projectId
    );
    recentTxs = txs.map(t => ({
      hash: t.tx_hash,
      block: t.block_height,
      block_time: t.block_time,
    }));
  } catch (e) {
    // address may have no tx history yet on mainnet
    recentTxs = [];
  }

  return {
    source: 'blockfrost',
    network,
    counts,
    latest_block: {
      height: latestBlock.height,
      hash: latestBlock.hash,
      time: latestBlock.time,
      slot: latestBlock.slot,
    },
    recent_txs: recentTxs,
  };
}

// ---------- KOIOS FALLBACK ----------

async function koiosFetch(network, path, body) {
  const url = `${KOIOS[network]}${path}`;
  const opts = body
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cf: { cacheTtl: CACHE_TTL_SECONDS },
      }
    : { cf: { cacheTtl: CACHE_TTL_SECONDS } };
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`Koios ${network} ${path}: ${r.status}`);
  return r.json();
}

async function loadFromKoios(network, addr) {
  // Koios uses POST with body for address queries
  const [addrInfo, tipData, addrTxs] = await Promise.all([
    koiosFetch(network, '/address_info', { _addresses: [addr] }),
    koiosFetch(network, '/tip'),
    // /address_txs returns recent transactions involving the address
    koiosFetch(network, '/address_txs', { _addresses: [addr], _after_block_height: 0 }),
  ]);

  const counts = { savecard: 0, biochar: 0, soiltest: 0, credit: 0, other: 0 };
  const utxos = (addrInfo[0] && addrInfo[0].utxo_set) || [];
  for (const utxo of utxos) {
    const assetList = utxo.asset_list || [];
    for (const a of assetList) {
      const decoded = decodeAssetName(a.asset_name || '');
      counts[classifyAsset(decoded)]++;
    }
  }

  const tip = tipData[0] || {};

  // Sort transactions newest first by block_time, take top 10, normalize to homepage shape
  const txList = Array.isArray(addrTxs) ? addrTxs : [];
  const recent_txs = txList
    .sort((a, b) => (b.block_time || 0) - (a.block_time || 0))
    .slice(0, 10)
    .map(tx => ({
      hash: tx.tx_hash,
      block: tx.block_height,
      block_time: tx.block_time,
    }));

  return {
    source: 'koios',
    network,
    counts,
    latest_block: {
      height: tip.block_no,
      hash: tip.hash,
      time: tip.block_time,
      slot: tip.abs_slot,
    },
    recent_txs,
  };
}

// ---------- SENSOR (off-chain telemetry) ----------

async function loadSensor() {
  // Field telemetry is embedded in a public HTML page (Next.js RSC payload).
  // No REST API — scrape once per cache TTL. Override with SENSOR_PAGE_URL.
  const sensorPage = process.env.SENSOR_PAGE_URL ||
    'https://www.dagwelldev.com/sensors/op5pro-field-a';
  try {
    const r = await fetch(sensorPage, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Malama Edge Function)' },
      cf: { cacheTtl: CACHE_TTL_SECONDS },
    });
    if (!r.ok) return null;
    const html = await r.text();

    // Embedded JSON in self.__next_f.push() with escaped quotes
    // (e.g. \"air\": { \"tempC\": … }). Format changed in 2026 from flat
    // air_temp_c aliases to nested air/soil/power objects — support both.
    const grab = (re) => {
      const m = html.match(re);
      return m ? parseFloat(m[1]) : null;
    };

    // Current format: \"air\": { … \"tempC\": … \"humidityPct\": … }, \"soil\": { \"tempC\": … }, \"power\": { \"batteryPct\": … }
    let air_c = grab(/\\"air\\":\s*\{[\s\S]*?\\"tempC\\":\s*([0-9.-]+)/);
    let soil_c = grab(/\\"soil\\":\s*\{[\s\S]*?\\"tempC\\":\s*([0-9.-]+)/);
    let humidity = grab(/\\"air\\":\s*\{[\s\S]*?\\"humidityPct\\":\s*([0-9.-]+)/);
    let battery = grab(/\\"power\\":\s*\{[\s\S]*?\\"batteryPct\\":\s*([0-9.-]+)/);

    // Legacy flat aliases (older HTML)
    if (air_c == null) air_c = grab(/"air_temp_c\\?":\s*([0-9.-]+)/);
    if (soil_c == null) soil_c = grab(/"soil_temp_c\\?":\s*([0-9.-]+)/);
    if (humidity == null) humidity = grab(/"air_humidity\\?":\s*([0-9.-]+)/);
    if (battery == null) battery = grab(/"batteryPct\\?":\s*([0-9.-]+)/);

    let tsMatch = html.match(/\\"timestamp\\":\s*\\"([^"\\]+)/);
    if (!tsMatch) tsMatch = html.match(/"timestamp\\?":\s*\\?"([^"\\]+)/);
    const timestamp = tsMatch ? tsMatch[1] : null;

    const hasAnyReading = [air_c, soil_c, humidity, battery].some(
      (v) => v != null && !Number.isNaN(v)
    );

    // Return partial payload when we at least have a timestamp (page structure OK)
    // so the homepage can show "last recorded" until numeric fields parse again.
    if (!hasAnyReading) {
      if (timestamp) {
        return {
          source: 'pilot_telemetry',
          sensor_id: 'op5pro-field-a',
          soil_c,
          air_c,
          humidity,
          battery,
          timestamp,
          incomplete: true,
        };
      }
      return null;
    }

    return {
      source: 'pilot_telemetry',
      sensor_id: 'op5pro-field-a',
      soil_c,
      air_c,
      humidity,
      battery,
      timestamp,
    };
  } catch {
    return null;
  }
}

// ---------- AI COMPUTE (aipower.fyi) ----------
// Returns headline AI energy stats. Falls back to constants from launch kit
// if AIPOWER_API_URL is not set or upstream is unreachable.

const AIPOWER_FALLBACK = {
  source: 'static',
  video_gen_wh: 944,
  gpt_o3_wh: 39.2,
  water_per_video_l: 1.0,
  efficiency_gap_label: '1.88M',
  models_tracked: 30,
  fas_meta_multiplier: 19000,
};

async function loadAIPower() {
  const url = process.env.AIPOWER_API_URL;
  if (!url) return AIPOWER_FALLBACK;
  try {
    const r = await fetch(url, {
      cf: { cacheTtl: CACHE_TTL_SECONDS },
    });
    if (!r.ok) return AIPOWER_FALLBACK;
    const data = await r.json();
    return {
      source: 'aipower.fyi',
      video_gen_wh: data.video_gen_wh ?? data.video_generation_wh ?? AIPOWER_FALLBACK.video_gen_wh,
      gpt_o3_wh: data.gpt_o3_wh ?? data.gpto3_wh ?? AIPOWER_FALLBACK.gpt_o3_wh,
      water_per_video_l: data.water_per_video_l ?? data.water_l ?? AIPOWER_FALLBACK.water_per_video_l,
      efficiency_gap_label: data.efficiency_gap_label ?? data.gap ?? AIPOWER_FALLBACK.efficiency_gap_label,
      models_tracked: data.models_tracked ?? data.model_count ?? AIPOWER_FALLBACK.models_tracked,
      fas_meta_multiplier: data.fas_meta_multiplier ?? AIPOWER_FALLBACK.fas_meta_multiplier,
      timestamp: data.timestamp || null,
    };
  } catch {
    return AIPOWER_FALLBACK;
  }
}

// ---------- HANDLER ----------

export default async function handler(req) {
  const url = new URL(req.url);
  const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'preprod';

  const projectId =
    network === 'mainnet'
      ? process.env.BLOCKFROST_PROJECT_ID_MAINNET
      : process.env.BLOCKFROST_PROJECT_ID_PREPROD;

  const addr =
    network === 'mainnet'
      ? process.env.MALAMA_ADDR_MAINNET || DEFAULT_ADDRS.mainnet
      : process.env.MALAMA_ADDR_PREPROD || DEFAULT_ADDRS.preprod;

  // Off-chain blocks are always available regardless of chain config
  const [sensor, aiCompute] = await Promise.all([
    loadSensor(),
    loadAIPower(),
  ]);

  // If no address is configured for this network, return a graceful empty state
  // rather than 503. The mainnet wallet is intentionally empty until Q2 2026.
  if (!addr) {
    return new Response(
      JSON.stringify({
        ok: true,
        network,
        address: null,
        fetched_at: new Date().toISOString(),
        chain: {
          ok: false,
          status: 'not_configured',
          message: network === 'mainnet'
            ? 'Mainnet launches Q2 2026 after audit. Preprod is live now.'
            : `${network} not yet configured`,
          assets_total: 0,
          tx_count: 0,
          recent_txs: [],
        },
        sensor,
        ai_compute: aiCompute,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`,
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  let chain = null;
  let chainError = null;

  // Try Blockfrost first if we have a project id
  if (projectId) {
    try {
      chain = await loadFromBlockfrost(network, addr, projectId);
    } catch (e) {
      chainError = `blockfrost: ${e.message}`;
    }
  }

  // Fall back to Koios if Blockfrost failed or no project id
  if (!chain) {
    try {
      chain = await loadFromKoios(network, addr);
    } catch (e) {
      return new Response(
        JSON.stringify({
          ok: true,
          network,
          address: addr,
          fetched_at: new Date().toISOString(),
          chain: {
            ok: false,
            status: 'unavailable',
            message: `Indexers temporarily unavailable. Try again in 30s.`,
            blockfrost_error: chainError,
            koios_error: e.message,
            assets_total: 0,
            tx_count: 0,
            recent_txs: [],
          },
          sensor,
          ai_compute: aiCompute,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, s-maxage=10, stale-while-revalidate=30`,
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  }

  const chainOut = { ...chain, ok: true };

  const payload = {
    ok: true,
    network,
    address: addr,
    fetched_at: new Date().toISOString(),
    chain: chainOut,
    sensor,
    ai_compute: aiCompute,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
