import { useMemo, useCallback, useState, useEffect } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useProperties } from '../../hooks/useProperties';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFormDirty } from '../../hooks/useFormDirty';
import { fetchLinkedWells, fetchLinkedDocuments, saveProperty, unlinkWell, relinkWell } from '../../api/properties';
import { AccordionSection } from '../ui/AccordionSection';
import { StatusBadge } from '../ui/StatusBadge';
import { SkeletonRows } from '../ui/SkeletonRows';
import { Spinner } from '../ui/Spinner';
import { formatDate, formatDecimal, formatTRS, getWellStatusColor } from '../../lib/helpers';
import { OCCFilingsSection } from '../shared/OCCFilingsSection';
import { CompletionReportsSection } from '../shared/CompletionReportsSection';
import { MODAL_TYPES, BORDER, SLATE } from '../../lib/constants';
import type { LinkedWell, LinkedDocument } from '../../types/property-detail';

// Vanilla CSS variables
const RED_DIRT = '#C05621';
const RED_DIRT_DARK = '#9C4215';
const OIL_NAVY = '#1C2B36';
const SLATE_BLUE = '#334E68';

// Deterministic group color palette (matches vanilla getEntityColor)
const ENTITY_PALETTE = [
  { bg: '#DBEAFE', text: '#1E40AF' },
  { bg: '#FCE7F3', text: '#9D174D' },
  { bg: '#D1FAE5', text: '#065F46' },
  { bg: '#FEF3C7', text: '#92400E' },
  { bg: '#EDE9FE', text: '#5B21B6' },
  { bg: '#FFEDD5', text: '#9A3412' },
  { bg: '#CCFBF1', text: '#115E59' },
  { bg: '#FEE2E2', text: '#991B1B' },
];

function getEntityColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return ENTITY_PALETTE[Math.abs(h) % ENTITY_PALETTE.length];
}

interface Props {
  onClose: () => void;
  modalId: string;
  propertyId: string;
}

const MATCH_STYLES: Record<string, { bg: string; color: string }> = {
  'Surface Location': { bg: '#dbeafe', color: '#1d4ed8' },
  'Bottom Hole': { bg: '#cffafe', color: '#0e7490' },
  'Lateral Path': { bg: '#f3e8ff', color: '#7c3aed' },
  'Adjacent Section': { bg: '#fef3c7', color: '#92400e' },
};

function getMatchStyle(reason: string) {
  return MATCH_STYLES[reason] || { bg: '#e5e7eb', color: '#374151' };
}

