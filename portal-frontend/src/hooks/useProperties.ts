import { useEffect, useSyncExternalStore } from 'react';
import { useDashboardStore } from '../contexts/DashboardDataContext';
import type { PropertyRecord } from '../types/dashboard';

export function useProperties(): {
  data: PropertyRecord[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const store = useDashboardStore();
  const state = useSyncExternalStore(store.subscribe, () => store.getSnapshot().properties);

  // Eagerly load on first access
  useEffect(() => {
    if (!state.initialized && !state.loading) {
      store.loadProperties();
    }
  }, [state.initialized, state.loading, store]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    reload: () => store.reload('properties'),
  };
}
