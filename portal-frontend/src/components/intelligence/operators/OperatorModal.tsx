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

function idleRateColor(rate: number): string {
  if (rate < 20) return '#16a34a';
  if (rate < 50) return '#f59e0b';
  if (rate < 75) return '#f97316';
  return '#dc2626';
}

function declineColor(rate: number | null): string {
  if (rate == null) return SLATE;
  if (rate > -10) return '#16a34a';
  if (rate > -35) return '#f59e0b';
  if (rate > -60) return '#f97316';
  return '#dc2626';
}

const GAS_PROFILE_COLORS: Record<string, { bg: string; color: string }> = {
  'Primarily Lean Gas': { bg: '#dbeafe', color: '#1e40af' },
  'Primarily Rich Gas': { bg: '#fef3c7', color: '#92400e' },
  'Mixed Portfolio': { bg: '#f3f4f6', color: '#374151' },
};

const sectionStyle: React.CSSProperties = {
  padding: 12, background: '#fff', borderRadius: 8, border: `1px solid ${BORDER}`,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: TEXT_DARK, margin: '0 0 8px',
};

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
      .slice(-18)
      .map(m => ({ label: fmtMonth(m.year_month), value: m.total_gross }));
  }, [detail]);

  const monthlyRows = useMemo(() => {
    if (!detail?.monthly) return [];
    return [...detail.monthly]
      .sort((a, b) => b.year_month.localeCompare(a.year_month))
      .slice(0, 6);
  }, [detail]);

  const contact = detail?.contact;
  const ph = detail?.production_health;

  // Custom header content with meta line
  const headerContent = (
    <div>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Merriweather', serif", color: '#fff' }}>
        {detail?.operator_name || operatorName}
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace' }}>#{operatorNumber}</span>
        {detail && (
          <Badge
            bg={detail.status === 'OPEN' ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.15)'}
            color={detail.status === 'OPEN' ? '#bbf7d0' : 'rgba(255,255,255,0.7)'}
            size="sm"
          >
            {detail.status === 'OPEN' ? 'Active' : 'Inactive'}
          </Badge>
        )}
        {detail?.gas_profile && (() => {
          const gp = GAS_PROFILE_COLORS[detail.gas_profile.label] || GAS_PROFILE_COLORS['Mixed Portfolio'];
          return (
            <Badge bg={gp.bg + '33'} color="#e2e8f0" size="sm">
              {detail.gas_profile.label}
            </Badge>
          );
        })()}
        {detail && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginLeft: 'auto' }}>
            {detail.summary.total_puns} leases &middot; {detail.all_counties.length} counties
          </span>
        )}
      </div>
    </div>
  );

  // Footer with Operator Summary button
  const footer = detail ? (
    <>
      <span style={{ fontSize: 11, color: SLATE }}>{detail.analysis_period} analysis</span>
      <button
        onClick={() => window.open(`/print/operators/${operatorNumber}`, '_blank')}
        style={{
          marginLeft: 'auto', padding: '8px 16px', borderRadius: 6, border: 'none',
          background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        Operator Summary
        <span style={{ fontSize: 11 }}>&#x2197;</span>
      </button>
    </>
  ) : undefined;

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
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 660, padding: '0 20px', boxSizing: 'border-box' }}>
        <ModalShell
          onClose={onClose}
          headerContent={headerContent}
          headerBg="linear-gradient(135deg, #6d28d9, #7c3aed)"
          maxWidth={660}
          footer={footer}
        >
          {loading ? (
            <LoadingSkeleton columns={2} rows={4} />
          ) : error ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#dc2626', fontSize: 13 }}>{error}</div>
          ) : detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
                {[
                  { label: 'Total Leases', value: String(detail.summary.total_puns) },
                  { label: 'Gross Revenue', value: fmtDollar(detail.summary.total_gross) },
                  { label: 'Deduction %', value: detail.summary.deduction_ratio != null ? detail.summary.deduction_ratio.toFixed(1) + '%' : '—' },
                  { label: 'PCRR', value: detail.summary.pcrr != null ? detail.summary.pcrr.toFixed(1) + '%' : '—',
                    color: detail.summary.pcrr != null ? (detail.summary.pcrr >= 100 ? '#16a34a' : detail.summary.pcrr < 10 ? '#dc2626' : TEXT_DARK) : SLATE },
                ].map((s, i) => (
                  <div key={i} style={{ padding: '10px 8px', background: BG_MUTED, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: (s as any).color || TEXT_DARK }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Contact info — phone is clickable tel: link */}
              {contact && (contact.contact_name || contact.phone || contact.address || contact.city) && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Contact Information</h4>
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
                        <a href={`tel:${contact.phone}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>{contact.phone}</a>
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

              {/* Operational Health — 3 cards with color coding + idle breakdown bar */}
              {ph && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Operational Health</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: ph.idlePuns > 0 ? 12 : 0 }}>
                    {/* Well Activity */}
                    <div style={{ padding: '10px 12px', background: BG_MUTED, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Well Activity</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: idleRateColor(ph.idleRatePct) }}>
                        {ph.idleRatePct}% idle
                      </div>
                      <div style={{ fontSize: 11, color: SLATE }}>{ph.idlePuns} idle of {ph.totalPuns} PUNs</div>
                    </div>
                    {/* Avg Decline */}
                    <div style={{ padding: '10px 12px', background: BG_MUTED, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Avg Decline (12mo)</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: declineColor(ph.avgDecline) }}>
                        {ph.avgDecline != null ? ph.avgDecline.toFixed(1) + '%' : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: SLATE }}>Year-over-year BOE</div>
                    </div>
                    {/* Production Trend */}
                    <div style={{ padding: '10px 12px', background: BG_MUTED, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Production Trend</div>
                      <div style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#dc2626' }}>{ph.decliningWells} &#x2193;</span>
                        <span style={{ color: SLATE, fontSize: 14 }}>/</span>
                        <span style={{ color: '#16a34a' }}>{ph.growingWells} &#x2191;</span>
                      </div>
                      <div style={{ fontSize: 11, color: SLATE }}>Declining / Growing</div>
                    </div>
                  </div>

                  {/* Idle Breakdown stacked bar */}
                  {ph.idlePuns > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: SLATE, marginBottom: 4 }}>Idle Breakdown</div>
                      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#f1f5f9' }}>
                        {ph.recentlyIdle > 0 && (
                          <div style={{ width: `${(ph.recentlyIdle / ph.idlePuns) * 100}%`, background: '#f59e0b', transition: 'width 0.3s' }}
                            title={`Recently Idle (3-6mo): ${ph.recentlyIdle}`} />
                        )}
                        {ph.extendedIdle > 0 && (
                          <div style={{ width: `${(ph.extendedIdle / ph.idlePuns) * 100}%`, background: '#f97316', transition: 'width 0.3s' }}
                            title={`Extended Idle (6-12mo): ${ph.extendedIdle}`} />
                        )}
                        {ph.longTermIdle > 0 && (
                          <div style={{ width: `${(ph.longTermIdle / ph.idlePuns) * 100}%`, background: '#94a3b8', transition: 'width 0.3s' }}
                            title={`Long-term Idle (12+mo): ${ph.longTermIdle}`} />
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11 }}>
                        {ph.recentlyIdle > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f59e0b' }} />
                            <span style={{ color: SLATE }}>3-6mo ({ph.recentlyIdle})</span>
                          </span>
                        )}
                        {ph.extendedIdle > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#f97316' }} />
                            <span style={{ color: SLATE }}>6-12mo ({ph.extendedIdle})</span>
                          </span>
                        )}
                        {ph.longTermIdle > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#94a3b8' }} />
                            <span style={{ color: SLATE }}>12+mo ({ph.longTermIdle})</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Efficiency Breakdown */}
              <div style={sectionStyle}>
                <h4 style={sectionTitle}>Efficiency Breakdown (6 Months)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, fontSize: 13 }}>
                  {[
                    { label: 'Total Production Value', value: fmtDollar(detail.summary.total_gross), color: TEXT_DARK, weight: 400 },
                    { label: 'Processing Deductions (Prod 5)', value: '-' + fmtDollar(detail.summary.residue_deductions), color: '#dc2626', weight: 400 },
                    { label: 'NGL Returned (Prod 6)', value: '+' + fmtDollar(detail.summary.pcrr_value), color: '#16a34a', weight: 400 },
                    { label: 'Net Value Return', value: fmtDollar(detail.summary.net_value_return), color: detail.summary.net_value_return >= 0 ? '#16a34a' : '#dc2626', weight: 700 },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '8px 0',
                      borderTop: i > 0 ? `1px solid ${BORDER}` : 'none',
                      ...(i === 3 ? { borderTop: `2px solid ${BORDER}`, marginTop: 4 } : {}),
                    }}>
                      <span style={{ color: TEXT_DARK, fontWeight: row.weight }}>{row.label}</span>
                      <span style={{ color: row.color, fontWeight: row.weight, fontFamily: 'monospace' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.4 }}>
                  PCRR = NGL Returned &divide; Deductions &times; 100. Over 100% means more value returned than deducted.
                </div>
              </div>

              {/* Purchaser — with affiliated context note */}
              {detail.purchaser.primary_purchaser_name && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Primary Purchaser</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: TEXT_DARK }}>{detail.purchaser.primary_purchaser_name}</span>
                    {detail.purchaser.is_affiliated ? (
                      <Badge bg="#fef3c7" color="#92400e" size="sm">Affiliated</Badge>
                    ) : (
                      <Badge bg="#f3f4f6" color="#374151" size="sm">Third Party</Badge>
                    )}
                  </div>
                  {detail.purchaser.is_affiliated && (
                    <div style={{ fontSize: 11, color: SLATE, marginTop: 6, lineHeight: 1.4, background: '#fffbeb', padding: '6px 10px', borderRadius: 4, border: '1px solid #fef3c7' }}>
                      This operator processes through an affiliated entity, which can result in different deduction structures
                      compared to third-party purchaser arrangements.
                    </div>
                  )}
                </div>
              )}

              {/* Gas Profile */}
              {detail.gas_profile && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Gas Profile</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    {(() => {
                      const gp = GAS_PROFILE_COLORS[detail.gas_profile!.label] || GAS_PROFILE_COLORS['Mixed Portfolio'];
                      return <Badge bg={gp.bg} color={gp.color} size="sm">{detail.gas_profile!.label}</Badge>;
                    })()}
                    {detail.gas_profile.lean_pct != null && (
                      <span style={{ fontSize: 11, color: SLATE }}>
                        {Math.round(detail.gas_profile.lean_pct * 100)}% lean &middot; {Math.round(detail.gas_profile.oil_pct * 100)}% oil
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Revenue Trend Chart */}
              {trendData.length > 0 && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Gross Revenue Trend</h4>
                  <TrendChart data={trendData} type="line" height={150} color="#7c3aed" />
                </div>
              )}

              {/* Monthly Trend Table */}
              {monthlyRows.length > 0 && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Monthly Detail</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                          {['Month', 'Gross', 'Deductions', 'Ded %', 'PCRR'].map(h => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Month' ? 'left' : 'right', fontSize: 11, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyRows.map((m, i) => {
                          const dedPct = m.total_gross > 0 ? (m.residue_deductions / m.total_gross * 100) : 0;
                          const pcrr = m.residue_deductions > 0 ? ((m as any).pcrr_value ?? 0) / m.residue_deductions * 100 : null;
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                              <td style={{ padding: '7px 10px', fontWeight: 500, color: TEXT_DARK }}>{fmtMonth(m.year_month)}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: TEXT_DARK }}>{fmtDollar(m.total_gross)}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>{fmtDollar(m.residue_deductions)}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: TEXT_DARK }}>{dedPct.toFixed(1)}%</td>
                              <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: SLATE }}>{pcrr != null ? pcrr.toFixed(0) + '%' : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Counties with well counts */}
              {detail.counties && detail.counties.length > 0 && (
                <div style={sectionStyle}>
                  <h4 style={sectionTitle}>Counties ({detail.counties.length})</h4>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {detail.counties
                      .sort((a, b) => b.well_count - a.well_count)
                      .map(c => (
                        <Badge key={c.county} bg="#f5f3ff" color="#6d28d9" size="sm">
                          {c.county} ({c.well_count})
                        </Badge>
                      ))}
                  </div>
                </div>
              )}

            </div>
          ) : null}
        </ModalShell>
      </div>
    </div>,
    document.body,
  );
}
