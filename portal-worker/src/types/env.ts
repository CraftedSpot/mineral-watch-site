/**
 * Environment Types
 * 
 * TypeScript interfaces for Cloudflare Worker environment bindings
 */

/**
 * Environment interface for the Portal Worker
 * Includes all KV namespaces, environment variables, and secrets
 */
export interface Env {
  // KV Namespaces
  AUTH_TOKENS: KVNamespace;
  OCC_CACHE: KVNamespace;

  // Environment Variables (secrets)
  MINERAL_AIRTABLE_API_KEY: string;
  POSTMARK_API_KEY: string;
  AUTH_SECRET: string;
  STRIPE_SECRET_KEY: string;
  TRACK_WELL_SECRET: string;
}

/**
 * User object type from Airtable
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  plan?: string;
}

/**
 * Property object type from Airtable
 */
export interface Property {
  id: string;
  section: string;
  township: string;
  range: string;
  county: string;
  state: string;
}

/**
 * Well object type from Airtable
 */
export interface Well {
  id: string;
  apiNumber: string;
  wellName?: string;
  operator?: string;
  county?: string;
  status: string;
}