export function PropertyModal({ onClose, propertyId }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { data: properties, reload: reloadProperties } = useProperties();
  const [saving, setSaving] = useState(false);
  const [meridian, setMeridian] = useState('IM');
  const [occCount, setOccCount] = useState<number | null>(null);

  const prop = useMemo(() => properties.find((p) => p.id === propertyId), [properties, propertyId]);
  const f = prop?.fields;

  const { data: linkedWells, loading: wellsLoading, refetch: refetchWells } = useAsyncData<LinkedWell[]>(
    () => fetchLinkedWells(propertyId),
    [propertyId],
  );
  const { data: linkedDocs, loading: docsLoading } = useAsyncData<LinkedDocument[]>(
    () => fetchLinkedDocuments(propertyId),
    [propertyId],
  );

  const initialValues = useMemo(() => ({
    notes: String(f?.Notes ?? ''),
    riAcres: String(f?.['RI Acres'] ?? ''),
    wiAcres: String(f?.['WI Acres'] ?? ''),
    riDecimal: f?.ri_decimal != null ? String(f.ri_decimal) : '',
    wiDecimal: f?.wi_decimal != null ? String(f.wi_decimal) : '',
    orriAcres: f?.orri_acres != null ? String(f.orri_acres) : '',
    orriDecimal: f?.orri_decimal != null ? String(f.orri_decimal) : '',
    miAcres: f?.mi_acres != null ? String(f.mi_acres) : '',
    miDecimal: f?.mi_decimal != null ? String(f.mi_decimal) : '',
  }), [f]);

  const { values, setValue, isDirty, reset } = useFormDirty(initialValues);

  useEffect(() => { reset(initialValues); }, [initialValues, reset]);
  useEffect(() => {
    if (f?.MERIDIAN) setMeridian(String(f.MERIDIAN));
  }, [f]);

  const totalAcres = Number(values.riAcres || 0) + Number(values.wiAcres || 0);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveProperty(propertyId, {
        notes: values.notes,
        riAcres: values.riAcres || 0,
        wiAcres: values.wiAcres || 0,
        riDecimal: values.riDecimal || null,
        wiDecimal: values.wiDecimal || null,
        orriAcres: values.orriAcres || null,
        orriDecimal: values.orriDecimal || null,
        miAcres: values.miAcres || null,
        miDecimal: values.miDecimal || null,
      });
      toast.success('Property saved');
      reloadProperties();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [propertyId, values, toast, reloadProperties, onClose]);

  const handleUnlink = useCallback(async (well: LinkedWell) => {
    const ok = await confirm(`Unlink ${well.wellName}?`, {
      title: 'Unlink Well', confirmText: 'Unlink', icon: 'warning', destructive: true,
    });
    if (!ok) return;
    try {
      await unlinkWell(well.linkId);
      toast.success('Well unlinked');
      refetchWells();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink');
    }
  }, [confirm, toast, refetchWells]);

  const handleRelink = useCallback(async (well: LinkedWell) => {
    try {
      await relinkWell(well.linkId);
      toast.success('Well relinked');
      refetchWells();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to relink');
    }
  }, [toast, refetchWells]);

  if (!prop || !f) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: 40, textAlign: 'center', color: SLATE }}>Property not found</div>
      </div>
    );
  }

  const county = String(f.COUNTY || '');
  const legal = formatTRS(f.SEC as string, f.TWN as string, f.RNG as string);
  const group = f.Group as string | undefined;
  const code = f.property_code as string | undefined;
  const groupColor = group ? getEntityColor(group) : null;

  const interestFields = [
    { key: 'riDecimal', label: 'RI Decimal' },
    { key: 'wiDecimal', label: 'WI Decimal' },
    { key: 'orriDecimal', label: 'ORRI Decimal' },
    { key: 'miDecimal', label: 'MI Decimal' },
    { key: 'orriAcres', label: 'ORRI Acres' },
    { key: 'miAcres', label: 'MI Acres' },
  ];
  const populatedInterests = interestFields.filter((i) => values[i.key as keyof typeof values]).length;

  return (
    <div style={cardStyle}>
      {/* Header — vanilla: .property-card-header gradient #C05621 → #9C4215 */}
      <div style={{
        background: `linear-gradient(135deg, ${RED_DIRT} 0%, ${RED_DIRT_DARK} 100%)`,
        color: '#fff', padding: '20px 24px', position: 'relative', flexShrink: 0,
      }}>
        <button onClick={onClose} style={closeStyle}>&times;</button>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Merriweather', serif" }}>Mineral Property</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 15, opacity: 0.9 }}>{county} &bull; {legal}</span>
          {totalAcres > 0 && (
            <span style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
              {totalAcres.toFixed(2)} acres
            </span>
          )}
        </div>
        {code && (
          <div style={{ marginTop: 6 }}>
            <span style={{ fontFamily: "'SF Mono', 'Monaco', monospace", fontSize: 12, background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: 4, opacity: 0.85 }}>
              {code}
            </span>
          </div>
        )}
      </div>

      {/* Body — vanilla: padding 20px 24px, background #f1f5f9, scrollable */}
      <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch', background: '#f1f5f9' }}>

        {/* Details Grid — vanilla: .details-grid flex column gap 12px */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Legal row with meridian dropdown */}
          <div style={detailsRowStyle}>
            <span style={labelStyle}>Legal</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...valueStyle, fontFamily: 'monospace' }}>{legal}</span>
              <select
                value={meridian}
                onChange={(e) => setMeridian(e.target.value)}
                style={{ padding: '4px 8px', border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 13, fontFamily: 'inherit', background: '#fff' }}
              >
                <option value="IM">IM</option>
                <option value="CM">CM</option>
              </select>
            </div>
          </div>

          {/* Group row */}
          {group && (
            <div style={detailsRowStyle}>
              <span style={labelStyle}>Group</span>
              <span style={{ ...valueStyle, background: groupColor!.bg, color: groupColor!.text, padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: 13 }}>
                {group}
              </span>
            </div>
          )}

          {/* Total Acres */}
          <div style={detailsRowStyle}>
            <span style={labelStyle}>Total Acres</span>
            <span style={{ ...valueStyle, fontWeight: 500 }}>{totalAcres > 0 ? totalAcres.toFixed(2) : '\u2014'}</span>
          </div>

          {/* RI Acres */}
          <div style={detailsRowStyle}>
            <span style={labelStyle}>RI Acres</span>
            <input type="number" step="0.01" min="0" value={values.riAcres} placeholder="0"
              onChange={(e) => setValue('riAcres', e.target.value)} style={inputStyle} />
          </div>

          {/* WI Acres */}
          <div style={{ ...detailsRowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>WI Acres</span>
            <input type="number" step="0.01" min="0" value={values.wiAcres} placeholder="0"
              onChange={(e) => setValue('wiAcres', e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Ownership Interests — vanilla: margin 16px 0, border 1px solid #e2e8f0, border-radius 8px */}
        <AccordionSection title="Ownership Interests" count={populatedInterests || undefined}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {interestFields.map((field) => (
              <div key={field.key}>
                <label style={{ fontSize: 11, color: SLATE_BLUE, fontWeight: 500 }}>{field.label}</label>
                <input type="number" step="any"
                  value={values[field.key as keyof typeof values]}
                  onChange={(e) => setValue(field.key as keyof typeof values, e.target.value)}
                  style={{ ...inputStyle, width: '100%', marginTop: 2 }}
                />
              </div>
            ))}
          </div>
        </AccordionSection>

        {/* Linked Wells */}
        <AccordionSection title="Linked Wells" count={wellsLoading ? null : (linkedWells?.length ?? 0)}>
          {wellsLoading ? <SkeletonRows /> : linkedWells && linkedWells.length > 0 ? (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {linkedWells.map((w) => {
                const ms = getMatchStyle(w.matchReason);
                const interests: string[] = [];
                if (w.riNri != null) interests.push(`RI: ${formatDecimal(w.riNri)}`);
                if (w.wiNri != null) interests.push(`WI: ${formatDecimal(w.wiNri)}`);
                if (w.orriNri != null) interests.push(`ORRI: ${formatDecimal(w.orriNri)}`);
                return (
                  <div key={w.wellId || w.apiNumber} style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          onClick={() => modal.open(MODAL_TYPES.WELL, { wellId: w.wellId, apiNumber: w.apiNumber, wellName: w.wellName })}
                          style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                        >
                          {w.wellName}
                        </span>
                        <div style={{ fontSize: 11, color: SLATE_BLUE, marginTop: 2 }}>
                          {w.operator} &middot; {w.county}
                        </div>
                        {interests.length > 0 && (
                          <div style={{ fontSize: 11, color: OIL_NAVY, fontFamily: 'monospace', marginTop: 2 }}>
                            {interests.join(' | ')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {w.matchReason && <StatusBadge label={w.matchReason} background={ms.bg} color={ms.color} />}
                          {w.wellStatus && (
                            <StatusBadge label={w.wellStatus}
                              background={getWellStatusColor(w.wellStatus) + '20'}
                              color={getWellStatusColor(w.wellStatus)} />
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {w.linkStatus === 'Linked' ? (
                            <button onClick={() => handleUnlink(w)} style={linkBtnStyle}>Unlink</button>
                          ) : (
                            <button onClick={() => handleRelink(w)} style={{ ...linkBtnStyle, color: '#16a34a' }}>Relink</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0' }}>No wells linked to this property</div>
          )}
        </AccordionSection>

        {/* Linked Documents */}
        <AccordionSection title="Linked Documents" count={docsLoading ? null : (linkedDocs?.length ?? 0)}>
          {docsLoading ? <SkeletonRows count={2} /> : linkedDocs && linkedDocs.length > 0 ? (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {linkedDocs.map((d) => (
                <div key={d.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <span
                    onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: d.id })}
                    style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
                  >
                    {d.displayName}
                  </span>
                  <div style={{ fontSize: 11, color: SLATE_BLUE }}>{d.docType} &middot; {formatDate(d.uploadDate)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0' }}>No documents linked to this property</div>
          )}
        </AccordionSection>

        {/* OCC Filings */}
        <AccordionSection title="OCC Filings" count={occCount}>
          <OCCFilingsSection
            section={f.SEC as string}
            township={f.TWN as string}
            range={f.RNG as string}
            onCountChange={setOccCount}
          />
        </AccordionSection>

        {/* County Records */}
        <AccordionSection title="County Records" count={wellsLoading ? null : undefined}>
          {linkedWells && linkedWells.filter((w) => w.apiNumber).length > 0 ? (
            linkedWells.filter((w) => w.apiNumber).map((w) => (
              <div key={w.apiNumber} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: SLATE_BLUE, fontWeight: 600, marginBottom: 4 }}>{w.wellName}</div>
                <CompletionReportsSection apiNumber={w.apiNumber} />
              </div>
            ))
          ) : (
            <div style={{ color: '#6b7280', fontSize: 14, padding: '12px 0' }}>
              {wellsLoading ? 'Loading...' : 'No county records found for this section'}
            </div>
          )}
        </AccordionSection>

        {/* Notes — vanilla: margin-top 16px, white bg, border, border-radius 8px, padding 16px */}
        <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ ...labelStyle, marginBottom: 8 }}>Notes</span>
            <textarea
              value={values.notes}
              onChange={(e) => setValue('notes', e.target.value)}
              placeholder="Add notes about this property..."
              style={{
                width: '100%', minHeight: 80, padding: 10, border: `1px solid ${BORDER}`,
                borderRadius: 6, fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
                background: '#fff', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      </div>

      {/* Footer — vanilla: padding 16px 24px, gap 10px, flex-shrink 0 */}
      <div style={{
        padding: '16px 24px', borderTop: '1px solid #e5e7eb',
        display: 'flex', gap: 10, flexShrink: 0, background: '#fff',
        borderRadius: '0 0 16px 16px',
      }}>
        <a href={`/portal/title?property=${propertyId}`} style={{ ...actionBtnStyle, background: 'linear-gradient(135deg, #1e3a5f, #0f172a)', textDecoration: 'none' }}>
          Title Chain
        </a>
        <button onClick={() => { onClose(); window.location.search = '?tab=tools'; }}
          style={{ ...actionBtnStyle, background: RED_DIRT }}>
          Estimate Revenue
        </button>
        <a href={`/portal/map?county=${county}&sec=${f.SEC}&twn=${f.TWN}&rng=${f.RNG}`}
          target="_blank" rel="noopener noreferrer"
          style={{ ...actionBtnStyle, background: RED_DIRT, textDecoration: 'none' }}>
          MW Map &#x2197;
        </a>
        {isDirty && (
          <button onClick={handleSave} disabled={saving}
            style={{ ...actionBtnStyle, background: RED_DIRT, opacity: saving ? 0.7 : 1 }}>
            {saving && <Spinner size={14} color="#fff" />}
            Save &amp; Close
          </button>
        )}
      </div>
    </div>
  );
}

// Vanilla: max-width 700px, max-height calc(100vh - 20px), margin 10px auto, border-radius 16px
const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700,
  maxHeight: 'calc(100vh - 20px)', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontFamily: "'Inter', 'DM Sans', sans-serif",
  overflow: 'hidden', padding: 0,
};

// Vanilla: 32x32, border-radius 6px, rgba(255,255,255,0.1) bg, 1px border
const closeStyle: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16,
  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6, width: 32, height: 32, cursor: 'pointer',
  fontSize: 20, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// Vanilla: .details-row — padding 10px 0, border-bottom 1px solid var(--border)
const detailsRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
};

// Vanilla: .details-label — font-size 13px, color var(--slate-blue), font-weight 500
const labelStyle: React.CSSProperties = {
  fontSize: 13, color: SLATE_BLUE, fontWeight: 500,
};

// Vanilla: .details-value — font-size 14px, color var(--oil-navy), font-weight 500
const valueStyle: React.CSSProperties = {
  fontSize: 14, color: OIL_NAVY, fontWeight: 500,
};

// Vanilla: padding 6px 10px, font-size 14px, width 120px
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 4, border: `1px solid ${BORDER}`,
  fontSize: 14, width: 120, fontFamily: 'inherit', background: '#fff',
};

// Vanilla: .action-btn — flex 1, padding 12px 16px, border-radius 6px, font-size 14px, font-weight 600
const actionBtnStyle: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6, fontSize: 14, fontWeight: 600,
  textAlign: 'center', cursor: 'pointer', color: '#fff', border: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 11, cursor: 'pointer',
  color: SLATE_BLUE, textDecoration: 'underline', padding: '2px 4px',
};
