import { apiFetch } from './client';
import type {
  SummaryData,
  Insight,
  DeductionReportData,
  OperatorComparisonData,
  DeductionResearchData,
  ProductionDeclineData,
  DeclineMarketsData,
  DeclineResearchData,
  ShutInDetectorData,
  PoolingReportData,
  OccFilingData,
  WellRiskProfileData,
  OperatorDirectoryEntry,
  OperatorEfficiencyEntry,
  OperatorDetailData,
  CategoryBreakdownData,
} from '../types/intelligence';

// ── Summary & Insights ──

export function fetchSummary(): Promise<SummaryData> {
  return apiFetch('/api/intelligence/summary');
}

export function fetchInsights(): Promise<{ insights: Insight[] }> {
  return apiFetch('/api/intelligence/insights');
}

// ── Deduction ──

export function fetchDeductionReport(): Promise<DeductionReportData> {
  return apiFetch('/api/intelligence/deduction-report');
}

export function fetchOperatorComparison(): Promise<OperatorComparisonData> {
  return apiFetch('/api/intelligence/operator-comparison');
}

export function fetchDeductionResearch(): Promise<DeductionResearchData> {
  return apiFetch('/api/intelligence/deduction-research');
}

export function fetchDeductionCategories(apiNumber?: string): Promise<CategoryBreakdownData> {
  const params = apiNumber ? `?api_number=${encodeURIComponent(apiNumber)}` : '';
  return apiFetch(`/api/intelligence/deduction-categories${params}`);
}

// ── Production Decline ──

export function fetchProductionDecline(): Promise<ProductionDeclineData> {
  return apiFetch('/api/intelligence/production-decline');
}

export function fetchDeclineMarkets(): Promise<DeclineMarketsData> {
  return apiFetch('/api/intelligence/production-decline/markets');
}

export function fetchDeclineResearch(): Promise<DeclineResearchData> {
  return apiFetch('/api/intelligence/production-decline/research');
}

// ── Shut-In Detector ──

export function fetchShutInDetector(): Promise<ShutInDetectorData> {
  return apiFetch('/api/intelligence/shut-in-detector');
}

export function fetchShutInMarkets(): Promise<ShutInMarketsData> {
  return apiFetch('/api/intelligence/shut-in-detector/markets');
}

export function fetchShutInResearch(): Promise<ShutInResearchData> {
  return apiFetch('/api/intelligence/shut-in-detector/research');
}

// ── Pooling ──

export function fetchPoolingReport(): Promise<PoolingReportData> {
  return apiFetch('/api/intelligence/pooling-report');
}

// ── OCC Filing ──

export function fetchOccFilingActivity(): Promise<OccFilingData> {
  return apiFetch('/api/intelligence/occ-filing-activity');
}

// ── Well Risk Profile ──

export function fetchWellRiskProfile(): Promise<WellRiskProfileData> {
  return apiFetch('/api/intelligence/well-risk-profile');
}

// ── Operator Tools ──

export async function fetchOperatorDirectory(minWells = 20): Promise<OperatorDirectoryEntry[]> {
  const resp = await apiFetch<{ operators: OperatorDirectoryEntry[]; total_count: number }>(`/api/operators/directory?min_wells=${minWells}`);
  return resp.operators;
}

export async function fetchOperatorEfficiency(minWells = 10): Promise<OperatorEfficiencyEntry[]> {
  const resp = await apiFetch<{ operators: OperatorEfficiencyEntry[] }>(`/api/operators/efficiency?min_wells=${minWells}`);
  return resp.operators;
}

export function fetchOperatorDetail(operatorNumber: string): Promise<OperatorDetailData> {
  return apiFetch(`/api/operators/${operatorNumber}`);
}

export function fetchOperatorLookup(name: string) {
  return apiFetch(`/api/operators/lookup?name=${encodeURIComponent(name)}`);
}
