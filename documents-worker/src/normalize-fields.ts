/**
 * Shared post-processing logic for document metadata normalization.
 * Used by both the regular extraction handler and the multi-document split handler
 * to ensure consistent county fallback and meridian normalization.
 */

export interface NormalizedFields {
  county: string | null;
  range: string | null;
  meridian: string | null;
}

/**
 * Resolve county from extracted_data when not provided at the top level.
 * Checks multiple nested paths in the extraction output.
 */
export function resolveCounty(
  topLevelCounty: string | null | undefined,
  extractedData: any,
  fallbackCounty?: string | null
): string | null {
  let county = topLevelCounty ?? null;
  if (!county && extractedData) {
    county = extractedData.county
      || extractedData.tracts?.[0]?.legal?.county
      || extractedData.tracts?.[0]?.county
      || extractedData.tracts?.[0]?.legal_description?.county
      || extractedData.recording_info?.county
      || null;
  }
  if (!county && fallbackCounty) {
    county = fallbackCounty;
  }
  return county;
}

/**
 * Normalize range by stripping meridian suffixes (ECM→E, WCM→W, EIM→E, WIM→W)
 * and returning the meridian separately. Also checks extracted_data for meridian
 * if not embedded in the range string.
 */
export function normalizeRange(
  rawRange: string | null | undefined,
  extractedData?: any
): { range: string | null; meridian: string | null } {
  let range = rawRange ?? null;
  let meridian: string | null = null;

  if (range) {
    const rmMatch = range.match(/^(\d+[NSEW]?)(CM|IM)$/i);
    if (rmMatch) {
      range = rmMatch[1];
      meridian = rmMatch[2].toUpperCase();
    } else if (range.match(/^(\d+)(E|W)CM$/i)) {
      range = range.replace(/CM$/i, '');
      meridian = 'CM';
    } else if (range.match(/^(\d+)(E|W)IM$/i)) {
      range = range.replace(/IM$/i, '');
      meridian = 'IM';
    }
    // Also try extracting meridian from extracted_data if not found in range
    if (!meridian && extractedData?.tracts?.[0]?.legal_description?.meridian) {
      const m = extractedData.tracts[0].legal_description.meridian;
      if (m === 'IM' || m === 'CM' || m === 'Indian Meridian' || m === 'Cimarron Meridian') {
        meridian = m.startsWith('C') ? 'CM' : 'IM';
      }
    }
  }

  return { range, meridian };
}

/**
 * Combined normalization: resolve county + normalize range/meridian in one call.
 */
export function normalizeDocumentFields(
  topLevelCounty: string | null | undefined,
  rawRange: string | null | undefined,
  extractedData: any,
  fallbackCounty?: string | null
): NormalizedFields {
  const county = resolveCounty(topLevelCounty, extractedData, fallbackCounty);
  const { range, meridian } = normalizeRange(rawRange, extractedData);
  return { county, range, meridian };
}
