/**
 * Portal Worker Constants
 * 
 * Centralized constants for the Mineral Watch Portal Worker
 */

// Authentication & Session Constants
export const COOKIE_NAME = "mw_session";
export const TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
export const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

// Airtable Configuration
export const BASE_ID = "app3j3X29Uvp5stza";
export const USERS_TABLE = "👤 Users";
export const PROPERTIES_TABLE = "📍 Client Properties";
export const WELLS_TABLE = "🛢️ Client Wells";
export const ACTIVITY_TABLE = "📋 Activity Log";

// Application URLs
export const BASE_URL = "https://portal.mymineralwatch.com";

// Plan Limits Configuration
export const PLAN_LIMITS = {
  "Free": { properties: 1, wells: 1 },
  "Starter": { properties: 10, wells: 10 },
  "Standard": { properties: 50, wells: 50 },
  "Professional": { properties: 250, wells: 250 },
  "Enterprise": { properties: Infinity, wells: Infinity }
} as const;

// Plan-based activity history limits (in days)
export const ACTIVITY_LIMITS = {
  "Free": 7,
  "Starter": 30,
  "Standard": 90,
  "Professional": 365 * 10,  // 10 years = essentially unlimited
  "Enterprise": 365 * 10
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

// Stripe Price IDs - NEW pricing
export const PRICE_IDS = {
  starter_monthly: 'price_1SXDS9641UqM8A7NeSc0MOTv',    // $9/mo
  starter_annual: 'price_1SXDSG641UqM8A7N9PbCLsvG',     // $86/yr
  standard_monthly: 'price_1SXDSL641UqM8A7NSS10CWBd',   // $29/mo
  standard_annual: 'price_1SXDSQ641UqM8A7NIWcuCzmp',    // $278/yr
  professional_monthly: 'price_1SXDSV641UqM8A7NZTXdvUls', // $99/mo
  professional_annual: 'price_1SXDSZ641UqM8A7NvTHEJy9s'   // $950/yr
} as const;

// Map price ID to plan name
export const PRICE_TO_PLAN = {
  [PRICE_IDS.starter_monthly]: 'Starter',
  [PRICE_IDS.starter_annual]: 'Starter',
  [PRICE_IDS.standard_monthly]: 'Standard',
  [PRICE_IDS.standard_annual]: 'Standard',
  [PRICE_IDS.professional_monthly]: 'Professional',
  [PRICE_IDS.professional_annual]: 'Professional'
} as const;