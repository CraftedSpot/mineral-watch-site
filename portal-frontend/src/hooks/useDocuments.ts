import { useEffect, useSyncExternalStore } from 'react';
import { useDashboardStore } from '../contexts/DashboardDataContext';
import type { DocumentRecord } from '../types/dashboard';

/** Lazy-loaded: triggers fetch on first use */
export function useDocuments(): {
  data: DocumentRecord[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const store = useDashboardStore();
  const state = useSyncExternalStore(store.subscribe, () => store.getSnapshot().documents);

  useEffect(() => {
    if (!state.initialized && !state.loading) {
      store.loadDocuments();
    }
  }, [state.initialized, state.loading, store]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    reload: () => store.reload('documents'),
  };
}
