import { formatFieldName } from '../../../lib/format-doc-type';

interface Props {
  value: unknown;
}

const PARTY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  grantors: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  grantees: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  lessors: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  lessees: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  lessor: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  lessee: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  assignors: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  assignees: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  assignor: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  assignee: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  heirs_summary: { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF' },
  children_living: { bg: '#F0FDF4', border: '#22C55E', text: '#166534' },
  spouses: { bg: '#FAF5FF', border: '#A855F7', text: '#7C3AED' },
};

function getColors(fieldName?: string) {
  if (fieldName && PARTY_COLORS[fieldName]) return PARTY_COLORS[fieldName];
  return { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' };
}

function PartyCard({ party, colors }: { party: unknown; colors: { bg: string; border: string; text: string } }) {
  if (typeof party === 'string') {
    return (
      <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '10px 12px' }}>
        <span style={{ fontWeight: 600, color: colors.text }}>{party}</span>
      </div>
    );
  }

  if (typeof party !== 'object' || party === null) return null;
  const p = party as Record<string, unknown>;
  const name = String(p.name || p.full_name || 'Unknown');
  const nameVariations = Array.isArray(p.name_variations) ? p.name_variations : [];
  const capacity = p.capacity ? String(p.capacity) : '';
  const entityName = p.entity_name ? String(p.entity_name) : '';
  const entityType = p.entity_type ? String(p.entity_type) : '';
  const trustDate = p.trust_date ? String(p.trust_date) : '';
  const address = [p.address, p.city, p.state].filter(Boolean).join(', ');
  const maritalStatus = p.marital_status ? String(p.marital_status) : '';
  const tenancy = p.tenancy ? String(p.tenancy).replace(/_/g, ' ').replace(/wros/gi, 'WROS') : '';

  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: colors.text }}>{name}</span>
        {capacity && (
          <span style={{ background: '#E5E7EB', color: '#374151', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
            {capacity}
          </span>
        )}
      </div>
      {entityName && (
        <div style={{ fontSize: 12, color: '#7C3AED', marginTop: 4, fontWeight: 500 }}>
          {entityName}{entityType ? ` (${entityType})` : ''}{trustDate ? ` dated ${trustDate}` : ''}
        </div>
      )}
      {address && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{address}</div>}
      {nameVariations.length > 0 && (
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' }}>
          Also known as: {nameVariations.join(', ')}
        </div>
      )}
      {(maritalStatus || tenancy) && (
        <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          {maritalStatus && <span style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' }}>{maritalStatus}</span>}
          {tenancy && <span style={{ fontSize: 11, color: '#6B7280', textTransform: 'capitalize' }}>{tenancy}</span>}
        </div>
      )}
    </div>
  );
}

export function PartiesRenderer({ value, fieldName }: Props & { fieldName?: string }) {
  const colors = getColors(fieldName);
  const items = Array.isArray(value) ? value : (value != null ? [value] : []);
  if (items.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: -2 }}>
        AI-extracted — verify against original (edit in chain view)
      </div>
      {items.map((party, i) => (
        <PartyCard key={i} party={party} colors={colors} />
      ))}
    </div>
  );
}
