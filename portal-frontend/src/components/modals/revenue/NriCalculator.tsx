import { useState, useCallback } from 'react';
import { BORDER, DARK, SLATE, ORANGE } from '../../../lib/constants';

interface NriCalculatorProps {
  prefillAcres: number | null;
  onCalculate: (decimal: number | null) => void;
  currentDecimal: number | null;
}

const UNIT_SIZES = [640, 320, 160, 80];
const ROYALTY_RATES = [
  { label: '1/8 (12.5%)', value: 0.125 },
  { label: '3/16 (18.75%)', value: 0.1875 },
  { label: '1/5 (20%)', value: 0.2 },
  { label: '1/4 (25%)', value: 0.25 },
];

export function NriCalculator({ prefillAcres, onCalculate, currentDecimal }: NriCalculatorProps) {
  const [acres, setAcres] = useState(prefillAcres?.toString() || '');
  const [unitSize, setUnitSize] = useState(640);
  const [royaltyRate, setRoyaltyRate] = useState(0.1875);

  const calculated = useCallback(() => {
    const a = parseFloat(acres);
    if (isNaN(a) || a <= 0) return null;
    return (a / unitSize) * royaltyRate;
  }, [acres, unitSize, royaltyRate]);

  const result = calculated();

  return (
    <div style={{
      border: `1px solid #fbbf24`, borderRadius: 8, padding: 14,
      background: '#fffbeb', marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
        NRI Calculator — No decimal interest found
      </div>
      <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10, lineHeight: 1.4 }}>
        Enter your net mineral acres to estimate your decimal interest.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Acres */}
        <div style={{ flex: '1 1 100px' }}>
          <label style={labelStyle}>Net Mineral Acres</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={acres}
            onChange={(e) => setAcres(e.target.value)}
            placeholder="e.g. 10"
            style={inputStyle}
          />
        </div>

        {/* Unit Size */}
        <div style={{ flex: '1 1 100px' }}>
          <label style={labelStyle}>Unit Size</label>
          <select
            value={unitSize}
            onChange={(e) => setUnitSize(parseInt(e.target.value))}
            style={inputStyle}
          >
            {UNIT_SIZES.map(s => (
              <option key={s} value={s}>{s} acres</option>
            ))}
          </select>
        </div>

        {/* Royalty Rate */}
        <div style={{ flex: '1 1 120px' }}>
          <label style={labelStyle}>Royalty Rate</label>
          <select
            value={royaltyRate}
            onChange={(e) => setRoyaltyRate(parseFloat(e.target.value))}
            style={inputStyle}
          >
            {ROYALTY_RATES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Result */}
      {result != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: '#78350f' }}>Estimated Decimal:</span>
          <span style={{
            fontSize: 14, fontWeight: 700, color: DARK,
            fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
          }}>
            {result.toFixed(8)}
          </span>
          <button
            onClick={() => onCalculate(result)}
            style={{
              background: ORANGE, color: '#fff', border: 'none', borderRadius: 4,
              padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            {currentDecimal != null ? 'Update' : 'Use This Decimal'}
          </button>
        </div>
      )}

      {currentDecimal != null && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#16a34a' }}>
            Using calculated decimal: {currentDecimal.toFixed(8)}
          </span>
          <button
            onClick={() => onCalculate(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: SLATE, textDecoration: 'underline' }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#78350f',
  marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  border: `1px solid ${BORDER}`, borderRadius: 4,
  background: '#fff', boxSizing: 'border-box',
};
