import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = 'MKT: Forum Monitor';

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

function toFlatRecord(record: any): any {
  const f = record.fields || {};
  return {
    id: record.id,
    title: f['Post Title'] || '',
    url: f['Post URL'] || '',
    author: f['Author'] || '',
    posted_at: f['Posted At'] || null,
    category: f['Category'] || '',
    detected_location: f['Detected Location'] || '',
    detected_county: f['Detected County'] || '',
    detected_str: f['Detected STR'] || '',
    excerpt: f['Post Excerpt'] || '',
    occ_data: f['OCC Data Found'] || '',
    wells_found: f['Wells Found'] || null,
    active_operators: f['Active Operators'] || '',
    suggested_response: f['Suggested Response'] || '',
    response_status: f['Response Status'] || 'New',
    responded_at: f['Responded At'] || null,
    result: f['Result'] || '',
    notes: f['Notes'] || '',
  };
}

function toAirtableFields(body: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  if (body.response_status !== undefined) fields['Response Status'] = body.response_status;
  if (body.responded_at !== undefined) fields['Responded At'] = body.responded_at;
  if (body.result !== undefined) fields['Result'] = body.result;
  if (body.notes !== undefined) fields['Notes'] = body.notes;
  if (body.suggested_response !== undefined) fields['Suggested Response'] = body.suggested_response;
  return fields;
}

export async function handleForum(request: Request, env: Env, path: string, method: string): Promise<Response> {
  const match = path.match(/^\/api\/marketing\/forum\/?(rec[A-Za-z0-9]+)?$/);
  if (!match && path !== '/api/marketing/forum') {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const recordId = match?.[1];

  // GET — list all (sorted by Posted At descending)
  if (method === 'GET' && !recordId) {
    const data = await airtableFetch(env, '?sort%5B0%5D%5Bfield%5D=Posted+At&sort%5B0%5D%5Bdirection%5D=desc');
    const records = (data.records || []).map(toFlatRecord);
    return jsonResponse(records);
  }

  // PATCH — update response status, notes, result
  if ((method === 'PATCH' || method === 'PUT') && recordId) {
    const body = await request.json() as Record<string, any>;
    const fields = toAirtableFields(body);
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
