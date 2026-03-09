import { BORDER, TEXT_DARK, SLATE } from '../../lib/constants';
import { useIsMobile } from '../../hooks/useIsMobile';
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

/**
 * Parse idle well insights into tiered lines.
 * Backend sends: title = "9 wells recently went idle"
 *                description = "Production dropped to zero in the last few months. 47 other wells remain idle long-term."
 *
 * We split description into recent + long-term sub-lines within the same card.
 */
function parseIdleTiers(insight: Insight): { recent: string; recentSub: string; longTerm: string | null; longTermSub: string } | null {
  if (!insight.title || !insight.title.includes('recently went idle')) return null;

  const desc = insight.description || '';
  const longTermMatch = desc.match(/(\d+)\s+other\s+well[s]?\s+remain[s]?\s+idle\s+long[- ]term/i);

  const recentSub = 'Production dropped to zero in the last few months';
  if (longTermMatch) {
    const count = longTermMatch[1];
    return {
      recent: insight.title,
      recentSub,
      longTerm: `${count} well${parseInt(count) !== 1 ? 's' : ''} idle long-term`,
      longTermSub: 'No production for 12+ months',
    };
  }

  return { recent: insight.title, recentSub, longTerm: null, longTermSub: '' };
}

export function InsightsPanel({ insights, loading, onOpenReport }: InsightsPanelProps) {
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <section style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: TEXT_DARK, margin: 0 }}>Alerts & Insights</h2>
          <span style={{ fontSize: 12, color: SLATE }}>Based on your portfolio</span>
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
        <span style={{ fontSize: 12, color: SLATE }}>Based on your portfolio</span>
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        {items.map((insight, i) => {
          const colors = SEVERITY_COLORS[insight.severity] || SEVERITY_COLORS.info;
          const idleTiers = parseIdleTiers(insight);

          // Idle well insight — render as tiered lines
          if (idleTiers) {
            const reportType = insight.actionId ? mapActionToReport(insight.actionId) : null;
            return (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12,
                  padding: '14px 16px',
                  borderBottom: i < items.length - 1 ? `1px solid ${BORDER}` : 'none',
                  flexDirection: isMobile ? 'column' : 'row',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Recent idle */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                      background: '#f59e0b',
                    }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_DARK }}>{idleTiers.recent}</div>
                      <div style={{ fontSize: 12, color: SLATE }}>{idleTiers.recentSub}</div>
                    </div>
                  </div>
                  {/* Long-term idle */}
                  {idleTiers.longTerm && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                        background: '#94a3b8',
                      }} />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: TEXT_DARK }}>{idleTiers.longTerm}</div>
                        <div style={{ fontSize: 12, color: SLATE }}>{idleTiers.longTermSub}</div>
                      </div>
                    </div>
                  )}
                </div>
                {reportType && (
                  <button
                    onClick={() => onOpenReport(reportType)}
                    style={{
                      flexShrink: 0, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                      border: 'none', borderRadius: 4, cursor: 'pointer',
                      background: colors.btnBg, color: colors.btnColor,
                      alignSelf: isMobile ? 'flex-start' : 'center',
                    }}
                  >
                    Review Wells
                  </button>
                )}
              </div>
            );
          }

          // Standard insight rendering
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12,
                padding: '14px 16px',
                borderBottom: i < items.length - 1 ? `1px solid ${BORDER}` : 'none',
                flexDirection: isMobile ? 'column' : 'row',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
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
                      alignSelf: isMobile ? 'flex-start' : 'center',
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
