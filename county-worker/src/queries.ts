export interface CountyStats {
  totalWells: number;
  activeWells: number;
  recentPermits: number;
  recentCompletions: number;
  recentPooling: number;
}

export interface OperatorRow {
  operator: string;
  active_wells: number;
  recent_filings: number;
}

export interface ActivityItem {
  date: string;
  title: string;
  detail: string;
  type: 'permit' | 'completion' | 'pooling' | 'spacing';
}

export interface CountyIndexRow {
  county: string;
  total_wells: number;
  active_wells: number;
}

// Known multi-word and truncated county variants in occ_docket_entries
const DOCKET_COUNTY_ALIASES: Record<string, string[]> = {
  'Roger Mills': ['Roger', 'Mills'],
  'Le Flore': ['Le', 'Flore'],
  'Kingfisher': ['King'],
};

// Build SQL WHERE conditions to match a county in occ_docket_entries
// (handles case mismatches, multi-word splits, and truncations)
function buildDocketCountyMatch(countyName: string): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  // Case-insensitive match covers McClain/Mcclain/MCCLAIN etc.
  conditions.push('LOWER(county) = LOWER(?)');
  params.push(countyName);

  // Check for known aliases (multi-word splits + truncations)
  const aliases = DOCKET_COUNTY_ALIASES[countyName];
  if (aliases) {
    for (const alias of aliases) {
      conditions.push('county = ?');
      params.push(alias);
    }
  }

  return { where: conditions.join(' OR '), params };
}

// Pretty-print relief type for the activity feed
function formatReliefType(reliefType: string): string {
  const map: Record<string, string> = {
    'POOLING': 'Pooling Application',
    'SPACING': 'Spacing Application',
    'INCREASED DENSITY': 'Increased Density',
    'LOCATION EXCEPTION': 'Location Exception',
    'CHANGE OF OPERATOR': 'Change of Operator',
    'MULTI-UNIT HORIZONTAL': 'Multi-Unit Horizontal Well',
    'HORIZONTAL WELL': 'Horizontal Well Application',
    'WELL TRANSFER': 'Well Transfer',
    'DISSOLUTION': 'Unit Dissolution',
    'VACUUM': 'Vacuum Order',
    'DISPOSAL WELL': 'Disposal Well',
    'INCREASED WELL DENSITY': 'Increased Well Density',
  };
  const upper = reliefType.toUpperCase();
  if (map[upper]) return map[upper];
  for (const [key, label] of Object.entries(map)) {
    if (upper.includes(key)) return label;
  }
  return reliefType.replace(/\b\w/g, c => c.toUpperCase()) || 'OCC Filing';
}

// Map relief type to activity feed badge
function mapReliefToType(reliefType: string): 'permit' | 'completion' | 'pooling' | 'spacing' {
  const upper = reliefType.toUpperCase();
  if (upper.includes('POOLING')) return 'pooling';
  if (upper.includes('SPACING') || upper.includes('DENSITY') || upper.includes('HORIZONTAL') || upper.includes('MULTI-UNIT')) return 'spacing';
  if (upper.includes('COMPLETION')) return 'completion';
  return 'permit';
}

// Normalize operator names for matching between wells table and docket entries
// Wells: "COTERRA ENERGY OPERATING CO."  Docket: "COTERRA ENERGY OPERATING CO"
function normalizeOperator(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[.,\s]+(LLC|LP|INC|LTD|CO|CORP|COMPANY|PARTNERSHIP)[.,\s]*$/g, '')
    .trim();
}

