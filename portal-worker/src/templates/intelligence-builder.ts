/**
 * Intelligence Builder
 * Assembles the Intelligence page from component files at build time.
 * Follows the same pattern as map-builder.ts and dashboard-builder.ts.
 */

// Shell HTML with placeholder comments
import shell from './intelligence-shell.html';

// CSS
import baseCss from './styles/intelligence-base.txt';

// Shared utilities
import sharedAuth from './scripts/shared-auth.txt';
import sharedOccHelpers from './scripts/shared-occ-helpers.txt';
import sharedDocHelpers from './scripts/shared-doc-helpers.txt';
import sharedOccFilings from './scripts/shared-occ-filings.txt';
import sharedCompletionReports from './scripts/shared-completion-reports.txt';
import sharedDrillingPermits from './scripts/shared-drilling-permits.txt';
import sharedOtcProduction from './scripts/shared-otc-production.txt';
import sharedOtcCss from './styles/shared-otc-production.txt';
import sharedDocumentDetail from './scripts/shared-document-detail.txt';
import sharedWellDetail from './scripts/shared-well-detail.txt';

// JS modules
import initJs from './scripts/intelligence-init.txt';
import insightsJs from './scripts/intelligence-insights.txt';
import questionsJs from './scripts/intelligence-questions.txt';
import reportsJs from './scripts/intelligence-reports.txt';
import operatorsJs from './scripts/intelligence-operators.txt';
import virtualScrollJs from './scripts/virtual-scroll.txt';

// Report CSS
import reportsCss from './styles/intelligence-reports.txt';
import virtualScrollCss from './styles/virtual-scroll.txt';

// Assemble: replace placeholders with component content
let html = shell;

// CSS
html = html.replace('/* __INTEL_CSS__ */\n', () => baseCss);

// Report CSS
html = html.replace('/* __INTEL_REPORTS_CSS__ */\n', () => reportsCss);
html = html.replace('/* __VIRTUAL_SCROLL_CSS__ */\n', () => virtualScrollCss);
html = html.replace('/* __SHARED_OTC_CSS__ */\n', () => sharedOtcCss);

// JS — shared modules (must load before intelligence modules)
html = html.replace('/* __SHARED_AUTH__ */\n', () => sharedAuth);
html = html.replace('/* __SHARED_OCC_HELPERS__ */\n', () => sharedOccHelpers);
html = html.replace('/* __SHARED_DOC_HELPERS__ */\n', () => sharedDocHelpers);
html = html.replace('/* __SHARED_OCC_FILINGS__ */\n', () => sharedOccFilings);
html = html.replace('/* __SHARED_COMPLETION_REPORTS__ */\n', () => sharedCompletionReports);
html = html.replace('/* __SHARED_DRILLING_PERMITS__ */\n', () => sharedDrillingPermits);
html = html.replace('/* __SHARED_OTC_PRODUCTION__ */\n', () => sharedOtcProduction);
html = html.replace('/* __SHARED_DOCUMENT_DETAIL__ */\n', () => sharedDocumentDetail);
html = html.replace('/* __SHARED_WELL_DETAIL__ */\n', () => sharedWellDetail);
html = html.replace('/* __INTEL_INIT__ */\n', () => initJs);
html = html.replace('/* __INTEL_INSIGHTS__ */\n', () => insightsJs);
html = html.replace('/* __INTEL_QUESTIONS__ */\n', () => questionsJs);
html = html.replace('/* __VIRTUAL_SCROLL__ */\n', () => virtualScrollJs);
html = html.replace('/* __INTEL_REPORTS__ */\n', () => reportsJs);
html = html.replace('/* __INTEL_OPERATORS__ */\n', () => operatorsJs);

export default html;
