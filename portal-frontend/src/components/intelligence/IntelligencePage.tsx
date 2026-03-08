import { useState, useRef, lazy, Suspense } from 'react';
import { useIntelligenceData } from '../../hooks/useIntelligenceData';
import { useIsMobile } from '../../hooks/useIsMobile';
import { SummaryCards } from './SummaryCards';
import { InsightsPanel } from './InsightsPanel';
import { ReportGrid } from './ReportGrid';
import { UpgradeBanner } from './UpgradeBanner';
import { ReportErrorBoundary } from './ReportErrorBoundary';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { TEXT_DARK, SLATE } from '../../lib/constants';
import type { ReportType } from '../../types/intelligence';

// Lazy-loaded report components
const DeductionReport = lazy(() => import('./reports/DeductionReport').then(m => ({ default: m.DeductionReport })));
const ProductionDeclineReport = lazy(() => import('./reports/ProductionDeclineReport').then(m => ({ default: m.ProductionDeclineReport })));
const ShutInDetectorReport = lazy(() => import('./reports/ShutInDetectorReport').then(m => ({ default: m.ShutInDetectorReport })));
const PoolingReport = lazy(() => import('./reports/PoolingReport').then(m => ({ default: m.PoolingReport })));
const OccFilingReport = lazy(() => import('./reports/OccFilingReport').then(m => ({ default: m.OccFilingReport })));
const WellRiskProfileReport = lazy(() => import('./reports/WellRiskProfileReport').then(m => ({ default: m.WellRiskProfileReport })));
const OperatorEfficiency = lazy(() => import('./operators/OperatorEfficiency').then(m => ({ default: m.OperatorEfficiency })));
const OperatorDirectory = lazy(() => import('./operators/OperatorDirectory').then(m => ({ default: m.OperatorDirectory })));

const REPORT_TITLES: Record<ReportType, string> = {
  'deduction': 'Residue Gas Deduction Audit',
  'production-decline': 'Production Decline Analysis',
  'pooling': 'Pooling Rate Comparison',
  'shut-in': 'Shut-In Detector',
  'occ-filing': 'OCC Filing Activity',
  'well-risk': 'Well Risk Profile',
  'operator-efficiency': 'Operator Efficiency Index',
  'operator-directory': 'Operator Directory',
};

const PRINT_URLS: Partial<Record<ReportType, string>> = {
  'deduction': '/print/intelligence/deduction-audit',
  'production-decline': '/print/intelligence/production-decline',
  'shut-in': '/print/intelligence/shut-in-detector',
  'pooling': '/print/intelligence/pooling',
};

export function IntelligencePage() {
  const { summary, insights, tier, loading, error } = useIntelligenceData();
  const [activeReport, setActiveReport] = useState<ReportType | null>(null);
  const [initialTab, setInitialTab] = useState<string | undefined>();
  const insightsRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const openReport = (type: ReportType, tab?: string) => {
    setActiveReport(type);
    setInitialTab(tab);
    window.scrollTo(0, 0);
  };

  const closeReport = () => {
    setActiveReport(null);
    setInitialTab(undefined);
  };

  const scrollToInsights = () => {
    insightsRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Tier=none: show upgrade banner
  if (!loading && tier === 'none') {
    return <UpgradeBanner />;
  }

  // Report viewer mode
  if (activeReport) {
    const title = REPORT_TITLES[activeReport];
    const printUrl = PRINT_URLS[activeReport];

    return (
      <div>
        {/* Report header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px' : '16px 24px' }}>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13 }}>
              <button
                onClick={closeReport}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#3b82f6', fontSize: 13, padding: 0, fontFamily: 'inherit',
                }}
              >
                Intelligence
              </button>
              <svg viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="2"
                style={{ width: 12, height: 12 }}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ color: TEXT_DARK }}>{title}</span>
            </div>
            {/* Title + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>{title}</h1>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={closeReport}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
                    padding: '6px 12px', fontSize: 13, cursor: 'pointer',
                    color: TEXT_DARK, fontFamily: 'inherit',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                    <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back
                </button>
                {printUrl && (
                  <button
                    onClick={() => window.open(printUrl, '_blank')}
                    style={{
                      background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
                      padding: '6px 12px', fontSize: 13, cursor: 'pointer',
                      color: TEXT_DARK, fontFamily: 'inherit',
                    }}
                  >
                    Print Summary
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Report content */}
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '16px' : '20px 24px' }}>
          <ReportErrorBoundary reportName={title}>
            <Suspense fallback={<LoadingSkeleton columns={4} rows={6} />}>
              {activeReport === 'deduction' && <DeductionReport tier={tier} initialTab={initialTab} />}
              {activeReport === 'production-decline' && <ProductionDeclineReport tier={tier} />}
              {activeReport === 'shut-in' && <ShutInDetectorReport tier={tier} />}
              {activeReport === 'pooling' && <PoolingReport />}
              {activeReport === 'occ-filing' && <OccFilingReport />}
              {activeReport === 'well-risk' && <WellRiskProfileReport />}
              {activeReport === 'operator-efficiency' && <OperatorEfficiency />}
              {activeReport === 'operator-directory' && <OperatorDirectory />}
            </Suspense>
          </ReportErrorBoundary>
        </div>
      </div>
    );
  }

  // Main intelligence page
  return (
    <div>
      <SummaryCards
        data={summary}
        insightCount={insights.length}
        loading={loading}
        onOpenReport={openReport}
        onScrollToInsights={scrollToInsights}
      />

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '20px 16px' : '24px 24px' }}>
        {error && (
          <div style={{
            padding: 16, marginBottom: 16, borderRadius: 8,
            background: '#fef2f2', color: '#dc2626', fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <div ref={insightsRef}>
          <InsightsPanel
            insights={insights}
            loading={loading}
            onOpenReport={openReport}
          />
        </div>

        <ReportGrid tier={tier} onOpenReport={openReport} />
      </div>
    </div>
  );
}
