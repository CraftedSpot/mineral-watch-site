import { useSearchParams } from 'react-router-dom';
import { useProperties } from '../../hooks/useProperties';
import { useWells } from '../../hooks/useWells';
import { useModal } from '../../contexts/ModalContext';
import { updateSearchParam } from '../../lib/helpers';
import { TabBar } from './TabBar';
import { MODAL_TYPES, SLATE, DARK } from '../../lib/constants';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {properties.slice(0, 20).map((p) => (
          <button
            key={p.id}
            onClick={() => modal.open(MODAL_TYPES.PROPERTY, { propertyId: p.id })}
            style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '10px 16px', textAlign: 'left', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: DARK }}>
                {String(p.fields.Name || p.fields['Property Name'] || 'Untitled')}
              </div>
              <div style={{ fontSize: 12, color: SLATE }}>
                {p.fields.COUNTY} &middot; S{p.fields.SEC}-T{p.fields.TWN}-R{p.fields.RNG}
              </div>
            </div>
            <div style={{ fontSize: 11, color: SLATE }}>{p.id}</div>
          </button>
        ))}
      </div>
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
