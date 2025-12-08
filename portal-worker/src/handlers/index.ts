/**
 * Handlers Index
 * 
 * Central re-export point for all portal worker handlers
 */

// Activity handlers
export {
  handleListActivity,
  handleActivityStats
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

// Auth handlers
export {
  handleSendMagicLink,
  handleVerifyToken,
  handleLogout,
  handleGetCurrentUser,
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