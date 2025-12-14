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
  fetchWellDetailsFromOCC
} from './wells.js';

// Auth handlers - most moved to auth-worker, keeping only registration
export {
  handleRegister
} from './auth.js';

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
  handleRemoveMember
} from './organization.js';