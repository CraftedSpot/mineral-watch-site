import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useDocuments } from '../../../hooks/useDocuments';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { fetchUsageStats } from '../../../api/documents';
import type { UsageResponse } from '../../../api/documents';
import { DOCUMENT_CATEGORIES, BASE_SORT_OPTIONS, CATEGORY_SORT_OPTIONS } from '../../../lib/document-categories';
import { MODAL_TYPES, BORDER, SLATE, DOC_STATUS_COLORS, TEAL } from '../../../lib/constants';
import { DataTable } from '../../ui/DataTable';
import { CreditDisplay } from '../../ui/CreditDisplay';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import type { ColumnDef } from '../../ui/DataTableTypes';
import type { DocumentRecord } from '../../../types/dashboard';

/** Map db doc_type/category → filter value (matching vanilla docTypeToFilterValue) */
const DOC_TYPE_MAP: Record<string, string> = {
  mineral_deed: 'mineral_deeds',
  royalty_deed: 'royalty_deed',
  assignment: 'assignment',
  assignment_of_lease: 'assignment',
  assignment_and_bill_of_sale: 'assignment',
  ratification: 'ratification',
  right_of_way: 'right_of_way',
  lease: 'leases',
  oil_and_gas_lease: 'leases',
  oil_gas_lease: 'leases',
  release_of_lease: 'release_of_lease',
  lease_amendment: 'lease_amendment',
  lease_extension: 'lease_extension',
  pooling_order: 'pooling_orders',
  drilling_and_spacing_order: 'drilling_and_spacing',
  horizontal_drilling_and_spacing_order: 'horizontal_drilling_and_spacing',
  location_exception_order: 'location_exception',
  increased_density_order: 'increased_density',
  change_of_operator_order: 'change_of_operator',
  multi_unit_horizontal_order: 'multi_unit_horizontal',
  unitization_order: 'unitization_orders',
  occ_order: 'other',
  division_order: 'division_orders',
  drilling_permit: 'drilling_permits',
  title_opinion: 'title_opinions',
  joa: 'joa',
  joint_operating_agreement: 'joa',
  check_stub: 'check_stubs',
  royalty_statement: 'check_stubs',
  suspense_notice: 'suspense_notices',
  tax_record: 'tax_records',
  affidavit_of_heirship: 'affidavit_of_heirship',
  heirship: 'affidavit_of_heirship',
  probate: 'probate',
  probate_document: 'probate',
  trust: 'trust',
  ownership_entity: 'trust',
  llc_docs: 'trust',
  estate: 'probate',
  legal_document: 'legal_documents',
  divorce_decree: 'divorce_decree',
  death_certificate: 'death_certificate',
  power_of_attorney: 'power_of_attorney',
  correspondence: 'correspondence',
  map: 'maps_plats',
  plat: 'maps_plats',
  multi_document: 'multi_document',
  production_report: 'production_reports',
  lease_production: 'production_reports',
  production_record: 'production_reports',
  production_summary: 'production_reports',
  well_completion_report: 'well_completion_reports',
  other: 'other',
};

/** Format snake_case doc type → readable label */
function formatDocType(docType: string | undefined): string {
  if (!docType) return 'Unknown';
  return docType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOcc\b/g, 'OCC')
    .replace(/\bJoa\b/g, 'JOA');
}

/** Get document category for filtering */
function getDocCategory(doc: DocumentRecord): string {
  const raw = (doc.doc_type || 'other').toLowerCase();
  return DOC_TYPE_MAP[raw] || 'other';
}

/** Get status display info */
function getStatusDisplay(status: string): { text: string; color: string } {
  switch (status) {
    case 'complete': return { text: 'Complete', color: DOC_STATUS_COLORS.complete || '#16a34a' };
    case 'failed': return { text: 'Failed', color: DOC_STATUS_COLORS.failed || '#dc2626' };
    case 'manual_review': return { text: 'Review', color: DOC_STATUS_COLORS.manual_review || '#f59e0b' };
    case 'processing': return { text: 'Processing', color: DOC_STATUS_COLORS.processing || '#3b82f6' };
    case 'queued': case 'pending': return { text: 'Queued', color: DOC_STATUS_COLORS.queued || '#8b5cf6' };
    case 'unprocessed': return { text: 'Skipped', color: '#9CA3AF' };
    case 'pending_prescan': return { text: 'Scanning...', color: '#3B82F6' };
    case 'prescan_complete': return { text: 'Ready', color: '#16A34A' };
    default: return { text: 'Processing', color: '#f59e0b' };
  }
}

