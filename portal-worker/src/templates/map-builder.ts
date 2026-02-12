/**
 * Map Builder
 * Assembles the Oklahoma map page from component files at build time.
 * Mirrors the dashboard-builder.ts pattern: .txt extension prevents
 * esbuild from executing the JS, keeping it as raw string imports.
 */

// Shell HTML with placeholder comments
import shell from './map-shell.html';

// Shared utilities (same source files as dashboard — single source of truth)
import sharedAuth from './scripts/shared-auth.txt';
import sharedUtils from './scripts/shared-utils.txt';
import sharedConfig from './scripts/shared-display-config.txt';
import sharedOccHelpers from './scripts/shared-occ-helpers.txt';
import sharedDocHelpers from './scripts/shared-doc-helpers.txt';
import sharedOtcProduction from './scripts/shared-otc-production.txt';
import sharedOtcCss from './styles/shared-otc-production.txt';
import sharedOccFilings from './scripts/shared-occ-filings.txt';
import sharedCompletionReports from './scripts/shared-completion-reports.txt';
import sharedDrillingPermits from './scripts/shared-drilling-permits.txt';
import sharedOperatorDetail from './scripts/shared-operator-detail.txt';
import sharedDocDetail from './scripts/shared-document-detail.txt';

// Map-specific JS modules
import controls from './scripts/map-controls.txt';
import core from './scripts/map-core.txt';
import geo from './scripts/map-geo.txt';
import wellsTracked from './scripts/map-wells-tracked.txt';
import occ from './scripts/map-occ.txt';
import documents from './scripts/map-documents.txt';
import properties from './scripts/map-properties.txt';
import layers from './scripts/map-layers.txt';
import activity from './scripts/map-activity.txt';
import nearby from './scripts/map-nearby.txt';
import init from './scripts/map-init.txt';

// Assemble: replace placeholders with component content
// Use function replacements to prevent $-pattern interpretation in String.replace()
let html = shell;

html = html.replace('/* __MAP_SHARED_AUTH__ */\n', () => sharedAuth);
html = html.replace('/* __MAP_SHARED_UTILS__ */\n', () => sharedUtils);
html = html.replace('/* __MAP_SHARED_CONFIG__ */\n', () => sharedConfig);
html = html.replace('/* __MAP_SHARED_OCC_HELPERS__ */\n', () => sharedOccHelpers);
html = html.replace('/* __MAP_SHARED_DOC_HELPERS__ */\n', () => sharedDocHelpers);
html = html.replace('/* __SHARED_OTC_PRODUCTION__ */\n', () => sharedOtcProduction);
html = html.replace('/* __SHARED_OTC_CSS__ */\n', () => sharedOtcCss);
html = html.replace('/* __SHARED_OCC_FILINGS__ */\n', () => sharedOccFilings);
html = html.replace('/* __SHARED_COMPLETION_REPORTS__ */\n', () => sharedCompletionReports);
html = html.replace('/* __SHARED_DRILLING_PERMITS__ */\n', () => sharedDrillingPermits);
html = html.replace('/* __SHARED_OPERATOR_DETAIL__ */\n', () => sharedOperatorDetail);
html = html.replace('/* __SHARED_DOCUMENT_DETAIL__ */\n', () => sharedDocDetail);
html = html.replace('/* __MAP_CONTROLS__ */\n', () => controls);
html = html.replace('/* __MAP_CORE__ */\n', () => core);
html = html.replace('/* __MAP_GEO__ */\n', () => geo);
html = html.replace('/* __MAP_WELLS_TRACKED__ */\n', () => wellsTracked);
html = html.replace('/* __MAP_OCC__ */\n', () => occ);
html = html.replace('/* __MAP_DOCUMENTS__ */\n', () => documents);
html = html.replace('/* __MAP_PROPERTIES__ */\n', () => properties);
html = html.replace('/* __MAP_LAYERS__ */\n', () => layers);
html = html.replace('/* __MAP_ACTIVITY__ */\n', () => activity);
html = html.replace('/* __MAP_NEARBY__ */\n', () => nearby);
html = html.replace('/* __MAP_INIT__ */\n', () => init);

export default html;
