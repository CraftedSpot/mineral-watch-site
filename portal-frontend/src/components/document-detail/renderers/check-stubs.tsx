import { useState } from 'react';
import { BORDER, SLATE, DARK } from '../../../lib/constants';

function fmtCurrency(val: unknown): string {
  if (val == null) return '-';
  const n = parseFloat(String(val));
  if (isNaN(n)) return String(val);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencyColor(val: unknown): string {
  if (val == null) return DARK;
  const n = parseFloat(String(val));
  return !isNaN(n) && n < 0 ? '#DC2626' : DARK;
}

// --- Check Stub Well Revenue (enhanced, product-per-well) ---

export function CheckStubWellRevenue({ value, docType }: { value: unknown; docType?: string }) {
  const wells = Array.isArray(value) ? value : [];
  if (wells.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {wells.map((well: Record<string, unknown>, wIdx: number) => (
        <WellCard key={wIdx} well={well} wIdx={wIdx} />
      ))}
    </div>
  );
}

function WellCard({ well, wIdx }: { well: Record<string, unknown>; wIdx: number }) {
  const wellName = String(well.well_name || 'Unknown Well');
  const wellNum = well.well_number ? ` (#${well.well_number})` : '';
  const api = well.api_number ? String(well.api_number) : '';
  const months = Array.isArray(well.production_months) ? well.production_months.join(', ') : (well.production_months ? String(well.production_months) : '');
  const loc = [well.county, well.state].filter(Boolean).join(', ');
  const products = Array.isArray(well.products) ? well.products as Array<Record<string, unknown>> : [];

  // No products: bonus payment or simple payment without production detail
  if (products.length === 0) {
    const hasProduction = well.product_type || well.product || well.gross_volume != null;

    // Bonus/consideration payment — clean card with just the amount
    if (!hasProduction && well.well_owner_total != null) {
      return (
        <div style={{ background: '#ECFDF5', border: '1px solid #10B981', borderRadius: 10, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span style={{ background: '#D1FAE5', color: '#065F46', padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Bonus Payment
              </span>
              {loc && <span style={{ fontSize: 13, color: '#6B7280', marginLeft: 10 }}>{loc}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#166534' }}>
              {fmtCurrency(well.well_owner_total)}
            </div>
          </div>
        </div>
      );
    }

    // Old-style flat row for stubs with product info but no products array
    return (
      <div style={{ background: '#F9FAFB', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 700, color: DARK, fontSize: 15, marginBottom: 8 }}>{wellName}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 13 }}>
          <div><span style={{ color: SLATE }}>Product:</span> {String(well.product_type || well.product || '\u2014')}</div>
          <div><span style={{ color: SLATE }}>Volume:</span> {well.gross_volume != null ? Number(well.gross_volume).toLocaleString() : '\u2014'}</div>
          <div><span style={{ color: SLATE }}>Gross:</span> {fmtCurrency(well.gross_value)}</div>
          <div><span style={{ color: SLATE }}>Net:</span> <strong style={{ color: '#166534' }}>{fmtCurrency(well.net_value)}</strong></div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#F9FAFB', border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16 }}>
      {/* Well header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <span style={{ fontWeight: 700, color: DARK, fontSize: 15 }}>{wellName}</span>
          {wellNum && <span style={{ color: SLATE, fontSize: 14 }}>{wellNum}</span>}
          {api && <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#6B7280', marginLeft: 8, background: '#F3F4F6', padding: '2px 6px', borderRadius: 3 }}>{api}</span>}
        </div>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          {loc ? `${loc}` : ''}{loc && months ? ' \u2022 ' : ''}{months ? `Prod: ${months}` : ''}
        </div>
      </div>

      {/* Products table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'white', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', minWidth: 640 }}>
          <thead style={{ background: '#F3F4F6' }}>
            <tr>
              {['Product', 'Volume', 'Price', 'Decimal', 'Purchaser', 'Gross', 'Deductions', 'Taxes', 'Owner Amt'].map((h) => (
                <th key={h} style={{
                  padding: '10px 8px',
                  textAlign: h === 'Product' || h === 'Purchaser' ? 'left' : 'right',
                  fontWeight: 600, color: '#374151', fontSize: 12,
                  textTransform: 'uppercase', letterSpacing: '0.3px',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p, pIdx) => (
              <ProductRow key={pIdx} product={p} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Well total */}
      {well.well_owner_total != null && (
        <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 700, fontSize: 15, color: DARK }}>
          Well Total: <span style={{ color: '#166534' }}>{fmtCurrency(well.well_owner_total)}</span>
        </div>
      )}
    </div>
  );
}

function ProductRow({ product }: { product: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const p = product;
  const prodLabel = String(p.product_type || 'Unknown').charAt(0).toUpperCase() + String(p.product_type || '').slice(1);
  const vol = p.volume != null ? parseFloat(String(p.volume)).toLocaleString('en-US') + (p.volume_unit ? ' ' + p.volume_unit : '') : '-';
  const price = p.price_per_unit != null ? '$' + parseFloat(String(p.price_per_unit)).toFixed(2) : '-';
  const dec = p.decimal_interest != null ? String(p.decimal_interest) : '-';
  const purchaser = p.purchaser ? String(p.purchaser) : '-';
  const hasDetail = (Array.isArray(p.deductions) && p.deductions.length > 0) || (Array.isArray(p.taxes) && p.taxes.length > 0);

  return (
    <>
      <tr
        style={{ borderBottom: `1px solid ${BORDER}`, cursor: hasDetail ? 'pointer' : undefined }}
        onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
      >
        <td style={{ padding: '10px 8px', fontWeight: 600, fontSize: 13 }}>
          {hasDetail && <span style={{ fontSize: 11, color: '#9CA3AF', marginRight: 4 }}>{expanded ? '\u25BC' : '\u25B6'}</span>}
          {prodLabel}
        </td>
        <td style={{ padding: '10px 8px', textAlign: 'right' }}>{vol}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right' }}>{price}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{dec}</td>
        <td style={{ padding: '10px 8px', fontSize: 12 }}>{purchaser}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtCurrency(p.gross_sales)}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right', color: currencyColor(p.total_deductions) }}>{fmtCurrency(p.total_deductions)}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right', color: currencyColor(p.total_taxes) }}>{fmtCurrency(p.total_taxes)}</td>
        <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#166534' }}>{fmtCurrency(p.owner_amount)}</td>
      </tr>
      {expanded && hasDetail && (
        <tr>
          <td colSpan={9} style={{ padding: 0 }}>
            <div style={{ background: '#FEFCE8', padding: '10px 14px', borderTop: `1px dashed ${BORDER}` }}>
              {Array.isArray(p.deductions) && p.deductions.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Deductions</div>
                  {(p.deductions as Array<Record<string, unknown>>).map((d, di) => (
                    <div key={di} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                      <span style={{ color: '#6B7280' }}>
                        {String(d.raw_label || '')}
                        {d.normalized_category && (
                          <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontSize: 11, marginLeft: 6 }}>
                            {String(d.normalized_category)}
                          </span>
                        )}
                      </span>
                      <span style={{ color: currencyColor(d.amount) }}>{fmtCurrency(d.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(p.taxes) && p.taxes.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1E40AF', marginBottom: 4 }}>Taxes</div>
                  {(p.taxes as Array<Record<string, unknown>>).map((t, ti) => (
                    <div key={ti} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                      <span style={{ color: '#6B7280' }}>
                        {String(t.raw_label || '')}
                        {t.normalized_type && (
                          <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '2px 8px', borderRadius: 4, fontSize: 11, marginLeft: 6 }}>
                            {String(t.normalized_type)}
                          </span>
                        )}
                      </span>
                      <span style={{ color: currencyColor(t.amount) }}>{fmtCurrency(t.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- Check Summary ---

export function CheckStubSummary({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  const summary = value as Record<string, unknown>;

  const items = [
    { label: 'Gas Net Revenue', value: summary.gas_net_revenue ?? summary.gas_revenue ?? summary.total_gas },
    { label: 'Oil Net Revenue', value: summary.oil_net_revenue ?? summary.oil_revenue ?? summary.total_oil },
    { label: 'Liquids Net Revenue', value: summary.liquids_net_revenue ?? summary.ngl_revenue ?? summary.total_ngl },
    { label: 'Total Net Revenue', value: summary.total_net_revenue ?? summary.total_net ?? summary.check_amount ?? summary.total },
  ].filter((item, i) => item.value != null || i === 3); // Always show Total

  if (items.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
      {items.map((item, i) => {
        const isTotal = item.label === 'Total Net Revenue';
        return (
          <div key={i} style={{
            background: isTotal ? '#ECFDF5' : '#F9FAFB',
            border: `1px solid ${isTotal ? '#10B981' : BORDER}`,
            borderRadius: 8, padding: 14,
          }}>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: isTotal ? 20 : 16, fontWeight: isTotal ? 700 : 600, color: isTotal ? '#166534' : DARK }}>
              {fmtCurrency(item.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Operating Expenses ---

export function OperatingExpensesRenderer({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  let totalOwner = 0;
  value.forEach((exp: Record<string, unknown>) => {
    totalOwner += exp.owner_amount != null ? parseFloat(String(exp.owner_amount)) : 0;
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'white', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        <thead style={{ background: '#FEF3C7' }}>
          <tr>
            {['Description', 'Vendor', 'Category', 'Gross', 'Owner Amt'].map((h) => (
              <th key={h} style={{
                padding: '10px 8px',
                textAlign: h === 'Gross' || h === 'Owner Amt' ? 'right' : 'left',
                fontWeight: 600, color: '#92400E', fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.3px',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.map((exp: Record<string, unknown>, i: number) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ padding: '10px 8px' }}>{String(exp.description || '')}</td>
              <td style={{ padding: '10px 8px', color: '#6B7280' }}>{String(exp.vendor || '-')}</td>
              <td style={{ padding: '10px 8px' }}>
                {exp.category ? (
                  <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                    {String(exp.category)}
                  </span>
                ) : '-'}
              </td>
              <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtCurrency(exp.gross_amount)}</td>
              <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: currencyColor(exp.owner_amount) }}>{fmtCurrency(exp.owner_amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#FEF3C7', fontWeight: 700 }}>
            <td colSpan={4} style={{ padding: '10px 8px', textAlign: 'right', fontSize: 13 }}>Total Operating Expenses:</td>
            <td style={{ padding: '10px 8px', textAlign: 'right', fontSize: 14 }}>{fmtCurrency(totalOwner)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
