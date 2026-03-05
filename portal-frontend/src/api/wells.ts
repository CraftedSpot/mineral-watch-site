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
