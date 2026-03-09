/** Intelligence tier based on user's plan */
export type IntelligenceTier = 'none' | 'portfolio' | 'full';

/** Insight severity levels */
export type InsightSeverity = 'info' | 'warning' | 'success' | 'critical';

/** Summary card data from /api/intelligence/summary */
export interface SummaryData {
  activeWells: number;
  countyCount: number;
  estimatedRevenue: number | null;
  revenueChange: number | null;
  revenueWellCount?: number;
  totalWells?: number;
  deductionFlags: number | null;
  shutInWells: number;
  wellsAnalyzed: number;
  wellsWithLinks?: number;
  actionItems: number;
  nearestDeadline: string | null;
  _intelligence_tier: IntelligenceTier;
  _beta_restricted?: boolean;
}

/** Single insight from /api/intelligence/insights */
export interface Insight {
  severity: InsightSeverity;
  title: string;
  description: string;
  action?: string;
  actionId?: string;
}

/** Report identifiers */
export type ReportType =
  | 'deduction'
  | 'production-decline'
  | 'pooling'
  | 'shut-in'
  | 'occ-filing'
  | 'well-risk'
  | 'operator-efficiency'
  | 'operator-directory';

// ── Deduction Report ──

export interface DeductionProduct {
  product_code: string;
  product_name: string;
  gross_value: number;
  market_deduction: number;
  deduction_pct: number;
}

export interface DeductionMonthly {
  year_month: string;
  gross_value: number;
  market_deduction: number;
  net_value: number;
  deduction_pct: number;
}

export interface DeductionWell {
  api_number: string;
  well_name: string;
  county: string;
  agg_deduction_pct: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  products: DeductionProduct[];
  monthly: DeductionMonthly[];
  residueGasNote: boolean;
  county_avg_pct: number | null;
  variance_points: number | null;
  operator: string;
  purchaser_id: string | null;
  purchaser_name: string | null;
  is_affiliated: boolean;
  gas_profile: 'lean' | 'rich' | 'mixed' | null;
  gor: number | null;
  lean_gas_expected: boolean;
  oil_only_verify: boolean;
  operator_number: string | null;
}

export interface DeductionReportData {
  flaggedWells: DeductionWell[];
  portfolio: {
    avg_deduction_pct: number;
    total_wells_analyzed: number;
  };
  statewide: {
    avg_deduction_pct: number | null;
  };
  summary: {
    flagged_count: number;
    worst_deduction_pct: number;
    total_excess_deductions: number;
    analysis_period: string;
    latest_month: string | null;
  };
}

// ── Deduction Categories ──

export interface DeductionCategoryDetail {
  category: string;
  total_amount: number;
  raw_labels: string[];
}

export interface DeductionBucket {
  bucket: string;
  bucket_label: string;
  total_amount: number;
  pct_of_gross: number;
  categories: DeductionCategoryDetail[];
}

