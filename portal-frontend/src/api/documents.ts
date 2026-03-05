import { apiFetch } from './client';
import type { DocumentDetail } from '../types/document-detail';

export interface UsageStats {
  docs_processed: number;
  credits_used: number;
  monthly_limit: number;
  monthly_remaining: number;
  purchased_credits: number;
  permanent_credits: number;
  billing_period: string;
  percentage_used: number;
  total_available: number;
  reset_date: string;
  is_lifetime_tier: boolean;
  total_credits_purchased: number;
}

export interface UsageResponse {
  usage: UsageStats;
  plan: string;
  credits: {
    hasCredits: boolean;
    monthlyRemaining: number;
    permanentRemaining: number;
    totalAvailable: number;
  };
}

export async function fetchUsageStats(): Promise<UsageResponse> {
  return apiFetch<UsageResponse>('/api/documents/usage');
}

export async function fetchDocumentDetail(docId: string): Promise<DocumentDetail> {
  const res = await apiFetch<{ document: DocumentDetail } | DocumentDetail>(
    `/api/documents/${docId}`,
  );
  // API may return { document: ... } or direct object
  return 'document' in res ? res.document : res;
}

export async function saveDocumentNotes(docId: string, notes: string): Promise<void> {
  await apiFetch(`/api/documents/${docId}/notes`, {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  });
}

export async function fetchDocumentBlob(docId: string): Promise<{ blob: Blob; contentType: string }> {
  const res = await fetch(`/api/documents/${docId}/download?view=true`, {
    credentials: 'include',
  });
  if (res.status === 413) {
    throw new Error('FILE_TOO_LARGE');
  }
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  const blob = await res.blob();
  return { blob, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}
