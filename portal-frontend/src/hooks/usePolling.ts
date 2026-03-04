import { useState, useCallback, useRef, useEffect } from 'react';

interface PollingOptions<T> {
  interval?: number;      // ms between polls (default 5000)
  maxDuration?: number;   // max total polling time in ms (default 300000 = 5min)
  shouldStop?: (data: T) => boolean;
}

interface PollingResult<T> {
  data: T | null;
  polling: boolean;
  error: string | null;
  start: (fetcher: () => Promise<T>) => void;
  stop: () => void;
}

export function usePolling<T>(opts: PollingOptions<T> = {}): PollingResult<T> {
  const { interval = 5000, maxDuration = 300000, shouldStop } = opts;
  const [data, setData] = useState<T | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);
  const fetcherRef = useRef<(() => Promise<T>) | null>(null);
  const mountedRef = useRef(true);
  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!mountedRef.current || !fetcherRef.current) return;
    if (Date.now() - startTimeRef.current > maxDuration) {
      setPolling(false);
      setError('Polling timed out');
      return;
    }
    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current) return;
      setData(result);
      if (shouldStopRef.current?.(result)) {
        setPolling(false);
        return;
      }
      timerRef.current = setTimeout(poll, interval);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Polling error');
      setPolling(false);
    }
  }, [interval, maxDuration]);

  const start = useCallback((fetcher: () => Promise<T>) => {
    cleanup();
    fetcherRef.current = fetcher;
    startTimeRef.current = Date.now();
    setPolling(true);
    setError(null);
    setData(null);
    // Start first poll immediately
    setTimeout(poll, 0);
  }, [cleanup, poll]);

  const stop = useCallback(() => {
    cleanup();
    setPolling(false);
  }, [cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  return { data, polling, error, start, stop };
}
