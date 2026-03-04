import { useState, useRef, useCallback, useEffect } from 'react';
import { useAsyncData } from '../../hooks/useAsyncData';
import { fetchDocketEntries } from '../../api/occ';
import { fetchDocketEntriesByWell } from '../../api/wells';
import { processOccFiling, fetchDocumentStatus, checkAnalyzedFilings } from '../../api/occ';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { StatusBadge } from '../ui/StatusBadge';
import { Spinner } from '../ui/Spinner';
import { SkeletonRows } from '../ui/SkeletonRows';
import { formatDate } from '../../lib/helpers';
import { MODAL_TYPES, FILING_STATUS_COLORS, BORDER, DARK, SLATE } from '../../lib/constants';
import type { DocketEntry } from '../../types/well-detail';

type FilingState = 'idle' | 'fetching' | 'queued' | 'processing' | 'complete' | 'error';

interface ProcessingEntry {
  state: FilingState;
  documentId?: string;
  displayName?: string;
  error?: string;
}

interface Props {
  apiNumber?: string;
  section?: string;
  township?: string;
  range?: string;
  onCountChange?: (count: number) => void;
}

function FilingRow({ filing, isAdjacent, processing, onAnalyze, onViewDoc }: {
  filing: DocketEntry;
  isAdjacent?: boolean;
  processing?: ProcessingEntry;
  onAnalyze: (filing: DocketEntry, force?: boolean) => void;
  onViewDoc: (docId: string) => void;
}) {
  const state = processing?.state || 'idle';
  const statusKey = filing.status?.toLowerCase() || '';
  const statusStyle = FILING_STATUS_COLORS[statusKey] || FILING_STATUS_COLORS.filed;

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: DARK }}>
          {filing.reliefTypeDisplay}
          {isAdjacent && (
            <span style={{ fontSize: 10, color: SLATE, marginLeft: 8, fontWeight: 400 }}>
              S{filing.section}-T{filing.township}-R{filing.range}
            </span>
          )}
        </div>
        {filing.applicant && (
          <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>{filing.applicant}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: DARK, fontWeight: 500 }}>{filing.caseNumber}</span>
          <StatusBadge label={filing.statusDisplay || filing.status} color={statusStyle.color} background={statusStyle.bg} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 12 }}>
        <div style={{ fontSize: 11, color: SLATE }}>{formatDate(filing.hearingDate || filing.docketDate)}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {state === 'complete' && processing?.documentId ? (
            <>
              <button
                onClick={() => onAnalyze(filing, true)}
                style={{
                  background: 'none', border: `1px solid ${BORDER}`, borderRadius: 4,
                  padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: SLATE,
                }}
              >
                Re-analyze
              </button>
              <button
                onClick={() => onViewDoc(processing.documentId!)}
                style={{
                  background: '#16a34a', border: 'none', borderRadius: 4,
                  padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                }}
              >
                View Doc &#8599;
              </button>
            </>
          ) : state === 'error' ? (
            <button
              onClick={() => onAnalyze(filing)}
              style={{
                background: '#dc2626', border: 'none', borderRadius: 4,
                padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#fff',
              }}
            >
              Retry
            </button>
          ) : state !== 'idle' ? (
            <button disabled style={{
              background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 4,
              padding: '3px 8px', fontSize: 11, color: SLATE, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Spinner size={10} /> {state === 'fetching' ? 'Fetching...' : state === 'queued' ? 'Queued...' : 'Processing...'}
            </button>
          ) : (
            <button
              onClick={() => onAnalyze(filing)}
              style={{
                background: '#3b82f6', border: 'none', borderRadius: 4,
                padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
              }}
            >
              Analyze
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function OCCFilingsSection({ apiNumber, section, township, range, onCountChange }: Props) {
  const modal = useModal();
  const toast = useToast();
  const [processingMap, setProcessingMap] = useState<Map<string, ProcessingEntry>>(new Map());
  const pollingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollingTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const fetcher = useCallback(() => {
    if (apiNumber) {
      return fetchDocketEntriesByWell(apiNumber).then((res) => ({
        direct: res.direct || [],
        adjacent: [] as DocketEntry[],
      }));
    }
    if (section && township && range) {
      return fetchDocketEntries({ section, township, range, includeAdjacent: true });
    }
    return Promise.resolve({ direct: [] as DocketEntry[], adjacent: [] as DocketEntry[] });
  }, [apiNumber, section, township, range]);

  const { data, loading, error } = useAsyncData(fetcher, [apiNumber, section, township, range]);

  // Check already-analyzed filings on data load
  useEffect(() => {
    if (!data) return;
    const allFilings = [...data.direct, ...data.adjacent];
    const cases = allFilings.filter((f) => f.caseNumber).map((f) => f.caseNumber);
    if (cases.length === 0) return;
    checkAnalyzedFilings(cases).then((cache) => {
      if (!mountedRef.current) return;
      const newMap = new Map(processingMap);
      for (const [caseNum, info] of Object.entries(cache)) {
        const key = allFilings.find((f) => f.caseNumber === caseNum)?.orderNumber || caseNum;
        newMap.set(key, { state: 'complete', documentId: info.documentId, displayName: info.displayName });
      }
      setProcessingMap(newMap);
    }).catch(() => { /* silent */ });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (data && onCountChange) {
      onCountChange(data.direct.length + data.adjacent.length);
    }
  }, [data, onCountChange]);

  const startPolling = useCallback((key: string, docId: string) => {
    const startTime = Date.now();
    const poll = async () => {
      if (!mountedRef.current) return;
      if (Date.now() - startTime > 300000) {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(key, { ...m.get(key)!, state: 'error', error: 'Timeout' });
          return m;
        });
        return;
      }
      try {
        const doc = await fetchDocumentStatus(docId);
        if (!mountedRef.current) return;
        if (doc.status === 'complete' || doc.status === 'failed') {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(key, {
              state: doc.status === 'complete' ? 'complete' : 'error',
              documentId: docId,
              displayName: doc.display_name,
              error: doc.extraction_error,
            });
            return m;
          });
          return;
        }
        const t = setTimeout(poll, 5000);
        pollingTimers.current.set(key, t);
      } catch {
        if (mountedRef.current) {
          const t = setTimeout(poll, 5000);
          pollingTimers.current.set(key, t);
        }
      }
    };
    const t = setTimeout(poll, 5000);
    pollingTimers.current.set(key, t);
  }, []);

  const handleAnalyze = useCallback(async (filing: DocketEntry, force = false) => {
    const key = filing.orderNumber || filing.caseNumber;
    setProcessingMap((prev) => {
      const m = new Map(prev);
      m.set(key, { state: 'fetching' });
      return m;
    });
    try {
      const result = await processOccFiling(filing.caseNumber, filing.orderNumber, force);
      if (!mountedRef.current) return;
      if (result.alreadyProcessed || result.document?.status === 'complete') {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(key, { state: 'complete', documentId: result.document!.id, displayName: result.document!.display_name });
          return m;
        });
      } else if (result.document) {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(key, { state: 'processing', documentId: result.document!.id });
          return m;
        });
        startPolling(key, result.document.id);
      } else {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(key, { state: 'error', error: result.error || 'Unknown error' });
          return m;
        });
        toast.error(result.error || 'Failed to process filing');
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to process filing';
      setProcessingMap((prev) => {
        const m = new Map(prev);
        m.set(key, { state: 'error', error: msg });
        return m;
      });
      toast.error(msg);
    }
  }, [startPolling, toast]);

  const handleViewDoc = useCallback((docId: string) => {
    modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId });
  }, [modal]);

  if (loading) return <SkeletonRows count={3} />;
  if (error) return <div style={{ color: '#dc2626', fontSize: 12, padding: 8 }}>Failed to load filings</div>;
  if (!data || (data.direct.length === 0 && data.adjacent.length === 0)) {
    return <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No filings found</div>;
  }

  return (
    <div>
      {data.direct.map((f) => (
        <FilingRow
          key={f.orderNumber || f.caseNumber}
          filing={f}
          processing={processingMap.get(f.orderNumber || f.caseNumber)}
          onAnalyze={handleAnalyze}
          onViewDoc={handleViewDoc}
        />
      ))}
      {data.adjacent.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `2px dashed ${BORDER}` }}>
          <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 8 }}>
            Adjacent Activity ({data.adjacent.length})
          </div>
          {data.adjacent.map((f) => (
            <FilingRow
              key={f.orderNumber || f.caseNumber}
              filing={f}
              isAdjacent
              processing={processingMap.get(f.orderNumber || f.caseNumber)}
              onAnalyze={handleAnalyze}
              onViewDoc={handleViewDoc}
            />
          ))}
        </div>
      )}
    </div>
  );
}
