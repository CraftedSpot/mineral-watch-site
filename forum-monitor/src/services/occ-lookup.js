/**
 * OCC Cross-Reference Service
 * Queries D1 for docket entries, wells, and adjacent section activity
 * to enrich forum posts with real OCC/well data.
 */

// PLSS Section Grid (boustrophedon numbering)
const SECTION_GRID = [
  [ 6,  5,  4,  3,  2,  1],
  [ 7,  8,  9, 10, 11, 12],
  [18, 17, 16, 15, 14, 13],
  [19, 20, 21, 22, 23, 24],
  [30, 29, 28, 27, 26, 25],
  [31, 32, 33, 34, 35, 36],
];

// Reverse lookup: section number -> [row, col]
const SECTION_TO_POS = new Map();
for (let r = 0; r < 6; r++) {
  for (let c = 0; c < 6; c++) {
    SECTION_TO_POS.set(SECTION_GRID[r][c], [r, c]);
  }
}

/**
 * Get adjacent sections within the same township (up to 8 neighbors)
 */
function getAdjacentSectionsInTownship(section) {
  const pos = SECTION_TO_POS.get(section);
  if (!pos) return [];

  const [row, col] = pos;
  const adjacent = [];
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1],
  ];

  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < 6 && nc >= 0 && nc < 6) {
      adjacent.push(SECTION_GRID[nr][nc]);
    }
  }
  return adjacent;
}

/**
 * Normalize township/range for occ_docket_entries (no leading zeros)
 * "7" + "N" → "7N", "14" + "N" → "14N"
 */
function toDocketFormat(num, dir) {
  return `${parseInt(num)}${dir.toUpperCase()}`;
}

/**
 * Normalize township/range for wells table (zero-padded)
 * "7" + "N" → "07N", "14" + "N" → "14N"
 */
function toWellsFormat(num, dir) {
  const n = parseInt(num);
  return `${n < 10 ? '0' + n : n}${dir.toUpperCase()}`;
}

/**
 * Query OCC docket entries for a specific section/township/range
 */
async function queryDocketEntries(db, section, township, range) {
  try {
    const result = await db.prepare(`
      SELECT case_number, relief_type, applicant, hearing_date, status, docket_date
      FROM occ_docket_entries
      WHERE section = ? AND township = ? AND range = ? AND meridian = 'IM'
      ORDER BY hearing_date DESC
      LIMIT 10
    `).bind(String(parseInt(section)), township, range).all();

    return result.results || [];
  } catch (err) {
    console.error(`[OCC-Lookup] Docket query error for ${section}-${township}-${range}: ${err.message}`);
    return [];
  }
}

/**
 * Query wells for a specific section/township/range
 */
async function queryWells(db, section, township, range) {
  try {
    const result = await db.prepare(`
      SELECT api_number, well_name, operator, well_status, completion_date, is_horizontal
      FROM wells
      WHERE section = ? AND township = ? AND range = ? AND meridian = 'IM'
        AND well_status IN ('AC', 'NEW', 'WOC')
      ORDER BY completion_date DESC
      LIMIT 20
    `).bind(parseInt(section), township, range).all();

    return result.results || [];
  } catch (err) {
    console.error(`[OCC-Lookup] Wells query error for ${section}-${township}-${range}: ${err.message}`);
    return [];
  }
}

/**
 * Query adjacent sections for recent OCC activity (last 12 months)
 */
async function queryAdjacentDockets(db, section, township, range) {
  const adjSections = getAdjacentSectionsInTownship(parseInt(section));
  if (adjSections.length === 0) return [];

  // 12 months ago
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const allResults = [];

  for (const adjSec of adjSections) {
    try {
      const result = await db.prepare(`
        SELECT case_number, relief_type, applicant, section, township, range, hearing_date
        FROM occ_docket_entries
        WHERE section = ? AND township = ? AND range = ? AND meridian = 'IM'
          AND relief_type IN ('POOLING', 'SPACING', 'HORIZONTAL_WELL', 'INCREASED_DENSITY')
          AND hearing_date >= ?
        ORDER BY hearing_date DESC
        LIMIT 5
      `).bind(String(adjSec), township, range, cutoffStr).all();

      if (result.results && result.results.length > 0) {
        allResults.push(...result.results);
      }
    } catch (err) {
      // Silently continue — individual section failures shouldn't block others
    }
  }

  return allResults;
}

