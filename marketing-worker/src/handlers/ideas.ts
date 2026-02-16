import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const IDEAS_TABLE = 'MKT: Ideas';
const CONTENT_TABLE = 'MKT: Content Pipeline';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function airtableFetch(env: Env, table: string, path: string, options: RequestInit = {}): Promise<any> {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
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
  if (body.title !== undefined) fields['Idea'] = body.title;
  if (body.category !== undefined) fields['Category'] = body.category;
  if (body.source !== undefined) fields['Source'] = body.source;
  if (body.added !== undefined) fields['Added'] = body.added;
  return fields;
}

// Map Airtable record to flat frontend format
function toFlatRecord(record: any): any {
  const f = record.fields || {};
  return {
    id: record.id,
    title: f['Idea'] || '',
    category: f['Category'] || '',
    source: f['Source'] || '',
    created_at: f['Added'] || null,
  };
}

export async function handleIdeas(request: Request, env: Env, path: string, method: string): Promise<Response> {
  // Check for promote action: /api/marketing/ideas/:id/promote
  const promoteMatch = path.match(/^\/api\/marketing\/ideas\/(rec[A-Za-z0-9]+)\/promote$/);
  if (promoteMatch && method === 'POST') {
    return promoteIdea(env, promoteMatch[1]);
  }

  const match = path.match(/^\/api\/marketing\/ideas\/?(rec[A-Za-z0-9]+)?$/);
  if (!match && path !== '/api/marketing/ideas') {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const recordId = match?.[1];

  // GET — list all
  if (method === 'GET' && !recordId) {
    const data = await airtableFetch(env, IDEAS_TABLE, '?sort%5B0%5D%5Bfield%5D=Added&sort%5B0%5D%5Bdirection%5D=desc');
    const records = (data.records || []).map(toFlatRecord);
    return jsonResponse(records);
  }

  // POST — create
  if (method === 'POST' && !recordId) {
    const body = await request.json() as Record<string, any>;
    const fields = body.fields ? body.fields : toAirtableFields(body);
    // Auto-set Added date if not provided
    if (!fields['Added']) {
      fields['Added'] = new Date().toISOString().split('T')[0];
    }
    const data = await airtableFetch(env, IDEAS_TABLE, '', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    return jsonResponse(toFlatRecord(data));
  }

  // PUT or PATCH — update
  if ((method === 'PATCH' || method === 'PUT') && recordId) {
    const body = await request.json() as Record<string, any>;
    const fields = body.fields ? body.fields : toAirtableFields(body);
    const data = await airtableFetch(env, IDEAS_TABLE, `/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
    return jsonResponse(toFlatRecord(data));
  }

  // DELETE
  if (method === 'DELETE' && recordId) {
    const data = await airtableFetch(env, IDEAS_TABLE, `/${recordId}`, { method: 'DELETE' });
    return jsonResponse(data);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function promoteIdea(env: Env, ideaId: string): Promise<Response> {
  // Fetch the idea
  const idea = await airtableFetch(env, IDEAS_TABLE, `/${ideaId}`);
  if (idea.error) {
    return jsonResponse({ error: 'Idea not found' }, 404);
  }

  const ideaFields = idea.fields || {};

  // Map category to channel
  const categoryToChannel: Record<string, string> = {
    'Content': 'Blog',
    'SEO': 'SEO',
    'Partnership': 'Email',
    'Lead Gen': 'Email',
    'Automation': 'Email',
  };

  // Create content pipeline entry
  const contentFields: Record<string, any> = {
    'Title': ideaFields['Idea'] || 'Untitled',
    'Status': 'Idea',
    'Channel': categoryToChannel[ideaFields['Category']] || 'Blog',
    'Priority': 'Med',
    'Notes': `Promoted from Idea Bank. Source: ${ideaFields['Source'] || 'N/A'}`,
  };

  const created = await airtableFetch(env, CONTENT_TABLE, '', {
    method: 'POST',
    body: JSON.stringify({ fields: contentFields }),
  });

  if (created.error) {
    return jsonResponse({ error: 'Failed to create content entry', details: created.error }, 500);
  }

  // Delete the idea
  await airtableFetch(env, IDEAS_TABLE, `/${ideaId}`, { method: 'DELETE' });

  return jsonResponse({ success: true, contentId: created.id, message: 'Idea promoted to Content Pipeline' });
}
