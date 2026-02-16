import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = 'MKT: Leads';

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
  if (body.name !== undefined) fields['Name'] = body.name;
  if (body.email !== undefined) fields['Email'] = body.email;
  if (body.company !== undefined) fields['Company'] = body.company;
  if (body.stage !== undefined) fields['Stage'] = body.stage;
  if (body.type !== undefined) fields['Type'] = body.type;
  if (body.properties !== undefined) fields['Properties'] = body.properties;
  if (body.est_value !== undefined) fields['Est Value'] = body.est_value;
  if (body.source !== undefined) fields['Source'] = body.source;
  if (body.next_action !== undefined) fields['Next Action'] = body.next_action;
  if (body.next_action_date !== undefined) fields['Next Action Date'] = body.next_action_date;
  if (body.notes !== undefined) fields['Notes'] = body.notes;
  return fields;
}

// Map Airtable record to flat frontend format
function toFlatRecord(record: any): any {
  const f = record.fields || {};
  return {
    id: record.id,
    name: f['Name'] || '',
    email: f['Email'] || '',
    company: f['Company'] || '',
    stage: f['Stage'] || '',
    type: f['Type'] || '',
    properties: f['Properties'] || null,
    est_value: f['Est Value'] || '',
    source: f['Source'] || '',
    next_action: f['Next Action'] || '',
    next_action_date: f['Next Action Date'] || null,
    notes: f['Notes'] || '',
  };
}

export async function handleLeads(request: Request, env: Env, path: string, method: string): Promise<Response> {
  const match = path.match(/^\/api\/marketing\/leads\/?(rec[A-Za-z0-9]+)?$/);
  if (!match && path !== '/api/marketing/leads') {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const recordId = match?.[1];

  // GET — list all
  if (method === 'GET' && !recordId) {
    const data = await airtableFetch(env, '?sort%5B0%5D%5Bfield%5D=Name&sort%5B0%5D%5Bdirection%5D=asc');
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
