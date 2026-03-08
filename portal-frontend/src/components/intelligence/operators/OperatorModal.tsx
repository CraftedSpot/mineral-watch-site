import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fetchOperatorDetail } from '../../../api/intelligence';
import { TrendChart } from '../TrendChart';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { ModalShell } from '../../ui/ModalShell';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { OperatorDetailData } from '../../../types/intelligence';

interface OperatorModalProps {
  operatorNumber: string;
  operatorName: string;
  subtitle?: string;
  onClose: () => void;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtMonth(ym: string): string {
  if (!ym || ym.length < 6) return ym || '';
  const m = parseInt(ym.substring(4, 6), 10);
  return MONTH_ABBR[m - 1] + " '" + ym.substring(2, 4);
}
function fmtDollar(v: number): string {
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + Math.round(v).toLocaleString();
}

export function OperatorModal({ operatorNumber, operatorName, subtitle, onClose }: OperatorModalProps) {
  const [detail, setDetail] = useState<OperatorDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOperatorDetail(operatorNumber)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [operatorNumber]);

  const trendData = useMemo(() => {
    if (!detail?.monthly) return [];
    return detail.monthly
      .sort((a, b) => a.year_month.localeCompare(b.year_month))
      .slice(-12)
      .map(m => ({ label: fmtMonth(m.year_month), value: m.total_gross }));
  }, [detail]);

  const contact = detail?.contact;
  const resolvedSubtitle = subtitle
    || (detail ? `${detail.summary.total_puns} leases across ${detail.all_counties.length} counties` : '');

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 640, padding: '0 20px', boxSizing: 'border-box' }}>
        <ModalShell
          onClose={onClose}
          title={detail?.operator_name || operatorName}
          subtitle={resolvedSubtitle}
          headerBg="linear-gradient(135deg, #6d28d9, #7c3aed)"
          maxWidth={640}
        >
          {loading ? (
            <LoadingSkeleton columns={2} rows={4} />
          ) : error ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>
          ) : detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Total Leases', value: String(detail.summary.total_puns) },
                  { label: 'Gross Revenue', value: fmtDollar(detail.summary.total_gross) },
                  { label: 'Deduction %', value: detail.summary.deduction_ratio != null ? detail.summary.deduction_ratio.toFixed(1) + '%' : '—' },
                  { label: 'PCRR', value: detail.summary.pcrr != null ? detail.summary.pcrr.toFixed(1) + '%' : '—' },
                ].map((s, i) => (
                  <div key={i} style={{ padding: '10px 8px', background: BG_MUTED, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: TEXT_DARK }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Contact info */}
              {contact && (contact.contact_name || contact.phone || contact.address || contact.city) && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Contact Information</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                    {contact.contact_name && (
                      <div>
                        <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Contact</div>
                        <div style={{ color: TEXT_DARK }}>{contact.contact_name}</div>
                      </div>
                    )}
                    {contact.phone && (
                      <div>
                        <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Phone</div>
                        <div style={{ color: TEXT_DARK }}>{contact.phone}</div>
                      </div>
                    )}
                    {contact.address && (
                      <div>
                        <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Address</div>
                        <div style={{ color: TEXT_DARK }}>{contact.address}</div>
                      </div>
                    )}
                    {contact.city && (
                      <div>
                        <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>City/State</div>
                        <div style={{ color: TEXT_DARK }}>{contact.city}, {contact.state} {contact.zip}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Production Health */}
              {detail.production_health && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Production Health</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                    <div>
                      <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Active Leases</div>
                      <div style={{ fontWeight: 600, color: '#16a34a' }}>{detail.production_health.activePuns}</div>
                    </div>
                    <div>
                      <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Idle Leases</div>
                      <div style={{ fontWeight: 600, color: detail.production_health.idleRatePct > 30 ? '#dc2626' : TEXT_DARK }}>
                        {detail.production_health.idlePuns} ({detail.production_health.idleRatePct}%)
                      </div>
                    </div>
                    <div>
                      <div style={{ color: SLATE, fontSize: 11, marginBottom: 2 }}>Avg Decline</div>
                      <div style={{ fontWeight: 600, color: (detail.production_health.avgDecline ?? 0) < -10 ? '#dc2626' : TEXT_DARK }}>
                        {detail.production_health.avgDecline != null ? detail.production_health.avgDecline.toFixed(1) + '%' : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Purchaser */}
              {detail.purchaser.primary_purchaser_name && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Primary Purchaser</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: TEXT_DARK }}>{detail.purchaser.primary_purchaser_name}</span>
                    {detail.purchaser.is_affiliated && (
                      <Badge bg="#fef3c7" color="#92400e" size="sm">Affiliated</Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Gas Profile */}
              {detail.gas_profile && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Gas Profile</h4>
                  <Badge bg="#dbeafe" color="#1e40af" size="sm">{detail.gas_profile.label}</Badge>
                </div>
              )}

              {/* Revenue Trend */}
              {trendData.length > 0 && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>Gross Revenue Trend</h4>
                  <TrendChart data={trendData} type="bar" height={120} color="#7c3aed" />
                </div>
              )}

              {/* Counties */}
              {detail.all_counties.length > 0 && (
                <div style={{ padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px' }}>
                    Counties ({detail.all_counties.length})
                  </h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {detail.all_counties.map(c => (
                      <Badge key={c} bg="#f5f3ff" color="#6d28d9" size="sm">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, color: SLATE, textAlign: 'center' }}>
                Operator #{operatorNumber} — {detail.analysis_period} analysis
              </div>
            </div>
          ) : null}
        </ModalShell>
      </div>
    </div>,
    document.body,
  );
}
