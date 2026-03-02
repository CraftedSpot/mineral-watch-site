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

// Property handlers (handleListProperties V1 removed — Airtable-based, deprecated)
export {
  handleListPropertiesV2,
  handleAddProperty,
  handleUpdateProperty,
  handleDeleteProperty
} from './properties.js';

// Property link counts handler
export {
  handleGetPropertyLinkCounts
} from './property-link-counts.js';

// Wells handlers
export {
  handleListWellsV2,
  handleAddWell,
  handleDeleteWell,
  handleUpdateWellNotes,
  handleUpdateWellInterests,
  handleSearchWells,
  fetchWellDetailsFromOCC
} from './wells.js';

// Well link counts handler
export {
  handleGetWellLinkCounts
} from './well-link-counts.js';

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

// Auth handlers — all consolidated into portal-worker
export {
  handleRegister,
  handleSendMagicLink,
  handleVerifyMagicLink,
  handleGetCurrentUser,
  handleLogout
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

// backfill-formations.ts deleted — handleBackfillFormations + handleGetFormationForActivity removed

// Well locations backfill handler
export { default as handleBackfillWellLocations } from './backfill-well-locations.js';

// Statewide activity handler
export { handleStatewideActivity } from './statewide.js';

// backfill-statewide-activity.ts deleted — handleBackfillStatewideActivity removed

// Section centers backfill handler
export { handleBackfillSectionCenters } from './backfill-section-centers.js';

// BH coordinates backfill handler
export { handleBackfillBhCoordinates } from './backfill-bh-coordinates.js';

// Completion report write-back backfill handler
export { handleBackfillCompletionWriteback } from './backfill-completion-writeback.js';

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
  handleMatchPropertyWells,
  handleDiscoverAndTrackWells
} from './property-well-matching.js';

// debug-airtable.ts deleted — handleDebugAirtable removed

// Property-Wells handlers
export {
  handleGetPropertyLinkedWells,
  handleGetWellLinkedProperties,
  handleUnlinkPropertyWell,
  handleRelinkPropertyWell
} from './property-wells.js';

// match-single-property.ts + match-single-well.ts deleted — replaced by D1 matching pipeline

// Map data handlers
export {
  handleGetCounties,
  handleGetTownships,
  handleGetCountyStats,
  handleGetCountyProduction,
  handleGetPoolingRates,
  handleGetPoolingOrders,
  handleGetOperatorActivity,
  handleGetAreaFilings
} from './map-data.js';

// Map data version handler
export {
  handleGetMapDataVersion
} from './map-data-version.js';

// Docket heatmap handler
export {
  handleGetDocketHeatmap
} from './docket-heatmap.js';

// OTC file sync handlers
export {
  handleGetOtcSyncFiles,
  handleCheckOtcFile,
  handleCheckOtcFilesBatch,
  handleRecordOtcFile
} from './otc-file-sync.js';

// OTC production upload handlers
export {
  handleUploadProductionData,
  handleGetProductionStats,
  handleUploadPunProductionData,
  handleComputePunRollups,
  handleGetPunProductionStats,
  handleTruncatePunProduction,
  handleValidateNormalization,
  handleCrosswalkDiagnostics,
  handlePromotePunLinks,
  handleWellsMissingPuns
} from './otc-production-upload.js';

// OTC financial upload handlers
export {
  handleUploadFinancialData,
  handleGetFinancialStats,
  handleTruncateFinancial
} from './otc-financial-upload.js';

// OTC supplementary upload handlers (leases, companies, tax periods, exemptions)
export {
  handleUploadOtcLeases,
  handleUploadOtcCompanies,
  handleUpdateLeaseOperators,
  handleUploadOtcTaxPeriods,
  handleUploadOtcExemptions
} from './otc-supplementary-upload.js';

// Completion reports handlers
export {
  handleGetCompletionReports,
  handleAnalyzeCompletion,
  handleGetProductionSummary,
  handleGetDecimalInterest
} from './completion-reports.js';

// Drilling permits handlers (Form 1000)
export {
  handleGetDrillingPermits,
  handleAnalyzePermit,
  handleSyncPermitToWell
} from './drilling-permits.js';

// Completions-to-wells sync handlers
export {
  handleSyncCompletionsToWells,
  handleSyncSingleCompletion
} from './sync-completions-to-wells.js';

// Unit print report handlers
export {
  handleUnitPrint,
  handleUnitPrintData
} from './unit-print.js';

// Document print report handler
export {
  handleDocumentPrint
} from './document-print.js';

// PLSS sections handlers
export {
  handleGetPlssSection,
  handleGetPlssSectionsBatch
} from './plss-sections.js';

// Tools revenue estimator handler
export {
  handlePropertyProduction,
  handleWellProduction
} from './tools-revenue.js';

// Dashboard counts handler (lightweight usage bar counts)
export {
  handleGetDashboardCounts
} from './dashboard-counts.js';

// County records handlers (OKCountyRecords integration)
export {
  handleCountyRecordsCounties,
  handleCountyRecordsInstrumentTypes,
  handleCountyRecordsSearch,
  handleCountyRecordsRetrieve
} from './county-records.js';

// Admin dashboard handlers
export {
  handleAdminUsers,
  handleAdminAttention,
  handleAdminUserDetail,
  handleAdminHealth,
  handleAdminActivity,
  handleAdminBilling,
  handleAdminNotesList,
  handleAdminNotesCreate,
  handleAdminNotesUpdate,
  handleAdminNotesDelete
} from './admin-dashboard.js';