// ══════════════════════════════════════════════
//  LIVE COMMODITY PRICES — EIA API v2
//  Fetches WTI crude & Henry Hub nat gas spot prices
//  Caches in KV for 6 hours to minimize API calls
// ══════════════════════════════════════════════

export interface PriceData {
  wti: { price: number; date: string; unit: string } | null;
  henryHub: { price: number; date: string; unit: string } | null;
  updatedAt: string;
  source: string;
  cached: boolean;
}

interface Env {
  PRICES_KV: KVNamespace;
  EIA_API_KEY: string;
}

const KV_KEY = 'commodity-prices';
const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours — EIA updates daily ~5pm ET

// ── EIA API v2 endpoints ──
function wtiUrl(apiKey: string): string {
  return `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${apiKey}&frequency=daily&data[0]=value&facets[product][]=EPCWTI&sort[0][column]=period&sort[0][direction]=desc&length=1`;
}

function henryHubUrl(apiKey: string): string {
  return `https://api.eia.gov/v2/natural-gas/pri/fut/data/?api_key=${apiKey}&frequency=daily&data[0]=value&facets[series][]=RNGWHHD&sort[0][column]=period&sort[0][direction]=desc&length=1`;
}

// ── Parse EIA response ──
function parseEiaResponse(data: any): { price: number; date: string } | null {
  try {
    const rows = data?.response?.data;
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const price = parseFloat(row.value);
    if (isNaN(price)) return null;
    return { price, date: row.period };
  } catch {
    return null;
  }
}

// ── Fetch fresh prices from EIA ──
async function fetchFreshPrices(apiKey: string): Promise<PriceData> {
  const result: PriceData = {
    wti: null,
    henryHub: null,
    updatedAt: new Date().toISOString(),
    source: 'U.S. Energy Information Administration',
    cached: false,
  };

  // Fetch both in parallel
  const [wtiRes, gasRes] = await Promise.allSettled([
    fetch(wtiUrl(apiKey)),
    fetch(henryHubUrl(apiKey)),
  ]);

  // Parse WTI
  if (wtiRes.status === 'fulfilled' && wtiRes.value.ok) {
    try {
      const data = await wtiRes.value.json();
      const parsed = parseEiaResponse(data);
      if (parsed) {
        result.wti = { price: parsed.price, date: parsed.date, unit: '$/BBL' };
      }
    } catch { /* swallow */ }
  }

  // Parse Henry Hub
  if (gasRes.status === 'fulfilled' && gasRes.value.ok) {
    try {
      const data = await gasRes.value.json();
      const parsed = parseEiaResponse(data);
      if (parsed) {
        result.henryHub = { price: parsed.price, date: parsed.date, unit: '$/MCF' };
      }
    } catch { /* swallow */ }
  }

  return result;
}

// ── Main handler ──
export async function handlePricesRequest(env: Env): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=900, s-maxage=1800', // CDN cache 30min, browser 15min
  };

  // Check KV cache first
  try {
    const cached = await env.PRICES_KV.get(KV_KEY, 'json') as PriceData | null;
    if (cached) {
      cached.cached = true;
      return new Response(JSON.stringify(cached), { headers });
    }
  } catch { /* cache miss, continue */ }

  // No cache — fetch fresh
  if (!env.EIA_API_KEY) {
    const fallback: PriceData = {
      wti: null,
      henryHub: null,
      updatedAt: new Date().toISOString(),
      source: 'Defaults — EIA API key not configured',
      cached: false,
    };
    return new Response(JSON.stringify(fallback), { headers });
  }

  const prices = await fetchFreshPrices(env.EIA_API_KEY);

  // Cache in KV (only if we got at least one price)
  if (prices.wti || prices.henryHub) {
    try {
      await env.PRICES_KV.put(KV_KEY, JSON.stringify(prices), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    } catch { /* non-fatal */ }
  }

  return new Response(JSON.stringify(prices), { headers });
}
