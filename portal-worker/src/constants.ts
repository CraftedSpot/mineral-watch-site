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

// Cache TTL
export const OCC_CACHE_TTL = 86400; // 24 hours in seconds

// CORS Headers
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
} as const;