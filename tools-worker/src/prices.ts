// ══════════════════════════════════════════════
//  LIVE COMMODITY PRICES
//  Primary: OilPriceAPI (real-time WTI + natural gas)
//  Fallback: EIA API v2 (delayed spot prices)
//  Caches in KV for 2 hours to minimize API calls
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
  OILPRICE_API_KEY: string;
}

const KV_KEY = 'commodity-prices';
const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours

const OILPRICE_BASE = 'https://api.oilpriceapi.com/v1/prices/latest';

// ── OilPriceAPI (primary) ──
function toISODate(dateStr: string): string {
  // "2026-02-19T06:15:30.889Z" → "2026-02-19"
  return dateStr.slice(0, 10);
}

async function fetchOilPriceAPI(apiKey: string): Promise<PriceData> {
  const result: PriceData = {
    wti: null,
    henryHub: null,
    updatedAt: new Date().toISOString(),
    source: 'OilPriceAPI',
    cached: false,
  };

  const headers = { 'Authorization': `Token ${apiKey}` };

  const [wtiRes, gasRes] = await Promise.allSettled([
    fetch(`${OILPRICE_BASE}?by_code=WTI_USD`, { headers }),
    fetch(`${OILPRICE_BASE}?by_code=NATURAL_GAS_USD`, { headers }),
  ]);

  // Parse WTI
  if (wtiRes.status === 'fulfilled' && wtiRes.value.ok) {
    try {
      const json: any = await wtiRes.value.json();
      if (json.status === 'success' && json.data?.price) {
        result.wti = {
          price: Math.round(json.data.price * 100) / 100,
          date: toISODate(json.data.created_at),
          unit: '$/BBL',
        };
      }
    } catch { /* swallow */ }
  }

  // Parse Natural Gas
  if (gasRes.status === 'fulfilled' && gasRes.value.ok) {
    try {
      const json: any = await gasRes.value.json();
      if (json.status === 'success' && json.data?.price) {
        result.henryHub = {
          price: Math.round(json.data.price * 100) / 100,
          date: toISODate(json.data.created_at),
          unit: '$/MCF',
        };
      }
    } catch { /* swallow */ }
  }

  return result;
}

// ── EIA API v2 (fallback) ──
function wtiUrl(apiKey: string): string {
  return `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${apiKey}&frequency=daily&data[0]=value&facets[product][]=EPCWTI&sort[0][column]=period&sort[0][direction]=desc&length=1`;
}

function henryHubUrl(apiKey: string): string {
  return `https://api.eia.gov/v2/natural-gas/pri/fut/data/?api_key=${apiKey}&frequency=daily&data[0]=value&facets[series][]=RNGWHHD&sort[0][column]=period&sort[0][direction]=desc&length=1`;
}

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

async function fetchEIAPrices(apiKey: string): Promise<PriceData> {
  const result: PriceData = {
    wti: null,
    henryHub: null,
    updatedAt: new Date().toISOString(),
    source: 'U.S. Energy Information Administration',
    cached: false,
  };

  const [wtiRes, gasRes] = await Promise.allSettled([
    fetch(wtiUrl(apiKey)),
    fetch(henryHubUrl(apiKey)),
  ]);

  if (wtiRes.status === 'fulfilled' && wtiRes.value.ok) {
    try {
      const data = await wtiRes.value.json();
      const parsed = parseEiaResponse(data);
      if (parsed) {
        result.wti = { price: parsed.price, date: parsed.date, unit: '$/BBL' };
      }
    } catch { /* swallow */ }
  }

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
    'Cache-Control': 'public, max-age=900, s-maxage=1800',
  };

  // Check KV cache first
  try {
    const cached = await env.PRICES_KV.get(KV_KEY, 'json') as PriceData | null;
    if (cached) {
      cached.cached = true;
      return new Response(JSON.stringify(cached), { headers });
    }
  } catch { /* cache miss, continue */ }

  // Primary: OilPriceAPI
  let prices: PriceData | null = null;
  if (env.OILPRICE_API_KEY) {
    try {
      prices = await fetchOilPriceAPI(env.OILPRICE_API_KEY);
    } catch { /* fall through to EIA */ }
  }

  // Fallback: EIA if OilPriceAPI returned nothing
  if ((!prices?.wti && !prices?.henryHub) && env.EIA_API_KEY) {
    try {
      prices = await fetchEIAPrices(env.EIA_API_KEY);
    } catch { /* swallow */ }
  }

  // Last resort: empty response
  if (!prices) {
    prices = {
      wti: null,
      henryHub: null,
      updatedAt: new Date().toISOString(),
      source: 'No price data available',
      cached: false,
    };
  }

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
