import { useState, useRef, useCallback } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { addWell, searchWells } from '../../api/wells';
import type { SearchWellResult } from '../../api/wells';
import { BulkWellImport } from './BulkWellImport';
import { TEAL, BORDER, SLATE, DARK, WELL_STATUS_COLORS } from '../../lib/constants';

interface Props {
  onClose: () => void;
  modalId: string;
  onComplete?: () => void;
}

type Tab = 'api' | 'search' | 'import';
type Phase = 'idle' | 'submitting' | 'success';

// --- Helpers ---

function formatApiNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
}

function getDigits(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

function isValidApi(digits: string): boolean {
  return digits.length === 10 && digits.startsWith('35');
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    AC: 'Active', PA: 'Plugged', IN: 'Inactive',
    SI: 'Shut-In', TA: 'Temp Abandon', NEW: 'New', NR: 'No Report',
  };
  return map[s] || s || 'Unknown';
}

// --- Component ---

export function AddWellModal({ onClose, onComplete }: Props) {
  const toast = useToast();
  const isMobile = useIsMobile();

  // Tabs
  const [tab, setTab] = useState<Tab>('api');
  const [importFooter, setImportFooter] = useState<React.ReactNode>(null);
  const [importStep, setImportStep] = useState<string>('upload');

  // Tab 1 state
  const [apiValue, setApiValue] = useState('');
  const [notes, setNotes] = useState('');
  const [preFilled, setPreFilled] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  // Tab 2 state
  const [searchName, setSearchName] = useState('');
  const [searchOperator, setSearchOperator] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advSection, setAdvSection] = useState('');
  const [advTownship, setAdvTownship] = useState('');
  const [advRange, setAdvRange] = useState('');
  const [advCounty, setAdvCounty] = useState('');
  const [results, setResults] = useState<SearchWellResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const digits = getDigits(apiValue);
  const valid = isValidApi(digits);

  // --- Search ---

  const runSearch = useCallback(async (name: string, op: string, sec: string, twp: string, rng: string, cty: string) => {
    const hasName = name.trim().length >= 2;
    const hasOp = op.trim().length >= 2;
    const hasAdvanced = sec || twp || rng || cty;
    if (!hasName && !hasOp && !hasAdvanced) {
      setResults([]);
      setSearchTruncated(false);
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const data = await searchWells({
        well_name: name.trim() || undefined,
        operator: op.trim() || undefined,
        section: sec || undefined,
        township: twp || undefined,
        range: rng || undefined,
        county: cty || undefined,
      });
      setResults(data.wells);
      setSearchTruncated(data.truncated);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const debouncedSearch = useCallback((name: string, op: string, sec: string, twp: string, rng: string, cty: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(name, op, sec, twp, rng, cty), 400);
  }, [runSearch]);

  const handleSearchFieldChange = (field: 'name' | 'operator' | 'section' | 'township' | 'range' | 'county', v: string) => {
    const setters = { name: setSearchName, operator: setSearchOperator, section: setAdvSection, township: setAdvTownship, range: setAdvRange, county: setAdvCounty };
    setters[field](v);
    const vals = { name: searchName, operator: searchOperator, section: advSection, township: advTownship, range: advRange, county: advCounty, [field]: v };
    debouncedSearch(vals.name, vals.operator, vals.section, vals.township, vals.range, vals.county);
  };

  const handleSelectResult = (well: SearchWellResult) => {
    const formatted = formatApiNumber(well.api_number);
    setApiValue(formatted);
    setPreFilled(true);
    setError('');
    setTab('api');
  };

  // --- Submit ---

  const handleSubmit = async () => {
    if (!valid || phase === 'submitting') return;
    setPhase('submitting');
    setError('');
    try {
      await addWell(digits);
      setPhase('success');
      toast.success('Well added');
      onComplete?.();
      autoCloseRef.current = setTimeout(() => onClose(), 2000);
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Failed to add well');
    }
  };

  // Cleanup auto-close on unmount
  const prevCloseRef = useRef(autoCloseRef);
  prevCloseRef.current = autoCloseRef;

  // --- Tab bar ---

  const tabsDisabled = tab === 'import' && importStep !== 'upload';

  const tabBar = (
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${BORDER}`, background: '#fff' }}>
      {([['api', isMobile ? 'API' : 'By API Number'], ['search', 'Search'], ['import', 'Import']] as [Tab, string][]).map(([key, label]) => (
        <button
          key={key}
          onClick={() => { if (!tabsDisabled) { setTab(key); setError(''); } }}
          style={{
            flex: 1, padding: isMobile ? '10px 8px' : '10px 16px', fontSize: isMobile ? 12 : 13, fontWeight: tab === key ? 700 : 500,
            color: tab === key ? TEAL : SLATE, background: 'none', border: 'none',
            borderBottom: tab === key ? `2px solid ${TEAL}` : '2px solid transparent',
            cursor: tabsDisabled && key !== tab ? 'not-allowed' : 'pointer',
            opacity: tabsDisabled && key !== tab ? 0.5 : 1,
            transition: 'all 0.15s',
            fontFamily: "'Inter', 'DM Sans', sans-serif",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // --- Footer ---

  const footer = tab === 'import'
    ? importFooter
    : phase === 'success' ? null : (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        {tab === 'api' && (
          <button
            onClick={handleSubmit}
            disabled={!valid || phase === 'submitting'}
            style={{
              ...primaryBtnStyle,
              opacity: !valid || phase === 'submitting' ? 0.5 : 1,
              cursor: !valid || phase === 'submitting' ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'submitting' ? 'Adding...' : 'Add Well'}
          </button>
        )}
      </div>
    );

  return (
    <ModalShell
      onClose={onClose}
      title="Add Well"
      subtitle="Track a well by API number or search the statewide database"
      headerBg={TEAL}
      maxWidth={tab === 'import' && importStep !== 'upload' ? 640 : 560}
      footer={footer}
    >
      {tabBar}

      {/* Tabs 1 & 2: padded content */}
      {tab !== 'import' && (
      <div style={{ padding: '16px 20px', minHeight: 380 }}>
        {/* Success state */}
        {phase === 'success' && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
            padding: 20, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>&#10003;</div>
            <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Well added successfully</div>
            <div style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
              Auto-matching to your properties...
            </div>
          </div>
        )}

        {/* Tab 1: API Number */}
        {phase !== 'success' && tab === 'api' && (
          <div>
            {preFilled && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
                padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#166534',
              }}>
                Ready to add &mdash; confirm below
              </div>
            )}

            <label style={labelStyle}>API Number</label>
            <input
              type="text"
              value={apiValue}
              onChange={(e) => {
                setApiValue(formatApiNumber(e.target.value));
                setPreFilled(false);
                setError('');
              }}
              placeholder="35-XXX-XXXXX"
              autoFocus
              style={{
                ...inputStyle,
                borderColor: preFilled ? '#86efac' : error ? '#fca5a5' : BORDER,
                background: preFilled ? '#f0fdf4' : '#fff',
              }}
            />
            <div style={{ fontSize: 11, color: SLATE, marginTop: 4, marginBottom: 16 }}>
              Oklahoma 10-digit API number (starts with 35)
            </div>

            {error && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
                padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#991b1b',
              }}>
                {error}
              </div>
            )}

            <label style={labelStyle}>Notes <span style={{ fontWeight: 400, color: SLATE }}>(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add context about this well..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: "'Inter', 'DM Sans', sans-serif" }}
            />
          </div>
        )}

        {/* Tab 2: Search */}
        {phase !== 'success' && tab === 'search' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 8 : 12, marginBottom: 8 }}>
              <div>
                <label style={labelStyle}>Well Name</label>
                <input
                  type="text"
                  value={searchName}
                  onChange={(e) => handleSearchFieldChange('name', e.target.value)}
                  placeholder="e.g. JONES 1-18"
                  autoFocus
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Operator</label>
                <input
                  type="text"
                  value={searchOperator}
                  onChange={(e) => handleSearchFieldChange('operator', e.target.value)}
                  placeholder="e.g. Continental"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: 4, marginBottom: 8 }}>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  background: 'none', border: 'none', padding: 0, fontSize: 12,
                  color: TEAL, cursor: 'pointer', fontWeight: 500,
                  fontFamily: "'Inter', 'DM Sans', sans-serif",
                }}
              >
                {showAdvanced ? '- Hide' : '+ Show'} location filters
              </button>
            </div>

            {showAdvanced && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11 }}>Section</label>
                  <input
                    type="text" value={advSection}
                    onChange={(e) => handleSearchFieldChange('section', e.target.value)}
                    placeholder="1-36" style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11 }}>Township</label>
                  <input
                    type="text" value={advTownship}
                    onChange={(e) => handleSearchFieldChange('township', e.target.value)}
                    placeholder="e.g. 18N" style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11 }}>Range</label>
                  <input
                    type="text" value={advRange}
                    onChange={(e) => handleSearchFieldChange('range', e.target.value)}
                    placeholder="e.g. 14W" style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: 11 }}>County</label>
                  <input
                    type="text" value={advCounty}
                    onChange={(e) => handleSearchFieldChange('county', e.target.value)}
                    placeholder="e.g. Grady" style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                  />
                </div>
              </div>
            )}

            {/* Results */}
            {searching && (
              <div style={{ textAlign: 'center', padding: 20, color: SLATE, fontSize: 13 }}>
                Searching...
              </div>
            )}

            {searchError && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
                padding: '8px 12px', fontSize: 13, color: '#991b1b',
              }}>
                {searchError}
              </div>
            )}

            {!searching && !searchError && results.length === 0 && (searchName.trim().length >= 2 || searchOperator.trim().length >= 2 || advSection || advTownship || advRange || advCounty) && (
              <div style={{ textAlign: 'center', padding: 20, color: SLATE, fontSize: 13 }}>
                No wells found
              </div>
            )}

            {!searching && results.length > 0 && (
              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.map((w) => {
                  const sColor = WELL_STATUS_COLORS[w.well_status] || '#6b7280';
                  const location = w.section && w.township && w.range
                    ? `S${w.section}-${w.township}-${w.range}`
                    : '';
                  return (
                    <button
                      key={w.api_number}
                      onClick={() => handleSelectResult(w)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8,
                        padding: '10px 14px', cursor: 'pointer',
                        fontFamily: "'Inter', 'DM Sans', sans-serif",
                        transition: 'border-color 0.15s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.borderColor = TEAL)}
                      onMouseOut={(e) => (e.currentTarget.style.borderColor = BORDER)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ color: DARK, fontSize: 13 }}>{w.well_name || 'Unnamed'}</strong>
                          <span style={{ color: SLATE, fontSize: 12, marginLeft: 8 }}>{w.api_number}</span>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: sColor,
                          background: `${sColor}18`, padding: '2px 8px', borderRadius: 4,
                        }}>
                          {statusLabel(w.well_status)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: SLATE, marginTop: 4 }}>
                        {location && <span>{location}</span>}
                        {location && w.county && <span> &middot; </span>}
                        {w.county && <span>{w.county} County</span>}
                        {w.operator && <span> &middot; {w.operator}</span>}
                      </div>
                      {w.formation_name && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{w.formation_name}</div>
                      )}
                    </button>
                  );
                })}
                {searchTruncated && (
                  <div style={{ textAlign: 'center', padding: 8, fontSize: 12, color: SLATE }}>
                    25+ results &mdash; try narrowing your search
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
      )}

      {/* Tab 3: Import Spreadsheet */}
      {phase !== 'success' && tab === 'import' && (
        <BulkWellImport
          onClose={onClose}
          onComplete={onComplete}
          onFooterChange={setImportFooter}
          onStepChange={(s) => setImportStep(s)}
        />
      )}
    </ModalShell>
  );
}

// --- Styles ---

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: DARK,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: `1px solid ${BORDER}`,
  borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: SLATE,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  background: TEAL, color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 20px', fontSize: 13, fontWeight: 600,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};