/**
 * Build a human-readable summary of relief types
 */
function summarizeReliefTypes(entries) {
  const counts = {};
  for (const e of entries) {
    const type = formatReliefType(e.relief_type);
    counts[type] = (counts[type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
}

/**
 * Format relief type for display
 */
function formatReliefType(type) {
  const map = {
    POOLING: 'Pooling',
    SPACING: 'Spacing',
    HORIZONTAL_WELL: 'Horizontal Well',
    INCREASED_DENSITY: 'Increased Density',
    LOCATION_EXCEPTION: 'Location Exception',
    OPERATOR_CHANGE: 'Operator Change',
    WELL_TRANSFER: 'Well Transfer',
    ORDER_MODIFICATION: 'Order Modification',
  };
  return map[type] || type;
}

/**
 * Main enrichment function — cross-reference a post's detected STR with D1 data
 * @param {D1Database} db - WELLS_DB binding
 * @param {Object} locations - Output from parseLocations()
 * @returns {Object} - { occDataSummary, wellsFound, activeOperators }
 */
export async function enrichWithOCC(db, locations) {
  if (!db || !locations || !locations.str || locations.str.length === 0) {
    return { occDataSummary: '', wellsFound: null, activeOperators: '' };
  }

  let totalDocketEntries = [];
  let totalWells = [];
  let totalAdjacentEntries = [];
  const allOperators = new Set();

  // Process each detected STR
  for (const str of locations.str) {
    const sec = str.section;
    const docketTwp = toDocketFormat(str.township, str.direction);
    const docketRng = toDocketFormat(str.range, str.ew);
    const wellsTwp = toWellsFormat(str.township, str.direction);
    const wellsRng = toWellsFormat(str.range, str.ew);

    console.log(`[OCC-Lookup] Querying S${sec}-T${docketTwp}-R${docketRng} (docket) / T${wellsTwp}-R${wellsRng} (wells)`);

    // Run docket + wells queries in parallel for this STR
    const [docketEntries, wells] = await Promise.all([
      queryDocketEntries(db, sec, docketTwp, docketRng),
      queryWells(db, sec, wellsTwp, wellsRng),
    ]);

    totalDocketEntries.push(...docketEntries);
    totalWells.push(...wells);

    // Collect operators from wells
    for (const w of wells) {
      if (w.operator) allOperators.add(w.operator);
    }

    // Also collect applicants from docket entries as operators
    for (const d of docketEntries) {
      if (d.applicant) allOperators.add(d.applicant);
    }

    // Query adjacent sections (use docket format since we're querying docket table)
    const adjEntries = await queryAdjacentDockets(db, sec, docketTwp, docketRng);
    totalAdjacentEntries.push(...adjEntries);
  }

  // Build summary text
  const summaryParts = [];

  if (totalDocketEntries.length > 0) {
    const typeSummary = summarizeReliefTypes(totalDocketEntries);
    summaryParts.push(`${totalDocketEntries.length} OCC filing${totalDocketEntries.length !== 1 ? 's' : ''} (${typeSummary})`);
  }

  if (totalWells.length > 0) {
    const operatorList = Array.from(allOperators).slice(0, 5).join(', ');
    summaryParts.push(`${totalWells.length} active well${totalWells.length !== 1 ? 's' : ''} by ${operatorList}`);
  }

  if (totalAdjacentEntries.length > 0) {
    summaryParts.push(`${totalAdjacentEntries.length} recent filing${totalAdjacentEntries.length !== 1 ? 's' : ''} in adjacent sections`);
  }

  const occDataSummary = summaryParts.join('. ') + (summaryParts.length > 0 ? '.' : '');
  const wellsFound = totalWells.length > 0 ? totalWells.length : null;
  const activeOperators = Array.from(allOperators).slice(0, 10).join(', ');

  console.log(`[OCC-Lookup] Result: ${totalDocketEntries.length} dockets, ${totalWells.length} wells, ${totalAdjacentEntries.length} adjacent, operators: ${activeOperators || 'none'}`);

  return { occDataSummary, wellsFound, activeOperators };
}
