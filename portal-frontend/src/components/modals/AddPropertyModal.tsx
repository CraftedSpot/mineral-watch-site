import { useState, useRef } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { BulkPropertyImport } from './BulkPropertyImport';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { addProperty } from '../../api/properties';
import { ORANGE, BORDER, SLATE, DARK } from '../../lib/constants';

interface Props {
  onClose: () => void;
  modalId: string;
  onComplete?: () => void;
}

type Tab = 'add' | 'import';
type Phase = 'idle' | 'submitting' | 'success';

// --- Helpers ---

function normalizeTownship(raw: string): { value: string; error: string } {
  const s = raw.trim().replace(/^T/i, '');
  if (!s) return { value: '', error: '' };
  const m = s.match(/^0*(\d+)\s*([NnSs])?$/);
  if (!m) return { value: s, error: 'Format: number + N or S (e.g. 18N)' };
  const num = parseInt(m[1]);
  if (num < 1 || num > 36) return { value: s, error: 'Township must be 1-36' };
  if (!m[2]) return { value: s, error: 'Add direction (N or S)' };
  return { value: `${num}${m[2].toUpperCase()}`, error: '' };
}

function normalizeRange(raw: string): { value: string; error: string } {
  const s = raw.trim().replace(/^R/i, '');
  if (!s) return { value: '', error: '' };
  const m = s.match(/^0*(\d+)\s*([EeWw])?$/);
  if (!m) return { value: s, error: 'Format: number + E or W (e.g. 14W)' };
  const num = parseInt(m[1]);
  if (num < 1 || num > 30) return { value: s, error: 'Range must be 1-30' };
  if (!m[2]) return { value: s, error: 'Add direction (E or W)' };
  return { value: `${num}${m[2].toUpperCase()}`, error: '' };
}

function validateSection(raw: string): string {
  if (!raw) return '';
  const num = parseInt(raw);
  if (isNaN(num) || num < 1 || num > 36) return 'Must be 1-36';
  return '';
}

// --- Component ---

