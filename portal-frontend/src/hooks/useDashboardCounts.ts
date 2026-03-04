import { useEffect, useSyncExternalStore } from 'react';
import { useDashboardStore } from '../contexts/DashboardDataContext';
import type { DashboardCounts } from '../types/dashboard';

export function useDashboardCounts(): {
  data: DashboardCounts | null;
  loading: boolean;
  error: string | null;
} {
  const store = useDashboardStore();
  const state = useSyncExternalStore(store.subscribe, () => store.getSnapshot().counts);

  useEffect(() => {
    if (!state.data && !state.loading) {
      store.loadCounts();
    }
  }, [state.data, state.loading, store]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
  };
}
