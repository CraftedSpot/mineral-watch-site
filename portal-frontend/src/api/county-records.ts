import { apiFetch } from './client';

export interface CountyRecord {
  county: string;
  series: string;
  number: string;
  instrument_type: string;
  instrument_date: string | null;
  indexed_date: string | null;
  grantors: string[];
  grantees: string[];
  legal_descriptions: { section: string; township: string; range: string; quarter: string | null; legal: string; acres: number | null }[];
  page_count: number;
  cost_to_view: number;
  free_to_view: boolean;
  images: { number: number; page: string }[];
  in_library: boolean;
  retrieve_credits: number;
  document_id?: string;
  doc_status?: string;
}

export interface CountyRecordSearchResult {
  results: CountyRecord[];
  total_results: number;
  page: number;
  total_pages: number;
  from_cache: boolean;
}

export interface CountyRecordRetrieveResult {
  success: boolean;
  document_id?: string;
  status?: string;
  doc_type?: string;
  display_name?: string;
  page_count?: number;
  credits_charged?: number;
  message?: string;
  error?: string;
}

export function searchCountyRecords(params: {
  county: string;
  section: string;
  township: string;
  range: string;
  page?: number;
  party_name?: string;
}): Promise<CountyRecordSearchResult> {
  return apiFetch('/api/county-records/search', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function retrieveCountyRecord(params: {
  county: string;
  instrument_number: string;
  images: { number: number; page: string }[];
  instrument_type?: string;
}): Promise<CountyRecordRetrieveResult> {
  return apiFetch('/api/county-records/retrieve', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
