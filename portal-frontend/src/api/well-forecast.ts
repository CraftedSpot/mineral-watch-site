import { apiFetch } from './client';

export interface ComparablesResponse {
  success: boolean;
  target: {
    api: string;
    well_name: string;
    operator: string;
    formation: string;
    formation_group: string;
    county: string;
    trs: string;
    well_type: string;
    completion_date: string | null;
    well_status: string;
    lateral_length: number | null;
  };
  cohort: {
    count: number;
    formation: string;
    well_type: string;
    county: string;
    completion_range: string;
    tier: number;
    insufficient?: boolean;
  };
  type_curve: {
    months: number[];
    p10: { oil: number[]; gas: number[] };
    p50: { oil: number[]; gas: number[] };
    p90: { oil: number[]; gas: number[] };
    well_count_at_month: number[];
    max_month: number;
  } | null;
  milestones: Array<{
    month: number;
    p10_oil: number; p50_oil: number; p90_oil: number;
    p10_gas: number; p50_gas: number; p90_gas: number;
    well_count: number;
  }>;
  summary: {
    peak_oil_month: number;
    peak_p50_oil: number;
    peak_p50_gas: number;
    first_year_decline_rate: number | null;
    cumulative_p50_oil: number;
    cumulative_p50_gas: number;
    max_months_of_data: number;
  };
  target_vs_curve: {
    months_producing: number;
    performance_vs_p50: string | null;
  } | null;
  operator_sub_cohort: {
    count: number;
    operator: string;
  } | null;
}

export interface ForecastResponse {
  success: boolean;
  forecast: {
    id: string;
    forecast_text: string;
    model: string;
    credits_charged: number;
    generated_at: string;
    formation: string;
    well_type: string;
    county: string;
    comparable_count: number;
  } | null;
}

export async function getComparables(apiNumber: string): Promise<ComparablesResponse> {
  return apiFetch(`/api/well-forecast/comparables?api=${apiNumber}`);
}

export async function getForecast(apiNumber: string): Promise<ForecastResponse> {
  return apiFetch(`/api/well-forecast?api=${apiNumber}`);
}

export async function generateForecast(apiNumber: string, pun?: string): Promise<ForecastResponse> {
  return apiFetch('/api/well-forecast', {
    method: 'POST',
    body: JSON.stringify({ api_number: apiNumber, pun }),
  });
}