// Fetch all stats + operators + activity for a county page
export async function fetchCountyData(db: D1Database, countyUpper: string, countyName: string) {
  const docket = buildDocketCountyMatch(countyName);

  // Run all queries in parallel
  const [wellStats, permitCount, completionCount, poolingCount, operators,
         recentPermits, recentCompletions, recentPooling, docketCount, recentDocket,
         recentFilers] =
    await Promise.all([
      // 1. Total + active wells
      db.prepare(
        `SELECT COUNT(*) as total_wells,
                SUM(CASE WHEN well_status = 'AC' THEN 1 ELSE 0 END) as active_wells
         FROM wells WHERE county = ?`
      ).bind(countyUpper).first<{ total_wells: number; active_wells: number }>(),

      // 2. Permits last 90 days
      db.prepare(
        `SELECT COUNT(*) as cnt FROM statewide_activity
         WHERE (county = ? OR county LIKE '%-' || ?) AND has_permit = 1 AND permit_date >= date('now', '-90 days')`
      ).bind(countyUpper, countyUpper).first<{ cnt: number }>(),

      // 3. Completions last 90 days
      db.prepare(
        `SELECT COUNT(*) as cnt FROM statewide_activity
         WHERE (county = ? OR county LIKE '%-' || ?) AND has_completion = 1 AND completion_date >= date('now', '-90 days')`
      ).bind(countyUpper, countyUpper).first<{ cnt: number }>(),

      // 4. Pooling orders last 90 days (kept for activity feed dedup)
      db.prepare(
        `SELECT COUNT(*) as cnt FROM pooling_orders
         WHERE county = ? AND order_date >= date('now', '-90 days')`
      ).bind(countyName).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),

      // 5. Top 5 operators by active wells
      db.prepare(
        `SELECT operator, COUNT(*) as active_wells
         FROM wells WHERE county = ? AND well_status = 'AC'
         GROUP BY operator ORDER BY active_wells DESC LIMIT 5`
      ).bind(countyUpper).all<OperatorRow>(),

      // 6. Recent permits for activity feed
      db.prepare(
        `SELECT well_name, operator, surface_section as section, surface_township as township,
                surface_range as range, formation, permit_date as activity_date
         FROM statewide_activity
         WHERE (county = ? OR county LIKE '%-' || ?) AND has_permit = 1 AND permit_date >= date('now', '-90 days')
         ORDER BY permit_date DESC LIMIT 5`
      ).bind(countyUpper, countyUpper).all(),

      // 7. Recent completions for activity feed
      db.prepare(
        `SELECT well_name, operator, surface_section as section, surface_township as township,
                surface_range as range, formation, completion_date as activity_date
         FROM statewide_activity
         WHERE (county = ? OR county LIKE '%-' || ?) AND has_completion = 1 AND completion_date >= date('now', '-90 days')
         ORDER BY completion_date DESC LIMIT 5`
      ).bind(countyUpper, countyUpper).all(),

      // 8. Recent pooling orders for activity feed
      db.prepare(
        `SELECT case_number, applicant as operator, section, township, range,
                order_date as activity_date
         FROM pooling_orders
         WHERE county = ? AND order_date >= date('now', '-90 days')
         ORDER BY order_date DESC LIMIT 5`
      ).bind(countyName).all().catch(() => ({ results: [] })),

      // 9. Docket entries count (90 days) — the REAL OCC filings count
      db.prepare(
        `SELECT COUNT(*) as cnt FROM occ_docket_entries
         WHERE (${docket.where}) AND docket_date >= date('now', '-90 days')`
      ).bind(...docket.params).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),

      // 10. Recent docket entries for activity feed
      db.prepare(
        `SELECT case_number, relief_type, applicant, section, township, range,
                docket_date as activity_date, status, hearing_date
         FROM occ_docket_entries
         WHERE (${docket.where}) AND docket_date >= date('now', '-90 days')
         ORDER BY docket_date DESC LIMIT 10`
      ).bind(...docket.params).all().catch(() => ({ results: [] })),

      // 11. Top filers in last 90 days (fetch 20 so we can match against top 5 operators)
      db.prepare(
        `SELECT applicant, COUNT(*) as filings FROM occ_docket_entries
         WHERE (${docket.where}) AND docket_date >= date('now', '-90 days')
         GROUP BY applicant ORDER BY filings DESC LIMIT 20`
      ).bind(...docket.params).all().catch(() => ({ results: [] })),
    ]);

  // Build stats — use docket count for "OCC Filings", fall back to pooling count
  const stats: CountyStats = {
    totalWells: wellStats?.total_wells ?? 0,
    activeWells: wellStats?.active_wells ?? 0,
    recentPermits: permitCount?.cnt ?? 0,
    recentCompletions: completionCount?.cnt ?? 0,
    recentPooling: (docketCount?.cnt ?? 0) || (poolingCount?.cnt ?? 0),
  };

  // Build activity feed — merge all sources
  const activity: ActivityItem[] = [];

  for (const r of (recentPermits.results || []) as any[]) {
    activity.push({
      date: r.activity_date || '',
      title: `Intent to Drill — ${r.well_name || 'Unknown Well'}`,
      detail: [r.operator, r.section && r.township && r.range ? `Sec ${r.section}-${r.township}-${r.range}` : null, r.formation].filter(Boolean).join(' · '),
      type: 'permit',
    });
  }

  for (const r of (recentCompletions.results || []) as any[]) {
    activity.push({
      date: r.activity_date || '',
      title: `Completion Report — ${r.well_name || 'Unknown Well'}`,
      detail: [r.operator, r.section && r.township && r.range ? `Sec ${r.section}-${r.township}-${r.range}` : null, r.formation].filter(Boolean).join(' · '),
      type: 'completion',
    });
  }

  // Collect pooling case numbers so we can dedup against docket entries
  const poolingCaseNums = new Set<string>();
  for (const r of (recentPooling.results || []) as any[]) {
    const caseNum = r.case_number || '';
    if (caseNum) poolingCaseNums.add(caseNum);
    activity.push({
      date: r.activity_date || '',
      title: `Pooling Order — Cause ${caseNum || 'Unknown'}`,
      detail: [r.operator, r.section && r.township && r.range ? `Sec ${r.section}-${r.township}-${r.range}` : null].filter(Boolean).join(' · '),
      type: 'pooling',
    });
  }

  // Add docket entries (skip duplicates of pooling orders)
  for (const r of (recentDocket.results || []) as any[]) {
    const caseNum = r.case_number || '';
    if (caseNum && poolingCaseNums.has(caseNum)) continue;

    const reliefLabel = formatReliefType(r.relief_type || '');
    activity.push({
      date: r.activity_date || '',
      title: `${reliefLabel} — ${caseNum || 'Unknown'}`,
      detail: [
        r.applicant,
        r.section && r.township && r.range ? `Sec ${r.section}-${r.township}-${r.range}` : null,
        r.status || null,
      ].filter(Boolean).join(' · '),
      type: mapReliefToType(r.relief_type || ''),
    });
  }

  // Sort descending by date, take top 8
  activity.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const topActivity = activity.slice(0, 8);

  // Merge operator wells with recent filing counts
  const filingsByOperator = new Map<string, number>();
  for (const row of (recentFilers.results || []) as any[]) {
    if (row.applicant) {
      filingsByOperator.set(normalizeOperator(row.applicant), row.filings as number);
    }
  }

  const operatorsWithFilings: OperatorRow[] = ((operators.results || []) as any[]).map(op => {
    const normalized = normalizeOperator(op.operator || '');
    const filings = filingsByOperator.get(normalized) || 0;
    return {
      operator: op.operator,
      active_wells: op.active_wells,
      recent_filings: filings,
    };
  });

  return {
    stats,
    operators: operatorsWithFilings,
    activity: topActivity,
  };
}

// Fetch all counties with well counts for the index page
export async function fetchCountyIndex(db: D1Database): Promise<CountyIndexRow[]> {
  const result = await db.prepare(
    `SELECT county,
            COUNT(*) as total_wells,
            SUM(CASE WHEN well_status = 'AC' THEN 1 ELSE 0 END) as active_wells
     FROM wells
     WHERE county IS NOT NULL AND county != ''
     GROUP BY county
     ORDER BY active_wells DESC`
  ).all<CountyIndexRow>();
  return (result.results || []) as CountyIndexRow[];
}
