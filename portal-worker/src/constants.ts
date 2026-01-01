/**
 * Portal Worker Constants
 * 
 * Centralized constants for the Mineral Watch Portal Worker
 */

// Authentication & Session Constants
export const COOKIE_NAME = "mw_session";
export const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
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
export const PLAN_LIMITS = {
  "Free": { properties: 1, wells: 1, activityRecords: 5 },
  "Starter": { properties: 10, wells: 10, activityRecords: 25 },
  "Standard": { properties: 50, wells: 50, activityRecords: 50 },
  "Professional": { properties: 250, wells: 250, activityRecords: 100 },
  "Enterprise 500": { properties: 500, wells: 500, activityRecords: 200 },
  "Enterprise 1K": { properties: 1000, wells: 1000, activityRecords: 500 },
  "Enterprise": { properties: Infinity, wells: Infinity, activityRecords: Infinity }
} as const;

// Cache TTL
export const OCC_CACHE_TTL = 86400; // 24 hours in seconds

// Validation Limits
export const MAX_NOTES_LENGTH = 1000;

// CORS Headers
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
} as const;

// Security Headers
export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://static.cloudflareinsights.com https://player.vimeo.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://r2cdn.perplexity.ai; img-src 'self' data: https://*.arcgisonline.com; frame-src 'self' blob: https://player.vimeo.com; connect-src 'self' https://player.vimeo.com https://*.vimeocdn.com;",
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
  enterprise_1k_monthly: 'price_PLACEHOLDER_ENT1K_MONTHLY', // $199/mo - TODO: Create in Stripe
  enterprise_1k_annual: 'price_PLACEHOLDER_ENT1K_ANNUAL'    // $1910/yr - TODO: Create in Stripe
} as const;

// Map price ID to plan name
export const PRICE_TO_PLAN = {
  [PRICE_IDS.starter_monthly]: 'Starter',
  [PRICE_IDS.starter_annual]: 'Starter',
  [PRICE_IDS.standard_monthly]: 'Standard',
  [PRICE_IDS.standard_annual]: 'Standard',
  [PRICE_IDS.professional_monthly]: 'Professional',
  [PRICE_IDS.professional_annual]: 'Professional',
  [PRICE_IDS.enterprise_1k_monthly]: 'Enterprise 1K',
  [PRICE_IDS.enterprise_1k_annual]: 'Enterprise 1K'
} as const;