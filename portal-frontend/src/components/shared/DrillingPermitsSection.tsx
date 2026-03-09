import { useState, useRef, useCallback, useEffect } from 'react';
import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchDrillingPermits } from '../../api/wells';
import { analyzePermit, fetchDocumentStatus } from '../../api/occ';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { SkeletonRows } from '../ui/SkeletonRows';
import { formatDate } from '../../lib/helpers';
import { MODAL_TYPES, BORDER, DARK, SLATE } from '../../lib/constants';
import type { DrillingPermit } from '../../types/well-detail';

type EntryState = 'idle' | 'fetching' | 'processing' | 'complete' | 'error';

interface Props {
  apiNumber: string;
  onCountChange?: (count: number) => void;
}

export function DrillingPermitsSection({ apiNumber, onCountChange }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { data, loading, error } = useAsyncData(
    () => fetchDrillingPermits(apiNumber),
    [apiNumber],
  );
  const [stateMap, setStateMap] = useState<Map<string, { state: EntryState; docId?: string }>>(new Map());
  const pollingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollingTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (data && onCountChange) onCountChange(data.length);
  }, [data, onCountChange]);

  useEffect(() => {
    if (!data) return;
    const newMap = new Map(stateMap);
    for (const p of data) {
      if (p.documentId && !newMap.has(p.entryId)) {
        newMap.set(p.entryId, { state: 'complete', docId: p.documentId });
      }
    }
    setStateMap(newMap);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = useCallback((entryId: string, docId: string) => {
    const startTime = Date.now();
    const poll = async () => {
      if (!mountedRef.current) return;
      if (Date.now() - startTime > 300000) {
        setStateMap((prev) => new Map(prev).set(entryId, { state: 'error' }));
        return;
      }
      try {
        const doc = await fetchDocumentStatus(docId);
        if (!mountedRef.current) return;
        if (doc.status === 'complete' || doc.status === 'failed') {
          setStateMap((prev) => new Map(prev).set(entryId, {
            state: doc.status === 'complete' ? 'complete' : 'error', docId,
          }));
          return;
        }
        pollingTimers.current.set(entryId, setTimeout(poll, 5000));
      } catch {
        if (mountedRef.current) pollingTimers.current.set(entryId, setTimeout(poll, 5000));
      }
    };
    pollingTimers.current.set(entryId, setTimeout(poll, 5000));
  }, []);

  const handleAnalyze = useCallback(async (permit: DrillingPermit, force = false) => {
    setStateMap((prev) => new Map(prev).set(permit.entryId, { state: 'fetching' }));
    try {
      const result = await analyzePermit(apiNumber, permit.entryId, force);
      if (!mountedRef.current) return;
      const docId = result.documentId || result.document?.id;
      if (result.alreadyProcessed || result.document?.status === 'complete') {
        setStateMap((prev) => new Map(prev).set(permit.entryId, { state: 'complete', docId }));
      } else if (result.document) {
        setStateMap((prev) => new Map(prev).set(permit.entryId, { state: 'processing', docId: result.document!.id }));
        startPolling(permit.entryId, result.document.id);
      } else {
        setStateMap((prev) => new Map(prev).set(permit.entryId, { state: 'error' }));
        toast.error(result.error || 'Failed to analyze');
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setStateMap((prev) => new Map(prev).set(permit.entryId, { state: 'error' }));
      toast.error(err instanceof Error ? err.message : 'Failed to analyze');
    }
  }, [apiNumber, startPolling, toast]);

  if (loading) return (
    <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 13, color: '#6b7280', animation: 'pulse 1.5s ease-in-out infinite' }}>
      Searching OCC drilling permits...
    </div>
  );
  if (error) return <div style={{ color: '#dc2626', fontSize: 12, padding: 8 }}>Failed to load</div>;
  if (!data || data.length === 0) return <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No drilling permits found</div>;

  return (
    <div>
      {data.map((permit, i) => {
        const isLatest = i === 0;
        const entry = stateMap.get(permit.entryId);
        const state = entry?.state || 'idle';

        return (
          <div key={permit.entryId} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Badge bg="#dbeafe" color="#1e40af">PERMIT 1000</Badge>
                {isLatest && <Badge bg="#dcfce7" color="#166534">Latest</Badge>}
                {permit.location && <span style={{ fontSize: 11, color: SLATE }}>{permit.location}</span>}
              </div>
              <div style={{ fontSize: 12, color: SLATE, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {permit.county && <span>{permit.county}</span>}
                {permit.wellName && <span>&#183; {permit.wellName}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 12 }}>
              <div style={{ fontSize: 11, color: SLATE }}>{formatDate(permit.effectiveDate)}</div>
              {state === 'complete' && entry?.docId ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleAnalyze(permit, true)} style={{
                    background: 'none', border: `1px solid ${BORDER}`, borderRadius: 4,
                    padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: SLATE,
                  }}>Re-analyze</button>
                  <button onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: entry.docId })} style={{
                    background: '#16a34a', border: 'none', borderRadius: 4,
                    padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                  }}>View Doc &#8599;</button>
                </div>
              ) : state !== 'idle' ? (
                <button disabled style={{
                  background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 4,
                  padding: '3px 8px', fontSize: 11, color: SLATE, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Spinner size={10} /> {state === 'fetching' ? 'Fetching...' : 'Processing...'}
                </button>
              ) : (
                <button onClick={() => handleAnalyze(permit)} style={{
                  background: '#3b82f6', border: 'none', borderRadius: 4,
                  padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                }}>Analyze</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
