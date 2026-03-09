import { useState, useRef, useCallback, useEffect } from 'react';
import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchCompletionReports } from '../../api/wells';
import { analyzeCompletionReport, fetchDocumentStatus } from '../../api/occ';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { SkeletonRows } from '../ui/SkeletonRows';
import { formatDate } from '../../lib/helpers';
import { MODAL_TYPES, BORDER, DARK, SLATE } from '../../lib/constants';
import type { CompletionReport } from '../../types/well-detail';

type EntryState = 'idle' | 'fetching' | 'processing' | 'complete' | 'error';

interface Props {
  apiNumber: string;
  onCountChange?: (count: number) => void;
}

export function CompletionReportsSection({ apiNumber, onCountChange }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { data, loading, error } = useAsyncData(
    () => fetchCompletionReports(apiNumber),
    [apiNumber],
  );
  const [stateMap, setStateMap] = useState<Map<string, { state: EntryState; docId?: string; displayName?: string }>>(new Map());
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

  // Mark already-analyzed entries
  useEffect(() => {
    if (!data) return;
    const newMap = new Map(stateMap);
    for (const r of data) {
      if (r.documentId && !newMap.has(r.entryId)) {
        newMap.set(r.entryId, { state: 'complete', docId: r.documentId });
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
            state: doc.status === 'complete' ? 'complete' : 'error',
            docId, displayName: doc.display_name,
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

  const handleAnalyze = useCallback(async (report: CompletionReport, force = false) => {
    setStateMap((prev) => new Map(prev).set(report.entryId, { state: 'fetching' }));
    try {
      const result = await analyzeCompletionReport(apiNumber, report.entryId, force);
      if (!mountedRef.current) return;
      const docId = result.documentId || result.document?.id;
      const docDisplayName = result.displayName || result.document?.displayName || result.document?.display_name;
      if (result.alreadyProcessed || result.document?.status === 'complete') {
        setStateMap((prev) => new Map(prev).set(report.entryId, {
          state: 'complete', docId, displayName: docDisplayName,
        }));
      } else if (result.document) {
        setStateMap((prev) => new Map(prev).set(report.entryId, { state: 'processing', docId: result.document!.id }));
        startPolling(report.entryId, result.document.id);
      } else {
        setStateMap((prev) => new Map(prev).set(report.entryId, { state: 'error' }));
        toast.error(result.error || 'Failed to analyze');
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setStateMap((prev) => new Map(prev).set(report.entryId, { state: 'error' }));
      toast.error(err instanceof Error ? err.message : 'Failed to analyze');
    }
  }, [apiNumber, startPolling, toast]);

  if (loading) return (
    <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 13, color: '#6b7280', animation: 'pulse 1.5s ease-in-out infinite' }}>
      Searching OCC completion records...
    </div>
  );
  if (error) return <div style={{ color: '#dc2626', fontSize: 12, padding: 8 }}>Failed to load</div>;
  if (!data || data.length === 0) return <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No completion reports found</div>;

  // Sort newest first so "Latest" badge is correct
  const sorted = [...data].sort((a, b) => {
    const da = a.effectiveDate ? new Date(a.effectiveDate).getTime() : 0;
    const db = b.effectiveDate ? new Date(b.effectiveDate).getTime() : 0;
    return db - da;
  });

  return (
    <div>
      {sorted.map((report, i) => {
        const isLatest = i === 0;
        const entry = stateMap.get(report.entryId);
        const state = entry?.state || 'idle';

        return (
          <div key={report.entryId} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Badge
                  bg={report.formType === '1002C' ? '#fef3c7' : '#dbeafe'}
                  color={report.formType === '1002C' ? '#92400e' : '#1e40af'}
                >
                  {report.formType === '1002C' ? 'RECOMPLETION 1002C' : 'COMPLETION 1002A'}
                </Badge>
                {isLatest && <Badge bg="#dcfce7" color="#166534">Latest</Badge>}
                {report.location && <span style={{ fontSize: 11, color: SLATE }}>{report.location}</span>}
              </div>
              <div style={{ fontSize: 12, color: SLATE, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {report.county && <span>{report.county}</span>}
                {report.wellName && <span>&#183; {report.wellName}</span>}
                {report.pun && <span style={{ fontFamily: 'monospace', fontSize: 11 }}>PUN: {report.pun}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 12 }}>
              <div style={{ fontSize: 11, color: SLATE }}>{formatDate(report.effectiveDate)}</div>
              {state === 'complete' && entry?.docId ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleAnalyze(report, true)} style={{
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
                <button onClick={() => handleAnalyze(report)} style={{
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
