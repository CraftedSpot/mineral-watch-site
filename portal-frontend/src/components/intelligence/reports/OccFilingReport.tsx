import { useState, useMemo } from 'react';
import { useReportData } from '../../../hooks/useReportData';
import { fetchOccFilingActivity } from '../../../api/intelligence';
import { TabNav } from '../TabNav';
import { SortableTable } from '../SortableTable';
import { LoadingSkeleton } from '../../ui/LoadingSkeleton';
import { Badge } from '../../ui/Badge';
import { BORDER, TEXT_DARK, SLATE, BG_MUTED } from '../../../lib/constants';
import type { Column } from '../SortableTable';
import type { OccFiling, OccFilingProperty, OccFilingData } from '../../../types/intelligence';

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return d; }
}

function reliefBadge(type: string) {
  const t = (type || '').toLowerCase();
  if (t.includes('horizontal') || t.includes('spacing')) return <Badge bg="#dcfce7" color="#166534" size="sm">{type}</Badge>;
  if (t.includes('pooling')) return <Badge bg="#dbeafe" color="#1e40af" size="sm">{type}</Badge>;
  if (t.includes('increased density')) return <Badge bg="#fef3c7" color="#92400e" size="sm">{type}</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{type}</Badge>;
}

function distanceBadge(tier: number, desc: string) {
  if (tier === 0) return <Badge bg="#fee2e2" color="#991b1b" size="sm">Same Section</Badge>;
  if (tier === 1) return <Badge bg="#fed7aa" color="#9a3412" size="sm">Adjacent</Badge>;
  return <Badge bg="#f3f4f6" color="#374151" size="sm">{desc || 'Nearby'}</Badge>;
}

export function OccFilingReport() {
  const [activeTab, setActiveTab] = useState('properties');
  const { data, loading, error, refetch } = useReportData(fetchOccFilingActivity);

  if (loading) return <LoadingSkeleton columns={5} rows={6} />;
  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 12 }}>{error || 'Could not load report.'}</p>
        <button onClick={refetch} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
      </div>
    );
  }

  const { summary: s, byProperty, byCounty, marketResearch } = data;
  const tabs = [
    { key: 'properties', label: 'My Properties', badge: byProperty.length },
    { key: 'counties', label: 'My Markets', badge: byCounty.length },
    { key: 'research', label: 'Market Research' },
  ];

  return (
    <div>
      {/* HUD */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { value: String(s.totalFilings), label: 'Total Filings', detail: 'Near your properties' },
          { value: String(s.sameSectionFilings), label: 'On Your Sections', detail: 'Direct impact' },
          { value: String(s.topApplicants?.length || 0), label: 'Active Operators', detail: s.topApplicants?.[0]?.name || '' },
          { value: String(s.propertiesWithActivity), label: 'Properties Active', detail: `of ${byProperty.length} total` },
        ].map((b, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', background: BG_MUTED, borderRadius: 8,
            border: `1px solid ${BORDER}`, flex: '1 1 160px',
          }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: i === 1 && s.sameSectionFilings > 0 ? '#dc2626' : TEXT_DARK }}>{b.value}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT_DARK }}>{b.label}</div>
              <div style={{ fontSize: 11, color: SLATE }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'properties' && <PropertiesTab properties={byProperty} />}
      {activeTab === 'counties' && <CountiesTab counties={byCounty} />}
      {activeTab === 'research' && <ResearchTab data={marketResearch} />}
    </div>
  );
}

