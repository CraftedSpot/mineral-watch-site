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

// Fetch all stats + operators + activity for a county page
export async function fetchCountyData(db: D1Database, countyUpper: string, countyName: string) {
  // Run all queries in parallel
  const [wellStats, permitCount, completionCount, poolingCount, operators, recentPermits, recentCompletions, recentPooling] =
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
         WHERE county = ? AND has_permit = 1 AND permit_date >= date('now', '-90 days')`
      ).bind(countyUpper).first<{ cnt: number }>(),

      // 3. Completions last 90 days
      db.prepare(
        `SELECT COUNT(*) as cnt FROM statewide_activity
         WHERE county = ? AND has_completion = 1 AND completion_date >= date('now', '-90 days')`
      ).bind(countyUpper).first<{ cnt: number }>(),

      // 4. Pooling orders last 90 days
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
         WHERE county = ? AND has_permit = 1 AND permit_date >= date('now', '-90 days')
         ORDER BY permit_date DESC LIMIT 5`
      ).bind(countyUpper).all(),

      // 7. Recent completions for activity feed
      db.prepare(
        `SELECT well_name, operator, surface_section as section, surface_township as township,
                surface_range as range, formation, completion_date as activity_date
         FROM statewide_activity
         WHERE county = ? AND has_completion = 1 AND completion_date >= date('now', '-90 days')
         ORDER BY completion_date DESC LIMIT 5`
      ).bind(countyUpper).all(),

      // 8. Recent pooling for activity feed
      db.prepare(
        `SELECT case_number, applicant as operator, section, township, range,
                order_date as activity_date
         FROM pooling_orders
         WHERE county = ? AND order_date >= date('now', '-90 days')
         ORDER BY order_date DESC LIMIT 5`
      ).bind(countyName).all().catch(() => ({ results: [] })),
    ]);

  // Build stats
  const stats: CountyStats = {
    totalWells: wellStats?.total_wells ?? 0,
    activeWells: wellStats?.active_wells ?? 0,
    recentPermits: permitCount?.cnt ?? 0,
    recentCompletions: completionCount?.cnt ?? 0,
    recentPooling: poolingCount?.cnt ?? 0,
  };

  // Build activity feed — merge and sort
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

  for (const r of (recentPooling.results || []) as any[]) {
    activity.push({
      date: r.activity_date || '',
      title: `Pooling Order — Cause ${r.case_number || 'Unknown'}`,
      detail: [r.operator, r.section && r.township && r.range ? `Sec ${r.section}-${r.township}-${r.range}` : null].filter(Boolean).join(' · '),
      type: 'pooling',
    });
  }

  // Sort descending by date, take top 8
  activity.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const topActivity = activity.slice(0, 8);

  return {
    stats,
    operators: (operators.results || []) as OperatorRow[],
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
