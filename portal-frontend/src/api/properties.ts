import { apiFetch } from './client';
import type { LinkedWell, LinkedDocument, PropertySavePayload } from '../types/property-detail';

export async function fetchLinkedWells(propId: string): Promise<LinkedWell[]> {
  const res = await apiFetch<{ wells: LinkedWell[] }>(`/api/property/${propId}/linked-wells`);
  return (res.wells || []).filter((w) => w.linkStatus !== 'Unlinked');
}

export async function fetchLinkedDocuments(propId: string): Promise<LinkedDocument[]> {
  const res = await apiFetch<{ documents: LinkedDocument[] }>(`/api/property/${propId}/linked-documents`);
  return res.documents || [];
}

export async function saveProperty(propId: string, payload: PropertySavePayload): Promise<void> {
  await apiFetch(`/api/properties/${propId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function unlinkWell(linkId: string): Promise<void> {
  await apiFetch(`/api/property-well-link/${linkId}`, { method: 'DELETE' });
}

export async function relinkWell(linkId: string): Promise<void> {
  await apiFetch(`/api/property-well-link/${linkId}`, {
    method: 'PATCH',
    body: JSON.stringify({ linkStatus: 'Linked' }),
  });
}

// --- Bulk Import Types ---

export interface BulkValidationResult {
  index: number;
  original: Record<string, unknown>;
  normalized: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
  isValid: boolean;
}

export interface BulkValidationResponse {
  results: BulkValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    warnings: number;
    willImport: number;
    emptyRowsSkipped: number;
  };
  planCheck: {
    current: number;
    limit: number;
    plan: string;
    afterUpload: number;
    wouldExceedLimit: boolean;
  };
}

export interface BulkUploadResponse {
  success: boolean;
  results: {
    successful: number;
    failed: number;
    skipped: number;
    errors: Array<{ index: number; error: string }>;
  };
}

export async function bulkValidateProperties(
  properties: Record<string, unknown>[]
): Promise<BulkValidationResponse> {
  return apiFetch<BulkValidationResponse>('/api/bulk-validate-properties', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

export async function bulkUploadProperties(
  properties: Record<string, unknown>[]
): Promise<BulkUploadResponse> {
  return apiFetch<BulkUploadResponse>('/api/bulk-upload-properties', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

// --- Single Property ---

export async function addProperty(fields: {
  SEC: string;
  TWN: string;
  RNG: string;
  MERIDIAN?: string;
  COUNTY?: string;
  Group?: string;
  'RI Acres'?: number;
  'WI Acres'?: number;
  Notes?: string;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/api/properties', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}
