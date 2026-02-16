import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const TABLE_NAME = 'MKT: Calendar';

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
  if (body.date !== undefined) fields['Date'] = body.date;
  if (body.end_date !== undefined) fields['End Date'] = body.end_date;
  if (body.type !== undefined) fields['Type'] = body.type;
  if (body.location !== undefined) fields['Location'] = body.location;
  if (body.strategy !== undefined) fields['Strategy'] = body.strategy;
  if (body.status !== undefined) fields['Status'] = body.status;
  if (body.cost !== undefined) fields['Cost'] = body.cost;
  if (body.description !== undefined) fields['Description'] = body.description;
  if (body.notes !== undefined) fields['Notes'] = body.notes;
  return fields;
}

// Map Airtable record to flat frontend format
function toFlatRecord(record: any): any {
  const f = record.fields || {};
  return {
    id: record.id,
    title: f['Title'] || '',
    date: f['Date'] || null,
    end_date: f['End Date'] || null,
    type: f['Type'] || '',
    location: f['Location'] || '',
    strategy: f['Strategy'] || '',
    status: f['Status'] || '',
    cost: f['Cost'] || '',
    description: f['Description'] || '',
    notes: f['Notes'] || '',
  };
}

export async function handleCalendar(request: Request, env: Env, path: string, method: string): Promise<Response> {
  const match = path.match(/^\/api\/marketing\/calendar\/?(rec[A-Za-z0-9]+)?$/);
  if (!match && path !== '/api/marketing/calendar') {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const recordId = match?.[1];

  // GET — list all (optionally filtered by month via ?year=YYYY&month=MM)
  if (method === 'GET' && !recordId) {
    const url = new URL(request.url);
    const year = url.searchParams.get('year');
    const month = url.searchParams.get('month');

    let queryPath = '?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=asc';

    // If year/month provided, filter to that month (plus a week before/after for grid overlap)
    if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month);
      // Start from first day of month, end at last day
      const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
      queryPath += `&filterByFormula=AND(IS_AFTER({Date},'${y}-${String(m).padStart(2, '0')}-00'),IS_BEFORE({Date},'${y}-${String(m + 1 > 12 ? 1 : m + 1).padStart(2, '0')}-00'))`;
    }

    // Paginate through all results
    let allRecords: any[] = [];
    let offset: string | undefined;

    do {
      let fetchPath = queryPath;
      if (offset) fetchPath += `&offset=${offset}`;

      const data = await airtableFetch(env, fetchPath);
      if (data.records) {
        allRecords = allRecords.concat(data.records.map(toFlatRecord));
      }
      offset = data.offset;
    } while (offset);

    return jsonResponse(allRecords);
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
