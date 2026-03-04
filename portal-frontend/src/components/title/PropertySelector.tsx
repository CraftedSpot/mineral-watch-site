import { useState, useEffect, useRef } from 'react';
import { DARK, SLATE, ORANGE, BORDER, TEAL } from '../../lib/constants';
import type { ChainProperty } from '../../types/title-chain';

interface PropertySelectorProps {
  properties: ChainProperty[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

export function PropertySelector({ properties, selectedId, onSelect, loading }: PropertySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = properties.find((p) => p.airtableRecordId === selectedId);
  const filtered = properties.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const label = `${p.county} S${p.section}-${p.township}-${p.range}`.toLowerCase();
    return label.includes(q);
  });

  const formatLabel = (p: ChainProperty) =>
    `${p.county} — S${p.section}-${p.township}-${p.range}`;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', fontFamily: "'DM Sans', sans-serif" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: '8px 16px', fontSize: 14, fontWeight: 600, color: DARK,
          cursor: 'pointer', minWidth: 280,
        }}>
        {loading ? 'Loading properties...' : selected ? formatLabel(selected) : 'Select a property...'}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={SLATE} strokeWidth="2"
          style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : '' }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: 320, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${BORDER}` }}>
            <input
              type="text"
              placeholder="Search county, section..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{
                width: '100%', padding: '6px 10px', border: `1px solid ${BORDER}`,
                borderRadius: 6, fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '12px 16px', color: SLATE, fontSize: 13 }}>No properties found</div>
            )}
            {filtered.map((p) => (
              <div
                key={p.airtableRecordId}
                onClick={() => { onSelect(p.airtableRecordId); setOpen(false); setSearch(''); }}
                style={{
                  padding: '10px 16px', cursor: 'pointer', fontSize: 13,
                  background: p.airtableRecordId === selectedId ? ORANGE + '10' : 'transparent',
                  borderLeft: p.airtableRecordId === selectedId ? `3px solid ${ORANGE}` : '3px solid transparent',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fb')}
                onMouseLeave={(e) => (e.currentTarget.style.background = p.airtableRecordId === selectedId ? ORANGE + '10' : 'transparent')}
              >
                <div style={{ fontWeight: 600, color: DARK }}>{formatLabel(p)}</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                  {p.chainDocCount} chain document{p.chainDocCount !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
