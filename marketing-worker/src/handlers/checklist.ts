import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_ID = 'tblrWOHzyL3rjGeH7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

interface ChecklistItem {
  id: string;
  initiative: string;
  item: string;
  done: boolean;
  sort: number;
}

function toFlat(record: any): ChecklistItem {
  return {
    id: record.id,
    initiative: record.fields?.['Initiative'] || '',
    item: record.fields?.['Item'] || '',
    done: !!record.fields?.['Done'],
    sort: record.fields?.['Sort Order'] || 0,
  };
}

export async function handleChecklist(request: Request, env: Env, path: string, method: string): Promise<Response> {
  const apiKey = env.MINERAL_AIRTABLE_API_KEY;

  // GET /api/marketing/checklist — list all items
  if (method === 'GET' && path === '/api/marketing/checklist') {
    const items: ChecklistItem[] = [];
    let offset: string | undefined;

    do {
      let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100&sort%5B0%5D%5Bfield%5D=Sort+Order&sort%5B0%5D%5Bdirection%5D=asc`;
      if (offset) url += `&offset=${offset}`;

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      const data = await resp.json() as any;
      if (data.records) {
        items.push(...data.records.map(toFlat));
      }
      offset = data.offset;
    } while (offset);

    return jsonResponse(items);
  }

  // PATCH /api/marketing/checklist/:id — toggle done
  if (method === 'PATCH' && path.startsWith('/api/marketing/checklist/')) {
    const id = path.split('/').pop();
    const body = await request.json() as any;

    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: { Done: !!body.done },
      }),
    });

    const data = await resp.json() as any;
    return jsonResponse(toFlat(data));
  }

  // POST /api/marketing/checklist — add new item
  if (method === 'POST' && path === '/api/marketing/checklist') {
    const body = await request.json() as any;

    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          Initiative: body.initiative || '',
          Item: body.item || '',
          Done: false,
          'Sort Order': body.sort || 99,
        },
      }),
    });

    const data = await resp.json() as any;
    return jsonResponse(toFlat(data));
  }

  // DELETE /api/marketing/checklist/:id
  if (method === 'DELETE' && path.startsWith('/api/marketing/checklist/')) {
    const id = path.split('/').pop();

    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    return jsonResponse({ deleted: true });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
