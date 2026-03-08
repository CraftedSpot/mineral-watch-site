import { useQuery } from '@tanstack/react-query';

interface UseReportDataOptions {
  enabled?: boolean;
  /** When any value in this array changes, data is re-fetched (included in query key). */
  deps?: unknown[];
  /** Explicit query key segment. Auto-derived from fetchFn.name if omitted. */
  key?: string;
}

interface UseReportDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching report data, backed by TanStack Query.
 *
 * - Caches results for 5 minutes (stale-while-revalidate)
 * - Retries failed requests twice
 * - `enabled` gates the fetch — won't fire until true (default true)
 * - `deps` are included in the query key so changes trigger re-fetch
 * - `key` overrides the auto-derived query key segment (needed for anonymous fns)
 */
export function useReportData<T>(
  fetchFn: () => Promise<T>,
  options: UseReportDataOptions = {},
): UseReportDataResult<T> {
  const { enabled = true, deps, key } = options;
  const queryKey = ['intelligence', key || fetchFn.name || 'report', ...(deps || [])];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: fetchFn,
    enabled,
    staleTime: 30 * 60 * 1000,  // 30 min — intelligence data only changes on daily cron
  });

  return {
    data: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : 'Failed to load report') : null,
    refetch: () => { refetch(); },
  };
}
