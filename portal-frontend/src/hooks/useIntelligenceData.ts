import { useState, useEffect } from 'react';
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
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [tier, setTier] = useState<IntelligenceTier>('none');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fire both in parallel — each renders independently as it resolves
        const [summaryResult, insightsResult] = await Promise.allSettled([
          fetchSummary(),
          fetchInsights(),
        ]);

        if (cancelled) return;

        if (summaryResult.status === 'fulfilled') {
          setSummary(summaryResult.value);
          setTier(summaryResult.value._intelligence_tier || 'none');
        } else {
          setError('Failed to load intelligence data');
        }

        if (insightsResult.status === 'fulfilled') {
          setInsights(insightsResult.value.insights || []);
        }
      } catch {
        if (!cancelled) setError('Failed to load intelligence data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { summary, insights, tier, loading, error };
}
