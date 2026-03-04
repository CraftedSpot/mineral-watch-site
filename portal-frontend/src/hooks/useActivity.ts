import { useEffect, useSyncExternalStore } from 'react';
import { useDashboardStore } from '../contexts/DashboardDataContext';
import type { ActivityRecord } from '../types/dashboard';

/** Lazy-loaded: triggers fetch on first use */
export function useActivity(): {
  data: ActivityRecord[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const store = useDashboardStore();
  const state = useSyncExternalStore(store.subscribe, () => store.getSnapshot().activity);

  useEffect(() => {
    if (!state.initialized && !state.loading) {
      store.loadActivity();
    }
  }, [state.initialized, state.loading, store]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    reload: () => store.reload('activity'),
  };
}
