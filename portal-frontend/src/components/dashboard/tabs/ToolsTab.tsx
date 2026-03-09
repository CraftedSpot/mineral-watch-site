import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProperties } from '../../../hooks/useProperties';
import { useWells } from '../../../hooks/useWells';
import { useModal } from '../../../contexts/ModalContext';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { MODAL_TYPES, SLATE, BORDER, ORANGE, BG_MUTED, DARK, TEXT_MUTED } from '../../../lib/constants';
import type { PropertyRecord } from '../../../types/dashboard';
import type { WellRecord } from '../../../types/dashboard';

type Mode = 'property' | 'well';

/** Remove numeric prefix from county: "011-BLAINE" → "BLAINE" */
function cleanCounty(county: string | undefined): string {
  if (!county) return '';
  return String(county).replace(/^\d+-/, '');
}

function formatTRS(sec?: string, twn?: string, rng?: string): string {
  const parts = [sec, twn, rng].filter(Boolean);
  return parts.join('-') || '';
}

interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  mode: Mode;
}

function matchProperty(p: PropertyRecord, q: string): boolean {
  const f = p.fields;
  const haystack = [
    cleanCounty(f.COUNTY),
    f.SEC,
    f.TWN,
    f.RNG,
    f.entity_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function matchWell(w: WellRecord, q: string): boolean {
  const haystack = [w.well_name, w.apiNumber, w.operator, w.county]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function ToolsTab() {
  const { data: properties, loading: propsLoading } = useProperties();
  const { data: wells, loading: wellsLoading } = useWells();
  const modal = useModal();
  const isMobile = useIsMobile();

  const [, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('property');
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loading = mode === 'property' ? propsLoading : wellsLoading;

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    if (mode === 'property') {
      return properties
        .filter((p) => matchProperty(p, q))
        .slice(0, 10)
        .map((p) => ({
          id: p.id,
          title: `${cleanCounty(p.fields.COUNTY)} ${formatTRS(p.fields.SEC, p.fields.TWN, p.fields.RNG)}`,
          subtitle: p.fields.entity_name || '',
          mode: 'property' as Mode,
        }));
    }

    return wells
      .filter((w) => matchWell(w, q))
      .slice(0, 10)
      .map((w) => ({
        id: w.id,
        title: w.well_name || w.apiNumber || w.id,
        subtitle: [w.operator, w.county].filter(Boolean).join(' — '),
        mode: 'well' as Mode,
      }));
  }, [query, mode, properties, wells]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.children[activeIdx] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const selectResult = useCallback(
    (r: SearchResult) => {
      if (r.mode === 'property') {
        modal.open(MODAL_TYPES.REVENUE_ESTIMATOR, { propertyId: r.id });
      } else {
        modal.open(MODAL_TYPES.REVENUE_ESTIMATOR, { wellId: r.id });
      }
      setQuery('');
      setDropdownOpen(false);
    },
    [modal],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!dropdownOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(results[activeIdx]);
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      inputRef.current?.blur();
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setQuery('');
    setDropdownOpen(false);
    inputRef.current?.focus();
  };

  const hasData = mode === 'property' ? properties.length > 0 : wells.length > 0;
  const showDropdown = dropdownOpen && query.trim().length > 0;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: DARK,
            margin: '0 0 6px',
          }}
        >
          Revenue Estimator
        </h2>
        <p style={{ fontSize: 14, color: SLATE, margin: 0 }}>
          Search for a property or well to estimate monthly royalty income based on recent production.
        </p>
      </div>

      {/* Mode toggle */}
      <div
        style={{
          display: 'inline-flex',
          background: BG_MUTED,
          borderRadius: 8,
          padding: 3,
          marginBottom: 16,
          border: `1px solid ${BORDER}`,
        }}
      >
        {(['property', 'well'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            style={{
              padding: '7px 20px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s',
              background: mode === m ? '#fff' : 'transparent',
              color: mode === m ? DARK : TEXT_MUTED,
              boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {m === 'property' ? 'By Property' : 'By Well'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => query.trim() && setDropdownOpen(true)}
          onBlur={() => {
            // Delay to allow click on dropdown item
            setTimeout(() => setDropdownOpen(false), 200);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'property'
              ? 'Search by county, section, township, range, or entity...'
              : 'Search by well name, API number, operator, or county...'
          }
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 14,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            outline: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocusCapture={(e) => {
            (e.target as HTMLInputElement).style.borderColor = ORANGE;
          }}
          onBlurCapture={(e) => {
            (e.target as HTMLInputElement).style.borderColor = BORDER;
          }}
          aria-label={`Search ${mode === 'property' ? 'properties' : 'wells'}`}
          role="combobox"
          aria-expanded={showDropdown}
          aria-activedescendant={showDropdown ? `tools-result-${activeIdx}` : undefined}
        />

        {/* Dropdown */}
        {showDropdown && (
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              maxHeight: 400,
              overflowY: 'auto',
              zIndex: 100,
            }}
          >
            {loading ? (
              <div style={{ padding: 16, textAlign: 'center', color: SLATE, fontSize: 13 }}>
                Loading...
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: SLATE, fontSize: 13 }}>
                No matches found
              </div>
            ) : (
              results.map((r, i) => (
                <div
                  key={r.id}
                  id={`tools-result-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectResult(r);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    padding: isMobile ? '14px 16px' : '10px 16px',
                    minHeight: isMobile ? 44 : undefined,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    background: i === activeIdx ? BG_MUTED : '#fff',
                    borderBottom: i < results.length - 1 ? `1px solid ${BORDER}` : undefined,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: DARK }}>{r.title}</div>
                  {r.subtitle && (
                    <div style={{ fontSize: 12, color: TEXT_MUTED }}>{r.subtitle}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!hasData && !loading && (
        <div
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            border: `2px dashed ${BORDER}`,
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 14, color: SLATE, marginBottom: 8 }}>
            {mode === 'property'
              ? 'Add properties to get started'
              : 'Add wells to get started'}
          </div>
          <button
            onClick={() => {
              setSearchParams({ tab: mode === 'property' ? 'properties' : 'wells' }, { replace: true });
            }}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 600,
              color: ORANGE,
              background: 'transparent',
              border: `1px solid ${ORANGE}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Go to {mode === 'property' ? 'Properties' : 'Wells'}
          </button>
        </div>
      )}
    </div>
  );
}
