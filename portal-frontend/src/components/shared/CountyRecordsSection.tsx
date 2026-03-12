import { useState, useEffect, useRef, useCallback } from 'react';
import { searchCountyRecords, retrieveCountyRecord } from '../../api/county-records';
import { fetchDocumentStatus } from '../../api/occ';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { formatDate } from '../../lib/helpers';
import { MODAL_TYPES, BORDER, SLATE } from '../../lib/constants';
import type { CountyRecord } from '../../api/county-records';

// ── Instrument type categories (ported from vanilla) ──

function normalizeType(type: string): string {
  return (type || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

const CR_LEASES_ACTIVITY = [
  'Oil & Gas Lease',
  'Memorandum Of Oil & Gas',
  'Memorandum of Lease',
  'Ratification',
  'Amendment O & G',
  'Assignment',
  'Partial Assignment',
  'Pooling',
  'Pooling Order',
  'Spacing',
].map(normalizeType);

const CR_TITLE_DOCS = [
  'Mineral Deed',
  'Mineral & Royalty Deed',
  'Quit Claim Deed/ Mineral Interest',
  'Trustee Mineral Deed',
  'Warranty Deed',
  'Quit Claim Deed',
  'Deed & Conveyance',
  'Convey',
  'Affidavit of Heirship',
].map(normalizeType);

const CR_BLACKLIST = [
  'SURFACE GRANT',
  'Final Decree',
  'Journal Entry',
  'CERTIFICATE',
  'CORR/WD',
  'Notice',
  'REPORT',
  'Subordination Agreement',
].map(normalizeType);

type FilterMode = 'all' | 'both' | 'leases' | 'title';

function isBlacklisted(type: string): boolean {
  return CR_BLACKLIST.includes(normalizeType(type));
}

function isRelevant(type: string): boolean {
  if (isBlacklisted(type)) return false;
  const n = normalizeType(type);
  return CR_LEASES_ACTIVITY.includes(n) || CR_TITLE_DOCS.includes(n);
}

function isVisible(type: string, mode: FilterMode): boolean {
  if (!type || isBlacklisted(type)) return false;
  if (mode === 'all') return true;
  const n = normalizeType(type);
  if (mode === 'leases') return CR_LEASES_ACTIVITY.includes(n);
  if (mode === 'title') return CR_TITLE_DOCS.includes(n);
  return CR_LEASES_ACTIVITY.includes(n) || CR_TITLE_DOCS.includes(n);
}

function getTypeBadge(type: string): { bg: string; color: string } {
  const t = (type || '').toLowerCase();
  if (t.includes('deed') || t.includes('conveyance') || t.includes('heirship'))
    return { bg: '#dbeafe', color: '#1e40af' };
  if (t.includes('mortgage') || t.includes('lien'))
    return { bg: '#fef3c7', color: '#92400e' };
  if (t.includes('lease') || t.includes('assignment') || t.includes('pooling') || t.includes('ratification'))
    return { bg: '#d1fae5', color: '#065f46' };
  if (t.includes('order') || t.includes('judgment') || t.includes('spacing'))
    return { bg: '#ede9fe', color: '#5b21b6' };
  return { bg: '#e5e7eb', color: '#374151' };
}

// ── Unsupported counties ──

const UNSUPPORTED_COUNTIES = [
  'caddo','canadian','cleveland','creek','garfield','hughes',
  'oklahoma','payne','rogers','tulsa','wagoner','woods',
];

export function isCountySupported(county: string): boolean {
  return !UNSUPPORTED_COUNTIES.includes(county.toLowerCase().replace(/ county$/i, '').trim());
}

// ── Processing state ──

type RecordState = 'idle' | 'fetching' | 'processing' | 'complete' | 'error';

interface ProcessingEntry {
  state: RecordState;
  documentId?: string;
  error?: string;
}

// ── Component ──

const CR_MAX_PAGES = 30;
const POLL_INTERVAL = 5000;
const MAX_POLL_MS = 300_000; // 5 min

interface Props {
  section: string;
  township: string;
  range: string;
  county: string;
  onCountChange?: (count: number | null) => void;
  initialFilterMode?: FilterMode;
  onDocumentRetrieved?: () => void;
}

export function CountyRecordsSection({ section, township, range, county, onCountChange, initialFilterMode, onDocumentRetrieved }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const mountedRef = useRef(true);
  const pollingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [allResults, setAllResults] = useState<CountyRecord[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>(initialFilterMode || 'both');
  const [typeFilter, setTypeFilter] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [activePartySearch, setActivePartySearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingMap, setProcessingMap] = useState<Map<string, ProcessingEntry>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollingTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Initial load — fetches page 1, then auto-loads remaining pages up to CR_MAX_PAGES
  useEffect(() => {
    if (!section || !township || !range || !county) return;
    setLoading(true);
    setError(null);
    setAllResults([]);
    setCurrentPage(0);

    let cancelled = false;
    const params: Parameters<typeof searchCountyRecords>[0] = { county, section, township, range, page: 1 };
    if (activePartySearch) params.party_name = activePartySearch;

    (async () => {
      try {
        const res = await searchCountyRecords(params);
        if (cancelled || !mountedRef.current) return;
        let accumulated = res.results;
        let page = res.page;
        const pages = res.total_pages;
        setAllResults(accumulated);
        setCurrentPage(page);
        setTotalPages(pages);
        setTotalResults(res.total_results);
        setLoading(false);

        // Auto-load remaining pages
        while (page < pages && page < CR_MAX_PAGES) {
          if (cancelled || !mountedRef.current) return;
          setLoadingMore(true);
          const nextParams = { ...params, page: page + 1 };
          const nextRes = await searchCountyRecords(nextParams);
          if (cancelled || !mountedRef.current) return;
          accumulated = [...accumulated, ...nextRes.results];
          page = nextRes.page;
          setAllResults(accumulated);
          setCurrentPage(page);
        }
        if (mountedRef.current) setLoadingMore(false);
      } catch (err: any) {
        if (cancelled || !mountedRef.current) return;
        setError(err.message || 'Search failed');
        setLoading(false);
        setLoadingMore(false);
      }
    })();

    return () => { cancelled = true; };
  }, [county, section, township, range, activePartySearch]);

  // Report count to parent
  useEffect(() => {
    if (loading) {
      onCountChange?.(null);
    } else {
      const visible = allResults.filter((r) => isRelevant(r.instrument_type));
      onCountChange?.(visible.length);
    }
  }, [allResults, loading, onCountChange]);

  // Load more pages
  const loadMore = useCallback(async () => {
    if (loadingMore || currentPage >= totalPages || currentPage >= CR_MAX_PAGES) return;
    setLoadingMore(true);
    try {
      const params: Parameters<typeof searchCountyRecords>[0] = { county, section, township, range, page: currentPage + 1 };
      if (activePartySearch) params.party_name = activePartySearch;
      const res = await searchCountyRecords(params);
      if (!mountedRef.current) return;
      setAllResults((prev) => [...prev, ...res.results]);
      setCurrentPage(res.page);
      setTotalPages(res.total_pages);
    } catch {
      if (mountedRef.current) toast.error('Failed to load more results');
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [loadingMore, currentPage, totalPages, county, section, township, range, activePartySearch, toast]);

  // Polling for document processing
  const startPolling = useCallback((instNum: string, docId: string) => {
    const startTime = Date.now();
    const poll = async () => {
      if (!mountedRef.current) return;
      if (Date.now() - startTime > MAX_POLL_MS) {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(instNum, { state: 'error', documentId: docId, error: 'Timeout' });
          return m;
        });
        return;
      }
      try {
        const doc = await fetchDocumentStatus(docId);
        if (!mountedRef.current) return;
        if (doc.status === 'complete' || doc.status === 'processed') {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(instNum, { state: 'complete', documentId: docId });
            return m;
          });
          // Update the record in allResults
          setAllResults((prev) =>
            prev.map((r) =>
              r.number === instNum ? { ...r, in_library: true, document_id: docId, doc_status: 'complete' } : r,
            ),
          );
          toast.success('Document analyzed');
          onDocumentRetrieved?.();
          return;
        }
        if (doc.status === 'failed' || doc.status === 'error') {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(instNum, { state: 'error', documentId: docId, error: doc.extraction_error });
            return m;
          });
          toast.error('Extraction failed');
          return;
        }
        const t = setTimeout(poll, POLL_INTERVAL);
        pollingTimers.current.set(instNum, t);
      } catch {
        if (mountedRef.current) {
          const t = setTimeout(poll, POLL_INTERVAL);
          pollingTimers.current.set(instNum, t);
        }
      }
    };
    const t = setTimeout(poll, POLL_INTERVAL);
    pollingTimers.current.set(instNum, t);
  }, [toast]);

  // Start polling for records that came back as processing from the search
  useEffect(() => {
    for (const r of allResults) {
      if (r.in_library && r.document_id && r.doc_status && r.doc_status !== 'complete' && r.doc_status !== 'processed') {
        const existing = processingMap.get(r.number);
        if (!existing || existing.state === 'idle') {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(r.number, { state: 'processing', documentId: r.document_id });
            return m;
          });
          startPolling(r.number, r.document_id!);
        }
      }
    }
  }, [allResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retrieve handler
  const handleRetrieve = useCallback(async (record: CountyRecord) => {
    const ok = await confirm(
      `Retrieve and analyze this ${record.page_count}-page ${record.instrument_type || 'document'}? This costs 5 credits.`,
      { title: 'Retrieve County Record', confirmText: 'Retrieve (5 credits)', icon: 'info' },
    );
    if (!ok) return;

    setProcessingMap((prev) => {
      const m = new Map(prev);
      m.set(record.number, { state: 'fetching' });
      return m;
    });

    try {
      const result = await retrieveCountyRecord({
        county: record.county,
        instrument_number: record.number,
        images: record.images,
        instrument_type: record.instrument_type,
      });

      if (!mountedRef.current) return;

      if (result.status === 'processing') {
        toast.info('Document is being processed...');
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(record.number, { state: 'processing' });
          return m;
        });
        return;
      }

      if (!result.success) {
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(record.number, { state: 'error', error: result.error });
          return m;
        });
        toast.error(result.error || 'Retrieval failed');
        return;
      }

      const docId = result.document_id!;
      if (result.credits_charged) {
        toast.success(`Retrieved — ${result.credits_charged} credits used`);
      }

      // Update the record
      setAllResults((prev) =>
        prev.map((r) =>
          r.number === record.number ? { ...r, in_library: true, document_id: docId, retrieve_credits: 0 } : r,
        ),
      );

      // Check if complete or needs polling
      try {
        const doc = await fetchDocumentStatus(docId);
        if (!mountedRef.current) return;
        if (doc.status === 'complete' || doc.status === 'processed') {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(record.number, { state: 'complete', documentId: docId });
            return m;
          });
          setAllResults((prev) =>
            prev.map((r) =>
              r.number === record.number ? { ...r, doc_status: 'complete' } : r,
            ),
          );
          onDocumentRetrieved?.();
        } else {
          setProcessingMap((prev) => {
            const m = new Map(prev);
            m.set(record.number, { state: 'processing', documentId: docId });
            return m;
          });
          startPolling(record.number, docId);
        }
      } catch {
        // If status check fails, start polling anyway
        setProcessingMap((prev) => {
          const m = new Map(prev);
          m.set(record.number, { state: 'processing', documentId: docId });
          return m;
        });
        startPolling(record.number, docId);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Retrieval failed';
      setProcessingMap((prev) => {
        const m = new Map(prev);
        m.set(record.number, { state: 'error', error: msg });
        return m;
      });
      toast.error(msg);
    }
  }, [confirm, toast, startPolling]);

  // View analyzed document
  const handleViewDoc = useCallback((docId: string) => {
    modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId });
  }, [modal]);

  // ── Filtered results ──

  const visibleResults = allResults.filter((r) => {
    if (!isVisible(r.instrument_type, filterMode)) return false;
    if (typeFilter && normalizeType(r.instrument_type) !== normalizeType(typeFilter)) return false;
    return true;
  });

  // Unique instrument types for dropdown (from relevant results)
  const uniqueTypes = Array.from(new Set(
    allResults.filter((r) => isVisible(r.instrument_type, filterMode)).map((r) => r.instrument_type),
  )).sort();

  // ── Render ──

  if (loading) {
    return (
      <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
        <Spinner size={14} /> Searching county records...
      </div>
    );
  }

  if (error) {
    return <div style={{ color: '#dc2626', fontSize: 12, padding: 8 }}>Failed to load county records: {error}</div>;
  }

  if (allResults.length === 0) {
    return <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No county records found for this section</div>;
  }

  return (
    <div>
      {/* Party name search */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Search by party name (e.g. Price)"
          value={partySearch}
          onChange={(e) => setPartySearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setActivePartySearch(partySearch.trim()); }}
          style={{
            flex: 1, padding: '5px 8px', fontSize: 12, border: `1px solid ${BORDER}`,
            borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={() => setActivePartySearch(partySearch.trim())}
          style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${BORDER}`, borderRadius: 4, background: '#334E68', color: '#fff',
          }}
        >
          Search
        </button>
        {activePartySearch && (
          <button
            onClick={() => { setPartySearch(''); setActivePartySearch(''); }}
            style={{
              padding: '5px 8px', fontSize: 11, cursor: 'pointer',
              border: `1px solid ${BORDER}`, borderRadius: 4, background: '#fff', color: '#334E68',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
          {([['all', 'All'], ['both', 'Both'], ['leases', 'Leases'], ['title', 'Title']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setFilterMode(key); setTypeFilter(''); }}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: 'none', background: filterMode === key ? '#334E68' : '#fff',
                color: filterMode === key ? '#fff' : '#334E68',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Type filter dropdown */}
        {uniqueTypes.length > 1 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: '4px 8px', fontSize: 11, border: `1px solid ${BORDER}`, borderRadius: 4, background: '#fff' }}
          >
            <option value="">All Types ({uniqueTypes.length})</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Count */}
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>
          {visibleResults.length} of {totalResults} records
          {activePartySearch && <> for &ldquo;{activePartySearch}&rdquo;</>}
        </span>
      </div>

      {/* Results list */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {visibleResults.map((record) => {
          const proc = processingMap.get(record.number);
          const state = proc?.state || 'idle';
          const badge = getTypeBadge(record.instrument_type);
          const isAnalyzed = record.in_library && record.document_id &&
            (record.doc_status === 'complete' || record.doc_status === 'processed' || state === 'complete');
          const docId = proc?.documentId || record.document_id;

          return (
            <div key={`${record.county}-${record.number}`} style={{
              padding: '8px 0', borderBottom: `1px solid ${BORDER}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge bg={badge.bg} color={badge.color} size="sm">
                      {record.instrument_type || 'Unknown'}
                    </Badge>
                    <span style={{ fontSize: 11, color: SLATE }}>
                      {formatDate(record.instrument_date) || formatDate(record.indexed_date) || '—'}
                    </span>
                    {record.page_count > 0 && (
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>{record.page_count}p</span>
                    )}
                  </div>
                  {(record.grantors.length > 0 || record.grantees.length > 0) && (
                    <div style={{ fontSize: 11, color: '#374151', marginTop: 3, lineHeight: 1.4 }}>
                      {record.grantors.length > 0 && (
                        <span>{record.grantors.slice(0, 2).join(', ')}{record.grantors.length > 2 ? ` +${record.grantors.length - 2}` : ''}</span>
                      )}
                      {record.grantors.length > 0 && record.grantees.length > 0 && (
                        <span style={{ color: SLATE }}> → </span>
                      )}
                      {record.grantees.length > 0 && (
                        <span>{record.grantees.slice(0, 2).join(', ')}{record.grantees.length > 2 ? ` +${record.grantees.length - 2}` : ''}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Action button — color matches vanilla well module progression */}
                <div style={{ flexShrink: 0, marginLeft: 8 }}>
                  {isAnalyzed && docId ? (
                    <button
                      onClick={() => handleViewDoc(docId)}
                      style={{
                        background: '#10b981', border: 'none', borderRadius: 4,
                        padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                      }}
                    >
                      Analyzed
                    </button>
                  ) : state === 'error' ? (
                    <button
                      onClick={() => handleRetrieve(record)}
                      style={{
                        background: '#ef4444', border: 'none', borderRadius: 4,
                        padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                      }}
                    >
                      Retry
                    </button>
                  ) : state === 'fetching' ? (
                    <button disabled style={{
                      background: '#8b5cf6', border: 'none', borderRadius: 4,
                      padding: '3px 10px', fontSize: 11, color: '#fff', fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <Spinner size={10} />
                      Retrieving...
                    </button>
                  ) : state === 'processing' ? (
                    <button disabled style={{
                      background: '#6366f1', border: 'none', borderRadius: 4,
                      padding: '3px 10px', fontSize: 11, color: '#fff', fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <Spinner size={10} />
                      Processing...
                    </button>
                  ) : record.page_count > 50 ? (
                    <button disabled style={{
                      background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 4,
                      padding: '3px 10px', fontSize: 11, color: '#9ca3af',
                    }}>
                      {record.page_count}p — too large
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRetrieve(record)}
                      style={{
                        background: '#3b82f6', border: 'none', borderRadius: 4,
                        padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#fff', fontWeight: 600,
                      }}
                      title="5 credits"
                    >
                      Retrieve
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Load more — shows progress during auto-load, manual button if auto-load stopped */}
      {currentPage < totalPages && currentPage < CR_MAX_PAGES && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          {loadingMore ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#627D98' }}>
              <Spinner size={12} />
              Loading page {currentPage + 1} of {Math.min(totalPages, CR_MAX_PAGES)}...
            </div>
          ) : (
            <button
              onClick={loadMore}
              style={{
                background: 'none', border: `1px solid ${BORDER}`, borderRadius: 4,
                padding: '6px 16px', fontSize: 12, cursor: 'pointer',
                color: '#334E68', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              Load More (page {currentPage + 1} of {totalPages})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
