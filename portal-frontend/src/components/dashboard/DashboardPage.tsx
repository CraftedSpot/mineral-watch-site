import { useSearchParams } from 'react-router-dom';
import { useProperties } from '../../hooks/useProperties';
import { useWells } from '../../hooks/useWells';
import { useModal } from '../../contexts/ModalContext';
import { updateSearchParam, formatTRS } from '../../lib/helpers';
import { TabBar } from './TabBar';
import { MODAL_TYPES, SLATE, DARK } from '../../lib/constants';

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

const TABS = ['properties', 'wells', 'documents', 'activity', 'tools'] as const;
type TabId = (typeof TABS)[number];

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'properties';

  const setTab = (tab: string) => {
    setSearchParams(updateSearchParam('tab', tab), { replace: true });
  };

  return (
    <div style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
        <TabBar tabs={TABS} active={activeTab} onChange={setTab} />

        <div style={{ padding: '24px', maxWidth: 1400, margin: '0 auto' }}>
          {activeTab === 'properties' && <PropertiesTestTab />}
          {activeTab === 'wells' && <WellsTestTab />}
          {activeTab === 'documents' && (
            <PlaceholderTab name="Documents" description="Uploaded documents with AI extraction." />
          )}
          {activeTab === 'activity' && (
            <PlaceholderTab name="Activity" description="Alert feed showing well status changes, new filings." />
          )}
          {activeTab === 'tools' && (
            <PlaceholderTab name="Tools" description="Revenue estimator, production analysis, and OCC filing viewer." />
          )}
        </div>
    </div>
  );
}

/** Temporary: Properties tab with test modal buttons wired to real data */
function PropertiesTestTab() {
  const { data: properties, loading, error } = useProperties();
  const modal = useModal();

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 12, color: '#94a3b8', background: '#f8fafc', display: 'inline-block', padding: '6px 16px', borderRadius: 6 }}>
        Phase 2b test — click a property to open modal
      </div>
      {loading && <div style={{ color: SLATE, padding: 20 }}>Loading properties...</div>}
      {error && <div style={{ color: '#dc2626', padding: 20 }}>{error}</div>}
      {!loading && properties.length === 0 && <div style={{ color: SLATE, padding: 20 }}>No properties found</div>}
      {!loading && properties.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={thStyle}>County</th>
              <th style={thStyle}>Legal</th>
              <th style={thStyle}>Group</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total Acres</th>
              <th style={thStyle}>Notes</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Links</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => {
              const f = p.fields;
              const totalAcres = Number(f['RI Acres'] || 0) + Number(f['WI Acres'] || 0);
              const notes = String(f.Notes || '');
              const group = f.Group ? String(f.Group) : null;
              const ec = group ? getEntityColor(group) : null;
              const counts = (p as unknown as Record<string, unknown>)._linkCounts as { wells?: number; documents?: number; filings?: number } | undefined;
              return (
                <tr
                  key={p.id}
                  onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.id })}
                  style={{ borderBottom: '1px solid #e2e8f0', cursor: 'pointer' }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td style={tdStyle}>{String(f.COUNTY)}</td>
                  <td style={{ ...tdStyle, color: '#C05621', fontWeight: 600 }}>
                    {formatTRS(f.SEC as string, f.TWN as string, f.RNG as string)}
                  </td>
                  <td style={tdStyle}>
                    {ec ? (
                      <span style={{ background: ec.bg, color: ec.text, padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                        {group}
                      </span>
                    ) : <span style={{ color: '#A0AEC0' }}>&mdash;</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {totalAcres > 0 ? totalAcres.toFixed(2) : <span style={{ color: '#A0AEC0' }}>&mdash;</span>}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 300 }}>
                    {notes ? (
                      <span style={{ color: SLATE, fontSize: 13 }}>
                        {notes.length > 80 ? notes.substring(0, 80) + '...' : notes}
                      </span>
                    ) : <span style={{ color: '#A0AEC0' }}>&mdash;</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {counts && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', fontSize: 12 }}>
                        {counts.wells != null && counts.wells > 0 && <span style={{ color: '#C05621' }}>&#9650;{counts.wells}</span>}
                        {counts.documents != null && counts.documents > 0 && <span style={{ color: SLATE }}>&#128196;{counts.documents}</span>}
                        {counts.filings != null && counts.filings > 0 && <span style={{ color: SLATE }}>&#128221;{counts.filings}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Temporary: Wells tab with test modal buttons wired to real data */
function WellsTestTab() {
  const { data: wells, loading, error } = useWells();
  const modal = useModal();

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 12, color: '#94a3b8', background: '#f8fafc', display: 'inline-block', padding: '6px 16px', borderRadius: 6 }}>
        Phase 2b test — click a well to open modal
      </div>
      {loading && <div style={{ color: SLATE, padding: 20 }}>Loading wells...</div>}
      {error && <div style={{ color: '#dc2626', padding: 20 }}>{error}</div>}
      {!loading && wells.length === 0 && <div style={{ color: SLATE, padding: 20 }}>No wells found</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {wells.slice(0, 20).map((w) => (
          <button
            key={w.id}
            onClick={() => modal.open(MODAL_TYPES.WELL, { wellId: w.id, apiNumber: w.apiNumber, wellName: w.well_name })}
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '10px 16px', textAlign: 'left', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: DARK }}>{w.well_name}</div>
              <div style={{ fontSize: 12, color: SLATE }}>{w.operator} &middot; {w.county} &middot; {w.apiNumber}</div>
            </div>
            <div style={{ fontSize: 11, color: SLATE }}>{w.occ_well_status}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
};
const tdStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: '#1a2332',
};

function PlaceholderTab({ name, description }: { name: string; description: string }) {
  return (
    <div style={{
      padding: '60px 24px', textAlign: 'center',
      border: '2px dashed #e2e8f0', borderRadius: 12,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>
        {name}
      </div>
      <div style={{ fontSize: 14, color: SLATE, maxWidth: 500, margin: '0 auto' }}>
        {description}
      </div>
      <div style={{
        marginTop: 16, fontSize: 12, color: '#94a3b8',
        background: '#f8fafc', display: 'inline-block', padding: '6px 16px',
        borderRadius: 6,
      }}>
        Phase 2c implementation pending
      </div>
    </div>
  );
}
