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