export function AddPropertyModal({ onClose, onComplete }: Props) {
  const toast = useToast();
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<Tab>('add');

  // Location
  const [meridian, setMeridian] = useState('IM');
  const [township, setTownship] = useState('');
  const [range, setRange] = useState('');
  const [section, setSection] = useState('');

  // Details
  const [group, setGroup] = useState('');
  const [riAcres, setRiAcres] = useState('');
  const [wiAcres, setWiAcres] = useState('');
  const [notes, setNotes] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Import tab state
  const [importFooter, setImportFooter] = useState<React.ReactNode>(null);
  const [importStep, setImportStep] = useState<string>('upload');
  const tabsDisabled = tab === 'import' && importStep !== 'upload';

  const twp = normalizeTownship(township);
  const rng = normalizeRange(range);
  const secError = validateSection(section);

  const filled = section.trim() && township.trim() && range.trim();
  const valid = filled && !secError && !twp.error && !rng.error;

  // --- Submit ---

  const handleSubmit = async () => {
    if (!valid || phase === 'submitting') return;
    setPhase('submitting');
    setError('');
    try {
      await addProperty({
        SEC: section.trim(),
        TWN: twp.value,
        RNG: rng.value,
        MERIDIAN: meridian,
        Group: group.trim() || undefined,
        'RI Acres': riAcres ? parseFloat(riAcres) : undefined,
        'WI Acres': wiAcres ? parseFloat(wiAcres) : undefined,
        Notes: notes.trim() || undefined,
      });
      setPhase('success');
      toast.success('Property added');
      onComplete?.();
      autoCloseRef.current = setTimeout(() => onClose(), 2000);
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Failed to add property');
    }
  };

  // --- Tab bar ---

  const tabBar = (
    <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${BORDER}`, background: '#fff' }}>
      {([['add', 'Add Property'], ['import', 'Import Spreadsheet']] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={tabsDisabled ? undefined : () => { setTab(key); setError(''); }}
          style={{
            flex: 1, padding: '10px 16px', fontSize: 13, fontWeight: tab === key ? 700 : 500,
            color: tab === key ? ORANGE : SLATE, background: 'none', border: 'none',
            borderBottom: tab === key ? `2px solid ${ORANGE}` : '2px solid transparent',
            cursor: tabsDisabled ? 'default' : 'pointer',
            opacity: tabsDisabled && tab !== key ? 0.4 : 1,
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

  const footer = phase === 'success'
    ? null
    : tab === 'import'
      ? importFooter
      : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!valid || phase === 'submitting'}
            style={{
              ...primaryBtnStyle,
              opacity: !valid || phase === 'submitting' ? 0.5 : 1,
              cursor: !valid || phase === 'submitting' ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'submitting' ? 'Adding...' : 'Add Property'}
          </button>
        </div>
      );

  return (
    <ModalShell
      onClose={onClose}
      title="Add Property"
      subtitle="Add a mineral interest location to monitor"
      headerBg={ORANGE}
      maxWidth={isMobile ? '100%' : tab === 'import' ? 900 : 520}
      footer={footer}
    >
      {tabBar}

      {/* Success */}
      {phase === 'success' && (
        <div style={{ padding: '16px 20px' }}>
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
            padding: 20, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>&#10003;</div>
            <div style={{ fontWeight: 700, color: '#166534', fontSize: 15 }}>Property added successfully</div>
            <div style={{ fontSize: 12, color: '#4ade80', marginTop: 4 }}>
              Auto-matching to wells in your area...
            </div>
          </div>
        </div>
      )}

      {/* Tab 1: Add Property */}
      {phase !== 'success' && tab === 'add' && (
        <div style={{ padding: '16px 20px' }}>
          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
              padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#991b1b',
            }}>
              {error}
            </div>
          )}

          {/* Location section */}
          <div style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Location
          </div>

          {/* Meridian */}
          <label style={labelStyle}>Meridian</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['IM', 'CM'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMeridian(m)}
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: meridian === m ? 700 : 400,
                  background: meridian === m ? '#FEF3EC' : '#fff',
                  border: `1px solid ${meridian === m ? ORANGE : BORDER}`,
                  color: meridian === m ? ORANGE : DARK,
                  borderRadius: 6, cursor: 'pointer',
                  fontFamily: "'Inter', 'DM Sans', sans-serif",
                }}
              >
                {m === 'IM' ? 'Indian Meridian (IM)' : 'Cimarron Meridian (CM)'}
              </button>
            ))}
          </div>

          {/* Township, Range, Section */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Township</label>
              <input
                type="text"
                value={township}
                onChange={(e) => { setTownship(e.target.value); setError(''); }}
                placeholder="e.g. 18N"
                autoFocus
                style={inputStyle}
              />
              {twp.error && <div style={fieldErrorStyle}>{twp.error}</div>}
            </div>
            <div>
              <label style={labelStyle}>Range</label>
              <input
                type="text"
                value={range}
                onChange={(e) => { setRange(e.target.value); setError(''); }}
                placeholder="e.g. 14W"
                style={inputStyle}
              />
              {rng.error && <div style={fieldErrorStyle}>{rng.error}</div>}
            </div>
            <div>
              <label style={labelStyle}>Section</label>
              <input
                type="text"
                value={section}
                onChange={(e) => { setSection(e.target.value.replace(/\D/g, '').slice(0, 2)); setError(''); }}
                placeholder="1-36"
                style={inputStyle}
              />
              {secError && <div style={fieldErrorStyle}>{secError}</div>}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: 16 }} />

          {/* Details section */}
          <div style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Details <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </div>

          {/* Entity/Group */}
          <label style={labelStyle}>Entity / Group</label>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="e.g. Price Family Trust, Smith Minerals LLC"
            style={{ ...inputStyle, marginBottom: 12 }}
          />

          {/* RI & WI Acres */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>RI Acres</label>
              <input
                type="number"
                value={riAcres}
                onChange={(e) => setRiAcres(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>WI Acres</label>
              <input
                type="number"
                value={wiAcres}
                onChange={(e) => setWiAcres(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Notes */}
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this property..."
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: "'Inter', 'DM Sans', sans-serif" }}
          />
        </div>
      )}

      {/* Tab 2: Import Spreadsheet */}
      {phase !== 'success' && tab === 'import' && (
        <BulkPropertyImport
          onClose={onClose}
          onComplete={onComplete}
          onFooterChange={setImportFooter}
          onStepChange={setImportStep}
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
  background: ORANGE, color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 20px', fontSize: 13, fontWeight: 600,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const fieldErrorStyle: React.CSSProperties = {
  fontSize: 11, color: '#dc2626', marginTop: 2,
};
