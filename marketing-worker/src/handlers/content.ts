import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = 'MKT: Content Pipeline';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function airtableFetch(env: Env, path: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  return resp.json();
}

// Map flat frontend keys to Airtable field names
function toAirtableFields(body: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  if (body.title !== undefined) fields['Title'] = body.title;
  if (body.channel !== undefined) fields['Channel'] = body.channel;
  if (body.distribution !== undefined) fields['Distribution'] = body.distribution;
  if (body.status !== undefined) fields['Status'] = body.status;
  if (body.priority !== undefined) fields['Priority'] = body.priority;
  if (body.target_date !== undefined) fields['Target Date'] = body.target_date;
  if (body.notes !== undefined) fields['Notes'] = body.notes;
  return fields;
}

// Map Airtable record to flat frontend format
function toFlatRecord(record: any): any {
  const f = record.fields || {};
  return {
    id: record.id,
    title: f['Title'] || '',
    channel: f['Channel'] || '',
    distribution: f['Distribution'] || '',
    status: f['Status'] || '',
    priority: f['Priority'] || '',
    target_date: f['Target Date'] || null,
    notes: f['Notes'] || '',
  };
}

export async function handleContent(request: Request, env: Env, path: string, method: string): Promise<Response> {
  const match = path.match(/^\/api\/marketing\/content\/?(rec[A-Za-z0-9]+)?$/);
  if (!match && path !== '/api/marketing/content') {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const recordId = match?.[1];

  // GET — list all
  if (method === 'GET' && !recordId) {
    const data = await airtableFetch(env, '?sort%5B0%5D%5Bfield%5D=Title&sort%5B0%5D%5Bdirection%5D=asc');
    const records = (data.records || []).map(toFlatRecord);
    return jsonResponse(records);
  }

  // POST — create
  if (method === 'POST' && !recordId) {
    const body = await request.json() as Record<string, any>;
    const fields = body.fields ? body.fields : toAirtableFields(body);
    const data = await airtableFetch(env, '', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    return jsonResponse(toFlatRecord(data));
  }

  // PUT or PATCH — update
  if ((method === 'PATCH' || method === 'PUT') && recordId) {
    const body = await request.json() as Record<string, any>;
    const fields = body.fields ? body.fields : toAirtableFields(body);
    const data = await airtableFetch(env, `/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
    return jsonResponse(toFlatRecord(data));
  }

  // DELETE
  if (method === 'DELETE' && recordId) {
    const data = await airtableFetch(env, `/${recordId}`, { method: 'DELETE' });
    return jsonResponse(data);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
