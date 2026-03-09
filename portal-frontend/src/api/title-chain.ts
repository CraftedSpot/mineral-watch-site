import { apiFetch } from './client';
import type { TitleChainPropertiesResponse, TitleChainResponse } from '../types/title-chain';

/** Fetch properties that have chain-of-title documents */
export function fetchChainProperties(): Promise<TitleChainPropertiesResponse> {
  return apiFetch('/api/title-chain/properties');
}

/** Fetch chain-of-title data for a property (with tree) */
export function fetchTitleChain(propertyId: string): Promise<TitleChainResponse> {
  return apiFetch(`/api/property/${propertyId}/title-chain?include_tree=1`);
}

/** Update interest fields on a current owner (marks is_manual = 1) */
export function updateCurrentOwnerInterest(
  propertyId: string,
  ownerId: number,
  data: { interest_text?: string; interest_decimal?: number | null; interest_type?: string | null },
): Promise<{ success: boolean }> {
  return apiFetch(`/api/property/${propertyId}/current-owners/${ownerId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** Revert a manual interest edit back to auto-extracted values */
export function revertCurrentOwnerInterest(
  propertyId: string,
  ownerId: number,
): Promise<{ success: boolean }> {
  return apiFetch(`/api/property/${propertyId}/current-owners/${ownerId}/manual`, {
    method: 'DELETE',
  });
}
