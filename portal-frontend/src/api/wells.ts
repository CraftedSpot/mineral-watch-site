import { apiFetch } from './client';
import type {
  WellEnrichment,
  LinkedProperty,
  LinkedDocument,
  ProductionSummary,
  CompletionReport,
  DrillingPermit,
  DocketEntry,
} from '../types/well-detail';

export async function fetchWellEnrichment(apiNumber: string): Promise<WellEnrichment> {
  const res = await apiFetch<{ data: WellEnrichment }>(`/api/well-enrichment/${apiNumber}`);
  return res.data;
}

export async function fetchLinkedProperties(wellId: string): Promise<LinkedProperty[]> {
  const res = await apiFetch<{ properties: LinkedProperty[] }>(`/api/well/${wellId}/linked-properties`);
  return (res.properties || []).filter((p) => p.linkStatus !== 'Unlinked');
}

export async function fetchProductionSummary(apiNumber: string): Promise<ProductionSummary> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await apiFetch<ProductionSummary>(`/api/wells/${apiNumber}/production-summary`, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCompletionReports(apiNumber: string): Promise<CompletionReport[]> {
  const res = await apiFetch<{ completionReports: CompletionReport[] }>(
    `/api/wells/${apiNumber}/completion-reports`,
  );
  return res.completionReports || [];
}

export async function fetchDrillingPermits(apiNumber: string): Promise<DrillingPermit[]> {
  const res = await apiFetch<{ drillingPermits: DrillingPermit[] }>(
    `/api/wells/${apiNumber}/drilling-permits`,
  );
  return res.drillingPermits || [];
}

export async function fetchDocketEntriesByWell(
  apiNumber: string,
): Promise<{ direct: DocketEntry[]; pun?: string }> {
  const res = await apiFetch<{ direct: DocketEntry[]; pun?: string }>(
    `/api/docket-entries-by-well?api=${apiNumber}`,
  );
  return res;
}

export async function fetchLinkedDocuments(wellId: string, apiNumber: string): Promise<LinkedDocument[]> {
  const res = await apiFetch<{ documents: LinkedDocument[] }>(
    `/api/well/${wellId}/linked-documents?api_number=${apiNumber}`,
  );
  return res.documents || [];
}

export async function saveWellNotes(wellId: string, notes: string): Promise<void> {
  await apiFetch(`/api/wells/${wellId}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

// --- Add Well ---

export async function addWell(apiNumber: string, notes?: string): Promise<{ id: string; success: true }> {
  return apiFetch<{ id: string; success: true }>('/api/wells', {
    method: 'POST',
    body: JSON.stringify({ apiNumber, notes: notes || '' }),
  });
}

// --- Search Wells ---

export interface SearchWellResult {
  api_number: string;
  well_name: string;
  well_number: string;
  section: string | number;
  township: string;
  range: string;
  county: string;
  operator: string;
  well_type: string;
  well_status: string;
  formation_name: string;
  ip_oil_bbl: number | null;
  ip_gas_mcf: number | null;
}

export interface SearchWellsParams {
  q?: string;
  well_name?: string;
  operator?: string;
  section?: string;
  township?: string;
  range?: string;
  county?: string;
}

export async function searchWells(params: SearchWellsParams): Promise<{
  wells: SearchWellResult[];
  total: number;
  truncated: boolean;
}> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const res = await apiFetch<{ success: boolean; data: { wells: SearchWellResult[]; total: number; truncated: boolean } }>(
    `/api/wells/search?${qs.toString()}`,
  );
  return res.data;
}
