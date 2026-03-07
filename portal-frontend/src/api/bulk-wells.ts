import { apiFetch } from './client';

// --- Validation Types ---

export interface WellSearchMatch {
  api_number: string;
  well_name: string;
  well_number?: string;
  operator: string;
  county: string;
  section: string | number;
  township: string;
  range: string;
  well_status: string;
  match_score: number;
  sectionMismatch?: boolean;
}

export interface WellValidationResult {
  row: number;
  original: Record<string, unknown>;
  normalized: {
    apiNumber?: string;
    wellName?: string;
    csvWellName?: string;
    notes?: string;
    punResolved?: string;
  } | null;
  matchStatus: 'has_api' | 'exact' | 'ambiguous' | 'not_found';
  searchResults: { matches: WellSearchMatch[]; total: number; truncated: boolean } | null;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
  isValid: boolean;
  needsSelection: boolean;
}

export interface WellValidationResponse {
  results: WellValidationResult[];
  summary: {
    total: number;
    exactMatches: number;
    needsReview: number;
    notFound: number;
    hasApi: number;
    duplicates: number;
    willImport: number;
    canImport: boolean;
  };
  planCheck: {
    current: number;
    limit: number;
    plan: string;
    afterUpload: number;
    wouldExceedLimit: boolean;
  };
}

export interface WellUploadResponse {
  success: boolean;
  results: {
    successful: number;
    failed: number;
    skipped: number;
    duplicatesSkipped: number;
    errors: string[];
  };
}

// --- API Functions ---

export async function bulkValidateWells(
  wells: Record<string, unknown>[],
): Promise<WellValidationResponse> {
  return apiFetch<WellValidationResponse>('/api/bulk-validate-wells', {
    method: 'POST',
    body: JSON.stringify({ wells }),
  });
}

export async function bulkUploadWells(
  wells: WellValidationResult[],
  selections?: Record<number, string>,
): Promise<WellUploadResponse> {
  return apiFetch<WellUploadResponse>('/api/bulk-upload-wells', {
    method: 'POST',
    body: JSON.stringify({ wells, selections }),
  });
}
