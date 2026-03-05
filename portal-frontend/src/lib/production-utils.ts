import type { WellRecord } from '../types/dashboard';

/**
 * Compute the data horizon (latest production month across all wells).
 * OTC data has a 3-4 month lag, so we use the latest month any well has data for.
 */
export function computeDataHorizon(wells: WellRecord[]): string | null {
  let latest: string | null = null;
  for (const w of wells) {
    if (w.otc_last_prod_month && (!latest || w.otc_last_prod_month > latest)) {
      latest = w.otc_last_prod_month;
    }
  }
  return latest;
}

/**
 * Get production status for a well relative to the data horizon.
 * - 'active': produced within 3 months of horizon
 * - 'idle': has production data but not within 3 months
 * - 'no_data': no production data at all
 */
export function getProductionStatus(
  well: WellRecord,
  dataHorizon: string | null,
): 'active' | 'idle' | 'no_data' {
  if (!well.otc_last_prod_month) return 'no_data';
  if (!dataHorizon) return 'no_data';

  // Parse YYYYMM and compute 3 months before horizon
  const hYear = parseInt(dataHorizon.substring(0, 4));
  const hMonth = parseInt(dataHorizon.substring(4, 6));
  let tMonth = hMonth - 3;
  let tYear = hYear;
  if (tMonth <= 0) { tMonth += 12; tYear--; }
  const threshold = `${tYear}${String(tMonth).padStart(2, '0')}`;

  return well.otc_last_prod_month >= threshold ? 'active' : 'idle';
}

/** Format YYYYMM to "Jan 2025" */
export function formatProdMonth(yyyymm: string | null): string {
  if (!yyyymm || yyyymm.length < 6) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(yyyymm.substring(4, 6));
  const y = yyyymm.substring(0, 4);
  return `${months[m - 1] || '?'} ${y}`;
}
