/**
 * County Clerk Directory Handler
 *
 * GET /api/county-clerks          — all 154 entries
 * GET /api/county-clerks?county=  — filter by county
 * GET /api/county-clerks?type=    — filter by office type
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { isSuperAdmin } from '../utils/auth.js';
import type { Env } from '../types/env.js';

interface ClerkOffice {
  id: number;
  county: string;
  office_type: string;
  office_name: string;
  physical_address: string | null;
  mailing_address: string | null;
  phone: string | null;
  email: string | null;
  office_hours: string | null;
  website: string | null;
  uses_okcountyrecords: number;
  earliest_digitized_records: string | null;
  notes: string | null;
  verification_status: string | null;
}

export async function handleGetCountyClerks(request: Request, env: Env): Promise<Response> {
  try {
    const authUser = await authenticateRequest(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!isSuperAdmin(authUser.email)) {
      return jsonResponse({ error: 'County Clerk Directory is not yet available for your account' }, 403);
    }

    const url = new URL(request.url);
    const county = url.searchParams.get('county')?.trim() || '';
    const officeType = url.searchParams.get('type')?.trim() || '';

    let sql = 'SELECT id, county, county_code, office_type, office_name, physical_address, mailing_address, phone, email, office_hours, website, uses_okcountyrecords, earliest_digitized_records, notes, verification_status, last_verified_date FROM county_clerk_offices';
    const conditions: string[] = [];
    const params: string[] = [];

    if (county) {
      conditions.push('UPPER(county) = UPPER(?)');
      params.push(county);
    }
    if (officeType) {
      conditions.push('office_type = ?');
      params.push(officeType);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY county, office_type';

    const result = await env.WELLS_DB.prepare(sql).bind(...params).all<ClerkOffice>();

    // Strip null/empty fields from each row
    const offices = result.results.map(row => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value !== null && value !== '') {
          clean[key] = value;
        }
      }
      return clean;
    });

    return jsonResponse({ offices, count: offices.length });
  } catch (err: any) {
    console.error('County clerks error:', err);
    return jsonResponse({ error: 'Failed to load county clerk directory' }, 500);
  }
}
