import { apiFetch } from './client';
import type {
  TitleChainPropertiesResponse,
  TitleChainResponse,
  NameSuggestionsResponse,
  BulkCorrectRequest,
  BulkCorrectResponse,
} from '../types/title-chain';

/** Fetch properties that have chain-of-title documents */
export function fetchChainProperties(): Promise<TitleChainPropertiesResponse> {
  return apiFetch('/api/title-chain/properties');
}

/**
 * Prefetch properties into module-level cache so the title page loads instantly.
 * Called on nav hover — deduped so multiple hovers don't re-fetch.
 */
let _prefetchPromise: Promise<TitleChainPropertiesResponse> | null = null;
let _prefetchResult: TitleChainPropertiesResponse | null = null;

export function prefetchTitleProperties(): void {
  if (_prefetchResult || _prefetchPromise) return;
  _prefetchPromise = fetchChainProperties()
    .then((res) => { _prefetchResult = res; return res; })
    .catch(() => { _prefetchPromise = null; return null as any; });
}

export function getPrefetchedProperties(): TitleChainPropertiesResponse | null {
  return _prefetchResult;
}

export function clearPrefetchedProperties(): void {
  _prefetchResult = null;
  _prefetchPromise = null;
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

/** Fetch name variation clusters for a property's title chain */
export function fetchNameSuggestions(propertyId: string): Promise<NameSuggestionsResponse> {
  return apiFetch(`/api/property/${propertyId}/name-suggestions`);
}

/** Apply bulk name corrections + save learned mappings */
export function bulkCorrectNames(propertyId: string, data: BulkCorrectRequest): Promise<BulkCorrectResponse> {
  return apiFetch(`/api/property/${propertyId}/bulk-correct`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** Delete a learned name mapping (stops future auto-corrections for that variant) */
export function deleteNameMapping(propertyId: string, mappingId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/property/${propertyId}/name-mapping/${mappingId}`, {
    method: 'DELETE',
  });
}

/** Mark an orphan document as a manual chain root */
export function markAsRoot(propertyId: string, docId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/property/${propertyId}/mark-root`, {
    method: 'POST',
    body: JSON.stringify({ doc_id: docId }),
  });
}

/** Remove manual chain root designation */
export function unmarkRoot(propertyId: string, docId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/property/${propertyId}/unmark-root`, {
    method: 'POST',
    body: JSON.stringify({ doc_id: docId }),
  });
}

/** Scan for and flag duplicate chain documents on a property */
export function dedupScan(propertyId: string): Promise<{
  success: boolean;
  docsScanned: number;
  tier1aDuplicates: number;
  tier1bDuplicates: number;
  tier2Duplicates: number;
  totalFlagged: number;
}> {
  return apiFetch(`/api/property/${propertyId}/dedup-scan`, {
    method: 'POST',
  });
}
