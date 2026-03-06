import { BORDER } from '../../../lib/constants';

// --- Primary Term (blue card with term + dates) ---

export function PrimaryTermRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const years = v.years; const months = v.months;
  const commence = v.commencement_date ? String(v.commencement_date) : '';
  const expire = v.expiration_date ? String(v.expiration_date) : '';
  const term = [years && `${years} years`, months && `${months} months`].filter(Boolean).join(', ');
  if (!term && !commence && !expire) return null;

  return (
    <div style={{ background: '#DBEAFE', border: '1px solid #3B82F6', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {term && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Term</span>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1E40AF' }}>{term}</div>
          </div>
        )}
        {commence && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Commencement</span>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1E40AF' }}>{commence}</div>
          </div>
        )}
        {expire && (
          <div>
            <span style={{ color: '#6B7280', fontSize: 12 }}>Expiration</span>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#DC2626' }}>{expire}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Consideration (green card with PAID-UP/DELAY RENTAL badge) ---

export function ConsiderationRenderer({ value, docType }: { value: unknown; docType?: string }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const isPaidUp = v.is_paid_up_lease;
  const bonusPerAcre = v.bonus_per_acre;
  const totalBonus = v.total_bonus;
  const delayRental = v.delay_rental_per_acre;
  const bonusStated = v.bonus_stated ? String(v.bonus_stated) : '';

  // Only use special rendering for leases
  if (!docType?.includes('lease')) return null;

  return (
    <div style={{ background: '#F0FDF4', border: '1px solid #22C55E', borderRadius: 8, padding: 14 }}>
      <div style={{ marginBottom: 8 }}>
        {isPaidUp === true && (
          <span style={{ background: '#22C55E', color: 'white', padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600 }}>PAID-UP LEASE</span>
        )}
        {isPaidUp === false && (
          <span style={{ background: '#F59E0B', color: 'white', padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600 }}>DELAY RENTAL</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13 }}>
        {bonusPerAcre != null && (
          <div><span style={{ color: '#6B7280', fontSize: 12 }}>Bonus/Acre</span><div style={{ fontWeight: 600, color: '#166534' }}>${Number(bonusPerAcre).toLocaleString()}</div></div>
        )}
        {totalBonus != null && (
          <div><span style={{ color: '#6B7280', fontSize: 12 }}>Total Bonus</span><div style={{ fontWeight: 600, color: '#166534' }}>${Number(totalBonus).toLocaleString()}</div></div>
        )}
        {delayRental != null && (
          <div><span style={{ color: '#6B7280', fontSize: 12 }}>Delay Rental/Acre</span><div style={{ fontWeight: 600, color: '#92400E' }}>${Number(delayRental).toLocaleString()}</div></div>
        )}
      </div>
      {bonusStated && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#374151', fontStyle: 'italic' }}>"{bonusStated}"</div>
      )}
    </div>
  );
}

// --- Royalty (three colored blocks: Oil/Gas/Other) ---

export function RoyaltyRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const oil = v.oil as Record<string, unknown> | undefined;
  const gas = v.gas as Record<string, unknown> | undefined;
  const other = v.other_minerals as Record<string, unknown> | undefined;
  if (!oil && !gas && !other) return null;

  const blocks: Array<{ label: string; bg: string; color: string; data: Record<string, unknown> }> = [];
  if (oil) blocks.push({ label: 'Oil', bg: '#1F2937', color: 'white', data: oil });
  if (gas) blocks.push({ label: 'Gas', bg: '#3B82F6', color: 'white', data: gas });
  if (other) blocks.push({ label: 'Other', bg: '#6B7280', color: 'white', data: other });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {blocks.map((b) => (
        <div key={b.label} style={{ background: b.bg, color: b.color, borderRadius: 8, padding: '12px 16px', minWidth: 100, textAlign: 'center' }}>
          <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>{b.label}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{String(b.data.fraction || b.data.rate || '-')}</div>
          {b.data.decimal != null && (
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{String(b.data.decimal)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- Depth Clause (green/red card) ---

export function DepthClauseRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const has = v.has_depth_clause;
  const bg = has ? '#DCFCE7' : '#FEE2E2';
  const border = has ? '#22C55E' : '#EF4444';
  const icon = has ? '\u2705' : '\u274C';
  const labelColor = has ? '#166534' : '#991B1B';

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, color: labelColor, fontSize: 14 }}>Depth Clause</span>
        {v.source && <span style={{ background: 'rgba(0,0,0,0.08)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{String(v.source)}</span>}
      </div>
      {has ? (
        <div style={{ fontSize: 13, color: '#374151' }}>
          {v.trigger && <div>Trigger: {String(v.trigger)}</div>}
          {v.depth_retained && <div>Retained: {String(v.depth_retained)}</div>}
          {v.depth_feet != null && <div>Depth: {Number(v.depth_feet).toLocaleString()} ft</div>}
          {v.reference_point && <div>Reference: {String(v.reference_point)}</div>}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: '#991B1B', fontStyle: 'italic' }}>No depth clause — lessee retains all depths</div>
      )}
    </div>
  );
}

// --- Pugh Clause (green/red card with H/V badges) ---

export function PughClauseRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const has = v.has_pugh_clause;
  const bg = has ? '#DCFCE7' : '#FEE2E2';
  const border = has ? '#22C55E' : '#EF4444';
  const icon = has ? '\u2705' : '\u274C';
  const labelColor = has ? '#166534' : '#991B1B';
  const hPugh = v.horizontal_pugh;
  const vPugh = v.vertical_pugh;

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, color: labelColor, fontSize: 14 }}>Pugh Clause</span>
      </div>
      {has ? (
        <>
          {v.type && <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Type: {String(v.type)}</div>}
          {v.trigger && <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Trigger: {String(v.trigger)}</div>}
          {v.releases && <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>{String(v.releases)}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: hPugh ? '#166534' : '#D1D5DB', color: hPugh ? 'white' : '#6B7280',
            }}>Horizontal Pugh</span>
            <span style={{
              padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: vPugh ? '#166534' : '#D1D5DB', color: vPugh ? 'white' : '#6B7280',
            }}>Vertical Pugh</span>
          </div>
          {v.unit_change_provision && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>Unit Change: {String(v.unit_change_provision)}</div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#991B1B', fontStyle: 'italic' }}>No Pugh clause — non-pooled acreage NOT automatically released</div>
      )}
    </div>
  );
}

// --- Deductions Clause (green/red with prohibited chips) ---

export function DeductionsClauseRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const has = v.has_no_deductions_clause;
  const bg = has ? '#DCFCE7' : '#FEE2E2';
  const border = has ? '#22C55E' : '#EF4444';
  const icon = has ? '\u2705' : '\u274C';
  const labelColor = has ? '#166534' : '#991B1B';
  const prohibited = Array.isArray(v.prohibited_deductions) ? v.prohibited_deductions : [];

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, color: labelColor, fontSize: 14 }}>No-Deductions Clause</span>
      </div>
      {has ? (
        <>
          {v.scope && <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>{String(v.scope)}</div>}
          {prohibited.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {prohibited.map((d, i) => (
                <span key={i} style={{ background: '#FEE2E2', border: '1px solid #EF4444', color: '#DC2626', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                  {String(d)}
                </span>
              ))}
            </div>
          )}
          {v.exception && <div style={{ fontSize: 12, color: '#6B7280' }}>Exception: {String(v.exception)}</div>}
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#991B1B', fontStyle: 'italic' }}>No no-deductions clause — post-production costs may be deducted from royalty</div>
      )}
    </div>
  );
}

