import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useToast } from '../../../contexts/ToastContext';
import { getComparables, getForecast, generateForecast } from '../../../api/well-forecast';
import type { ComparablesResponse, ForecastResponse } from '../../../api/well-forecast';
import { searchWells } from '../../../api/wells';
import { fetchPrices } from '../../../api/revenue';
import type { SearchWellResult } from '../../../api/wells';
import { Spinner } from '../../ui/Spinner';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { TEXT_DARK, SLATE, BORDER } from '../../../lib/constants';

const BRAND_TEAL = '#0f766e';
const BAND_FILL = 'rgba(15, 118, 110, 0.10)';
const BAND_STROKE = 'rgba(15, 118, 110, 0.25)';

const LOADING_MESSAGES = [
  'Finding comparable wells in the formation...',
  'Crunching 25 years of production data...',
  'Computing decline curves across the cohort...',
  'Calculating P10/P50/P90 percentiles...',
  'Normalizing production to completion dates...',
  'Almost there — assembling the type curve...',
];

const FORECAST_MESSAGES = [
  'Analyzing comparable well performance...',
  'Computing revenue projections at current prices...',
  'Evaluating operator deduction profiles...',
  'Assessing economic risk thresholds...',
  'Synthesizing forecast narrative...',
  'Opus is thinking deeply about your well...',
];

type ProductView = 'gas' | 'oil' | 'boe';

interface Props {
  tier?: string;
  initialApi?: string;
}