export interface DeductionPercentiles {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface WellCategoryData {
  api_number: string;
  well_name: string | null;
  operator: string;
  county: string;
  interest_type: string | null;
  observation_count: number;
  buckets: DeductionBucket[];
  percentiles: Record<string, DeductionPercentiles | null>;
}

export interface CategoryBreakdownData {
  wells: WellCategoryData[];
}

// ── Operator Comparison ──

export interface OperatorComparisonEntry {
  operator_number: string;
  operator_name: string;
  your_wells: number;
  total_wells: number;
  total_gross: number;
  residue_deductions: number;
  liquids_returned: number;
  deduction_ratio: number;
  ngl_recovery_ratio: number | null;
  is_affiliated: boolean;
  gas_profile: 'lean' | 'rich' | null;
}

export interface OperatorComparisonData {
  operators: OperatorComparisonEntry[];
  statewide: {
    operator_count: number;
    deduction_ratio: number;
    ngl_recovery_ratio: number | null;
  } | null;
  analysis_period: string;
}

// ── Deduction Research ──

export interface DeductionResearchData {
  topDeductionCounties: Array<{ county: string; avg_deduction_pct: number; well_count: number }>;
  topPcrrOperators: Array<{ operator_name: string; pcrr: number; well_count: number }>;
  topNetReturnOperators: Array<{ operator_name: string; net_value_return: number; well_count: number }>;
}

// ── Production Decline ──

export interface DeclineMonthly {
  yearMonth: string;
  oil: number;
  gas: number;
  boe: number;
}

export interface DeclineWell {
  clientWellId: string;
  wellId: string;
  apiNumber: string;
  wellName: string;
  operator: string;
  county: string;
  formation: string;
  wellType: string;
  isHorizontal: boolean;
  status: 'active' | 'declining' | 'steep_decline' | 'idle';
  lastReportedMonth: string | null;
  recentOilBBL: number | null;
  recentGasMCF: number | null;
  recentBOE: number;
  yoyChangePct: number | null;
}

export interface DeclineMarketComparison {
  county: string;
  avgYoyPct: number | null;
  userAvgYoyPct: number | null;
  delta: number | null;
  userWellCount: number;
  countyWellCount: number;
}

export interface ProductionDeclineData {
  wells: DeclineWell[];
  summary: {
    totalWells: number;
    activeWells: number;
    idleWells: number;
    portfolioOilBBL: number;
    portfolioGasMCF: number;
    wellsInDecline: number;
    wellsSteepDecline: number;
  };
  latestDataMonth: string;
  monthlyTotals?: Array<{ yearMonth: string; totalOil: number; totalGas: number; totalBoe: number }>;
}

// ── Production Decline Markets ──

export interface FormationSummary {
  formation: string;
  wellCount: number;
  avgYoyChangePct: number | null;
  activeWells: number;
  idleWells: number;
}

export interface DeclineCountyAggregate {
  county: string;
  totalWells: number;
  activeWells: number;
  idleWells: number;
  avgYoyChangePct: number | null;
  medianYoyChangePct: number | null;
  weightedAvgYoyPct: number | null;
  userWellCount: number;
  userAvgYoyPct: number | null;
  userMedianYoyPct: number | null;
  userVsCountyDelta: number | null;
  topFormations: FormationSummary[];
}

export interface DeclineMarketsData {
  latestDataMonth: string;
  counties: DeclineCountyAggregate[];
}

// ── Decline Research ──

export interface DeclineResearchOperator {
  operator: string;
  operatorNumber: string | null;
  activeWells: number;
  avgDecline: number;
}

export interface DeclineResearchCounty {
  county: string;
  activeWells: number;
  avgDecline: number;
  decliningWells: number;
  growingWells: number;
}

export interface DeclineResearchData {
  summary: {
    totalPuns: number;
    activePuns: number;
    avgDecline: number;
    steepDecline: number;
    flatWells: number;
    growingWells: number;
    dataHorizon: string;
  };
  operatorsByDecline: DeclineResearchOperator[];
  operatorsByGrowth: DeclineResearchOperator[];
  counties: DeclineResearchCounty[];
}

// ── Shut-In Detector ──

export interface ShutInWell {
  clientWellId: string;
  apiNumber: string;
  wellName: string;
  operator: string;
  operatorNumber: string | null;
  county: string;
  wellType: string;
  pun: string | null;
  status: 'recently_idle' | 'extended_idle' | 'no_recent_production' | 'no_data';
  monthsIdle: number;
  lastProdMonth: string | null;
  firstProdMonth: string | null;
  peakMonth: string | null;
  declineRate12m: number | null;
  riskFlags: string[];
  taxPeriodStart: string | null;
  taxPeriodEnd: string | null;
  taxPeriodActive: boolean | null;
}

export interface ShutInDetectorData {
  summary: {
    totalIdle: number;
    hbpRisk: number;
    recentlyIdle: number;
    extendedIdle: number;
    noRecentProd: number;
    noData: number;
  };
  wells: ShutInWell[];
  generatedAt: string;
}

export interface ShutInMarketCounty {
  county: string;
  countyCode: string;
  totalWells: number;
  idleWells: number;
  idleRate: number;
  userWellCount: number;
  userIdleWells: number;
  userIdleRate: number;
  userVsCountyDelta: number | null;
  topOperators: Array<{
    operator: string;
    totalWells: number;
    idleWells: number;
    idleRate: number;
  }>;
}

export interface ShutInMarketsData {
  counties: ShutInMarketCounty[];
}

export interface ShutInResearchOperator {
  operator: string;
  operatorNumber: string | null;
  totalWells: number;
  idleWells: number;
  recentlyIdle: number;
  idleRatePct: number;
}

export interface ShutInResearchCounty {
  county: string;
  totalWells: number;
  idleWells: number;
  idleRatePct: number;
  topIdleOperator: string | null;
  topIdleOperatorNumber: string | null;
}

export interface ShutInResearchData {
  summary: {
    totalPuns: number;
    activePuns: number;
    idlePuns: number;
    idleRatePct: number;
    recentlyIdle: number;
    longTermIdle: number;
    newlyIdle6mo: number;
    unassignedWells: number;
    dataHorizon: string;
  };
  operatorsByCount: ShutInResearchOperator[];
  operatorsByRate: ShutInResearchOperator[];
  counties: ShutInResearchCounty[];
}

// ── Pooling Report ──

export interface PoolingElectionOption {
  optionNumber: number;
  optionType: string;
  bonusPerAcre: number | null;
  royaltyFraction: string | null;
}

export interface PoolingNearbyOrder {
  id: string;
  orderDate: string;
  operator: string;
  formations: Array<{ name: string } | string>;
  county: string;
  section: string;
  township: string;
  range: string;
  unitSizeAcres: number;
  wellType: string;
  responseDeadline: string;
  caseNumber: string;
  orderNumber: string;
  applicant: string;
  distanceTier: number;
  distanceDescription: string;
  electionOptions: PoolingElectionOption[];
}

export interface PoolingPropertyGroup {
  propertyId: string;
  propertyName: string;
  section: string;
  township: string;
  range: string;
  county: string;
  orderCount: number;
  avgBonus: number | null;
  sameSectionCount: number;
  adjacentCount: number;
  nearbyOrders: PoolingNearbyOrder[];
}

export interface PoolingCountyAvg {
  county: string;
  avgBonus: number | null;
  minBonus: number | null;
  maxBonus: number | null;
  orderCount: number;
  formations: string[];
  mostActiveOperator: string;
  dominantRoyalty: string;
}

export interface PoolingReportData {
  summary: {
    totalNearbyOrders: number;
    avgBonusPerAcre: number | null;
    bonusRange: { min: number | null; max: number | null };
    royaltyOptions: Record<string, number>;
    topOperators: Array<{ name: string; orderCount: number }>;
    dateRange: { earliest: string | null; latest: string | null };
    countyCount: number;
  };
  byProperty: PoolingPropertyGroup[];
  countyAverages: PoolingCountyAvg[];
  marketResearch: {
    topFormations: Array<{ name: string; avgBonus: number; orderCount: number }>;
    topPayingOperators: Array<{ name: string; avgBonus: number; orderCount: number }>;
    hottestCounties: Array<{ county: string; orderCount: number }>;
  };
}

// ── OCC Filing Activity ──

export interface OccFiling {
  caseNumber: string;
  reliefType: string;
  applicant: string;
  county: string;
  section: string;
  township: string;
  range: string;
  hearingDate: string | null;
  status: string;
  docketDate: string;
  sourceUrl: string;
  distanceTier: number;
  distanceDescription: string;
}

export interface OccFilingProperty {
  propertyId: string;
  propertyName: string;
  section: string;
  township: string;
  range: string;
  county: string;
  filingCount: number;
  sameSectionCount: number;
  filings: OccFiling[];
}

export interface OccFilingData {
  summary: {
    totalFilings: number;
    sameSectionFilings: number;
    filingTypes: Record<string, number>;
    topApplicants: Array<{ name: string; count: number }>;
    dateRange: { earliest: string | null; latest: string | null };
    propertiesWithActivity: number;
  };
  byProperty: OccFilingProperty[];
  byCounty: Array<{
    county: string;
    filingCount: number;
    topApplicants: Array<{ name: string; count: number }>;
    filingTypes: Record<string, number>;
    latestDate: string;
  }>;
  marketResearch?: {
    hottestCounties: Array<{ county: string; count: number }>;
    topFilers: Array<{ applicant: string; count: number }>;
    filingTypeBreakdown: Record<string, number>;
    totalStatewideFilings90d: number;
  };
}

// ── Well Risk Profile ──

export interface RiskProfileWell {
  clientWellId: string;
  wellName: string;
  apiNumber: string;
  operator: string;
  county: string;
  wellType: string;
  formationCanonical: string | null;
  formationGroup: string | null;
  profileId: string;
  profileName: string;
  halfCycleBreakeven: number;
  riskLevel: 'at_risk' | 'tight' | 'adequate' | 'comfortable';
  cushionDollar: number;
  cushionPct: number;
  totalDiscountPct: number;
  mktDeductionPct: number | null;
  taxPct: number | null;
  netBackPrice: number;
  stressedAtWti: number | null;
  criticalAtWti: number | null;
  hasDeductionData: boolean;
  deductionSource: string;
  deductionSourceDetail: string | null;
  deductionConfidence: string;
  isStale: boolean;
  lastProdMonth: string | null;
  declineRate12m: number | null;
}

export interface WellRiskProfileData {
  wtiPrice: { price: number; date: string; source: string };
  henryHubPrice: { price: number; date: string } | null;
  summary: {
    totalWells: number;
    idleWellsExcluded: number;
    atRiskCount: number;
    tightCount: number;
    adequateCount: number;
    comfortableCount: number;
    avgCushion: number;
    coverageRate: number;
    wellsWithDeductionData: number;
    avgDiscountPct: number;
    portfolioNetBack: number;
  };
  wells: RiskProfileWell[];
  byProfile: Array<{
    profileId: string;
    profileName: string;
    halfCycleBreakeven: number | null;
    wellCount: number;
    riskLevel: string;
  }>;
  byFormation: Array<{
    formationGroup: string;
    wellCount: number;
    avgBreakeven: number | null;
    profileDistribution: Record<string, number>;
    atRiskCount: number;
  }>;
}

// ── Operator Tools ──

export interface OperatorDirectoryEntry {
  operator_number: string;
  operator_name: string;
  well_count: number;
  counties: string[];
  status: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  contact_name?: string | null;
}

export interface OperatorEfficiencyEntry {
  operator_number: string;
  operator_name: string;
  status: string;
  well_count: number;
  total_gross: number;
  residue_deductions: number;
  deduction_pct: number | null;
  pcrr_value: number;
  net_value_return: number;
  pcrr: number | null;
  primary_county: string | null;
  primary_purchaser_id: string | null;
  primary_purchaser_name: string | null;
  is_affiliated: boolean;
  gas_profile: string | null;
}

export interface OperatorDetailData {
  operator_number: string;
  operator_name: string;
  status: string;
  contact: {
    status: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    contact_name: string | null;
  } | null;
  gas_profile: {
    label: string;
    lean_pct: number;
    oil_pct: number;
  } | null;
  all_counties: string[];
  summary: {
    total_gross: number;
    residue_deductions: number;
    pcrr_value: number;
    net_value_return: number;
    deduction_ratio: number | null;
    pcrr: number | null;
    well_count: number;
    total_puns: number;
  };
  efficiency: {
    pcrr: number | null;
    deduction_ratio: number | null;
  };
  purchaser: {
    primary_purchaser_id: string | null;
    primary_purchaser_name: string | null;
    is_affiliated: boolean;
  };
  production_health: {
    totalPuns: number;
    activePuns: number;
    idlePuns: number;
    recentlyIdle: number;
    extendedIdle: number;
    longTermIdle: number;
    idleRatePct: number;
    avgDecline: number | null;
    decliningWells: number;
    growingWells: number;
  } | null;
  monthly: Array<{
    year_month: string;
    total_gross: number;
    residue_deductions: number;
    well_count: number;
  }>;
  counties: Array<{
    county: string;
    well_count: number;
    total_gross: number;
    deduction_pct: number | null;
  }>;
  analysis_period: string;
}

// ── Report card config ──

export interface ReportCardConfig {
  type: ReportType;
  title: string;
  description: string;
  tier: 'portfolio' | 'full';
  icon: React.ReactNode;
  iconBg?: string;
  iconStroke?: string;
  section: 'reports' | 'research';
  initialTab?: string;
}
