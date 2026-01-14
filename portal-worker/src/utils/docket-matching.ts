/**
 * Docket Matching Utilities
 *
 * Functions to find existing OCC docket entries that match
 * a user's properties or wells. Used when adding new properties/wells
 * to surface historical filings.
 */

import type { Env } from '../index';

/**
 * Result shape for OCC filing summary
 */
export interface OccFilingSummary {
  count: number;
  types: string[];
  dateRange: {
    oldest: string | null;
    newest: string | null;
  };
}

/**
 * Raw docket entry from D1
 */
interface DocketEntry {
  id: string;
  case_number: string;
  relief_type: string;
  docket_date: string;
  section: string;
  township: string;
  range: string;
  county: string;
  applicant: string | null;
  additional_sections: string | null;
  api_numbers: string | null;
}

/**
 * Normalize township format for comparison
 * "7N" -> "7N", "7 N" -> "7N", "07N" -> "7N"
 */
function normalizeTownship(twn: string | null): string | null {
  if (!twn) return null;
  const match = twn.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format for comparison
 * "4W" -> "4W", "4 W" -> "4W", "04W" -> "4W"
 */
function normalizeRange(rng: string | null): string | null {
  if (!rng) return null;
  const match = rng.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([EW])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : rng.toUpperCase();
}

/**
 * Normalize section to string without leading zeros
 */
function normalizeSection(sec: string | number | null): string | null {
  if (sec === null || sec === undefined) return null;
  const num = parseInt(sec.toString(), 10);
  return isNaN(num) ? null : num.toString();
}

/**
 * Normalize API number to XXX-XXXXX format
 */
function normalizeAPINumber(api: string | null): string | null {
  if (!api) return null;
  const digits = api.toString().replace(/[^0-9]/g, '');

  // 10-digit with state code: 3504924518 -> 049-24518
  if (digits.length === 10 && digits.startsWith('35')) {
    return `${digits.substring(2, 5)}-${digits.substring(5, 10)}`;
  }

  // 8-digit: 04924518 -> 049-24518
  if (digits.length === 8) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 8)}`;
  }

  // Already has dash format
  const match = api.match(/(\d{3})[-\s]?(\d{5})/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return null;
}

/**
 * Find docket entries matching a Section-Township-Range location
 *
 * Checks both the primary section AND the additional_sections JSON field
 * for multi-section orders.
 *
 * @param section - Section number (1-36)
 * @param township - Township (e.g., "7N")
 * @param range - Range (e.g., "4W")
 * @param env - Worker environment with WELLS_DB
 * @returns Array of matching docket entries
 */
export async function findMatchingDocketEntries(
  section: string | number,
  township: string,
  range: string,
  env: Env
): Promise<DocketEntry[]> {
  const sec = normalizeSection(section);
  const twn = normalizeTownship(township);
  const rng = normalizeRange(range);

  if (!sec || !twn || !rng) {
    console.log(`[DocketMatch] Invalid location: S${section} T${township} R${range}`);
    return [];
  }

  // Query for primary section match OR additional_sections JSON match
  // The additional_sections field contains JSON like:
  // [{"section":"2","township":"12N","range":"12E","county":"McClain","meridian":"IM"}]
  const query = `
    SELECT id, case_number, relief_type, docket_date, section, township, range,
           county, applicant, additional_sections, api_numbers
    FROM occ_docket_entries
    WHERE (
      -- Primary section match (normalize comparison)
      (CAST(section AS INTEGER) = CAST(? AS INTEGER)
       AND UPPER(TRIM(township)) = ?
       AND UPPER(TRIM(range)) = ?)
      -- OR additional sections match (search JSON array)
      OR (additional_sections IS NOT NULL
          AND additional_sections LIKE ?)
    )
    AND relief_type IN ('POOLING', 'INCREASED_DENSITY', 'SPACING', 'HORIZONTAL_WELL',
                        'LOCATION_EXCEPTION', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION')
    ORDER BY docket_date DESC
    LIMIT 100
  `;

  // Build pattern to match in additional_sections JSON
  // Match: "section":"14","township":"7N","range":"4W"
  const jsonPattern = `%"section":"${sec}"%"township":"${twn}"%"range":"${rng}"%`;

  try {
    const result = await env.WELLS_DB.prepare(query)
      .bind(sec, twn, rng, jsonPattern)
      .all<DocketEntry>();

    return result.results || [];
  } catch (err) {
    console.error(`[DocketMatch] Query error:`, err);
    return [];
  }
}

/**
 * Find docket entries that reference a specific API number
 *
 * Searches the api_numbers JSON field for matching API numbers.
 * Used for Location Exception and Change of Operator filings.
 *
 * @param apiNumber - API number in any format (will be normalized)
 * @param env - Worker environment with WELLS_DB
 * @returns Array of matching docket entries
 */
export async function findDocketEntriesByAPI(
  apiNumber: string,
  env: Env
): Promise<DocketEntry[]> {
  const normalizedAPI = normalizeAPINumber(apiNumber);

  if (!normalizedAPI) {
    console.log(`[DocketMatch] Invalid API number: ${apiNumber}`);
    return [];
  }

  // Search for API number in the api_numbers JSON array field
  // Format: ["049-24518", "035-20123"]
  const query = `
    SELECT id, case_number, relief_type, docket_date, section, township, range,
           county, applicant, additional_sections, api_numbers
    FROM occ_docket_entries
    WHERE api_numbers LIKE ?
    ORDER BY docket_date DESC
    LIMIT 50
  `;

  try {
    const result = await env.WELLS_DB.prepare(query)
      .bind(`%${normalizedAPI}%`)
      .all<DocketEntry>();

    return result.results || [];
  } catch (err) {
    console.error(`[DocketMatch] API query error:`, err);
    return [];
  }
}

/**
 * Build OCC filing summary from docket entries
 *
 * Aggregates entries into a summary with count, unique types, and date range.
 *
 * @param entries - Array of docket entries
 * @returns Summary object for API response
 */
export function buildFilingSummary(entries: DocketEntry[]): OccFilingSummary {
  if (!entries || entries.length === 0) {
    return {
      count: 0,
      types: [],
      dateRange: { oldest: null, newest: null }
    };
  }

  // Get unique relief types
  const typesSet = new Set<string>();
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const entry of entries) {
    if (entry.relief_type) {
      typesSet.add(entry.relief_type);
    }

    if (entry.docket_date) {
      if (!oldest || entry.docket_date < oldest) {
        oldest = entry.docket_date;
      }
      if (!newest || entry.docket_date > newest) {
        newest = entry.docket_date;
      }
    }
  }

  return {
    count: entries.length,
    types: Array.from(typesSet).sort(),
    dateRange: { oldest, newest }
  };
}

/**
 * Find all OCC filings for a property location
 *
 * Convenience function that combines query and summary building.
 *
 * @param section - Section number
 * @param township - Township
 * @param range - Range
 * @param env - Worker environment
 * @returns Filing summary for API response
 */
export async function getOccFilingsForProperty(
  section: string | number,
  township: string,
  range: string,
  env: Env
): Promise<OccFilingSummary> {
  const entries = await findMatchingDocketEntries(section, township, range, env);
  return buildFilingSummary(entries);
}

/**
 * Find all OCC filings for a well
 *
 * Searches by both API number AND STR location, deduplicating results.
 *
 * @param apiNumber - Well's API number
 * @param section - Well's section (surface or BH)
 * @param township - Well's township
 * @param range - Well's range
 * @param env - Worker environment
 * @returns Filing summary for API response
 */
export async function getOccFilingsForWell(
  apiNumber: string,
  section: string | number | null,
  township: string | null,
  range: string | null,
  env: Env
): Promise<OccFilingSummary> {
  // Fetch by API number
  const apiEntries = await findDocketEntriesByAPI(apiNumber, env);

  // Fetch by location if available
  let locationEntries: DocketEntry[] = [];
  if (section && township && range) {
    locationEntries = await findMatchingDocketEntries(section, township, range, env);
  }

  // Deduplicate by case_number
  const seenCases = new Set<string>();
  const allEntries: DocketEntry[] = [];

  for (const entry of [...apiEntries, ...locationEntries]) {
    if (!seenCases.has(entry.case_number)) {
      seenCases.add(entry.case_number);
      allEntries.push(entry);
    }
  }

  // Sort by date descending
  allEntries.sort((a, b) => (b.docket_date || '').localeCompare(a.docket_date || ''));

  return buildFilingSummary(allEntries);
}
