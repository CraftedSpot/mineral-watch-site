import { useState, useMemo, useCallback } from 'react';
import { useProperties } from '../../../hooks/useProperties';
import { useModal } from '../../../contexts/ModalContext';
import { useToast } from '../../../contexts/ToastContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { formatTRS } from '../../../lib/helpers';
import { getEntityColor } from '../../../lib/entity-colors';
import { PropertyLinkCounts } from '../../ui/LinkCounts';
import { DataTable } from '../../ui/DataTable';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { MODAL_TYPES, SLATE, ORANGE } from '../../../lib/constants';
import type { ColumnDef } from '../../ui/DataTableTypes';
import type { PropertyRecord } from '../../../types/dashboard';

/** Remove numeric prefix from county: "011-BLAINE" → "BLAINE" */
function cleanCounty(county: string | undefined): string {
  if (!county) return '';
  return String(county).replace(/^\d+-/, '');
}

/** Parse township string: "T24N" → { num: 24, dir: 'n' } */
function parseTownship(twp: string | undefined): { num: number; dir: string } {
  const match = (twp || '').match(/T?(\d+)([NS])?/i);
  return match ? { num: parseInt(match[1]), dir: (match[2] || '').toLowerCase() } : { num: 0, dir: '' };
}

/** Parse range string: "R10W" → { num: 10, dir: 'w' } */
function parseRange(rng: string | undefined): { num: number; dir: string } {
  const match = (rng || '').match(/R?(\d+)([EW])?/i);
  return match ? { num: parseInt(match[1]), dir: (match[2] || '').toLowerCase() } : { num: 0, dir: '' };
}

/** Total acres for a property */
function totalAcres(p: PropertyRecord): number {
  return Number(p.fields['RI Acres'] || 0) + Number(p.fields['WI Acres'] || 0);
}

/** Legal description sort — County → Township → Range → Section (matches vanilla exactly) */
function compareLegal(a: PropertyRecord, b: PropertyRecord): number {
  const aC = cleanCounty(a.fields.COUNTY).toLowerCase();
  const bC = cleanCounty(b.fields.COUNTY).toLowerCase();
  if (aC !== bC) return aC < bC ? -1 : 1;

  const aTwp = parseTownship(a.fields.TWN);
  const bTwp = parseTownship(b.fields.TWN);
  if (aTwp.num !== bTwp.num) return aTwp.num - bTwp.num;
  if (aTwp.dir !== bTwp.dir) return aTwp.dir < bTwp.dir ? -1 : 1;

  const aRng = parseRange(a.fields.RNG);
  const bRng = parseRange(b.fields.RNG);
  if (aRng.num !== bRng.num) return aRng.num - bRng.num;
  if (aRng.dir !== bRng.dir) return aRng.dir < bRng.dir ? -1 : 1;

  const aSec = parseInt(String(a.fields.SEC)) || 0;
  const bSec = parseInt(String(b.fields.SEC)) || 0;
  return aSec - bSec;
}

// Sort dropdown options (matches vanilla dashboard-shell.html)
const SORT_OPTIONS = [
  { value: 'legal-asc', label: 'Legal Description' },
  { value: 'acres-desc', label: 'Total Acres' },
  { value: 'wells-desc', label: 'Wells' },
  { value: 'documents-desc', label: 'Documents' },
  { value: 'filings-desc', label: 'OCC Filings' },
];

