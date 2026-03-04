import { apiFetch } from './client';
import type { DocketEntry, OccProcessResult } from '../types/well-detail';

export async function fetchDocketEntries(params: {
  section: string;
  township: string;
  range: string;
  meridian?: string;
  includeAdjacent?: boolean;
}): Promise<{ direct: DocketEntry[]; adjacent: DocketEntry[] }> {
  const qs = new URLSearchParams({
    section: params.section,
    township: params.township,
    range: params.range,
    meridian: params.meridian || 'IM',
    includeAdjacent: String(params.includeAdjacent ?? true),
  });
  return apiFetch(`/api/docket-entries?${qs}`);
}

export async function processOccFiling(
  caseNumber: string,
  orderNumber: string,
  force = false,
): Promise<OccProcessResult> {
  return apiFetch('/api/occ/fetch', {
    method: 'POST',
    body: JSON.stringify({ caseNumber, orderNumber, force }),
  });
}

export async function fetchDocumentStatus(docId: string): Promise<{ status: string; display_name?: string; extraction_error?: string }> {
  const res = await apiFetch<{ document: { status: string; display_name?: string; extraction_error?: string } }>(
    `/api/documents/${docId}`,
  );
  return res.document;
}

export async function analyzeCompletionReport(
  apiNumber: string,
  entryId: string,
  force = false,
): Promise<OccProcessResult> {
  return apiFetch('/api/occ/fetch-1002a', {
    method: 'POST',
    body: JSON.stringify({ apiNumber, entryId, force }),
  });
}

export async function analyzePermit(
  apiNumber: string,
  entryId: string,
  force = false,
): Promise<OccProcessResult> {
  return apiFetch(`/api/wells/${apiNumber}/analyze-permit`, {
    method: 'POST',
    body: JSON.stringify({ entryId, force }),
  });
}

export async function checkAnalyzedFilings(
  caseNumbers: string[],
): Promise<Record<string, { documentId: string; displayName: string }>> {
  if (caseNumbers.length === 0) return {};
  return apiFetch(`/api/documents/by-occ-cases?cases=${caseNumbers.join(',')}`);
}
