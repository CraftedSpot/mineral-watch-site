/**
 * Credit-Based Document Processing Limits
 *
 * Credit calculation:
 * - 1 document = 1 credit (regardless of page count)
 * - "Other" with skip_extraction = 0 credits (free classification only)
 *
 * Two credit buckets:
 * - Monthly credits: Use-or-lose, reset each billing cycle
 * - Permanent credits: Bonus (annual) + purchased packs, never expire
 *
 * Consumption order: Monthly first, then permanent
 */

export interface TierLimit {
  monthly: number;           // Monthly credit allowance (use-or-lose)
  bonus: number;            // Permanent bonus credits for annual subscriptions
  isLifetime?: boolean;     // Special handling for lifetime free tier (no monthly reset)
}

export const TIER_LIMITS: Record<string, TierLimit> = {
  // Free tier - 10 lifetime credits (trial, not monthly)
  'Free': {
    monthly: 0,       // No monthly allocation
    bonus: 10,        // 10 lifetime credits as trial
    isLifetime: true
  },

  // Paid tiers - monthly reset + bonus for annual
  'Starter': {
    monthly: 10,
    bonus: 75         // 75 permanent credits for annual (~7.5 months worth)
  },

  'Standard': {
    monthly: 25,
    bonus: 300        // 300 permanent credits for annual (12 months worth)
  },

  'Professional': {
    monthly: 50,
    bonus: 1000       // 1000 permanent credits for annual (20 months worth)
  },

  // Business tier (renamed from Enterprise 500)
  'Business': {
    monthly: 100,
    bonus: 2500       // 2500 permanent credits for annual (25 months worth)
  },

  // Enterprise - white glove, effectively unlimited
  'Enterprise': {
    monthly: 250,
    bonus: 10000      // Large bonus pool for annual enterprise
  }
};

// Helper functions
export function getTierLimit(plan: string): TierLimit {
  return TIER_LIMITS[plan] || TIER_LIMITS['Free'];
}

export function getCurrentBillingPeriod(date: Date = new Date()): string {
  // Returns YYYY-MM-01 for the start of the billing month
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

export function getNextBillingPeriod(currentPeriod: string): string {
  const date = new Date(currentPeriod);
  date.setMonth(date.getMonth() + 1);
  return getCurrentBillingPeriod(date);
}