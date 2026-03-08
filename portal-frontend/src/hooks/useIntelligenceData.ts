import { useQuery } from '@tanstack/react-query';
import { fetchSummary, fetchInsights } from '../api/intelligence';
import type { SummaryData, Insight, IntelligenceTier } from '../types/intelligence';

interface IntelligenceDataState {
  summary: SummaryData | null;
  insights: Insight[];
  tier: IntelligenceTier;
  loading: boolean;
  error: string | null;
}

export function useIntelligenceData(): IntelligenceDataState {
  const summaryQuery = useQuery({
    queryKey: ['intelligence', 'summary'],
    queryFn: fetchSummary,
    staleTime: 30 * 60 * 1000,  // 30 min — only changes on daily cron
  });

  const insightsQuery = useQuery({
    queryKey: ['intelligence', 'insights'],
    queryFn: () => fetchInsights().then(r => r.insights),
    staleTime: 30 * 60 * 1000,
  });

  const summary = summaryQuery.data ?? null;
  const tier: IntelligenceTier = summary?._intelligence_tier || 'none';

  return {
    summary,
    insights: insightsQuery.data ?? [],
    tier,
    loading: summaryQuery.isLoading,
    error: summaryQuery.error
      ? (summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Failed to load intelligence data')
      : null,
  };
}
