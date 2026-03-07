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

// --- Upload ---

export interface UploadResult {
  id: string;
  filename: string;
  size: number;
  status: string;
}

export interface BatchUploadResult {
  uploaded: number;
  failed: number;
  results: Array<{ success: boolean; id?: string; filename: string; size?: number; status?: string }>;
  errors: Array<{ filename: string; error: string }>;
}

export interface PrescanStatus {
  status: 'scanning' | 'prescan_complete' | string;
  document_count?: number;
  page_count?: number;
  estimated_credits?: number;
}

async function uploadFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout
  try {
    const res = await fetch(url, { credentials: 'include', signal: controller.signal, ...init });
    clearTimeout(timeout);
    if (res.status === 402) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Insufficient credits');
    }
    if (res.status === 413) throw new Error('File too large (max 95MB)');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Upload timed out — the file may be too large');
    }
    throw err;
  }
}

/** Presigned R2 upload for files >95MB that exceed CF Worker body limit */
async function presignedUpload(
  file: File,
  options: { enhanced?: boolean; prescan?: boolean } = {},
): Promise<UploadResult> {
  // Step 1: Request presigned URL
  const reqRes = await uploadFetch('/api/documents/request-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      enhanced: options.enhanced ?? false,
      prescan: options.prescan ?? false,
    }),
  });
  const { uploadUrl, r2Key, uploadId } = await reqRes.json();

  // Step 2: Upload directly to R2 via presigned URL
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!putRes.ok) throw new Error(`Direct upload failed (${putRes.status})`);

  // Step 3: Confirm upload — server creates the D1 record
  const confirmRes = await uploadFetch('/api/documents/confirm-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      r2Key,
      filename: file.name,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      enhanced: options.enhanced ?? false,
      prescan: options.prescan ?? false,
    }),
  });
  const data = await confirmRes.json();
  return data.document;
}

const DIRECT_UPLOAD_THRESHOLD = 95 * 1024 * 1024;

export async function uploadDocument(
  file: File,
  options: { enhanced?: boolean; prescan?: boolean } = {},
): Promise<UploadResult> {
  // Route large files through presigned R2 upload
  if (file.size >= DIRECT_UPLOAD_THRESHOLD) {
    return presignedUpload(file, options);
  }
  const form = new FormData();
  form.append('file', file);
  form.append('enhanced', options.enhanced ? '1' : '0');
  if (options.prescan) form.append('prescan', '1');
  const res = await uploadFetch('/api/documents/upload', { method: 'POST', body: form });
  const data = await res.json();
  return data.document;
}

export async function uploadDocuments(
  files: File[],
  options: { enhanced?: boolean; prescanIndices?: number[] } = {},
): Promise<BatchUploadResult> {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  form.append('enhanced', options.enhanced ? '1' : '0');
  if (options.prescanIndices && options.prescanIndices.length > 0) {
    form.append('prescan_doc_indices', options.prescanIndices.join(','));
  }
  const res = await uploadFetch('/api/documents/upload-multiple', { method: 'POST', body: form });
  return res.json();
}

export async function pollPrescanStatus(docId: string): Promise<PrescanStatus> {
  const res = await fetch(`/api/documents/${docId}/prescan`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to check prescan status');
  return res.json();
}

export async function confirmProcessing(docId: string): Promise<void> {
  const res = await uploadFetch(`/api/documents/${docId}/confirm-processing`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) throw new Error('Failed to confirm processing');
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