export function PropertiesTab() {
  const { data: properties, loading, reload } = useProperties();
  const isMobile = useIsMobile();
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortValue, setSortValue] = useState('legal-asc');

  // Column definitions (inside component so render can use isMobile)
  const columns: ColumnDef<PropertyRecord>[] = useMemo(() => [
    {
      key: 'county',
      label: 'County',
      width: '10%',
      sortable: true,
      searchable: true,
      hideOnMobile: true,
      getValue: (p) => cleanCounty(p.fields.COUNTY),
      compare: (a, b) => cleanCounty(a.fields.COUNTY).localeCompare(cleanCounty(b.fields.COUNTY)),
      render: (p) => <span>{cleanCounty(p.fields.COUNTY)}</span>,
    },
    {
      key: 'legal',
      label: 'Legal',
      width: '12%',
      mobileWidth: '1fr',
      sortable: true,
      searchable: true,
      getValue: (p) => {
        const f = p.fields;
        return [f.COUNTY, f.SEC, f.TWN, f.RNG, f.Meridian, f.property_code,
          (f.TWN || '') + '-' + (f.RNG || '') + '-' + (f.SEC || '')].filter(Boolean).join(' ');
      },
      compare: compareLegal,
      render: (p) => (
        <div>
          <strong style={{ color: ORANGE, fontFamily: "'IBM Plex Mono', monospace" }}>
            {formatTRS(p.fields.SEC as string, p.fields.TWN as string, p.fields.RNG as string)}
          </strong>
          {isMobile && (
            <div style={{ fontSize: 11, color: SLATE, marginTop: 1 }}>
              {cleanCounty(p.fields.COUNTY)}
              {(p.fields.Group || p.fields.entity_name) && (
                <> &middot; {String(p.fields.Group || p.fields.entity_name)}</>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'group',
      label: 'Group',
      width: '10%',
      searchable: true,
      hideOnMobile: true,
      getValue: (p) => String(p.fields.Group || p.fields.entity_name || ''),
      render: (p) => {
        const group = String(p.fields.Group || p.fields.entity_name || '');
        if (!group) return <em style={{ color: '#A0AEC0' }}>&mdash;</em>;
        const ec = getEntityColor(group);
        return (
          <Badge bg={ec.bg} color={ec.text} shape="pill">{group}</Badge>
        );
      },
    },
    {
      key: 'acres',
      label: 'Acres',
      width: '8%',
      headerAlign: 'right',
      sortable: true,
      hideOnMobile: true,
      compare: (a, b) => totalAcres(a) - totalAcres(b),
      render: (p) => {
        const t = totalAcres(p);
        return (
          <span style={{ textAlign: 'right', display: 'block' }}>
            {t > 0 ? t.toFixed(2) : <em style={{ color: '#A0AEC0' }}>&mdash;</em>}
          </span>
        );
      },
    },
    {
      key: 'notes',
      label: 'Notes',
      width: '1fr',
      searchable: true,
      hideOnMobile: true,
      getValue: (p) => String(p.fields.Notes || ''),
      render: (p) => {
        const notes = String(p.fields.Notes || '');
        if (!notes) return <em style={{ color: '#A0AEC0' }}>&mdash;</em>;
        return (
          <span style={{ color: SLATE, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {notes}
          </span>
        );
      },
    },
    {
      key: 'links',
      label: 'Links',
      width: '15%',
      mobileWidth: 'auto',
      headerAlign: 'right',
      render: (p) => {
        const counts = (p as unknown as Record<string, unknown>)._linkCounts as
          { wells: number; documents: number; filings: number } | undefined;
        return <PropertyLinkCounts counts={counts} />;
      },
    },
  ], [isMobile]);

  // Parse sort dropdown into DataTable defaultSort
  const defaultSort = useMemo(() => {
    const [field, direction] = sortValue.split('-') as [string, 'asc' | 'desc'];
    // Map dropdown values to column sort keys
    const keyMap: Record<string, string> = {
      legal: 'legal',
      acres: 'acres',
      wells: 'wells',
      documents: 'documents',
      filings: 'filings',
    };
    return { key: keyMap[field] || 'legal', direction };
  }, [sortValue]);

  // Comparators for link-count sort keys (not tied to visible columns)
  const customComparators = useMemo(() => {
    const lc = (p: PropertyRecord) => (p as unknown as Record<string, unknown>)._linkCounts as
      { wells: number; documents: number; filings: number } | undefined;
    return {
      wells: (a: PropertyRecord, b: PropertyRecord) => (lc(a)?.wells ?? 0) - (lc(b)?.wells ?? 0),
      documents: (a: PropertyRecord, b: PropertyRecord) => (lc(a)?.documents ?? 0) - (lc(b)?.documents ?? 0),
      filings: (a: PropertyRecord, b: PropertyRecord) => (lc(a)?.filings ?? 0) - (lc(b)?.filings ?? 0),
    };
  }, []);

  const handleRowClick = useCallback((p: PropertyRecord) => {
    modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.id });
  }, [modal]);

  const handleAddProperty = useCallback(() => {
    modal.open(MODAL_TYPES.ADD_PROPERTY, {
      onComplete: () => reload(),
    });
  }, [modal, reload]);

  const handleBulkDelete = useCallback(async () => {
    const count = selected.size;
    if (count === 0) return;
    const ok = await confirm(`Delete ${count} propert${count === 1 ? 'y' : 'ies'}? This cannot be undone.`, { destructive: true, icon: 'trash' });
    if (!ok) return;
    try {
      const res = await fetch('/api/properties/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted ${count} propert${count === 1 ? 'y' : 'ies'}`);
      setSelected(new Set());
      reload();
    } catch {
      toast.error('Failed to delete properties');
    }
  }, [selected, confirm, toast, reload]);

  return (
    <DataTable<PropertyRecord>
      columns={columns}
      data={properties}
      loading={loading}
      getRowId={(p) => p.id}
      onRowClick={handleRowClick}
      selectable
      selectedIds={selected}
      onSelectionChange={setSelected}
      searchable
      searchPlaceholder="Search properties by county, section, township, or range..."
      defaultSort={defaultSort}
      customComparators={customComparators}
      sortDropdown={{
        options: SORT_OPTIONS,
        value: sortValue,
        onChange: setSortValue,
      }}
      emptyTitle="No properties yet"
      emptyDescription="Add your first property to start monitoring wells and filings."
      bulkActions={
        <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
          Delete Selected
        </Button>
      }
      toolbarActions={
        <button
          onClick={handleAddProperty}
          style={{
            marginLeft: 'auto', background: ORANGE, color: '#fff', border: 'none',
            borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: "'Inter', 'DM Sans', sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          + Add Property
        </button>
      }
    />
  );
}
