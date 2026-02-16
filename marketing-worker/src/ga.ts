// Google Analytics Data API v1 integration using service account JWT auth

import { Env } from './types';

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

  // Import the private key
  const keyData = pemToArrayBuffer(saKey.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Sign
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt),
  );

  const jwt = unsignedJwt + '.' + base64url(signature);

  // Exchange JWT for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json() as any;
  if (tokenData.error) {
    throw new Error(`Google auth error: ${tokenData.error} - ${tokenData.error_description}`);
  }
  return tokenData.access_token;
}

export interface GAMetrics {
  sessions30d: number;
  users30d: number;
  newUsers30d: number;
  pageviews30d: number;
  sessions7d: number;
  users7d: number;
}

export async function fetchGAMetrics(env: Env): Promise<GAMetrics> {
  const saKey = JSON.parse(env.GOOGLE_SA_KEY);
  const accessToken = await getAccessToken(saKey);
  const propertyId = env.GA_PROPERTY_ID;

  // Run two date ranges in one request: 30 days and 7 days
  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [
          { startDate: '30daysAgo', endDate: 'today' },
          { startDate: '7daysAgo', endDate: 'today' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
        ],
      }),
    },
  );

  const data = await resp.json() as any;
  if (data.error) {
    throw new Error(`GA4 API error: ${data.error.message}`);
  }

  // Response has rows[0] with dateRangeValues for each date range
  const row = data.rows?.[0];
  if (!row) {
    return { sessions30d: 0, users30d: 0, newUsers30d: 0, pageviews30d: 0, sessions7d: 0, users7d: 0 };
  }

  // metricValues is an array of arrays: [30d values, 7d values]
  const vals30d = row.metricValues?.slice(0, 4) || [];
  const vals7d = row.metricValues?.slice(4, 8) || [];

  return {
    sessions30d: parseInt(vals30d[0]?.value || '0', 10),
    users30d: parseInt(vals30d[1]?.value || '0', 10),
    newUsers30d: parseInt(vals30d[2]?.value || '0', 10),
    pageviews30d: parseInt(vals30d[3]?.value || '0', 10),
    sessions7d: parseInt(vals7d[0]?.value || '0', 10),
    users7d: parseInt(vals7d[1]?.value || '0', 10),
  };
}
