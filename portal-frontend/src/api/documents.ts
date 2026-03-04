import { apiFetch } from './client';
import type { DocumentDetail } from '../types/document-detail';

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
