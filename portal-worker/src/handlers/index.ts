/**
 * Handlers Index
 * 
 * Central re-export point for all portal worker handlers
 */

// Activity handlers
export {
  handleListActivity,
  handleActivityStats,
  handleDeleteActivity
} from './activity.js';

// Property handlers
export {
  handleListProperties,
  handleAddProperty,
  handleUpdateProperty,
  handleDeleteProperty
} from './properties.js';

// Wells handlers
export {
  handleListWells,
  handleAddWell,
  handleDeleteWell,
  handleUpdateWellNotes,
  handleSearchWells,
  fetchWellDetailsFromOCC
} from './wells.js';

// Nearby wells handlers (D1 database queries)
export {
  handleNearbyWells,
  handleSurroundingWells
} from './nearby-wells.js';

// Well enrichment handlers
export {
  handleWellEnrichment
} from './well-enrichment.js';

export {
  handleBulkWellEnrichment
} from './well-enrichment-bulk.js';

// Auth handlers - most moved to auth-worker, keeping only registration
export {
  handleRegister
} from './auth.js';

// Sync handler
export {
  handleAirtableSync
} from './sync.js';

// Billing handlers
export {
  handleBillingPortal,
  handleUpgrade,
  handleUpgradeSuccess
} from './billing.js';

// Bulk upload handlers
export {
  handleBulkValidateProperties,
  handleBulkUploadProperties,
  handleBulkValidateWells,
  handleBulkUploadWells
} from './bulk.js';

// Track-well handlers
export {
  handleTrackThisWell,
  validateTrackToken,
  generateTrackWellSuccessPage,
  generateTrackWellErrorPage
} from './track-well.js';

// OCC proxy handler
export {
  handleOccProxy
} from './occ-proxy.js';

// Formation backfill handlers
export {
  handleBackfillFormations,
  handleGetFormationForActivity
} from './backfill-formations.js';

// Well locations backfill handler
export { default as handleBackfillWellLocations } from './backfill-well-locations.js';

// Statewide activity handler
export { handleStatewideActivity } from './statewide.js';

// Statewide activity backfill handler
export { handleBackfillStatewideActivity } from './backfill-statewide-activity.js';

// Organization handlers
export {
  handleGetOrganization,
  handleInviteMember,
  handleUpdateMemberRole,
  handleRemoveMember,
  handleUpdateOrganizationSettings
} from './organization.js';

// Property-well matching handler
export {
  handleMatchPropertyWells
} from './property-well-matching.js';

// Debug handler
export {
  handleDebugAirtable
} from './debug-airtable.js';

// Property-Wells handlers
export {
  handleGetPropertyLinkedWells,
  handleGetWellLinkedProperties,
  handleUnlinkPropertyWell
} from './property-wells.js';

// Single item matching handlers
export {
  handleMatchSingleProperty
} from './match-single-property.js';

export {
  handleMatchSingleWell
} from './match-single-well.js';

// Map data handlers
export {
  handleGetCounties,
  handleGetTownships,
  handleGetCountyStats,
  handleGetCountyProduction
} from './map-data.js';

// Map data version handler
export {
  handleGetMapDataVersion
} from './map-data-version.js';