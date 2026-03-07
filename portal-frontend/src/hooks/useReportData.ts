import { useState, useEffect, useCallback, useRef } from 'react';

interface UseReportDataOptions {
  enabled?: boolean;
  /** When any value in this array changes, data is re-fetched. */
  deps?: unknown[];
}

interface UseReportDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching report data.
 *
 * @param fetchFn  Async function that returns the report data.
 * @param options  `enabled` gates the fetch — won't fire until true (default true).
 *                 `deps` triggers a re-fetch when any value changes (e.g. filter state).
 */
export function useReportData<T>(
  fetchFn: () => Promise<T>,
  options: UseReportDataOptions = {},
): UseReportDataResult<T> {
  const { enabled = true, deps } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchRef.current();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchRef.current();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...(deps || [])]);

  return { data, loading, error, refetch: load };
}
