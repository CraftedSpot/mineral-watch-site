import { Env } from '../types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

// ---- Google Auth ----

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getAccessToken(saKey: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: saKey.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64urlStr(JSON.stringify(header));
  const claimsB64 = base64urlStr(JSON.stringify(claims));
  const unsignedJwt = headerB64 + '.' + claimsB64;

  const keyData = pemToArrayBuffer(saKey.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt),
  );

  const jwt = unsignedJwt + '.' + base64url(signature);

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json() as any;
  if (tokenData.error) {
    throw new Error(`Google auth: ${tokenData.error} - ${tokenData.error_description}`);
  }
  return tokenData.access_token;
}

// ---- GA4 Report Runner ----

async function runReport(accessToken: string, propertyId: string, body: any): Promise<any> {
  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  const data = await resp.json() as any;
  if (data.error) {
    throw new Error(`GA4: ${data.error.message}`);
  }
  return data;
}

function extractRows(data: any): Array<{ dims: string[]; vals: number[] }> {
  if (!data.rows) return [];
  return data.rows.map((row: any) => ({
    dims: (row.dimensionValues || []).map((d: any) => d.value),
    vals: (row.metricValues || []).map((m: any) => parseFloat(m.value) || 0),
  }));
}

// ---- Main Handler ----

export async function handleAnalytics(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_SA_KEY || !env.GA_PROPERTY_ID) {
    return jsonResponse({ error: 'Google Analytics not configured' }, 503);
  }

  try {
    const saKey = JSON.parse(env.GOOGLE_SA_KEY);
    const accessToken = await getAccessToken(saKey);
    const pid = env.GA_PROPERTY_ID;

    // Run all reports in parallel
    const [overview, dailyTrend, sources, topPages, geo, devices, referrals] = await Promise.all([
      // 1. Overview: 30d vs previous 30d
      runReport(accessToken, pid, {
        dateRanges: [
          { startDate: '30daysAgo', endDate: 'today' },
          { startDate: '60daysAgo', endDate: '31daysAgo' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'engagedSessions' },
        ],
      }),

      // 2. Daily sessions for last 30 days
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),

      // 3. Traffic sources (channel grouping)
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      }),

      // 4. Top pages
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }, { name: 'averageSessionDuration' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 20,
      }),

      // 5. Geographic (US states)
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'region' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),

      // 6. Devices
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),

      // 7. Referral sources
      runReport(accessToken, pid, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),
    ]);

    // Parse overview (two date ranges: current 30d and previous 30d)
    const ovRow = overview.rows?.[0];
    const cur = ovRow?.metricValues?.slice(0, 7).map((m: any) => parseFloat(m.value) || 0) || [0,0,0,0,0,0,0];
    const prev = ovRow?.metricValues?.slice(7, 14).map((m: any) => parseFloat(m.value) || 0) || [0,0,0,0,0,0,0];

    function pctChange(c: number, p: number): number | null {
      if (p === 0) return c > 0 ? 100 : null;
      return Math.round(((c - p) / p) * 1000) / 10;
    }

    const overviewData = {
      sessions: { value: cur[0], change: pctChange(cur[0], prev[0]) },
      users: { value: cur[1], change: pctChange(cur[1], prev[1]) },
      newUsers: { value: cur[2], change: pctChange(cur[2], prev[2]) },
      pageviews: { value: cur[3], change: pctChange(cur[3], prev[3]) },
      avgDuration: { value: Math.round(cur[4]), change: pctChange(cur[4], prev[4]) },
      bounceRate: { value: Math.round(cur[5] * 1000) / 10, change: pctChange(cur[5], prev[5]) },
      engagedSessions: { value: cur[6], change: pctChange(cur[6], prev[6]) },
    };

    // Parse daily trend
    const daily = extractRows(dailyTrend).map(r => ({
      date: r.dims[0], // YYYYMMDD
      sessions: r.vals[0],
      users: r.vals[1],
    }));

    // Parse traffic sources
    const channelData = extractRows(sources).map(r => ({
      channel: r.dims[0],
      sessions: r.vals[0],
      users: r.vals[1],
      newUsers: r.vals[2],
    }));

    // Parse top pages
    const pageData = extractRows(topPages).map(r => ({
      path: r.dims[0],
      pageviews: r.vals[0],
      sessions: r.vals[1],
      avgDuration: Math.round(r.vals[2]),
    }));

    // Parse geo
    const geoData = extractRows(geo).map(r => ({
      region: r.dims[0],
      sessions: r.vals[0],
      users: r.vals[1],
    }));

    // Parse devices
    const deviceData = extractRows(devices).map(r => ({
      device: r.dims[0],
      sessions: r.vals[0],
      users: r.vals[1],
    }));

    // Parse referrals
    const referralData = extractRows(referrals).map(r => ({
      source: r.dims[0],
      sessions: r.vals[0],
      users: r.vals[1],
    }));

    return jsonResponse({
      overview: overviewData,
      daily,
      channels: channelData,
      pages: pageData,
      geo: geoData,
      devices: deviceData,
      referrals: referralData,
    });
  } catch (error: any) {
    console.error('Analytics error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}
