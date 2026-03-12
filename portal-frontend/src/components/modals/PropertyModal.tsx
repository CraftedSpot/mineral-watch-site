import { useMemo, useCallback, useState, useEffect } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useProperties } from '../../hooks/useProperties';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFormDirty } from '../../hooks/useFormDirty';
import { useIsMobile } from '../../hooks/useIsMobile';
import { fetchLinkedWells, fetchLinkedDocuments, saveProperty, unlinkWell, relinkWell } from '../../api/properties';
import { AccordionSection } from '../ui/AccordionSection';
import { Badge } from '../ui/Badge';
import { ModalShell } from '../ui/ModalShell';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TextArea, TextInput } from '../ui/FormField';
import { SkeletonRows } from '../ui/SkeletonRows';
import { Spinner } from '../ui/Spinner';
import { formatDate, formatDecimal, formatTRS, getWellStatusColor } from '../../lib/helpers';
import { OCCFilingsSection } from '../shared/OCCFilingsSection';
import { CountyRecordsSection, isCountySupported } from '../shared/CountyRecordsSection';
import { useAuth } from '../../hooks/useAuth';
import { MODAL_TYPES, BORDER, SLATE, ORANGE, ORANGE_DARK } from '../../lib/constants';
import { getMatchStyle } from '../../lib/match-styles';
import { OperatorLink } from '../ui/OperatorLink';
import type { LinkedWell, LinkedDocument } from '../../types/property-detail';

// Vanilla CSS variables
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


