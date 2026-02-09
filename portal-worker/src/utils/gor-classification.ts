/**
 * GOR (Gas-Oil Ratio) Classification Utility
 *
 * Classifies wells and operators by gas composition using lifetime
 * production volumes from the puns table.
 *
 * GOR = Total Gas (MCF) / Total Oil (BBL)
 * - GOR > 15,000 or pure gas → Lean/dry gas (low NGL expected)
 * - GOR 3,000–15,000 → Mixed/transitional
 * - GOR < 3,000 → Rich/wet gas (NGL recovery expected)
 */

export type GorOperatorProfile = {
  label: 'Primarily Lean Gas' | 'Primarily Rich Gas' | 'Mixed Portfolio';
  lean_pct: number;
  oil_pct: number;
  total_puns: number;
};

export type GorWellProfile = {
  gas_profile: 'lean' | 'rich' | 'mixed';
  gor: number | null;
};

const BATCH_SIZE = 50;

export async function classifyOperatorGor(
  db: D1Database,
  operatorNumbers: string[]
): Promise<Map<string, GorOperatorProfile>> {
  const result = new Map<string, GorOperatorProfile>();
  if (!operatorNumbers || operatorNumbers.length === 0) return result;

  for (let i = 0; i < operatorNumbers.length; i += BATCH_SIZE) {
    const batch = operatorNumbers.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    const query = `
      WITH operator_puns AS (
        SELECT DISTINCT ol.operator_number, p.pun, p.total_oil_bbl, p.total_gas_mcf
        FROM otc_leases ol
        JOIN puns p ON ol.pun = p.pun
        WHERE ol.operator_number IN (${placeholders})
          AND (COALESCE(p.total_oil_bbl, 0) > 0 OR COALESCE(p.total_gas_mcf, 0) > 0)
      )
      SELECT operator_number,
        COUNT(*) as total_puns,
        SUM(CASE WHEN COALESCE(total_oil_bbl, 0) = 0 THEN 1 ELSE 0 END) as pure_gas_puns,
        SUM(CASE WHEN total_oil_bbl > 0 AND (total_gas_mcf * 1.0 / total_oil_bbl) > 15000 THEN 1 ELSE 0 END) as lean_puns,
        SUM(CASE WHEN total_oil_bbl > 0 AND (total_gas_mcf * 1.0 / total_oil_bbl) < 3000 THEN 1 ELSE 0 END) as oil_puns
      FROM operator_puns
      GROUP BY operator_number
    `;

    try {
      const res = await db.prepare(query).bind(...batch).all();
      for (const row of (res.results || []) as any[]) {
        const totalPuns = row.total_puns || 0;
        if (totalPuns === 0) continue;

        const leanPct = ((row.pure_gas_puns || 0) + (row.lean_puns || 0)) / totalPuns;
        const oilPct = (row.oil_puns || 0) / totalPuns;

        let label: GorOperatorProfile['label'];
        if (leanPct > 0.7) {
          label = 'Primarily Lean Gas';
        } else if (oilPct > 0.7) {
          label = 'Primarily Rich Gas';
        } else {
          label = 'Mixed Portfolio';
        }

        result.set(row.operator_number, {
          label,
          lean_pct: Math.round(leanPct * 100),
          oil_pct: Math.round(oilPct * 100),
          total_puns: totalPuns,
        });
      }
    } catch (e) {
      console.error('GOR operator classification error:', e);
    }
  }

  return result;
}

export async function classifyWellGor(
  db: D1Database,
  apiNumbers: string[]
): Promise<Map<string, GorWellProfile>> {
  const result = new Map<string, GorWellProfile>();
  if (!apiNumbers || apiNumbers.length === 0) return result;

  for (let i = 0; i < apiNumbers.length; i += BATCH_SIZE) {
    const batch = apiNumbers.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');

    const query = `
      WITH well_pun_volumes AS (
        SELECT DISTINCT wpl.api_number, p.pun, p.total_oil_bbl, p.total_gas_mcf
        FROM well_pun_links wpl
        JOIN otc_leases ol ON wpl.base_pun = ol.base_pun
        JOIN puns p ON ol.pun = p.pun
        WHERE wpl.api_number IN (${placeholders})
      )
      SELECT api_number,
        COALESCE(SUM(total_oil_bbl), 0) as oil_bbl,
        COALESCE(SUM(total_gas_mcf), 0) as gas_mcf
      FROM well_pun_volumes
      GROUP BY api_number
    `;

    try {
      const res = await db.prepare(query).bind(...batch).all();
      for (const row of (res.results || []) as any[]) {
        const oilBbl = row.oil_bbl || 0;
        const gasMcf = row.gas_mcf || 0;

        if (oilBbl === 0 && gasMcf === 0) continue;

        let gasProfile: GorWellProfile['gas_profile'];
        let gor: number | null = null;

        if (oilBbl === 0) {
          gasProfile = 'lean'; // Pure gas well
        } else {
          gor = gasMcf / oilBbl;
          if (gor > 15000) {
            gasProfile = 'lean';
          } else if (gor < 3000) {
            gasProfile = 'rich';
          } else {
            gasProfile = 'mixed';
          }
        }

        result.set(row.api_number, { gas_profile: gasProfile, gor });
      }
    } catch (e) {
      console.error('GOR well classification error:', e);
    }
  }

  // Revenue-based fallback for wells not found via puns
  const missing = apiNumbers.filter(a => !result.has(a));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');

      const fallbackQuery = `
        SELECT wpl.api_number,
          SUM(CASE WHEN opf.product_code = '5' THEN opf.gross_value ELSE 0 END) as residue_value,
          SUM(opf.gross_value) as total_gross
        FROM well_pun_links wpl
        JOIN otc_production_financial opf ON wpl.base_pun = SUBSTR(opf.pun, 1, 10)
        WHERE wpl.api_number IN (${placeholders})
          AND opf.gross_value > 0
        GROUP BY wpl.api_number
      `;

      try {
        const res = await db.prepare(fallbackQuery).bind(...batch).all();
        for (const row of (res.results || []) as any[]) {
          const totalGross = row.total_gross || 0;
          const residueValue = row.residue_value || 0;
          if (totalGross > 0 && (residueValue / totalGross) > 0.80) {
            result.set(row.api_number, { gas_profile: 'lean', gor: null });
          }
        }
      } catch (e) {
        console.error('GOR revenue fallback error:', e);
      }
    }
  }

  return result;
}
