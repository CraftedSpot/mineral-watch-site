import { BORDER, TEXT_DARK, SLATE } from '../../lib/constants';
import type { Insight, ReportType } from '../../types/intelligence';

interface InsightsPanelProps {
  insights: Insight[];
  loading: boolean;
  onOpenReport: (type: ReportType) => void;
}

const SEVERITY_COLORS: Record<string, { indicator: string; btnBg: string; btnColor: string }> = {
  critical: { indicator: '#dc2626', btnBg: '#dc2626', btnColor: '#fff' },
  warning: { indicator: '#f59e0b', btnBg: '#fef3c7', btnColor: '#92400e' },
  success: { indicator: '#16a34a', btnBg: '#dcfce7', btnColor: '#166534' },
  info: { indicator: '#3b82f6', btnBg: '#dbeafe', btnColor: '#1e40af' },
};

function mapActionToReport(actionId: string): ReportType | null {
  switch (actionId) {
    case 'deduction-audit': return 'deduction';
    case 'pooling-report': return 'pooling';
    case 'shut-in-review': return 'shut-in';
    default: return null;
  }
}

export function InsightsPanel({ insights, loading, onOpenReport }: InsightsPanelProps) {
  if (loading) {
    return (
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>Alerts & Insights</h2>
          <span style={{ fontSize: 12, color: SLATE }}>Based on your portfolio data</span>
        </div>
        <div style={{
          border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20,
          background: '#fff', color: SLATE, fontSize: 14,
        }}>
          Analyzing your portfolio...
        </div>
      </section>
    );
  }

  const items = insights.length > 0 ? insights : [{
    severity: 'info' as const,
    title: 'Getting started',
    description: 'Add properties and wells to your dashboard, then come back here for personalized insights based on your portfolio.',
  }];

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>Alerts & Insights</h2>
        <span style={{ fontSize: 12, color: SLATE }}>Based on your portfolio data</span>
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        {items.map((insight, i) => {
          const colors = SEVERITY_COLORS[insight.severity] || SEVERITY_COLORS.info;
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px',
                borderBottom: i < items.length - 1 ? `1px solid ${BORDER}` : 'none',
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                background: colors.indicator,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {insight.title && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK, marginBottom: 2 }}>
                    {insight.title}
                  </div>
                )}
                <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.5 }}>
                  {insight.description}
                </div>
              </div>
              {insight.action && insight.actionId && (() => {
                const reportType = mapActionToReport(insight.actionId!);
                if (!reportType) return null;
                return (
                  <button
                    onClick={() => onOpenReport(reportType)}
                    style={{
                      flexShrink: 0, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                      border: 'none', borderRadius: 4, cursor: 'pointer',
                      background: colors.btnBg, color: colors.btnColor,
                    }}
                  >
                    {insight.action}
                  </button>
                );
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}
