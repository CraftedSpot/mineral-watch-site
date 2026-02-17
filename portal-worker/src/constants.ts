/**
 * Portal Worker Constants
 * 
 * Centralized constants for the Mineral Watch Portal Worker
 */

// Authentication & Session Constants
export const COOKIE_NAME = "mw_session_v4";
export const TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes (matches email text and KV TTL)
export const INVITE_TOKEN_EXPIRY = 72 * 60 * 60 * 1000; // 72 hours (for organization invites)
export const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

// Airtable Configuration
export const BASE_ID = "app3j3X29Uvp5stza";
export const USERS_TABLE = "👤 Users";
export const ORGANIZATION_TABLE = "🏢 Organization";
export const PROPERTIES_TABLE = "📍 Client Properties";
export const WELLS_TABLE = "🛢️ Client Wells";
export const ACTIVITY_TABLE = "📋 Activity Log";
export const WELL_LOCATIONS_TABLE = "📍 Well Locations";

// Application URLs
export const BASE_URL = "https://portal.mymineralwatch.com";

// Plan Limits Configuration
// Note: Additional seats can be purchased separately (TODO: implement seat purchasing)
export const PLAN_LIMITS = {
  "Free": { properties: 1, wells: 1, activityRecords: 5, seats: 1, docCreditsMonthly: 3, docCreditsBonus: 0 },
  "Starter": { properties: 10, wells: 10, activityRecords: 25, seats: 1, docCreditsMonthly: 10, docCreditsBonus: 75 },
  "Standard": { properties: 50, wells: 50, activityRecords: 50, seats: 1, docCreditsMonthly: 25, docCreditsBonus: 300 },
  "Professional": { properties: 250, wells: 250, activityRecords: 100, seats: 1, docCreditsMonthly: 50, docCreditsBonus: 1000 },
  "Business": { properties: 500, wells: 500, activityRecords: 200, seats: 3, docCreditsMonthly: 100, docCreditsBonus: 2500 },
  "Enterprise 1K": { properties: 1000, wells: 1000, activityRecords: 500, seats: 5, docCreditsMonthly: 150, docCreditsBonus: 5000 }
} as const;

// Safe plan limits lookup with fallback to Free
export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS['Free'];
}

// Super Admin Emails
// These users can act on behalf of any org/user (white-glove onboarding, troubleshooting)
export const SUPER_ADMIN_EMAILS = [
  'james@mymineralwatch.com'
] as const;

// Cache TTL
export const OCC_CACHE_TTL = 86400; // 24 hours in seconds

// Validation Limits
export const MAX_NOTES_LENGTH = 1000;

// CORS Headers
// Restricted to portal domain. For same-origin calls (portal serving its own API),
// CORS headers are ignored by browsers. This prevents cross-origin data reads.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://portal.mymineralwatch.com",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
} as const;

// Security Headers
export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://static.cloudflareinsights.com https://player.vimeo.com https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://r2cdn.perplexity.ai; img-src 'self' data: blob: https://*.arcgisonline.com; frame-src 'self' blob: https://player.vimeo.com; connect-src 'self' https://mymineralwatch.com https://*.mymineralwatch.com https://player.vimeo.com https://*.vimeocdn.com https://unpkg.com; worker-src 'self' blob:;",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin"
} as const;

// Stripe Price IDs - LIVE MODE
export const PRICE_IDS = {
  starter_monthly: 'price_1SZZbv9OfJmRCDOqciJ5AIlK',    // $9/mo
  starter_annual: 'price_1SZZbv9OfJmRCDOqhN2HIBtc',     // $86/yr
  standard_monthly: 'price_1SZZbu9OfJmRCDOquBBFk0dY',   // $29/mo
  standard_annual: 'price_1SZZbu9OfJmRCDOqYZm2Hbi6',    // $278/yr
  professional_monthly: 'price_1SZZbu9OfJmRCDOqOp2YjT1N', // $99/mo
  professional_annual: 'price_1SZZbt9OfJmRCDOquMh7kSyI',  // $950/yr
  business_monthly: 'price_1SoRkO9OfJmRCDOqJHItcg9T',  // $249/mo
  business_annual: 'price_1SoSwV9OfJmRCDOqxmuF4aBI',    // $2,390/yr
  enterprise_monthly: 'price_1SwRTW9OfJmRCDOqY3T0V1t5',  // $499/mo
  enterprise_annual: 'price_1SwRWG9OfJmRCDOqDBOrwul2'     // $4,790/yr
} as const;

// Map price ID to plan name
export const PRICE_TO_PLAN = {
  [PRICE_IDS.starter_monthly]: 'Starter',
  [PRICE_IDS.starter_annual]: 'Starter',
  [PRICE_IDS.standard_monthly]: 'Standard',
  [PRICE_IDS.standard_annual]: 'Standard',
  [PRICE_IDS.professional_monthly]: 'Professional',
  [PRICE_IDS.professional_annual]: 'Professional',
  [PRICE_IDS.business_monthly]: 'Business',
  [PRICE_IDS.business_annual]: 'Business',
  [PRICE_IDS.enterprise_monthly]: 'Enterprise 1K',
  [PRICE_IDS.enterprise_annual]: 'Enterprise 1K'
} as const;