function PropertiesTab({ properties }: { properties: OccFilingProperty[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (properties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No OCC filing activity near your properties.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {properties.map((prop) => (
        <div key={prop.propertyId} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          <button
            onClick={() => toggle(prop.propertyId)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="2"
                style={{ width: 14, height: 14, transition: 'transform 0.15s', transform: expanded.has(prop.propertyId) ? 'rotate(90deg)' : '' }}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>
                {prop.propertyName || `Sec ${prop.section}-${prop.township}-${prop.range}`}
              </span>
              <Badge bg="#f1f5f9" color={SLATE} size="sm">{prop.county}</Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: SLATE }}>
              <span>{prop.filingCount} filing{prop.filingCount !== 1 ? 's' : ''}</span>
              {prop.sameSectionCount > 0 && (
                <Badge bg="#fee2e2" color="#991b1b" size="sm">{prop.sameSectionCount} on section</Badge>
              )}
            </div>
          </button>

          {expanded.has(prop.propertyId) && (
            <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12 }}>
              <FilingsTable filings={prop.filings} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FilingsTable({ filings }: { filings: OccFiling[] }) {
  const columns: Column<OccFiling>[] = useMemo(() => [
    {
      key: 'docket_date', label: 'Date', sortType: 'string', width: 90,
      render: (row) => <span style={{ fontSize: 12 }}>{formatDate(row.docket_date)}</span>,
    },
    {
      key: 'relief_type', label: 'Type', sortType: 'string', width: 140,
      render: (row) => reliefBadge(row.relief_type),
    },
    {
      key: 'applicant', label: 'Applicant', sortType: 'string', width: 150,
      render: (row) => <span style={{ fontWeight: 500 }}>{row.applicant}</span>,
    },
    {
      key: 'case_number', label: 'Case #', sortType: 'string', width: 100,
      render: (row) => row.source_url ? (
        <a href={row.source_url} target="_blank" rel="noopener noreferrer"
          style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>{row.case_number}</a>
      ) : <span style={{ fontSize: 12 }}>{row.case_number}</span>,
    },
    {
      key: '_location', label: 'Location', sortType: 'string', width: 100,
      getValue: (row) => `${row.section}-${row.township}-${row.range}`,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.section}-{row.township}-{row.range}</span>,
    },
    {
      key: 'status', label: 'Status', sortType: 'string', width: 80,
      render: (row) => <span style={{ fontSize: 12, color: SLATE }}>{row.status || '—'}</span>,
    },
    {
      key: 'distanceTier', label: 'Distance', sortType: 'number', width: 100,
      render: (row) => distanceBadge(row.distanceTier, row.distanceDescription),
    },
  ], []);

  return (
    <SortableTable
      columns={columns}
      data={filings}
      defaultSort={{ key: 'docket_date', dir: 'desc' }}
      rowKey={(row) => row.id || row.case_number}
      emptyMessage="No filings"
    />
  );
}

function CountiesTab({ counties }: { counties: OccFilingData['byCounty'] }) {
  if (counties.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No county data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
      {counties.map((c) => {
        const topTypes = Object.entries(c.filingTypes || {}).sort(([, a], [, b]) => b - a).slice(0, 3);

        return (
          <div key={c.county} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT_DARK }}>{c.county}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT_DARK }}>{c.filingCount} filings</span>
            </div>
            {c.topApplicants?.length > 0 && (
              <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>
                Top filers: {c.topApplicants.slice(0, 3).map(a => a.name).join(', ')}
              </div>
            )}
            {topTypes.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {topTypes.map(([type, count]) => (
                  <Badge key={type} bg="#f1f5f9" color={SLATE} size="sm">{type} ({count})</Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResearchTab({ data }: { data: OccFilingData['marketResearch'] }) {
  if (!data) {
    return <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>No statewide research data available.</div>;
  }

  return (
    <div>
      {data.totalStatewideFilings90d > 0 && (
        <div style={{ fontSize: 13, color: SLATE, marginBottom: 16 }}>
          {data.totalStatewideFilings90d.toLocaleString()} statewide filings in the last 90 days
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {/* Hottest counties */}
        {data.hottestCounties?.length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Hottest Counties (90 days)</h3>
            {data.hottestCounties.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.hottestCounties.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
                <span style={{ color: TEXT_DARK }}>{c.county}</span>
                <span style={{ fontWeight: 600, color: SLATE }}>{c.count} filings</span>
              </div>
            ))}
          </div>
        )}

        {/* Top filers */}
        {data.topFilers?.length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Top Filers (90 days)</h3>
            {data.topFilers.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.topFilers.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
                <span style={{ color: TEXT_DARK }}>{f.applicant}</span>
                <span style={{ fontWeight: 600, color: SLATE }}>{f.count} filings</span>
              </div>
            ))}
          </div>
        )}

        {/* Filing type breakdown */}
        {data.filingTypeBreakdown && Object.keys(data.filingTypeBreakdown).length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, background: '#fff' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, margin: '0 0 12px' }}>Filing Types (90 days)</h3>
            {Object.entries(data.filingTypeBreakdown).sort(([, a], [, b]) => b - a).map(([type, count], i, arr) => (
              <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none', fontSize: 13 }}>
                <span style={{ color: TEXT_DARK }}>{type}</span>
                <span style={{ fontWeight: 600, color: SLATE }}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