// --- Shut-In Provisions (grey card with limitation sub-card) ---

export function ShutInProvisionsRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const amount = v.shut_in_royalty;
  const perAcre = v.per_acre;
  const trigger = v.trigger_period_days;
  const frequency = v.payment_frequency ? String(v.payment_frequency) : '';
  const limitation = v.limitation as Record<string, unknown> | undefined;

  return (
    <div style={{ background: '#F9FAFB', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, marginBottom: 8 }}>
        {amount != null && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Amount</span><div style={{ fontWeight: 600 }}>${String(amount)}</div></div>}
        {perAcre != null && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Per Acre</span><div style={{ fontWeight: 600 }}>${String(perAcre)}</div></div>}
        {trigger != null && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Trigger Period</span><div style={{ fontWeight: 600 }}>{String(trigger)} days</div></div>}
        {frequency && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Frequency</span><div style={{ fontWeight: 500 }}>{frequency}</div></div>}
      </div>
      {limitation && (
        (() => {
          const hasLimit = limitation.has_limitation;
          const limitBg = hasLimit ? '#DCFCE7' : '#FEE2E2';
          const limitBorder = hasLimit ? '#22C55E' : '#EF4444';
          const limitColor = hasLimit ? '#166534' : '#991B1B';
          return (
            <div style={{ background: limitBg, border: `1px solid ${limitBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
              {hasLimit ? (
                <span style={{ color: limitColor }}>Shut-in limited to {limitation.consecutive_years && `${limitation.consecutive_years} consecutive years`}</span>
              ) : (
                <span style={{ color: limitColor, fontStyle: 'italic' }}>No shut-in limitation — lessee can hold indefinitely</span>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}

// --- Exhibit A (blue card with provision chips) ---

export function ExhibitARenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const hasExhibit = v.has_exhibit_a;
  const provisions = Array.isArray(v.provisions) ? v.provisions : [];
  const controls = v.controls_over_printed_form;

  if (hasExhibit === false) {
    return (
      <div style={{ background: '#F3F4F6', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>Standard printed form only — no protective addendum</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#DBEAFE', border: '1px solid #3B82F6', borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>📋</span>
        <span style={{ fontWeight: 600, color: '#1E40AF', fontSize: 14 }}>Exhibit A</span>
        {controls && <span style={{ background: '#1E40AF', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>Controls Over Printed Form</span>}
      </div>
      {provisions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {provisions.map((p, i) => (
            <span key={i} style={{ background: 'white', border: '1px solid #3B82F6', color: '#1E40AF', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
              {String(p)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Pooling Provisions (lease-specific with anti-Pugh warning) ---

export function PoolingProvisionsRenderer({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const hasRight = v.lessee_has_pooling_right;
  const poolingType = v.pooling_type ? String(v.pooling_type) : '';
  const antiPugh = v.anti_pugh_language_detected;
  const pughLimits = v.pugh_clause_limits_pooling;

  return (
    <div style={{ background: '#F9FAFB', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {hasRight != null && (
          <span style={{
            background: hasRight ? '#22C55E' : '#EF4444', color: 'white',
            padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600,
          }}>{hasRight ? 'Lessee Has Pooling Rights' : 'No Pooling Rights'}</span>
        )}
        {poolingType && (
          <span style={{ background: '#E5E7EB', color: '#374151', padding: '4px 10px', borderRadius: 16, fontSize: 12 }}>{poolingType}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, marginBottom: 8 }}>
        {v.vertical_oil_well_max_acres != null && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Vertical Oil Max</span><div style={{ fontWeight: 500 }}>{String(v.vertical_oil_well_max_acres)} acres</div></div>}
        {v.gas_horizontal_max_acres != null && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Gas/Hz Max</span><div style={{ fontWeight: 500 }}>{String(v.gas_horizontal_max_acres)} acres</div></div>}
        {v.allocation_method && <div><span style={{ color: '#6B7280', fontSize: 12 }}>Allocation</span><div style={{ fontWeight: 500 }}>{String(v.allocation_method)}</div></div>}
      </div>
      {antiPugh && (
        <div style={{ background: '#FEE2E2', border: '1px solid #EF4444', borderRadius: 6, padding: '8px 12px', marginBottom: 6, fontSize: 12, color: '#991B1B' }}>
          ⚠️ Anti-Pugh Language Detected — pooled acreage may be held even after primary term
        </div>
      )}
      {pughLimits && (
        <div style={{ background: '#DCFCE7', border: '1px solid #22C55E', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#166534' }}>
          ✓ Pugh Clause Limits Pooling — protects non-pooled acreage
        </div>
      )}
    </div>
  );
}

// --- Prohibited Deductions (red tag chips) ---

export function ProhibitedDeductionsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {value.map((d, i) => (
        <span key={i} style={{ background: '#FEE2E2', border: '1px solid #EF4444', color: '#DC2626', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
          {String(d)}
        </span>
      ))}
    </div>
  );
}

// --- Provisions (blue tag chips for exhibit_a) ---

export function ProvisionsRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {value.map((p, i) => (
        <span key={i} style={{ background: 'white', border: '1px solid #3B82F6', color: '#1E40AF', padding: '3px 10px', borderRadius: 4, fontSize: 12 }}>
          {String(p)}
        </span>
      ))}
    </div>
  );
}
