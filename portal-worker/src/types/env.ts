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
  COMPLETIONS_CACHE: KVNamespace;

  // Service Bindings
  AUTH_WORKER: Fetcher;
  DOCUMENTS_WORKER?: Fetcher;
  OCC_FETCHER?: Fetcher;

  // D1 Database
  WELLS_DB?: D1Database;
  
  // MCP Services
  AIRTABLE?: any; // MCP Airtable service

  // Environment Variables (secrets)
  MINERAL_AIRTABLE_API_KEY: string;
  RESEND_API_KEY: string;
  AUTH_SECRET: string;
  STRIPE_SECRET_KEY: string;
  TRACK_WELL_SECRET: string;
  SYNC_API_KEY?: string;
  PROCESSING_API_KEY?: string;
  OTC_SYNC_AUTH_TOKEN?: string;  // Auth token for triggering OTC Fly machine

  // OKCountyRecords integration
  OKCR_API_KEY?: string;
  OKCR_API_BASE?: string;
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

/**
 * Completion data from KV cache
 */
export interface CompletionData {
  api: string;
  wellName?: string;
  operator?: string;
  county?: string;
  
  // Location data
  surfaceSection?: string;
  surfaceTownship?: string;
  surfaceRange?: string;
  bhSection?: string;
  bhTownship?: string;
  bhRange?: string;
  
  // Production data
  formationName?: string;
  formationDepth?: number;
  ipGas?: number;
  ipOil?: number;
  ipWater?: number;
  pumpingFlowing?: string;
  
  // Timeline data
  spudDate?: string;
  completionDate?: string;
  firstProdDate?: string;
  
  // Well details
  drillType?: string;
  lateralLength?: number;
  totalDepth?: number;
  wellNumber?: string;
  leaseName?: string;
  
  // Metadata
  cachedAt: number;
  source: string;
}