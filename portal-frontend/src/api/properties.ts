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
