/**
 * Revenue Estimator — API Response Types
 *
 * Matches the response shapes from:
 *   GET /api/tools/property-production
 *   GET /api/tools/well-production
 *   GET /api/prices
 */

// ── Shared ────────────────────────────────────────────────────

export interface ProductionMonth {
  yearMonth: string; // "YYYYMM"
  oilBbl: number;
  gasMcf: number;
}

export interface Trailing3Mo {
  avgOilBbl: number;
  avgGasMcf: number;
}

export interface Interest {
  type: 'RI' | 'WI' | 'ORRI';
  label: string;
  decimal: number;
  source: string;
  sourceDocId: string | null;
  sourceDate: string | null;
}

// ── Property Production Response ──────────────────────────────

export interface PropertyInfo {
  id: string;
  county: string | null;
  section: string | null;
  township: string | null;
  range: string | null;
  meridian: string | null;
  ri_decimal: number | null;
  wi_decimal: number | null;
  orri_decimal: number | null;
  ri_acres: number | null;
  total_acres: number | null;
  acres: number | null;
}

export interface PropertyWell {
  wellId: string;
  wellName: string;
  apiNumber: string | null;
  operator: string | null;
  wellStatus: string | null;
  interestDecimal: number | null;
  interestSource: string;
  interestSourceDocId: string | null;
  interestSourceDate: string | null;
  interests: Interest[];
  basePuns: string[];
  sharedPun: boolean;
  allocationPct: number | null;
  allocationSource: string | null;
  allocationSourceDocId: string | null;
  production: ProductionMonth[];
  trailing3mo: Trailing3Mo;
}

export interface SharedPunGroup {
  basePun: string;
  wellIds: string[];
  wellNames: string[];
  production: ProductionMonth[];
  trailing3mo: Trailing3Mo;
}

export interface PropertyProductionResponse {
  property: PropertyInfo;
  dataHorizon: string | null;
  wells: PropertyWell[];
  sharedPunGroups: SharedPunGroup[];
}

// ── Well Production Response ──────────────────────────────────

export interface WellInfo {
  id: string;
  wellName: string;
  apiNumber: string | null;
  operator: string | null;
  county: string | null;
  wellStatus: string | null;
  ri_nri: number | null;
  wi_nri: number | null;
  orri_nri: number | null;
  interestDecimal: number | null;
  interestSource: string;
  interestSourceDocId: string | null;
  interestSourceDate: string | null;
  interests: Interest[];
  basePuns: string[];
  allocationPct: number | null;
  allocationSource: string | null;
}

export interface LinkedProperty {
  id: string;
  county: string | null;
  section: string | null;
  township: string | null;
  range: string | null;
  meridian: string | null;
  ri_decimal: number | null;
  ri_acres: number | null;
  total_acres: number | null;
  acres: number | null;
}

export interface WellProductionResponse {
  well: WellInfo;
  linkedProperty: LinkedProperty | null;
  dataHorizon: string | null;
  production: ProductionMonth[];
  trailing3mo: Trailing3Mo;
}

// ── Prices Response ───────────────────────────────────────────

export interface PricesResponse {
  wti: { price: number };
  henryHub: { price: number };
}

// ── Revenue Calculation ───────────────────────────────────────

export interface RevenueResult {
  gross: number | null;
  net: number | null;
}

export function calcRevenue(
  oilBbl: number,
  gasMcf: number,
  oilPrice: number,
  gasPrice: number,
  decimal: number | null,
  allocationPct: number | null,
  deductionPct: number,
): RevenueResult {
  if (decimal == null) return { gross: null, net: null };
  const alloc = allocationPct ?? 1;
  const grossWell = (oilBbl * oilPrice + gasMcf * gasPrice) * alloc;
  const gross = grossWell * decimal;
  const net = gross * (1 - deductionPct / 100);
  return { gross, net };
}
