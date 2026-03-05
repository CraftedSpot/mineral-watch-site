import { useState, useEffect, useCallback, useRef } from 'react';

interface AsyncDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): AsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Track whether data has loaded and which execute ref triggered the last fetch.
  // This lets us skip redundant re-fetches when <Activity> re-fires effects
  // on hidden→visible transitions without deps changing.
  const dataLoadedRef = useRef(false);
  const lastExecuteRef = useRef<typeof execute | null>(null);

  const execute = useCallback(async () => {
    dataLoadedRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        dataLoadedRef.current = true;
        setData(result);
        setLoading(false);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        dataLoadedRef.current = true;
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    const depsChanged = lastExecuteRef.current !== execute;
    lastExecuteRef.current = execute;
    // Fetch if deps changed OR data never finished loading (e.g. interrupted by Activity hide)
    if (depsChanged || !dataLoadedRef.current) {
      execute();
    }
    return () => { mountedRef.current = false; };
  }, [execute]);

  return { data, loading, error, refetch: execute };
}
