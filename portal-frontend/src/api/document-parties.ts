import { apiFetch } from './client';

export interface AddPartyResult {
  success: boolean;
  party: {
    id: number;
    party_name: string;
    party_name_normalized: string;
    party_role: string;
    is_manual: number;
  };
}

export async function addDocumentParty(
  documentId: string,
  data: { party_name: string; party_role: string },
): Promise<AddPartyResult> {
  return apiFetch(`/api/documents/${documentId}/parties`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteDocumentParty(
  documentId: string,
  partyRowId: number,
): Promise<{ success: boolean }> {
  return apiFetch(`/api/documents/${documentId}/parties/${partyRowId}`, {
    method: 'DELETE',
  });
}

export async function restoreDocumentParty(
  documentId: string,
  partyRowId: number,
): Promise<{ success: boolean }> {
  return apiFetch(`/api/documents/${documentId}/parties/${partyRowId}/restore`, {
    method: 'POST',
  });
}
