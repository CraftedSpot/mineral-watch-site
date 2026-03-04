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
import { MODAL_TYPES, BORDER, DARK, SLATE } from '../../lib/constants';
import type { PropertyRecord } from '../../types/dashboard';
import type { LinkedWell, LinkedDocument } from '../../types/property-detail';

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

  // Reset form when property changes
  useEffect(() => { reset(initialValues); }, [initialValues, reset]);

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

  const propName = String(f.Name || f['Property Name'] || 'Untitled Property');
  const county = String(f.COUNTY || '');
  const legal = formatTRS(f.SEC as string, f.TWN as string, f.RNG as string);
  const totalAcres = Number(f['RI Acres'] || 0) + Number(f['WI Acres'] || 0);
  const group = f.Group as string | undefined;
  const code = f.property_code as string | undefined;

  const interestFields = [
    { key: 'riDecimal', label: 'RI Decimal' },
    { key: 'wiDecimal', label: 'WI Decimal' },
    { key: 'orriAcres', label: 'ORRI Acres' },
    { key: 'orriDecimal', label: 'ORRI Decimal' },
    { key: 'miAcres', label: 'MI Acres' },
    { key: 'miDecimal', label: 'MI Decimal' },
  ];
  const populatedInterests = interestFields.filter((i) => values[i.key as keyof typeof values]).length;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #c4553a 0%, #a0402d 100%)',
        color: '#fff', padding: '20px 24px', borderRadius: '16px 16px 0 0', position: 'relative',
      }}>
        <button onClick={onClose} style={closeStyle}>&times;</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Mineral Property</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{county} &bull; {legal}</span>
          {totalAcres > 0 && (
            <span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
              {totalAcres.toFixed(2)} acres
            </span>
          )}
        </div>
        {code && (
          <div style={{ marginTop: 4 }}>
            <span style={{ background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: 8, fontSize: 11 }}>
              Ref: {code}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(100vh - 220px)', background: '#f1f5f9' }}>
        {/* Info Card */}
        <div style={{ background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}`, padding: 14 }}>
          <InfoRow label="Legal" value={legal} mono />
          {group && (
            <InfoRow label="Group">
              <span style={{ background: '#f1f5f9', color: DARK, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>
                {group}
              </span>
            </InfoRow>
          )}
          <InfoRow label="Total Acres" value={totalAcres > 0 ? String(totalAcres) : '\u2014'} />
          <InfoRow label="RI Acres">
            <input type="number" step="any" value={values.riAcres}
              onChange={(e) => setValue('riAcres', e.target.value)} style={inputStyle} />
          </InfoRow>
          <InfoRow label="WI Acres">
            <input type="number" step="any" value={values.wiAcres}
              onChange={(e) => setValue('wiAcres', e.target.value)} style={inputStyle} />
          </InfoRow>
        </div>

        {/* Ownership Interests */}
        <AccordionSection title="Ownership Interests" count={populatedInterests || undefined} defaultOpen={populatedInterests > 0}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {interestFields.map((field) => (
              <div key={field.key}>
                <label style={{ fontSize: 11, color: SLATE, fontWeight: 500 }}>{field.label}</label>
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
        <AccordionSection title="Linked Wells" count={wellsLoading ? null : (linkedWells?.length ?? 0)} defaultOpen>
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
                        <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                          {w.operator} &middot; {w.county}
                        </div>
                        {interests.length > 0 && (
                          <div style={{ fontSize: 11, color: DARK, fontFamily: 'monospace', marginTop: 2 }}>
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
            <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No linked wells</div>
          )}
        </AccordionSection>

        {/* Linked Documents */}
        <AccordionSection title="Linked Documents" count={docsLoading ? null : (linkedDocs?.length ?? 0)}>
          {docsLoading ? <SkeletonRows count={2} /> : linkedDocs && linkedDocs.length > 0 ? (
            <div>
              {linkedDocs.map((d) => (
                <div key={d.id} style={{ padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <span
                    onClick={() => modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: d.id })}
                    style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}
                  >
                    {d.displayName}
                  </span>
                  <div style={{ fontSize: 11, color: SLATE }}>{d.docType} &middot; {formatDate(d.uploadDate)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: SLATE, fontSize: 12, padding: 8, textAlign: 'center' }}>No linked documents</div>
          )}
        </AccordionSection>

        {/* OCC Filings — by property TRS */}
        <OCCFilingsSection section={f.SEC as string} township={f.TWN as string} range={f.RNG as string} />

        {/* County Records — aggregate from all linked wells */}
        {linkedWells && linkedWells.length > 0 && (
          <AccordionSection title="County Records" count={null}>
            {linkedWells.filter((w) => w.apiNumber).map((w) => (
              <div key={w.apiNumber} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4 }}>{w.wellName}</div>
                <CompletionReportsSection apiNumber={w.apiNumber} />
              </div>
            ))}
          </AccordionSection>
        )}

        {/* Notes */}
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: DARK, display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            value={values.notes}
            onChange={(e) => setValue('notes', e.target.value)}
            style={{
              width: '100%', minHeight: 80, padding: 10, borderRadius: 6,
              border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: 'inherit',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 20px', borderTop: `1px solid ${BORDER}`, background: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderRadius: '0 0 16px 16px',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {!window.location.pathname.includes('/portal/title') && (
            <a href={`/portal/title?property=${propertyId}`}
              style={{ ...footerBtnStyle, textDecoration: 'none' }}>
              Title Chain
            </a>
          )}
          <a href={`/portal/map?county=${county}&sec=${f.SEC}&twn=${f.TWN}&rng=${f.RNG}`}
            style={{ ...footerBtnStyle, textDecoration: 'none' }}>
            MW Map
          </a>
        </div>
        {isDirty && (
          <button onClick={handleSave} disabled={saving} style={{
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {saving && <Spinner size={12} color="#fff" />}
            Save & Close
          </button>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono, children }: {
  label: string; value?: string; mono?: boolean; children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ fontSize: 12, color: SLATE, fontWeight: 500 }}>{label}</span>
      {children || (
        <span style={{ fontSize: 13, color: DARK, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '\u2014'}</span>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 580,
  maxHeight: 'calc(100vh - 20px)', display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.15)', fontFamily: "'Inter', 'DM Sans', sans-serif",
  overflow: 'hidden',
};

const closeStyle: React.CSSProperties = {
  position: 'absolute', top: 12, right: 16, background: 'rgba(255,255,255,0.2)',
  border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
  fontSize: 18, lineHeight: '28px', textAlign: 'center', color: '#fff',
};

const inputStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 4, border: `1px solid ${BORDER}`,
  fontSize: 13, width: 100, textAlign: 'right', fontFamily: 'monospace',
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 11, cursor: 'pointer',
  color: SLATE, textDecoration: 'underline', padding: '2px 4px',
};

const footerBtnStyle: React.CSSProperties = {
  background: '#f1f5f9', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '6px 14px', fontSize: 12, color: DARK, cursor: 'pointer',
  display: 'inline-block',
};
