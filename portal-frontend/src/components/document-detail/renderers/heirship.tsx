import { formatFieldValue } from '../../../lib/format-doc-type';

// --- Heirs Summary ---

export function HeirsSummaryRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((heir, i) => {
        if (typeof heir !== 'object' || heir === null) {
          return (
            <div key={i} style={{ padding: 8, background: '#EFF6FF', borderRadius: 4 }}>{String(heir)}</div>
          );
        }
        const h = heir as Record<string, unknown>;
        const name = String(h.name || 'Unknown');
        const relationship = h.relationship ? String(h.relationship) : '';
        const share = h.estimated_share || h.share ? String(h.estimated_share || h.share) : '';

        return (
          <div key={i} style={{
            background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 6,
            padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ fontWeight: 600, color: '#1E40AF' }}>{name}</span>
              {relationship && <span style={{ color: '#6B7280', fontSize: 12, marginLeft: 8 }}>({relationship})</span>}
            </div>
            {share && (
              <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '4px 10px', borderRadius: 4, fontWeight: 500 }}>
                {share}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Children & Spouses ---

export function ChildrenSpousesRenderer({ value, fieldName }: { value: unknown; fieldName?: string }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  const isSpouse = fieldName === 'spouses';
  const bg = isSpouse ? '#FAF5FF' : '#F0FDF4';
  const border = isSpouse ? '#A855F7' : '#22C55E';
  const text = isSpouse ? '#7C3AED' : '#166534';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((person, i) => {
        if (typeof person !== 'object' || person === null) {
          return (
            <div key={i} style={{ padding: 8, background: bg, borderRadius: 4 }}>{String(person)}</div>
          );
        }
        const p = person as Record<string, unknown>;
        const name = String(p.name || 'Unknown');
        const status = p.status ? String(p.status) : '';
        const address = p.address ? String(p.address) : '';
        const spouseName = p.spouse_name ? String(p.spouse_name) : '';
        const marriageDate = p.marriage_date ? String(p.marriage_date) : '';

        return (
          <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontWeight: 600, color: text }}>{name}</div>
            {status && <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' }}>{status}</div>}
            {address && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{address}</div>}
            {spouseName && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>Spouse: {spouseName}</div>}
            {marriageDate && <div style={{ fontSize: 11, color: '#9CA3AF' }}>Married: {marriageDate}</div>}
          </div>
        );
      })}
    </div>
  );
}

// --- Decedent ---

export function DecedentRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') {
    return value ? <div style={{ fontSize: 14 }}>{formatFieldValue(value)}</div> : null;
  }
  const d = value as Record<string, unknown>;

  return (
    <div style={{ background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 6, padding: '10px 12px' }}>
      {d.name && <div style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>{String(d.name)}</div>}
      {d.date_of_death && <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Date of Death: {String(d.date_of_death)}</div>}
      {d.date_of_birth && <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Date of Birth: {String(d.date_of_birth)}</div>}
      {d.cause && <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Cause: {String(d.cause)}</div>}
      {d.location && <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>Location: {formatFieldValue(d.location)}</div>}
    </div>
  );
}