const POLL_STATUSES = new Set(['processing', 'pending', 'pending_prescan', 'prescan_complete']);
const POLL_INTERVAL = 15_000;
const MAX_POLL_DURATION = 30 * 60 * 1000;

// --- Enhanced Extraction Toggle ---
function EnhancedToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
      padding: '4px 10px', borderRadius: 6, fontSize: 12,
      background: enabled ? 'rgba(139,92,246,0.08)' : 'transparent',
      border: `1px solid ${enabled ? 'rgba(139,92,246,0.3)' : BORDER}`,
      userSelect: 'none',
    }}>
      {/* Track */}
      <div
        onClick={(e) => { e.preventDefault(); onToggle(); }}
        style={{
          width: 32, height: 18, borderRadius: 9, position: 'relative',
          background: enabled ? '#8b5cf6' : '#cbd5e1', transition: 'background 0.2s',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 2, left: enabled ? 16 : 2,
          transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ color: enabled ? '#6d28d9' : SLATE, fontWeight: enabled ? 600 : 400 }}>
        Enhanced extraction
      </span>
      <span style={{
        fontSize: 10, color: enabled ? '#6d28d9' : SLATE, fontWeight: 500,
        padding: '1px 4px', borderRadius: 3,
        background: enabled ? 'rgba(139,92,246,0.12)' : 'rgba(100,116,139,0.1)',
      }}>
        2 credits
      </span>
    </label>
  );
}

/** Get the display name for a document (prefer AI display_name, fallback to filename) */
function getDocDisplayName(d: DocumentRecord): string {
  return d.display_name || d.filename || 'Untitled';
}

