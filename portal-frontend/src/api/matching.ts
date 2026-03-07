import { apiFetch } from './client';

// --- Match Tracked Wells ---

export interface MatchWellsResponse {
  success: boolean;
  stats: {
    propertiesChecked: number;
    wellsChecked: number;
    linksCreated: number;
    existingLinks: number;
    newMatchesByType: Record<string, number>;
  };
}

// --- Discover & Track Wells ---

export interface DiscoverWellPreview {
  api_number: string;
  well_name: string;
  well_number?: string;
  operator: string;
  well_status: string;
  well_type?: string;
  is_horizontal?: boolean;
  county: string;
  section: string;
  township: string;
  range: string;
  match_method: string;
  matched_property_id: string;
  matched_property_desc: string;
}

export interface DiscoverWellsPreviewResponse {
  success: boolean;
  wells: DiscoverWellPreview[];
  total: number;
  planCheck: {
    current: number;
    limit: number;
    plan: string;
    afterAdd: number;
    wouldExceedLimit: boolean;
  };
}

export interface DiscoverWellsCommitResponse {
  success: boolean;
  stats: {
    wellsCreated: number;
    linksCreated: number;
    errors: string[];
  };
}

// --- API Functions ---

export async function matchPropertyWells(): Promise<MatchWellsResponse> {
  return apiFetch<MatchWellsResponse>('/api/match-property-wells', {
    method: 'POST',
  });
}

export async function discoverWellsPreview(): Promise<DiscoverWellsPreviewResponse> {
  return apiFetch<DiscoverWellsPreviewResponse>(
    '/api/discover-and-track-wells?preview=true',
    { method: 'POST' },
  );
}

export async function discoverWellsCommit(
  apiNumbers: string[],
): Promise<DiscoverWellsCommitResponse> {
  return apiFetch<DiscoverWellsCommitResponse>('/api/discover-and-track-wells', {
    method: 'POST',
    body: JSON.stringify({ apiNumbers }),
  });
}
