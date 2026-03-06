import { formatFieldName } from '../../../lib/format-doc-type';

// --- Election Options ---

interface ElectionProps { value: unknown }

export function ElectionOptionsRenderer({ value }: ElectionProps) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {value.map((option: Record<string, unknown>, i) => {
        const optType = String(option.option_type || option.type || '').toLowerCase();
        const isDefault = option.is_default === true;

        let bg: string, border: string, text: string, borderWidth = '1px';
        if (isDefault) {
          bg = '#DCFCE7'; border = '#22C55E'; text = '#166534'; borderWidth = '2px';
        } else if (optType === 'participate') {
          bg = '#EFF6FF'; border = '#3B82F6'; text = '#1E40AF';
        } else if (optType === 'non_consent') {
          bg = '#FEE2E2'; border = '#EF4444'; text = '#DC2626';
        } else if (optType.includes('cash')) {
          bg = '#FEF3C7'; border = '#F59E0B'; text = '#92400E';
        } else {
          bg = '#F3F4F6'; border = '#9CA3AF'; text = '#4B5563';
        }

        return (
          <div key={i} style={{ background: bg, border: `${borderWidth} solid ${border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: text, fontSize: 14 }}>
                Option {String(option.option_number || i + 1)}
                {optType ? ` - ${formatFieldName(optType)}` : ''}
              </div>
              {isDefault && (
                <span style={{ background: '#22C55E', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                  DEFAULT
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, fontSize: 13 }}>
              {option.bonus_per_nma != null && (
                <div><span style={{ color: '#6B7280' }}>Bonus:</span> <strong>${Number(option.bonus_per_nma).toLocaleString()}/NMA</strong></div>
              )}
              {option.bonus_per_acre != null && (
                <div><span style={{ color: '#6B7280' }}>Bonus:</span> <strong>${String(option.bonus_per_acre)}/acre</strong></div>
              )}
              {option.cost_per_nma != null && (
                <div><span style={{ color: '#6B7280' }}>Est. Cost:</span> <strong>${Number(option.cost_per_nma).toLocaleString()}/NMA</strong></div>
              )}
              {option.royalty_rate != null && (
                <div><span style={{ color: '#6B7280' }}>Royalty:</span> <strong>{String(option.royalty_rate)}</strong></div>
              )}
              {option.excess_royalty != null && (
                <div><span style={{ color: '#6B7280' }}>Excess Royalty:</span> <strong>{String(option.excess_royalty)}</strong></div>
              )}
              {option.nri_delivered != null && (
                <div><span style={{ color: '#6B7280' }}>NRI Delivered:</span> <strong>{String(option.nri_delivered)}</strong></div>
              )}
              {option.risk_penalty_percentage != null && (
                <div><span style={{ color: '#DC2626' }}>Risk Penalty:</span> <strong style={{ color: '#DC2626' }}>{String(option.risk_penalty_percentage)}%</strong></div>
              )}
            </div>
            {option.description && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#4B5563', borderTop: `1px solid ${border}`, paddingTop: 8 }}>
                {String(option.description)}
              </div>
            )}
            {option.notes && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#6B7280', fontStyle: 'italic' }}>
                {String(option.notes)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Formations Chips ---

export function FormationsChips({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {value.map((formation, i) => {
        const name = typeof formation === 'object' && formation
          ? String((formation as Record<string, unknown>).name || (formation as Record<string, unknown>).formation || 'Unknown')
          : String(formation);
        const f = typeof formation === 'object' && formation ? formation as Record<string, unknown> : null;
        const depthFrom = f?.depth_from ?? f?.depth_from_ft;
        const depthTo = f?.depth_to ?? f?.depth_to_ft;
        const depthInfo = typeof depthFrom === 'number' && typeof depthTo === 'number'
          ? ` (${depthFrom.toLocaleString()}'-${depthTo.toLocaleString()}')`
          : '';

        return (
          <div key={i} style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 6, padding: '8px 12px' }}>
            <span style={{ fontWeight: 500, color: '#1E40AF' }}>{name}</span>
            {depthInfo && <span style={{ color: '#6B7280', fontSize: 12 }}>{depthInfo}</span>}
          </div>
        );
      })}
    </div>
  );
}

// --- Target Formations ---

export function TargetFormationsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {value.map((formation, i) => {
        const f = typeof formation === 'object' && formation ? formation as Record<string, unknown> : null;
        const name = f ? String(f.name || f.formation_name || '') : String(formation);
        const isPrimary = f?.is_primary === true;
        const commonSource = f?.common_source ? String(f.common_source) : '';
        const qualifier = f?.qualifier ? String(f.qualifier) : '';
        if (!name) return null;

        return (
          <div key={i} style={{
            background: isPrimary ? '#DCFCE7' : '#F3F4F6',
            border: `1px solid ${isPrimary ? '#22C55E' : '#D1D5DB'}`,
            borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, color: isPrimary ? '#166534' : '#374151', fontSize: 14 }}>{name}</span>
              {qualifier && <span style={{ color: '#6B7280', fontSize: 12 }}>({qualifier})</span>}
              {isPrimary && (
                <span style={{ background: '#166534', color: 'white', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>
                  PRIMARY
                </span>
              )}
            </div>
            {commonSource && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{commonSource}</div>}
          </div>
        );
      })}
    </div>
  );
}

// --- Existing Wells ---

export function ExistingWellsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((well, i) => {
        if (typeof well !== 'object' || well === null) {
          return (
            <div key={i} style={{ background: '#F0FDF4', border: '1px solid #22C55E', borderRadius: 6, padding: '10px 12px' }}>
              <span style={{ fontWeight: 500, color: '#166534' }}>{String(well)}</span>
            </div>
          );
        }
        const w = well as Record<string, unknown>;
        const wellName = String(w.well_name || w.name || 'Unknown Well');
        const apiNumber = w.api_number || w.api ? String(w.api_number || w.api) : '';
        const classification = String(w.well_classification || w.classification || w.type || '');
        const classLower = classification.toLowerCase();
        const classBg = classLower === 'oil' ? '#FEE2E2' : '#DBEAFE';
        const classColor = classLower === 'oil' ? '#92400E' : '#1E40AF';

        return (
          <div key={i} style={{
            background: '#F0FDF4', border: '1px solid #22C55E', borderRadius: 6,
            padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ fontWeight: 500, color: '#166534' }}>{wellName}</span>
              {apiNumber && <span style={{ color: '#6B7280', fontSize: 12, marginLeft: 8 }}>API: {apiNumber}</span>}
            </div>
            {classification && (
              <span style={{ background: classBg, color: classColor, padding: '2px 8px', borderRadius: 4, fontSize: 11, textTransform: 'uppercase' }}>
                {classification}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