export function WellForecastReport({ tier, initialApi }: Props) {
  const isMobile = useIsMobile();
  const toast = useToast();

  const [apiInput, setApiInput] = useState(initialApi || '');
  const [selectedApi, setSelectedApi] = useState<string | null>(initialApi || null);
  const [compData, setCompData] = useState<ComparablesResponse | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse['forecast'] | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [productView, setProductView] = useState<ProductView>('gas');
  const [cumulative, setCumulative] = useState(false);
  const [wellSearchResults, setWellSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [trackedWells, setTrackedWells] = useState<any[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(true);
  const [countyFilter, setCountyFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advSection, setAdvSection] = useState('');
  const [advTownship, setAdvTownship] = useState('');
  const [advRange, setAdvRange] = useState('');
  const [trackedFilter, setTrackedFilter] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [prices, setPrices] = useState<{ wti: number | null; hh: number | null }>({ wti: null, hh: null });
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rotating loading messages
  const startLoadingMessages = useCallback((messages: string[]) => {
    let idx = 0;
    setLoadingMsg(messages[0]);
    loadingInterval.current = setInterval(() => {
      idx = (idx + 1) % messages.length;
      setLoadingMsg(messages[idx]);
    }, 2500);
  }, []);

  const stopLoadingMessages = useCallback(() => {
    if (loadingInterval.current) clearInterval(loadingInterval.current);
    loadingInterval.current = null;
    setLoadingMsg('');
  }, []);

  useEffect(() => () => { if (loadingInterval.current) clearInterval(loadingInterval.current); }, []);

  // Auto-load comparables
  useEffect(() => {
    if (!selectedApi) return;
    setCompLoading(true);
    setCompError(null);
    setCompData(null);
    setForecast(null);
    startLoadingMessages(LOADING_MESSAGES);

    Promise.all([
      getComparables(selectedApi),
      getForecast(selectedApi),
    ]).then(([comp, fc]) => {
      setCompData(comp);
      if (fc.forecast) setForecast(fc.forecast);
      if (comp.summary) {
        setProductView(comp.summary.cumulative_p50_gas > comp.summary.cumulative_p50_oil * 6 ? 'gas' : 'oil');
      }
    }).catch(err => {
      setCompError(err instanceof Error ? err.message : 'Failed to load comparables');
    }).finally(() => { setCompLoading(false); stopLoadingMessages(); });
  }, [selectedApi]);

  // URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const api = params.get('api') || params.get('pun');
    if (api && !selectedApi) { setApiInput(api); setSelectedApi(api); }
  }, []);

  // Load commodity prices
  useEffect(() => {
    fetchPrices()
      .then(data => {
        setPrices({ wti: data.wti?.price || null, hh: data.henryHub?.price || null });
      }).catch(() => {});
  }, []);

  // Load tracked wells
  useEffect(() => {
    setTrackedLoading(true);
    fetch('/api/wells', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { wells: [] })
      .then(data => {
        const wells = (data.wells || data.data?.wells || []).slice(0, 50);
        setTrackedWells(wells);
        if (wells.length === 0) setShowSearch(true);
      })
      .catch(() => {})
      .finally(() => setTrackedLoading(false));
  }, []);

  // Debounced typeahead search using existing searchWells API
  useEffect(() => {
    const q = apiInput.trim();
    const hasAdvanced = advSection || advTownship || advRange;
    if (q.length < 2 && !countyFilter && !operatorFilter && !hasAdvanced) { setWellSearchResults([]); return; }
    if (/^\d{10,14}$/.test(q) && q.length >= 10) { setSelectedApi(q); return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const isApiLike = /^\d{4,}$/.test(q);
        const params: any = {};
        if (q.length >= 2) {
          if (isApiLike) params.q = q;
          else params.well_name = q;
        }
        if (countyFilter) params.county = countyFilter;
        if (operatorFilter) params.operator = operatorFilter;
        if (advSection) params.section = advSection;
        if (advTownship) params.township = advTownship;
        if (advRange) params.range = advRange;
        const data = await searchWells(params);
        setWellSearchResults(data.wells || []);
      } catch { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [apiInput, countyFilter, operatorFilter, advSection, advTownship, advRange]);

  // BOE computation helper
  const toBoe = (oil: number, gas: number) => oil + gas / 6;

  // Chart data
  const chartData = useMemo(() => {
    if (!compData?.type_curve) return [];
    const tc = compData.type_curve;

    // Build monthly rate data
    const rateData = tc.months.map((month, i) => {
      const p10Oil = tc.p10.oil[i], p50Oil = tc.p50.oil[i], p90Oil = tc.p90.oil[i];
      const p10Gas = tc.p10.gas[i], p50Gas = tc.p50.gas[i], p90Gas = tc.p90.gas[i];
      return {
        month,
        p10: productView === 'gas' ? p10Gas : productView === 'oil' ? p10Oil : toBoe(p10Oil, p10Gas),
        p50: productView === 'gas' ? p50Gas : productView === 'oil' ? p50Oil : toBoe(p50Oil, p50Gas),
        p90: productView === 'gas' ? p90Gas : productView === 'oil' ? p90Oil : toBoe(p90Oil, p90Gas),
        wellCount: tc.well_count_at_month[i],
      };
    });

    if (!cumulative) return rateData;

    // Compute running sum for cumulative view
    let cumP10 = 0, cumP50 = 0, cumP90 = 0;
    return rateData.map(d => {
      cumP10 += d.p10;
      cumP50 += d.p50;
      cumP90 += d.p90;
      return { month: d.month, p10: Math.round(cumP10), p50: Math.round(cumP50), p90: Math.round(cumP90), wellCount: d.wellCount };
    });
  }, [compData, productView, cumulative]);

  // EUR callout — always show all products regardless of toggle
  const eurData = useMemo(() => {
    if (!cumulative || !compData?.type_curve) return null;
    const tc = compData.type_curve;
    let cumOil = 0, cumGas = 0;
    for (let i = 0; i < tc.p50.oil.length; i++) {
      cumOil += tc.p50.oil[i];
      cumGas += tc.p50.gas[i];
    }
    const cumBoe = cumOil + cumGas / 6;
    return { oil: Math.round(cumOil), gas: Math.round(cumGas), boe: Math.round(cumBoe) };
  }, [cumulative, compData]);

  const unitLabel = cumulative
    ? (productView === 'gas' ? 'MCF' : productView === 'oil' ? 'BBL' : 'BOE')
    : (productView === 'gas' ? 'MCF/mo' : productView === 'oil' ? 'BBL/mo' : 'BOE/mo');
  const productLabel = productView === 'gas' ? 'Gas' : productView === 'oil' ? 'Oil' : 'BOE';

  // Generate forecast
  const handleGenerate = useCallback(async () => {
    if (!selectedApi) return;
    setForecastLoading(true);
    startLoadingMessages(FORECAST_MESSAGES);
    try {
      const result = await generateForecast(selectedApi);
      if (result.forecast) {
        setForecast(result.forecast);
        toast.success(`Forecast generated (${result.forecast.credits_charged} credits)`);
      }
    } catch (err: any) {
      toast.error(err?.message?.includes('Insufficient') ? 'Insufficient credits (3 required)' : err?.message || 'Forecast failed');
    } finally { setForecastLoading(false); stopLoadingMessages(); }
  }, [selectedApi, toast, startLoadingMessages, stopLoadingMessages]);

  // Print handler
  const handlePrint = useCallback(() => window.print(), []);

  return (
    <div>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
        .print-only { display: none; }
      `}</style>

      {/* ── Well Selector ── */}
      <div className="no-print" style={{
        background: '#fff', borderRadius: 10, border: `1px solid ${BORDER}`,
        padding: isMobile ? 16 : 20, marginBottom: 16,
      }}>
        {selectedApi && compData?.target ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: TEXT_DARK }}>
                  {compData.target.well_name}
                  <span style={{ fontSize: 13, fontWeight: 400, color: SLATE, marginLeft: 10 }}>
                    {(compData as any).unit?.pun ? `PUN: ${(compData as any).unit.pun}` : `API: ${compData.target.api}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {compData.target.formation && <Badge bg="#dbeafe" color="#1d4ed8" size="sm">{compData.target.formation}</Badge>}
                  <Badge bg="#f0fdf4" color="#166534" size="sm">{compData.target.well_type}</Badge>
                  <Badge bg="#fef3c7" color="#92400e" size="sm">{compData.target.county}</Badge>
                  {compData.target.operator && <span style={{ fontSize: 12, color: SLATE }}>{compData.target.operator}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" size="sm" onClick={handlePrint}>Print / PDF</Button>
                <button onClick={() => { setSelectedApi(null); setCompData(null); setForecast(null); setApiInput(''); }}
                  style={{ background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 14px',
                    fontSize: 13, cursor: 'pointer', color: TEXT_DARK }}>
                  Change Well
                </button>
              </div>
            </div>
            {/* Unit wells listing */}
            {(compData as any).unit?.well_count > 1 && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  Wells in Unit ({(compData as any).unit.well_count})
                </div>
                {(compData as any).unit.wells.map((w: any) => (
                  <div key={w.api} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
                    fontSize: 12, color: w.is_selected ? TEXT_DARK : SLATE,
                    fontWeight: w.is_selected ? 600 : 400,
                  }}>
                    {w.is_selected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: BRAND_TEAL, flexShrink: 0 }} />}
                    <span>{w.name}</span>
                    <span style={{ color: SLATE, fontSize: 11 }}>{w.api}</span>
                    <Badge bg="#f0fdf4" color="#166534" size="sm">{w.type}</Badge>
                    {w.status && <Badge bg="#e2e8f0" color={SLATE} size="sm">{w.status}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>
                {showSearch ? 'Search any well in Oklahoma' : 'Select a well to forecast'}
              </div>
              {trackedWells.length > 0 && (
                <button onClick={() => { setShowSearch(!showSearch); setWellSearchResults([]); setApiInput(''); }}
                  style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {showSearch ? '\u2190 Your tracked wells' : 'Search any well \u2192'}
                </button>
              )}
            </div>

            {showSearch ? (
              <>
                {/* Search fields — matching AddWellModal pattern */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <input type="text" value={apiInput}
                    onChange={e => setApiInput(e.target.value)}
                    placeholder="Well name or API number..."
                    autoFocus
                    style={{ flex: 2, minWidth: 180, padding: '10px 14px', fontSize: 14, border: `1px solid ${BORDER}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <input type="text" value={operatorFilter}
                    onChange={e => setOperatorFilter(e.target.value)}
                    placeholder="Operator..."
                    style={{ flex: 1, minWidth: 140, padding: '10px 14px', fontSize: 14, border: `1px solid ${BORDER}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <select value={countyFilter} onChange={e => setCountyFilter(e.target.value)}
                    style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', color: TEXT_DARK, cursor: 'pointer' }}>
                    <option value="">All Counties</option>
                    {['BEAVER','BLAINE','CADDO','CANADIAN','CARTER','CLEVELAND','COAL','COMANCHE','COTTON','CREEK','CUSTER','DEWEY','ELLIS','GARFIELD','GARVIN','GRADY','GRANT','GREER','HARPER','HASKELL','HUGHES','JACKSON','JEFFERSON','KAY','KINGFISHER','KIOWA','LATIMER','LEFLORE','LINCOLN','LOGAN','LOVE','MAJOR','MARSHALL','MCCLAIN','MCINTOSH','MURRAY','MUSKOGEE','NOBLE','NOWATA','OKFUSKEE','OKLAHOMA','OKMULGEE','OSAGE','OTTAWA','PAWNEE','PAYNE','PITTSBURG','PONTOTOC','POTTAWATOMIE','ROGER MILLS','ROGERS','SEMINOLE','SEQUOYAH','STEPHENS','TEXAS','TILLMAN','TULSA','WAGONER','WASHITA','WASHINGTON','WOODS','WOODWARD'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {/* Advanced TRS filters */}
                <div style={{ marginBottom: 8 }}>
                  <button onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    {showAdvanced ? 'Hide' : 'Show'} location filters (Section/Township/Range)
                  </button>
                  {showAdvanced && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <input type="text" value={advSection} onChange={e => setAdvSection(e.target.value)}
                        placeholder="Section" style={{ width: 70, padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 6, outline: 'none' }} />
                      <input type="text" value={advTownship} onChange={e => setAdvTownship(e.target.value)}
                        placeholder="Township" style={{ width: 80, padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 6, outline: 'none' }} />
                      <input type="text" value={advRange} onChange={e => setAdvRange(e.target.value)}
                        placeholder="Range" style={{ width: 70, padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 6, outline: 'none' }} />
                    </div>
                  )}
                </div>
                {searching && <div style={{ textAlign: 'center', padding: 12, color: SLATE, fontSize: 13 }}><Spinner size={14} /> Searching...</div>}
                {wellSearchResults.length > 0 && (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                    {wellSearchResults.map((w: SearchWellResult) => (
                      <div key={w.api_number}
                        onClick={() => { setSelectedApi(w.api_number); setWellSearchResults([]); setShowSearch(false); }}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, fontSize: 13,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: TEXT_DARK }}>{w.well_name} {w.well_number || ''}</div>
                          <div style={{ fontSize: 11, color: SLATE }}>{w.operator || 'Unknown operator'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {w.formation_name && <Badge bg="#dbeafe" color="#1d4ed8" size="sm">{w.formation_name}</Badge>}
                          <Badge bg="#fef3c7" color="#92400e" size="sm">{w.county}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {apiInput.length >= 2 && !searching && wellSearchResults.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 16, color: SLATE, fontSize: 13 }}>No wells found</div>
                )}
              </>
            ) : (
              <>
                {/* Tracked wells list with inline search */}
                <input type="text" value={trackedFilter}
                  onChange={e => setTrackedFilter(e.target.value)}
                  placeholder="Filter your tracked wells..."
                  style={{ width: '100%', padding: '8px 14px', fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box' }}
                />
                {trackedLoading ? (
                  <div style={{ textAlign: 'center', padding: 20 }}><Spinner size={20} /></div>
                ) : (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, maxHeight: 350, overflowY: 'auto' }}>
                    {trackedWells.filter((w: any) => {
                      if (!trackedFilter) return true;
                      const q = trackedFilter.toLowerCase();
                      const name = (w.well_name || w.fields?.['Well Name'] || '').toLowerCase();
                      const op = (w.operator || w.fields?.Operator || '').toLowerCase();
                      const county = (w.county || w.fields?.County || '').toLowerCase();
                      return name.includes(q) || op.includes(q) || county.includes(q);
                    }).slice(0, 20).map((w: any) => (
                      <div key={w.id || w.api_number}
                        onClick={() => setSelectedApi(w.api_number || w.fields?.API)}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, fontSize: 13,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: TEXT_DARK }}>{w.well_name || w.fields?.['Well Name'] || 'Unknown'}</div>
                          <div style={{ fontSize: 11, color: SLATE }}>{w.operator || w.fields?.Operator || ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <Badge bg="#fef3c7" color="#92400e" size="sm">{w.county || w.fields?.County || ''}</Badge>
                        </div>
                      </div>
                    ))}
                    {trackedWells.length > 15 && (
                      <div style={{ padding: '8px 14px', fontSize: 12, color: '#3b82f6', cursor: 'pointer', textAlign: 'center' }}
                        onClick={() => setShowSearch(true)}>
                        Search all {trackedWells.length} tracked wells...
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Print header */}
      <div className="print-only" style={{ marginBottom: 16 }}>
        {compData?.target && (
          <div>
            <h1 style={{ fontSize: 20, margin: '0 0 4px', color: TEXT_DARK }}>Well Performance Forecast: {compData.target.well_name}</h1>
            <div style={{ fontSize: 13, color: SLATE }}>
              API: {compData.target.api} &middot; {compData.target.formation} {compData.target.well_type} &middot;
              {compData.target.county} County &middot; {compData.target.operator}
            </div>
          </div>
        )}
      </div>

      {/* ── Loading ── */}
      {compLoading && (
        <div style={{ textAlign: 'center', padding: 60, color: SLATE }}>
          <Spinner size={28} />
          <div style={{ marginTop: 12, fontSize: 14, fontWeight: 500, transition: 'opacity 0.3s' }}>{loadingMsg}</div>
        </div>
      )}

      {compError && <div style={{ textAlign: 'center', padding: 40, color: '#dc2626', fontSize: 14 }}>{compError}</div>}

      {/* ── Comparables + Forecast + Chart ── */}
      {compData?.type_curve && (
        <>
          {/* Cohort summary bar */}
          <div style={{
            background: '#f8fafc', borderRadius: 10, border: `1px solid ${BORDER}`,
            padding: '12px 20px', marginBottom: 16, display: 'flex',
            justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{ fontSize: 13, color: TEXT_DARK }}>
              <strong>{compData.cohort.count}</strong> comparable {compData.cohort.formation} {compData.cohort.well_type.toLowerCase()} units
              {(compData.cohort as any).total_wells && (compData.cohort as any).total_wells !== compData.cohort.count
                ? ` (${(compData.cohort as any).total_wells} wells)` : ''}
              {' '}in {compData.cohort.county} &middot; {compData.cohort.completion_range}
              {compData.cohort.tier > 1 && <Badge bg="#fef3c7" color="#92400e" size="sm" style={{ marginLeft: 8 }}>Broadened search</Badge>}
            </div>
            {compData.target_vs_curve?.performance_vs_p50 && (
              <Badge
                bg={compData.target_vs_curve.performance_vs_p50.startsWith('+') ? '#f0fdf4' : '#fef2f2'}
                color={compData.target_vs_curve.performance_vs_p50.startsWith('+') ? '#166534' : '#991b1b'}
              >
                {compData.target_vs_curve.performance_vs_p50} vs median
              </Badge>
            )}
          </div>

          {/* ── AI Forecast Section (ABOVE chart, like unit summary pattern) ── */}
          <div style={{
            background: '#fff', borderRadius: 10, border: `1px solid ${BORDER}`,
            padding: isMobile ? 16 : 20, marginBottom: 16,
          }}>
            {forecast ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 3, height: 28, borderRadius: 2, background: BRAND_TEAL }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: TEXT_DARK }}>AI Performance Forecast</div>
                      <div style={{ fontSize: 11, color: SLATE }}>
                        {forecast.model === 'claude-opus-4-6' ? 'Claude Opus' : 'Claude Sonnet'} &middot;
                        {new Date(forecast.generated_at).toLocaleDateString()} &middot;
                        {forecast.comparable_count} comparable wells
                      </div>
                    </div>
                  </div>
                  <Button className="no-print" variant="ghost" size="sm" onClick={handleGenerate} disabled={forecastLoading}>
                    {forecastLoading ? 'Generating...' : 'Re-forecast (3 cr)'}
                  </Button>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: TEXT_DARK }}
                  dangerouslySetInnerHTML={{
                    __html: forecast.forecast_text
                      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                      .replace(/^## (.*)$/gm, '<h3 style="margin:18px 0 6px;color:#0f766e;font-size:15px;font-weight:700;">$1</h3>')
                      .replace(/^# (.*)$/gm, '<h2 style="margin:22px 0 8px;color:#0f766e;font-size:17px;font-weight:700;">$1</h2>')
                      .replace(/---/g, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">')
                      .replace(/\n\n/g, '</p><p style="margin:10px 0">')
                      .replace(/\n/g, '<br>')
                  }}
                />
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 3, height: 28, borderRadius: 2, background: '#d1d5db' }} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT_DARK }}>AI Performance Forecast</div>
                    <div style={{ fontSize: 12, color: SLATE }}>
                      Detailed production, revenue, and economic analysis powered by Claude Opus
                    </div>
                  </div>
                </div>
                <Button className="no-print" variant="primary" color={BRAND_TEAL} onClick={handleGenerate}
                  disabled={forecastLoading}
                  icon={forecastLoading ? <Spinner size={14} color="#fff" /> : undefined}>
                  {forecastLoading ? loadingMsg || 'Generating...' : 'Generate Forecast (3 Credits)'}
                </Button>
              </div>
            )}
          </div>

          {/* Toggles: Product + View Mode */}
          <div className="no-print" style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {([['gas', 'Gas (MCF)'], ['oil', 'Oil (BBL)'], ['boe', 'BOE']] as [ProductView, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setProductView(key)}
                  style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: `1px solid ${BORDER}`, cursor: 'pointer',
                    background: productView === key ? BRAND_TEAL : '#fff',
                    color: productView === key ? '#fff' : TEXT_DARK,
                  }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([false, true] as boolean[]).map(isCum => (
                <button key={String(isCum)} onClick={() => setCumulative(isCum)}
                  style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                    border: `1px solid ${BORDER}`, cursor: 'pointer',
                    background: cumulative === isCum ? '#1e3a5f' : '#fff',
                    color: cumulative === isCum ? '#fff' : TEXT_DARK,
                  }}>
                  {isCum ? 'Cumulative (EUR)' : 'Monthly Rate'}
                </button>
              ))}
            </div>
          </div>

          {/* ── DECLINE CURVE CHART ── */}
          <div style={{
            background: '#fff', borderRadius: 10, border: `1px solid ${BORDER}`,
            padding: isMobile ? '12px 8px' : '20px 24px', marginBottom: 16,
          }}>
            <ResponsiveContainer width="100%" height={isMobile ? 300 : 450}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month"
                  label={{ value: 'Years From First Production', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: SLATE } }}
                  tickFormatter={(m: number) => {
                    if (m === 0) return '0';
                    if (m % 12 === 0) return `${m / 12}`;
                    return '';
                  }}
                  tick={{ fontSize: 10, fill: SLATE }}
                  ticks={chartData.filter(d => d.month % (chartData.length > 180 ? 24 : 12) === 0).map(d => d.month)}
                />
                <YAxis
                  label={{ value: cumulative ? `Cumulative ${productLabel} (${unitLabel})` : `${productLabel} (${unitLabel})`, angle: -90, position: 'insideLeft', offset: 0, style: { fontSize: 11, fill: SLATE } }}
                  tick={{ fontSize: 10, fill: SLATE }}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(Math.round(v))}
                />
                <Area dataKey="p90" stroke={BAND_STROKE} strokeWidth={1} fill={BAND_FILL}
                  type="monotone" isAnimationActive={false} name="P90 (Top Performers)" dot={false} />
                <Area dataKey="p10" stroke={BAND_STROKE} strokeWidth={1} fill="#fff"
                  type="monotone" isAnimationActive={false} name="P10 (Low Performers)" dot={false} />
                <Line dataKey="p50" stroke={BRAND_TEAL} strokeWidth={2.5} dot={false}
                  type="monotone" name="Comparable Median (P50)" isAnimationActive={false} />
                {compData.target_vs_curve?.months_producing && (
                  <ReferenceLine x={compData.target_vs_curve.months_producing} stroke="#94a3b8"
                    strokeDasharray="4 4" label={{ value: 'Today', position: 'top', style: { fontSize: 10, fill: SLATE } }} />
                )}
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}` }}
                  labelFormatter={(month: number) => {
                    const yrs = Math.floor(month / 12);
                    const mos = month % 12;
                    return `Month ${month} (${yrs > 0 ? `${yrs}yr${mos > 0 ? ` ${mos}mo` : ''}` : `${mos}mo`})`;
                  }}
                  formatter={(value: number, name: string) => [`${Math.round(value).toLocaleString()} ${unitLabel}`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11, color: SLATE, textAlign: 'center', marginTop: 4 }}>
              Based on {compData.type_curve.well_count_at_month[0]} wells at month 1,
              declining to {compData.type_curve.well_count_at_month[compData.type_curve.well_count_at_month.length - 1]} wells
              at month {compData.type_curve.max_month}
            </div>

            {/* EUR callout in cumulative mode */}
            {cumulative && eurData && compData.type_curve && (() => {
              const grossValue = (eurData.oil > 0 && prices.wti ? eurData.oil * prices.wti : 0)
                + (eurData.gas > 0 && prices.hh ? eurData.gas * prices.hh / 1000 : 0); // HH is $/MMBtu, gas is MCF
              const fmtVal = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toLocaleString();
              const fmtDollar = (v: number) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toLocaleString()}`;

              return (
                <div style={{
                  marginTop: 12, padding: '16px 20px', borderRadius: 8,
                  background: 'linear-gradient(135deg, #0f766e, #115e59)', color: '#fff',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 500 }}>Estimated Ultimate Recovery (P50)</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
                    {eurData.oil > 0 && (
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtVal(eurData.oil)}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>BBL Oil</div>
                      </div>
                    )}
                    {eurData.gas > 0 && (
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtVal(eurData.gas)}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>MCF Gas</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtVal(eurData.boe)}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>BOE Total</div>
                    </div>
                    {grossValue > 0 && (
                      <div style={{ borderLeft: '1px solid rgba(255,255,255,0.3)', paddingLeft: 24 }}>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtDollar(grossValue)}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>Est. Gross Lifetime Value</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
                    Based on {Math.round(compData.type_curve.max_month / 12)} years of comparable data
                    {grossValue > 0 && ` · At current prices (WTI $${prices.wti?.toFixed(0)}/bbl, HH $${prices.hh?.toFixed(2)}/MMBtu)`}
                    {compData.type_curve.max_month < 120 && ' · Well may have additional productive life beyond this window'}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Milestones table ── */}
          {compData.milestones.length > 0 && (
            <div style={{
              background: '#fff', borderRadius: 10, border: `1px solid ${BORDER}`,
              padding: '16px 20px', marginBottom: 16, overflowX: 'auto',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK, marginBottom: 10 }}>
                Production Milestones ({productLabel})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: SLATE }}>Month</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>P10 (Low)</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: BRAND_TEAL, fontWeight: 700 }}>P50 (Median)</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>P90 (High)</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>Wells</th>
                  </tr>
                </thead>
                <tbody>
                  {compData.milestones.map(m => {
                    const p10 = productView === 'gas' ? m.p10_gas : productView === 'oil' ? m.p10_oil : toBoe(m.p10_oil, m.p10_gas);
                    const p50 = productView === 'gas' ? m.p50_gas : productView === 'oil' ? m.p50_oil : toBoe(m.p50_oil, m.p50_gas);
                    const p90 = productView === 'gas' ? m.p90_gas : productView === 'oil' ? m.p90_oil : toBoe(m.p90_oil, m.p90_gas);
                    return (
                      <tr key={m.month} style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                          {m.month < 12 ? `Month ${m.month}` : `Year ${m.month / 12}`}
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>{Math.round(p10).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: BRAND_TEAL }}>{Math.round(p50).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>{Math.round(p90).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '6px 8px', color: SLATE }}>{m.well_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Disclaimer */}
          <div style={{
            fontSize: 11, color: SLATE, lineHeight: 1.6, marginTop: 8, padding: '12px 16px',
            background: '#f8fafc', borderRadius: 8, border: `1px solid ${BORDER}`,
          }}>
            <strong style={{ color: TEXT_DARK }}>Disclaimer:</strong> This forecast is generated using statistical analysis
            of comparable wells and AI-assisted interpretation. It is not a reserve report, engineering study, or
            investment recommendation. Production projections are estimates based on historical performance of similar
            wells and may not reflect the actual future performance of this well. Commodity prices, operating costs,
            regulatory changes, and reservoir conditions can materially affect actual results. Consult a qualified
            petroleum engineer or financial advisor before making investment decisions based on this data.
            Mineral Watch makes no warranty regarding the accuracy or completeness of this analysis.
          </div>

          {/* Print footer */}
          <div className="print-only" style={{ fontSize: 11, color: SLATE, textAlign: 'center', marginTop: 20, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
            Generated by Mineral Watch &middot; mymineralwatch.com &middot; {new Date().toLocaleDateString()}
          </div>
        </>
      )}

      {/* Insufficient comparables */}
      {compData?.cohort?.insufficient && (
        <div style={{ background: '#fef3c7', borderRadius: 10, border: '1px solid #f59e0b', padding: 20, textAlign: 'center', color: '#92400e', fontSize: 14 }}>
          Only {compData.cohort.count} comparable wells found — need at least 10 for a meaningful forecast.
        </div>
      )}
    </div>
  );
}