export function PropertyModal({ onClose, propertyId }: Props) {
  const modal = useModal();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { data: properties, reload: reloadProperties } = useProperties();
  const [saving, setSaving] = useState(false);
  const [meridian, setMeridian] = useState('IM');
  const [occCountOverride, setOccCountOverride] = useState<number | null>(null);
  const [crCount, setCrCount] = useState<number | null>(null);

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
      <ModalShell onClose={onClose} showHeader={false} bodyBg="#fff">
        <div style={{ padding: 40, textAlign: 'center', color: SLATE }}>Property not found</div>
      </ModalShell>
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
    <ModalShell
      onClose={onClose}
      headerBg={`linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE_DARK} 100%)`}
      headerContent={
        <>
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
        </>
      }
      bodyBg="#f1f5f9"
      footer={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 6 : 8, width: '100%' }}>
          <a href={`/portal/title?property=${propertyId}`} style={{ ...actionBtnStyle, background: 'linear-gradient(135deg, #1e3a5f, #0f172a)', textDecoration: 'none', padding: isMobile ? '10px 12px' : '12px 16px', fontSize: isMobile ? 12 : 14 }}>
            Title Chain
          </a>
          <button onClick={() => modal.open(MODAL_TYPES.REVENUE_ESTIMATOR, { propertyId })}
            style={{ ...actionBtnStyle, background: ORANGE, padding: isMobile ? '10px 12px' : '12px 16px', fontSize: isMobile ? 12 : 14 }}>
            Revenue
          </button>
          <a href={`/portal/map?county=${county}&sec=${f.SEC}&twn=${f.TWN}&rng=${f.RNG}`}
            target="_blank" rel="noopener noreferrer"
            style={{ ...actionBtnStyle, background: ORANGE, textDecoration: 'none', padding: isMobile ? '10px 12px' : '12px 16px', fontSize: isMobile ? 12 : 14 }}>
            Map
          </a>
          {isDirty && (
            <button onClick={handleSave} disabled={saving}
              style={{ ...actionBtnStyle, background: ORANGE, opacity: saving ? 0.7 : 1, padding: isMobile ? '10px 12px' : '12px 16px', fontSize: isMobile ? 12 : 14 }}>
              {saving && <Spinner size={14} color="#fff" />}
              Save
            </button>
          )}
        </div>
      }
    >
      {/* Details Grid */}
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
            <Badge bg={groupColor!.bg} color={groupColor!.text} shape="pill" size="md">
              {group}
            </Badge>
          </div>
        )}

        {/* Total Acres */}
        <div style={detailsRowStyle}>
          <span style={labelStyle}>Total Acres</span>
          <span style={{ ...valueStyle, fontWeight: 400 }}>{totalAcres > 0 ? totalAcres.toFixed(2) : '\u2014'}</span>
        </div>

        {/* RI Acres */}
        <div style={detailsRowStyle}>
          <span style={labelStyle}>RI Acres</span>
          <TextInput type="number" step="0.01" min="0" value={values.riAcres} placeholder="0"
            onChange={(e) => setValue('riAcres', e.target.value)} style={{ width: 120 }} />
        </div>

        {/* WI Acres */}
        <div style={{ ...detailsRowStyle, borderBottom: 'none' }}>
          <span style={labelStyle}>WI Acres</span>
          <TextInput type="number" step="0.01" min="0" value={values.wiAcres} placeholder="0"
            onChange={(e) => setValue('wiAcres', e.target.value)} style={{ width: 120 }} />
        </div>
      </div>

      {/* Ownership Interests */}
      <AccordionSection title="Ownership Interests" count={populatedInterests || undefined}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {interestFields.map((field) => (
            <div key={field.key}>
              <label style={{ fontSize: 11, color: SLATE_BLUE, fontWeight: 400 }}>{field.label}</label>
              <TextInput type="number" step="any"
                value={values[field.key as keyof typeof values]}
                onChange={(e) => setValue(field.key as keyof typeof values, e.target.value)}
                style={{ width: '100%', marginTop: 2 }}
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
                        <OperatorLink name={w.operator} fontSize={11} fontWeight={500} /> &middot; {w.county}
                      </div>
                      {interests.length > 0 && (
                        <div style={{ fontSize: 11, color: OIL_NAVY, fontFamily: 'monospace', marginTop: 2 }}>
                          {interests.join(' | ')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {w.matchReason && <Badge bg={ms.bg} color={ms.color}>{w.matchReason}</Badge>}
                        {w.wellStatus && (
                          <Badge bg={getWellStatusColor(w.wellStatus) + '20'} color={getWellStatusColor(w.wellStatus)}>
                            {w.wellStatus}
                          </Badge>
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
                  style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
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
      <AccordionSection title="OCC Filings" count={occCountOverride ?? prop?._linkCounts?.filings ?? null}>
        <OCCFilingsSection
          section={f.SEC as string}
          township={f.TWN as string}
          range={f.RNG as string}
          onCountChange={setOccCountOverride}
        />
      </AccordionSection>

      {/* County Records (OKCR) — super admin only */}
      {user?.isSuperAdmin && f.COUNTY && (
        <AccordionSection title="County Records" count={crCount}>
          {isCountySupported(String(f.COUNTY)) ? (
            <CountyRecordsSection
              section={f.SEC as string}
              township={f.TWN as string}
              range={f.RNG as string}
              county={String(f.COUNTY)}
              onCountChange={setCrCount}
            />
          ) : (
            <div style={{ color: '#6b7280', fontSize: 13, padding: '12px 0' }}>
              County records search is not available for {String(f.COUNTY)} County.
            </div>
          )}
        </AccordionSection>
      )}

      {/* Notes */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ ...labelStyle, marginBottom: 8 }}>Notes</span>
          <TextArea
            value={values.notes}
            onChange={(e) => setValue('notes', e.target.value)}
            placeholder="Add notes about this property..."
          />
        </div>
      </Card>
    </ModalShell>
  );
}

const detailsRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 0', borderBottom: `1px solid ${BORDER}`,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13, color: SLATE_BLUE, fontWeight: 400,
};

const valueStyle: React.CSSProperties = {
  fontSize: 14, color: OIL_NAVY, fontWeight: 400,
};

const actionBtnStyle: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6, fontSize: 14, fontWeight: 600,
  textAlign: 'center', cursor: 'pointer', color: '#fff', border: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 11, cursor: 'pointer',
  color: SLATE_BLUE, textDecoration: 'underline', padding: '2px 4px',
};
