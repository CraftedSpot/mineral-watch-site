import { createContext, useContext, useRef } from 'react';
import { apiFetch } from '../api/client';
import type {
  PropertyRecord,
  WellRecord,
  DocumentRecord,
  ActivityRecord,
  DashboardCounts,
} from '../types/dashboard';

// --- Data Slice ---
export interface DataSlice<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  lastFetched: number | null;
}

function emptySlice<T>(): DataSlice<T> {
  return { data: [], loading: false, error: null, initialized: false, lastFetched: null };
}

// --- Store Shape ---
interface DashboardStoreState {
  properties: DataSlice<PropertyRecord>;
  wells: DataSlice<WellRecord>;
  documents: DataSlice<DocumentRecord>;
  activity: DataSlice<ActivityRecord>;
  counts: { data: DashboardCounts | null; loading: boolean; error: string | null };
}

// --- External Store ---
export class DashboardDataStore {
  private _state: DashboardStoreState;
  private _listeners = new Set<() => void>();

  constructor() {
    this._state = {
      properties: emptySlice(),
      wells: emptySlice(),
      documents: emptySlice(),
      activity: emptySlice(),
      counts: { data: null, loading: false, error: null },
    };
  }

  getSnapshot = (): DashboardStoreState => this._state;

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  private emit() {
    this._state = { ...this._state };
    this._listeners.forEach((l) => l());
  }

  private updateSlice<K extends 'properties' | 'wells' | 'documents' | 'activity'>(
    key: K,
    partial: Partial<DashboardStoreState[K]>,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._state as any)[key] = { ...this._state[key], ...partial };
    this.emit();
  }

  // --- Loaders ---

  async loadProperties() {
    if (this._state.properties.loading) return;
    this.updateSlice('properties', { loading: true, error: null });
    try {
      const res = await apiFetch<{ records: PropertyRecord[] }>('/api/properties/v2');
      this.updateSlice('properties', {
        data: res.records || [],
        loading: false,
        initialized: true,
        lastFetched: Date.now(),
      });
    } catch (err: unknown) {
      this.updateSlice('properties', {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load properties',
      });
    }
  }

  async loadWells() {
    if (this._state.wells.loading) return;
    this.updateSlice('wells', { loading: true, error: null });
    try {
      const res = await apiFetch<{ wells: WellRecord[] }>('/api/wells/v2');
      this.updateSlice('wells', {
        data: res.wells || [],
        loading: false,
        initialized: true,
        lastFetched: Date.now(),
      });
    } catch (err: unknown) {
      this.updateSlice('wells', {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load wells',
      });
    }
  }

  async loadDocuments() {
    if (this._state.documents.loading) return;
    this.updateSlice('documents', { loading: true, error: null });
    try {
      const res = await apiFetch<{ documents: DocumentRecord[] }>('/api/documents');
      this.updateSlice('documents', {
        data: res.documents || [],
        loading: false,
        initialized: true,
        lastFetched: Date.now(),
      });
    } catch (err: unknown) {
      this.updateSlice('documents', {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load documents',
      });
    }
  }

  async loadActivity() {
    if (this._state.activity.loading) return;
    this.updateSlice('activity', { loading: true, error: null });
    try {
      const res = await apiFetch<{ activities: ActivityRecord[] }>('/api/activity');
      this.updateSlice('activity', {
        data: res.activities || [],
        loading: false,
        initialized: true,
        lastFetched: Date.now(),
      });
    } catch (err: unknown) {
      this.updateSlice('activity', {
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load activity',
      });
    }
  }

  async loadCounts() {
    if (this._state.counts.loading) return;
    this._state = { ...this._state, counts: { ...this._state.counts, loading: true, error: null } };
    this.emit();
    try {
      const res = await apiFetch<DashboardCounts>('/api/dashboard/counts');
      this._state = { ...this._state, counts: { data: res, loading: false, error: null } };
      this.emit();
    } catch (err: unknown) {
      this._state = {
        ...this._state,
        counts: {
          data: this._state.counts.data,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load counts',
        },
      };
      this.emit();
    }
  }

  async reload(key: 'properties' | 'wells' | 'documents' | 'activity' | 'counts') {
    if (key === 'counts') return this.loadCounts();
    // Reset initialized flag so it re-fetches
    this.updateSlice(key, { initialized: false });
    switch (key) {
      case 'properties': return this.loadProperties();
      case 'wells': return this.loadWells();
      case 'documents': return this.loadDocuments();
      case 'activity': return this.loadActivity();
    }
  }
}

// --- Context ---
const DashboardDataContext = createContext<DashboardDataStore | null>(null);

export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<DashboardDataStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new DashboardDataStore();
  }
  return (
    <DashboardDataContext.Provider value={storeRef.current}>
      {children}
    </DashboardDataContext.Provider>
  );
}

export function useDashboardStore(): DashboardDataStore {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) throw new Error('useDashboardStore must be used within DashboardDataProvider');
  return ctx;
}
