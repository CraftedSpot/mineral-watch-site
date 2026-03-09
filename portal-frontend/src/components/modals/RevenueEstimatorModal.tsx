import { useState, useEffect, useCallback, useMemo } from 'react';
import { ModalShell } from '../ui/ModalShell';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { Badge } from '../ui/Badge';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useToast } from '../../contexts/ToastContext';
import { OIL_NAVY, SLATE_BLUE, ORANGE, ORANGE_DARK, BORDER, SLATE, DARK } from '../../lib/constants';
import { fetchPropertyProduction, fetchWellProduction, fetchPrices } from '../../api/revenue';
import { calcRevenue } from '../../types/revenue';
import { WellRevenueCard } from './revenue/WellRevenueCard';
import { NriCalculator } from './revenue/NriCalculator';
import type {
  PropertyProductionResponse,
  WellProductionResponse,
  PricesResponse,
  PropertyWell,
  ProductionMonth,
  Interest,
} from '../../types/revenue';

interface Props {
  onClose: () => void;
  modalId: string;
  propertyId?: string;
  wellId?: string;
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatYearMonth(ym: string): string {
  if (!ym || ym.length < 6) return ym;
  const y = ym.substring(0, 4);
  const m = parseInt(ym.substring(4, 6));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${y}`;
}

export function RevenueEstimatorModal({ onClose, propertyId, wellId }: Props) {
  const isMobile = useIsMobile();
  const toast = useToast();
  const isPropertyMode = !!propertyId;

  // Data state
  const [propData, setPropData] = useState<PropertyProductionResponse | null>(null);
  const [wellData, setWellData] = useState<WellProductionResponse | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [deduction, setDeduction] = useState(25);
  const [manualDecimal, setManualDecimal] = useState<number | null>(null);
  const [allocOverrides, setAllocOverrides] = useState<Record<string, number>>({});
  const [drilldownWellIdx, setDrilldownWellIdx] = useState<number | null>(null);
  const [drilldownPunIdx, setDrilldownPunIdx] = useState<number | null>(null);

  // Fetch data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [dataResult, pricesResult] = await Promise.allSettled([
          isPropertyMode
            ? fetchPropertyProduction(propertyId!)
            : fetchWellProduction(wellId!),
          fetchPrices(),
        ]);

        if (cancelled) return;

        if (dataResult.status === 'rejected') {
          throw new Error(dataResult.reason?.message || 'Failed to load production data');
        }
        if (pricesResult.status === 'fulfilled') {
          setPrices(pricesResult.value);
        } else {
          // Fallback prices if fetch fails
          setPrices({ wti: { price: 70 }, henryHub: { price: 3.5 } });
        }

        if (isPropertyMode) {
          setPropData(dataResult.value as PropertyProductionResponse);
        } else {
          setWellData(dataResult.value as WellProductionResponse);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load data';
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [propertyId, wellId, isPropertyMode, toast]);

  // Handlers
  const handleAllocChange = useCallback((wellId: string, val: number | null) => {
    setAllocOverrides(prev => {
      const next = { ...prev };
      if (val == null) {
        delete next[wellId];
      } else {
        next[wellId] = val;
      }
      return next;
    });
  }, []);

  const handleBackToOverview = useCallback(() => {
    setDrilldownWellIdx(null);
    setDrilldownPunIdx(null);
  }, []);

  // Resolve effective oil/gas prices
  const oilPrice = prices?.wti?.price ?? 70;
  const gasPrice = prices?.henryHub?.price ?? 3.5;

  // Header info
  let headerTitle = 'Revenue Estimate';
  let headerSubtitle = '';
  let headerBg = `linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE_DARK} 100%)`;

  if (isPropertyMode && propData) {
    const p = propData.property;
    headerTitle = `Revenue Estimate`;
    headerSubtitle = [p.section, p.township, p.range, p.county].filter(Boolean).join(' · ');
    headerBg = `linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE_DARK} 100%)`;
  } else if (!isPropertyMode && wellData) {
    headerTitle = `Revenue Estimate`;
    headerSubtitle = wellData.well.wellName;
    headerBg = `linear-gradient(135deg, ${OIL_NAVY} 0%, ${SLATE_BLUE} 100%)`;
  } else if (!isPropertyMode) {
    headerBg = `linear-gradient(135deg, ${OIL_NAVY} 0%, ${SLATE_BLUE} 100%)`;
  }

  // Calculate deduction dollar impact for slider label
  const deductionImpact = useMemo(() => {
    if (isPropertyMode && propData) {
      let totalGross = 0;
      for (const w of propData.wells) {
        const decimal = manualDecimal ?? w.interestDecimal;
        if (decimal == null) continue;
        const alloc = allocOverrides[w.wellId] ?? w.allocationPct ?? 1;
        const { gross } = calcRevenue(w.trailing3mo.avgOilBbl, w.trailing3mo.avgGasMcf, oilPrice, gasPrice, decimal, alloc, 0);
        if (gross != null) totalGross += gross;
      }
      return totalGross * (deduction / 100);
    } else if (!isPropertyMode && wellData) {
      const w = wellData.well;
      const decimal = manualDecimal ?? w.interestDecimal;
      const alloc = allocOverrides[w.id] ?? w.allocationPct ?? 1;
      const { gross } = calcRevenue(wellData.trailing3mo.avgOilBbl, wellData.trailing3mo.avgGasMcf, oilPrice, gasPrice, decimal, alloc, 0);
      return (gross ?? 0) * (deduction / 100);
    }
    return 0;
  }, [isPropertyMode, propData, wellData, oilPrice, gasPrice, deduction, manualDecimal, allocOverrides]);

  return (
    <ModalShell
      onClose={onClose}
      headerBg={headerBg}
      headerContent={
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>{headerTitle}</h2>
          {headerSubtitle && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{headerSubtitle}</div>
          )}
        </div>
      }
      maxWidth={800}
      bodyPadding="0"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: SLATE, maxWidth: '60%', lineHeight: 1.4 }}>
            Estimates based on OTC production data and EIA spot prices. Actual royalty checks may differ.
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
              padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: SLATE,
            }}
          >
            Close
          </button>
        </div>
      }
    >
      {loading ? (
        <div style={{ padding: 20 }}>
          <LoadingSkeleton columns={1} rows={4} label="Revenue Estimator" />
        </div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#dc2626', marginBottom: 8 }}>{error}</div>
          <button
            onClick={() => window.location.reload()}
            style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Price Bar */}
          <PriceBar oilPrice={oilPrice} gasPrice={gasPrice} isMobile={isMobile} />

          {/* Deduction Slider */}
          <DeductionSlider
            value={deduction}
            onChange={setDeduction}
            impact={deductionImpact}
            isMobile={isMobile}
          />

          {/* Main Content */}
          <div style={{ padding: isMobile ? '12px 12px 20px' : '16px 20px 24px' }}>
            {isPropertyMode && propData ? (
              <PropertyView
                data={propData}
                oilPrice={oilPrice}
                gasPrice={gasPrice}
                deduction={deduction}
                manualDecimal={manualDecimal}
                allocOverrides={allocOverrides}
                drilldownWellIdx={drilldownWellIdx}
                drilldownPunIdx={drilldownPunIdx}
                onDrilldownWell={setDrilldownWellIdx}
                onDrilldownPun={setDrilldownPunIdx}
                onBackToOverview={handleBackToOverview}
                onAllocChange={handleAllocChange}
                onManualDecimal={setManualDecimal}
                isMobile={isMobile}
              />
            ) : wellData ? (
              <WellView
                data={wellData}
                oilPrice={oilPrice}
                gasPrice={gasPrice}
                deduction={deduction}
                manualDecimal={manualDecimal}
                allocOverride={allocOverrides[wellData.well.id] ?? null}
                onAllocChange={(val) => handleAllocChange(wellData.well.id, val)}
                onManualDecimal={setManualDecimal}
                isMobile={isMobile}
              />
            ) : null}
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ── Price Bar ──────────────────────────────────────────────────

function PriceBar({ oilPrice, gasPrice, isMobile }: { oilPrice: number; gasPrice: number; isMobile: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: isMobile ? 12 : 24, padding: isMobile ? '10px 12px' : '10px 20px',
      background: '#f0f4f8', borderBottom: `1px solid ${BORDER}`,
      alignItems: 'center', flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5 }}>WTI Oil</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: DARK }}>${oilPrice.toFixed(2)}/bbl</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5 }}>Henry Hub Gas</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: DARK }}>${gasPrice.toFixed(2)}/mcf</span>
      </div>
      <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>EIA spot prices</span>
    </div>
  );
}

// ── Deduction Slider ───────────────────────────────────────────

function DeductionSlider({ value, onChange, impact, isMobile }: {
  value: number; onChange: (v: number) => void; impact: number; isMobile: boolean;
}) {
  return (
    <div style={{
      padding: isMobile ? '12px 12px' : '12px 20px',
      background: '#fff', borderBottom: `1px solid ${BORDER}`,
      display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16,
      flexWrap: 'wrap',
    }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: DARK, whiteSpace: 'nowrap' }}>
        Deductions
      </label>
      <input
        type="range"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{ flex: 1, minWidth: 100, accentColor: ORANGE }}
      />
      <span style={{ fontSize: 14, fontWeight: 700, color: DARK, minWidth: 36, textAlign: 'right' }}>
        {value}%
      </span>
      {impact > 0 && (
        <span style={{ fontSize: 12, color: '#dc2626', whiteSpace: 'nowrap' }}>
          −{formatCurrency(Math.round(impact))}/mo
        </span>
      )}
    </div>
  );
}

// ── Property View ──────────────────────────────────────────────

function PropertyView({
  data, oilPrice, gasPrice, deduction, manualDecimal, allocOverrides,
  drilldownWellIdx, drilldownPunIdx,
  onDrilldownWell, onDrilldownPun, onBackToOverview,
  onAllocChange, onManualDecimal, isMobile,
}: {
  data: PropertyProductionResponse;
  oilPrice: number; gasPrice: number; deduction: number;
  manualDecimal: number | null;
  allocOverrides: Record<string, number>;
  drilldownWellIdx: number | null;
  drilldownPunIdx: number | null;
  onDrilldownWell: (idx: number) => void;
  onDrilldownPun: (idx: number) => void;
  onBackToOverview: () => void;
  onAllocChange: (wellId: string, val: number | null) => void;
  onManualDecimal: (val: number | null) => void;
  isMobile: boolean;
}) {
  const { property, wells, sharedPunGroups } = data;

  // Drill-down: single well
  if (drilldownWellIdx != null && wells[drilldownWellIdx]) {
    const w = wells[drilldownWellIdx];
    const decimal = manualDecimal ?? w.interestDecimal;
    const alloc = allocOverrides[w.wellId] ?? w.allocationPct;
    return (
      <WellDrillDown
        well={w}
        decimal={decimal}
        alloc={alloc}
        oilPrice={oilPrice}
        gasPrice={gasPrice}
        deduction={deduction}
        onBack={onBackToOverview}
        onAllocChange={(v) => onAllocChange(w.wellId, v)}
        isMobile={isMobile}
      />
    );
  }

  // Drill-down: shared PUN
  if (drilldownPunIdx != null && sharedPunGroups[drilldownPunIdx]) {
    const pun = sharedPunGroups[drilldownPunIdx];
    const firstWell = wells.find(w => pun.wellIds.includes(w.wellId));
    const decimal = manualDecimal ?? firstWell?.interestDecimal ?? null;
    return (
      <PunDrillDown
        group={pun}
        decimal={decimal}
        oilPrice={oilPrice}
        gasPrice={gasPrice}
        deduction={deduction}
        onBack={onBackToOverview}
        isMobile={isMobile}
      />
    );
  }

  // Check if any well has a decimal
  const hasAnyDecimal = manualDecimal != null || wells.some(w => w.interestDecimal != null);

  // NRI Calculator if no decimal
  const showNriCalc = !hasAnyDecimal && (property.ri_acres || property.acres);

  // Sort wells by revenue (highest first), wells without revenue at the end
  const sortedWells = useMemo(() => {
    return [...wells].sort((a, b) => {
      const decA = manualDecimal ?? a.interestDecimal;
      const decB = manualDecimal ?? b.interestDecimal;
      const allocA = allocOverrides[a.wellId] ?? a.allocationPct;
      const allocB = allocOverrides[b.wellId] ?? b.allocationPct;
      const revA = calcRevenue(a.trailing3mo.avgOilBbl, a.trailing3mo.avgGasMcf, oilPrice, gasPrice, decA, allocA, deduction);
      const revB = calcRevenue(b.trailing3mo.avgOilBbl, b.trailing3mo.avgGasMcf, oilPrice, gasPrice, decB, allocB, deduction);
      return (revB.net ?? -1) - (revA.net ?? -1);
    });
  }, [wells, oilPrice, gasPrice, deduction, manualDecimal, allocOverrides]);

  // Property totals
  const totals = useMemo(() => {
    let totalGross = 0;
    let totalNet = 0;
    let wellsWithRevenue = 0;
    for (const w of wells) {
      const decimal = manualDecimal ?? w.interestDecimal;
      const alloc = allocOverrides[w.wellId] ?? w.allocationPct;
      const { gross, net } = calcRevenue(w.trailing3mo.avgOilBbl, w.trailing3mo.avgGasMcf, oilPrice, gasPrice, decimal, alloc, deduction);
      if (gross != null && net != null) {
        totalGross += gross;
        totalNet += net;
        wellsWithRevenue++;
      }
    }
    return { totalGross, totalNet, wellsWithRevenue };
  }, [wells, oilPrice, gasPrice, deduction, manualDecimal, allocOverrides]);

  return (
    <>
      {showNriCalc && (
        <NriCalculator
          prefillAcres={property.ri_acres || property.acres || null}
          onCalculate={onManualDecimal}
          currentDecimal={manualDecimal}
        />
      )}

      {/* Property Total Summary */}
      {totals.wellsWithRevenue > 0 && (
        <div style={{
          background: OIL_NAVY, borderRadius: 8, padding: isMobile ? 14 : 16, marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Est. Monthly Revenue
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#86efac', marginTop: 4 }}>
              {formatCurrency(Math.round(totals.totalNet))}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>/mo net</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              Gross: {formatCurrency(Math.round(totals.totalGross))}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              {totals.wellsWithRevenue} of {wells.length} wells
            </div>
          </div>
        </div>
      )}

      {/* Well Cards Grid */}
      {wells.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: SLATE, fontSize: 14 }}>
          No wells linked to this property. Link wells from the Properties tab to estimate revenue.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Wells ({wells.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedWells.map((well, idx) => {
              const originalIdx = wells.indexOf(well);
              return (
                <WellRevenueCard
                  key={well.wellId}
                  well={well}
                  oilPrice={oilPrice}
                  gasPrice={gasPrice}
                  deduction={deduction}
                  decimal={manualDecimal ?? well.interestDecimal}
                  allocOverride={allocOverrides[well.wellId] ?? null}
                  onAllocChange={(val) => onAllocChange(well.wellId, val)}
                  onClick={() => onDrilldownWell(originalIdx)}
                  isMobile={isMobile}
                />
              );
            })}
          </div>
        </>
      )}

      {/* Shared PUN Groups */}
      {sharedPunGroups.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 }}>
            Shared Production Units ({sharedPunGroups.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sharedPunGroups.map((group, idx) => {
              const firstWell = wells.find(w => group.wellIds.includes(w.wellId));
              const decimal = manualDecimal ?? firstWell?.interestDecimal ?? null;
              const { net } = calcRevenue(group.trailing3mo.avgOilBbl, group.trailing3mo.avgGasMcf, oilPrice, gasPrice, decimal, null, deduction);
              return (
                <div
                  key={group.basePun}
                  onClick={() => onDrilldownPun(idx)}
                  style={{
                    border: `1px solid ${BORDER}`, borderRadius: 8, padding: isMobile ? 12 : 14,
                    background: '#fff', cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ORANGE; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: DARK }}>
                        Shared Unit
                        <Badge bg="#dbeafe" color="#1e40af" size="sm" style={{ marginLeft: 6 }}>
                          {group.wellNames.length} wells
                        </Badge>
                      </div>
                      <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>
                        {group.wellNames.join(', ')}
                      </div>
                    </div>
                    {net != null && (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>
                          {formatCurrency(Math.round(net))}
                        </div>
                        <div style={{ fontSize: 11, color: SLATE }}>/mo net</div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: SLATE }}>
                    <span>Oil: {group.trailing3mo.avgOilBbl.toLocaleString()} BBL/mo</span>
                    <span>Gas: {group.trailing3mo.avgGasMcf.toLocaleString()} MCF/mo</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

// ── Well View (single well mode) ────────────────────────────────

function WellView({
  data, oilPrice, gasPrice, deduction, manualDecimal, allocOverride, onAllocChange, onManualDecimal, isMobile,
}: {
  data: WellProductionResponse;
  oilPrice: number; gasPrice: number; deduction: number;
  manualDecimal: number | null;
  allocOverride: number | null;
  onAllocChange: (val: number | null) => void;
  onManualDecimal: (val: number | null) => void;
  isMobile: boolean;
}) {
  const { well, linkedProperty, production, trailing3mo } = data;
  const decimal = manualDecimal ?? well.interestDecimal;
  const alloc = allocOverride ?? well.allocationPct;

  const hasDecimal = decimal != null;
  const showNriCalc = !hasDecimal && linkedProperty && (linkedProperty.ri_acres || linkedProperty.acres);

  return (
    <>
      {showNriCalc && (
        <NriCalculator
          prefillAcres={linkedProperty!.ri_acres || linkedProperty!.acres || null}
          onCalculate={onManualDecimal}
          currentDecimal={manualDecimal}
        />
      )}

      {/* Linked Property Badge */}
      {linkedProperty && (
        <div style={{ marginBottom: 12 }}>
          <Badge bg="#fef3c7" color="#92400e" size="sm">
            Property: {[linkedProperty.section, linkedProperty.township, linkedProperty.range, linkedProperty.county].filter(Boolean).join(' · ')}
          </Badge>
        </div>
      )}

      {/* Well Info Header */}
      <div style={{
        border: `1px solid ${BORDER}`, borderRadius: 8, padding: isMobile ? 12 : 16,
        background: '#fff', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DARK }}>{well.wellName}</div>
            {well.apiNumber && <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>API: {well.apiNumber}</div>}
            {well.operator && <div style={{ fontSize: 12, color: SLATE }}>Operator: {well.operator}</div>}
          </div>
          {well.wellStatus && (
            <Badge
              bg={well.wellStatus === 'Active' ? '#dcfce7' : '#f1f5f9'}
              color={well.wellStatus === 'Active' ? '#166534' : '#64748b'}
              size="sm"
            >
              {well.wellStatus}
            </Badge>
          )}
        </div>

        {/* Interests */}
        <InterestsDisplay interests={well.interests} manualDecimal={manualDecimal} />

        {/* Allocation */}
        {alloc != null && alloc < 1 && (
          <div style={{ marginTop: 8, fontSize: 12, color: SLATE }}>
            Section Allocation: {(alloc * 100).toFixed(1)}%
            {well.allocationSource && <span style={{ color: '#94a3b8' }}> ({well.allocationSource})</span>}
          </div>
        )}
      </div>

      {/* Revenue Summary */}
      <RevenueSummary
        oilBbl={trailing3mo.avgOilBbl}
        gasMcf={trailing3mo.avgGasMcf}
        oilPrice={oilPrice}
        gasPrice={gasPrice}
        decimal={decimal}
        alloc={alloc}
        deduction={deduction}
        interests={well.interests}
        manualDecimal={manualDecimal}
        isMobile={isMobile}
      />

      {/* Production Table */}
      {production.length > 0 ? (
        <ProductionTable production={production} isMobile={isMobile} />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: SLATE, fontSize: 13 }}>
          No OTC production data available for this well.
        </div>
      )}
    </>
  );
}

// ── Well Drill-Down (from property overview) ────────────────────

function WellDrillDown({
  well, decimal, alloc, oilPrice, gasPrice, deduction, onBack, onAllocChange, isMobile,
}: {
  well: PropertyWell;
  decimal: number | null;
  alloc: number | null;
  oilPrice: number; gasPrice: number; deduction: number;
  onBack: () => void;
  onAllocChange: (val: number | null) => void;
  isMobile: boolean;
}) {
  return (
    <>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: ORANGE, fontWeight: 600, padding: 0, marginBottom: 12 }}
      >
        ← Back to overview
      </button>

      <div style={{
        border: `1px solid ${BORDER}`, borderRadius: 8, padding: isMobile ? 12 : 16,
        background: '#fff', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DARK }}>{well.wellName}</div>
            {well.apiNumber && <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>API: {well.apiNumber}</div>}
            {well.operator && <div style={{ fontSize: 12, color: SLATE }}>Operator: {well.operator}</div>}
          </div>
          {well.wellStatus && (
            <Badge
              bg={well.wellStatus === 'Active' ? '#dcfce7' : '#f1f5f9'}
              color={well.wellStatus === 'Active' ? '#166534' : '#64748b'}
              size="sm"
            >
              {well.wellStatus}
            </Badge>
          )}
        </div>

        <InterestsDisplay interests={well.interests} manualDecimal={null} />

        {alloc != null && alloc < 1 && (
          <AllocationEditor
            value={alloc}
            source={well.allocationSource}
            onChange={onAllocChange}
          />
        )}
      </div>

      <RevenueSummary
        oilBbl={well.trailing3mo.avgOilBbl}
        gasMcf={well.trailing3mo.avgGasMcf}
        oilPrice={oilPrice}
        gasPrice={gasPrice}
        decimal={decimal}
        alloc={alloc}
        deduction={deduction}
        interests={well.interests}
        manualDecimal={null}
        isMobile={isMobile}
      />

      {well.production.length > 0 ? (
        <ProductionTable production={well.production} isMobile={isMobile} />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: SLATE, fontSize: 13 }}>
          No OTC production data available.
        </div>
      )}
    </>
  );
}

// ── PUN Drill-Down ──────────────────────────────────────────────

function PunDrillDown({
  group, decimal, oilPrice, gasPrice, deduction, onBack, isMobile,
}: {
  group: { basePun: string; wellIds: string[]; wellNames: string[]; production: ProductionMonth[]; trailing3mo: { avgOilBbl: number; avgGasMcf: number } };
  decimal: number | null;
  oilPrice: number; gasPrice: number; deduction: number;
  onBack: () => void;
  isMobile: boolean;
}) {
  return (
    <>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: ORANGE, fontWeight: 600, padding: 0, marginBottom: 12 }}
      >
        ← Back to overview
      </button>

      <div style={{
        border: `1px solid ${BORDER}`, borderRadius: 8, padding: isMobile ? 12 : 16,
        background: '#fff', marginBottom: 12,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: DARK, marginBottom: 4 }}>Shared Production Unit</div>
        <div style={{ fontSize: 12, color: SLATE, marginBottom: 8 }}>PUN: {group.basePun}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {group.wellNames.map((name, i) => (
            <Badge key={i} bg="#f1f5f9" color="#334e68" size="sm">{name}</Badge>
          ))}
        </div>
      </div>

      <RevenueSummary
        oilBbl={group.trailing3mo.avgOilBbl}
        gasMcf={group.trailing3mo.avgGasMcf}
        oilPrice={oilPrice}
        gasPrice={gasPrice}
        decimal={decimal}
        alloc={null}
        deduction={deduction}
        interests={[]}
        manualDecimal={null}
        isMobile={isMobile}
      />

      {group.production.length > 0 ? (
        <ProductionTable production={group.production} isMobile={isMobile} />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: SLATE, fontSize: 13 }}>
          No production data for this unit.
        </div>
      )}
    </>
  );
}

// ── Shared Sub-Components ───────────────────────────────────────

function InterestsDisplay({ interests, manualDecimal }: { interests: Interest[]; manualDecimal: number | null }) {
  if (manualDecimal != null) {
    return (
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Badge bg="#fef3c7" color="#92400e" size="sm">Manual</Badge>
        <span style={{ fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'SF Mono', monospace" }}>
          {manualDecimal.toFixed(8)}
        </span>
      </div>
    );
  }

  if (interests.length === 0) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>No decimal interest set</div>
    );
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {interests.map((int, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Badge
            bg={int.type === 'RI' ? '#dcfce7' : int.type === 'WI' ? '#dbeafe' : '#fef3c7'}
            color={int.type === 'RI' ? '#166534' : int.type === 'WI' ? '#1e40af' : '#92400e'}
            size="sm"
          >
            {int.type}
          </Badge>
          <span style={{ fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'SF Mono', monospace" }}>
            {int.decimal.toFixed(8)}
          </span>
          <span style={{ fontSize: 11, color: SLATE }}>
            {int.source === 'property' ? '(from property)' : int.source === 'well_override' ? '(manual)' : `(${int.source})`}
          </span>
        </div>
      ))}
    </div>
  );
}

function RevenueSummary({
  oilBbl, gasMcf, oilPrice, gasPrice, decimal, alloc, deduction, interests, manualDecimal, isMobile,
}: {
  oilBbl: number; gasMcf: number; oilPrice: number; gasPrice: number;
  decimal: number | null; alloc: number | null; deduction: number;
  interests: Interest[]; manualDecimal: number | null; isMobile: boolean;
}) {
  // Primary interest revenue
  const { gross, net } = calcRevenue(oilBbl, gasMcf, oilPrice, gasPrice, decimal, alloc, deduction);

  // Multi-interest: separate lines for WI, ORRI if present and no manual decimal
  const additionalInterests = manualDecimal == null
    ? interests.filter(i => i.type !== 'RI')
    : [];

  return (
    <div style={{
      background: OIL_NAVY, borderRadius: 8, padding: isMobile ? 14 : 16, marginBottom: 12,
    }}>
      {/* Production */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>Oil (3-mo avg)</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{oilBbl.toLocaleString()} BBL</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>Gas (3-mo avg)</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{gasMcf.toLocaleString()} MCF</div>
        </div>
      </div>

      {/* Revenue Flow */}
      {gross != null && net != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Gross</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{formatCurrency(Math.round(gross))}</div>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>→</span>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Deductions ({deduction}%)</div>
            <div style={{ fontSize: 14, color: '#fca5a5' }}>−{formatCurrency(Math.round(gross - net))}</div>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16 }}>→</span>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Net</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#86efac' }}>{formatCurrency(Math.round(net))}</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          Set a decimal interest to see revenue estimates
        </div>
      )}

      {/* Additional interest lines (WI, ORRI) */}
      {additionalInterests.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: 12, paddingTop: 12 }}>
          {additionalInterests.map((int, i) => {
            const intRev = calcRevenue(oilBbl, gasMcf, oilPrice, gasPrice, int.decimal, alloc, deduction);
            if (intRev.net == null) return null;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: i > 0 ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Badge
                    bg={int.type === 'WI' ? 'rgba(59,130,246,0.3)' : 'rgba(245,158,11,0.3)'}
                    color={int.type === 'WI' ? '#93c5fd' : '#fcd34d'}
                    size="sm"
                  >
                    {int.type}
                  </Badge>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                    {int.decimal.toFixed(8)}
                    {int.type === 'WI' && ' (before OpEx)'}
                  </span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#86efac' }}>
                  {formatCurrency(Math.round(intRev.net!))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductionTable({ production, isMobile }: { production: ProductionMonth[]; isMobile: boolean }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, padding: '10px 14px', borderBottom: `1px solid ${BORDER}` }}>
        Production History
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? 12 : 13 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: DARK, borderBottom: `1px solid ${BORDER}` }}>Month</th>
            <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: DARK, borderBottom: `1px solid ${BORDER}` }}>Oil (BBL)</th>
            <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: DARK, borderBottom: `1px solid ${BORDER}` }}>Gas (MCF)</th>
          </tr>
        </thead>
        <tbody>
          {production.map((p, i) => (
            <tr key={p.yearMonth} style={{ borderBottom: i < production.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
              <td style={{ padding: '8px 14px', color: DARK }}>{formatYearMonth(p.yearMonth)}</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', color: DARK, fontFamily: "'SF Mono', monospace" }}>
                {p.oilBbl.toLocaleString()}
              </td>
              <td style={{ padding: '8px 14px', textAlign: 'right', color: DARK, fontFamily: "'SF Mono', monospace" }}>
                {p.gasMcf.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllocationEditor({ value, source, onChange }: {
  value: number; source: string | null; onChange: (val: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState((value * 100).toFixed(1));

  if (!editing) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: SLATE, display: 'flex', alignItems: 'center', gap: 6 }}>
        Section Allocation: {(value * 100).toFixed(1)}%
        {source && <span style={{ color: '#94a3b8' }}>({source})</span>}
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: ORANGE, fontWeight: 600 }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: SLATE }}>Allocation:</span>
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        style={{ width: 70, padding: '4px 8px', fontSize: 12, border: `1px solid ${BORDER}`, borderRadius: 4 }}
      />
      <span style={{ fontSize: 12, color: SLATE }}>%</span>
      <button
        onClick={() => {
          const pct = parseFloat(inputVal);
          if (!isNaN(pct) && pct >= 0 && pct <= 100) {
            onChange(pct / 100);
            setEditing(false);
          }
        }}
        style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
      >
        Apply
      </button>
      <button
        onClick={() => { onChange(null); setEditing(false); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: SLATE }}
      >
        Reset
      </button>
    </div>
  );
}
