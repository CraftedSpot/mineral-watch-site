/**
 * Credit-Based Document Processing Limits
 * 
 * Credit calculation:
 * - 1-30 pages = 1 credit (most documents)
 * - 31-60 pages = 2 credits
 * - 61-90 pages = 3 credits, etc.
 * - "Other" with skip_extraction = 0 credits (free classification)
 * 
 * Note: Currently for tracking only - not enforced
 */

export interface TierLimit {
  monthly: number;           // Base monthly credit allowance
  bonus: number;            // Bonus credits for annual subscriptions
  isLifetime?: boolean;     // Special handling for lifetime free tier
  overage_price?: number;   // Price per credit over limit (future)
}

export const TIER_LIMITS: Record<string, TierLimit> = {
  // Free tier - lifetime allowance
  'Free': { 
    monthly: 5, 
    bonus: 0, 
    isLifetime: true 
  },
  
  // Paid tiers - monthly reset
  'Starter': { 
    monthly: 25, 
    bonus: 50,        // 50 bonus credits for annual (2 months worth)
    overage_price: 0.50 
  },
  
  'Standard': { 
    monthly: 100, 
    bonus: 250,       // 250 bonus credits for annual (2.5 months worth)
    overage_price: 0.40 
  },
  
  'Professional': { 
    monthly: 500, 
    bonus: 1000,      // 1000 bonus credits for annual (2 months worth)
    overage_price: 0.30 
  },
  
  // Enterprise tiers - custom limits
  'Enterprise 500': { 
    monthly: 2000,    // High enough to be effectively unlimited
    bonus: 0,
    overage_price: 0.25 
  },
  
  'Enterprise': { 
    monthly: 99999,   // Effectively unlimited
    bonus: 0,
    overage_price: 0.20 
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