const columns: ColumnDef<DocumentRecord>[] = [
  {
    key: 'filename',
    label: 'Document',
    width: '3fr',
    searchable: true,
    sortable: true,
    getValue: (d) => `${d.display_name || ''} ${d.filename || ''}`,
    render: (d) => {
      const name = getDocDisplayName(d);
      return (
        <div style={{ overflow: 'hidden' }}>
          <strong style={{ color: '#1a2332', fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</strong>
          {d.display_name && d.filename && (
            <div style={{ fontSize: 11, color: SLATE, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
          )}
        </div>
      );
    },
  },
  {
    key: 'doc_type',
    label: 'Type',
    width: '1fr',
    searchable: true,
    getValue: (d) => d.doc_type || '',
    render: (d) => {
      const dt = d.doc_type;
      if (!dt) return <em style={{ color: '#A0AEC0' }}>&mdash;</em>;
      return <span>{formatDocType(dt)}</span>;
    },
  },
  {
    key: 'county',
    label: 'County',
    width: '1fr',
    searchable: true,
    getValue: (d) => d.county || '',
    render: (d) => d.county
      ? <span>{d.county}</span>
      : <em style={{ color: '#A0AEC0' }}>&mdash;</em>,
  },
  {
    key: 'status',
    label: 'Status',
    width: '100px',
    render: (d) => {
      const { text, color } = getStatusDisplay(d.status);
      const isPulsing = d.status === 'processing' || d.status === 'pending' || d.status === 'pending_prescan';
      return (
        <Badge bg={color + '20'} color={color} shape="pill"
          style={isPulsing ? { animation: 'pulse 1.5s ease-in-out infinite' } : undefined}>
          {text}
        </Badge>
      );
    },
  },
  {
    key: 'upload_date',
    label: 'Uploaded',
    width: '100px',
    sortable: true,
    sortKey: 'date',
    compare: (a, b) => new Date(a.upload_date).getTime() - new Date(b.upload_date).getTime(),
    render: (d) => (
      <span style={{ fontSize: 12, color: SLATE }}>
        {new Date(d.upload_date).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}
      </span>
    ),
  },
];

export function DocumentsTab() {
  const { data: documents, loading, reload } = useDocuments();
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('all');
  const [sortValue, setSortValue] = useState('date-desc');
  const [enhanced, setEnhanced] = useState(false);
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  // Polling refs
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);
  const prevStatusMapRef = useRef<Map<string, string>>(new Map());

  // Fetch credit usage stats on mount
  useEffect(() => {
    fetchUsageStats().then(setUsage).catch(() => { /* non-critical */ });
  }, []);

  // --- Document status polling ---
  const hasProcessingDocs = useMemo(
    () => documents.some((d) => POLL_STATUSES.has(d.status)),
    [documents],
  );

  // Track previous statuses to detect transitions
  useEffect(() => {
    const prev = prevStatusMapRef.current;
    for (const doc of documents) {
      const oldStatus = prev.get(doc.id);
      if (oldStatus && POLL_STATUSES.has(oldStatus) && doc.status === 'complete') {
        toast.success(`${doc.display_name || doc.filename || 'Document'} processing complete`);
        // Refresh credits after processing completes
        fetchUsageStats().then(setUsage).catch(() => {});
      }
    }
    prevStatusMapRef.current = new Map(documents.map((d) => [d.id, d.status]));
  }, [documents, toast]);

  useEffect(() => {
    // Clear any existing poll
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!hasProcessingDocs) return;

    pollStartRef.current = Date.now();

    const poll = () => {
      if (document.hidden) return; // Skip if tab not visible
      if (Date.now() - pollStartRef.current > MAX_POLL_DURATION) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        return;
      }
      reload();
    };

    pollTimerRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [hasProcessingDocs, reload]);

  // Build sort options based on category
  const sortOptions = useMemo(() => {
    const extra = CATEGORY_SORT_OPTIONS[category] || [];
    if (extra.length === 0) return BASE_SORT_OPTIONS;
    return [...BASE_SORT_OPTIONS, ...extra];
  }, [category]);

  // Reset sort if current value is no longer valid after category change
  const effectiveSortValue = useMemo(() => {
    if (sortOptions.some((o) => o.value === sortValue)) return sortValue;
    return 'date-desc';
  }, [sortOptions, sortValue]);

  // Filter by category
  const filteredByCategory = useMemo(() => {
    if (category === 'all') return documents;
    return documents.filter((d) => getDocCategory(d) === category);
  }, [documents, category]);

  // Parse sort into defaultSort
  const defaultSort = useMemo(() => {
    const dash = effectiveSortValue.lastIndexOf('-');
    if (dash > 0) {
      return { key: effectiveSortValue.substring(0, dash), direction: effectiveSortValue.substring(dash + 1) as 'asc' | 'desc' };
    }
    // Non-directional sorts (category-specific) — sort asc by default
    return { key: effectiveSortValue, direction: 'asc' as const };
  }, [effectiveSortValue]);

  const handleRowClick = useCallback((d: DocumentRecord) => {
    modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: d.id });
  }, [modal]);

  const handleCategoryChange = useCallback((val: string) => {
    setCategory(val);
    // Reset sort to default when changing category
    setSortValue('date-desc');
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (!count) return;
    const ok = await confirm(`Delete ${count} document${count === 1 ? '' : 's'}? This cannot be undone.`, { destructive: true, icon: 'trash' });
    if (!ok) return;
    try {
      const res = await fetch('/api/documents/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted ${count} document${count === 1 ? '' : 's'}`);
      setSelected(new Set());
      reload();
    } catch {
      toast.error('Failed to delete documents');
    }
  }, [selected, confirm, toast, reload]);

  if (loading) return <LoadingSkeleton columns={5} />;

  return (
    <div>
      {/* Credits bar + enhanced toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <CreditDisplay usage={usage} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
          <EnhancedToggle enabled={enhanced} onToggle={() => setEnhanced((v) => !v)} />
          <Button variant="primary" color={TEAL}
            onClick={() => modal.open(MODAL_TYPES.UPLOAD_DOCUMENT, { enhanced })}
            style={{ whiteSpace: 'nowrap' }}
            icon={
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={16} height={16}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            }
          >
            Upload Document
          </Button>
        </div>
      </div>

      <DataTable<DocumentRecord>
        columns={columns}
        data={filteredByCategory}
        loading={false}
        getRowId={(d) => d.id}
        onRowClick={handleRowClick}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        searchable
        searchPlaceholder="Search documents by filename, type, or county..."
        defaultSort={defaultSort}
        filterDropdown={{
          options: DOCUMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
          value: category,
          onChange: handleCategoryChange,
        }}
        sortDropdown={{
          options: sortOptions,
          value: effectiveSortValue,
          onChange: setSortValue,
        }}
        emptyTitle="No documents yet"
        emptyDescription="Upload your first document to start extracting mineral data."
        bulkActions={
          <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
            Delete Selected
          </Button>
        }
      />
    </div>
  );
}
