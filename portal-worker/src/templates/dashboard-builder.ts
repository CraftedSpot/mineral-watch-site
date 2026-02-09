/**
 * Dashboard Builder
 * Assembles the dashboard from component files at build time.
 * Wrangler's esbuild imports .html and .css files as strings.
 * We replace placeholder comments in the shell with actual content.
 */

// Shell HTML with placeholder comments
import shell from './dashboard-shell.html';

// CSS components (imported as text via .txt extension — esbuild extracts .css to separate files)
import baseCss from './styles/dashboard-base.txt';
import documentsCssRaw from './styles/dashboard-documents.txt';

// Shared utilities (used by both dashboard and map)
import sharedAuth from './scripts/shared-auth.txt';
import sharedUtils from './scripts/shared-utils.txt';
import sharedDisplayConfig from './scripts/shared-display-config.txt';
import sharedOccHelpers from './scripts/shared-occ-helpers.txt';
import sharedDocHelpers from './scripts/shared-doc-helpers.txt';
import sharedListController from './scripts/shared-list-controller.txt';
import sharedOtcProduction from './scripts/shared-otc-production.txt';
import sharedOtcCss from './styles/shared-otc-production.txt';
import sharedOccFilings from './scripts/shared-occ-filings.txt';
import sharedDocDetail from './scripts/shared-document-detail.txt';

// JS components (imported as text via .txt extension — esbuild would execute .js)
import utilsJsRaw from './scripts/dashboard-utils.txt';
import propertiesJsRaw from './scripts/dashboard-properties.txt';
import wellsJsRaw from './scripts/dashboard-wells.txt';
import activityJs from './scripts/dashboard-activity.txt';
import productionJs from './scripts/dashboard-production.txt';
import documentsJsRaw from './scripts/dashboard-documents.txt';
import occJs from './scripts/dashboard-occ.txt';
import initJs from './scripts/dashboard-init.txt';
import bulkJsRaw from './scripts/dashboard-bulk.txt';

// HTML partials
import addPropertyModal from './partials/modal-add-property.html';
import propertyDetailsModal from './partials/modal-property-details.html';
import addWellModal from './partials/modal-add-well.html';
import wellDetailsModal from './partials/modal-well-details.html';
import documentModalsRaw from './partials/modal-documents.html';
import bulkModalsRaw from './partials/modal-bulk-upload.html';

// Documents CSS has two blocks separated by a split marker
// (credit pack hover styles + document upload styles)
const [documentsCssA, documentsCssB] = documentsCssRaw.split('/* __SPLIT__ */\n');

// Utils JS has two blocks: core utilities (start of script) + toast/confirm (end of script)
const [utilsJsA, utilsJsB] = utilsJsRaw.split('/* __SPLIT_UTILS_B__ */\n');

// Properties JS has 4 blocks: tab core, add modal, details functions, save/close
const [propsA, propsRest1] = propertiesJsRaw.split('/* __SPLIT_PROPS_B__ */\n');
const [propsB, propsRest2] = propsRest1.split('/* __SPLIT_PROPS_C__ */\n');
const [propsC, propsD] = propsRest2.split('/* __SPLIT_PROPS_D__ */\n');

// Wells JS has 4 blocks: tab core, add modal handlers, search/details, CSV exports
const [wellsA, wellsRest1] = wellsJsRaw.split('/* __SPLIT_WELLS_B__ */\n');
const [wellsB, wellsRest2] = wellsRest1.split('/* __SPLIT_WELLS_C__ */\n');
const [wellsC, wellsD] = wellsRest2.split('/* __SPLIT_WELLS_D__ */\n');

// Documents JS has 3 blocks: main code, linked docs functions, window binding
const [docsA, docsRest1] = documentsJsRaw.split('/* __SPLIT_DOCS_B__ */\n');
const [docsB, docsC] = docsRest1.split('/* __SPLIT_DOCS_C__ */\n');

// Documents modals has 3 groups: manual link, view+detail+credits, upload
const [docModalsA, docModalsRest1] = documentModalsRaw.split('<!-- __SPLIT_DOCS_HTML_B__ -->\n');
const [docModalsB, docModalsC] = docModalsRest1.split('<!-- __SPLIT_DOCS_HTML_C__ -->\n');

// Bulk JS has main script + verification script separated by marker
const [bulkJsMain, bulkJsVerify] = bulkJsRaw.split('/* __SPLIT_VERIFY__ */\n');

// Bulk modals has upload modals + processing modal separated by marker
const [bulkModalsUpload, bulkModalsProcessing] = bulkModalsRaw.split('<!-- __SPLIT_PROCESSING__ -->\n');

// Assemble: replace placeholders with component content
// Use function replacements to prevent $-pattern interpretation in String.replace()
let html = shell;

// CSS
html = html.replace('/* __BASE_CSS__ */\n', () => baseCss);
html = html.replace('/* __DOCUMENTS_CSS_A__ */\n', () => documentsCssA);
html = html.replace('/* __DOCUMENTS_CSS_B__ */\n', () => documentsCssB);

// HTML partials
html = html.replace('<!-- __ADD_PROPERTY_MODAL__ -->\n', () => addPropertyModal);
html = html.replace('<!-- __ADD_WELL_MODAL__ -->\n', () => addWellModal);
html = html.replace('<!-- __WELL_DETAILS_MODAL__ -->\n', () => wellDetailsModal);
html = html.replace('<!-- __PROPERTY_DETAILS_MODAL__ -->\n', () => propertyDetailsModal);
html = html.replace('<!-- __DOCUMENT_MODALS_A__ -->\n', () => docModalsA);
html = html.replace('<!-- __BULK_UPLOAD_MODALS__ -->\n', () => bulkModalsUpload);
html = html.replace('<!-- __DOCUMENT_MODALS_B__ -->\n', () => docModalsB);
html = html.replace('<!-- __DOCUMENT_MODALS_C__ -->\n', () => docModalsC);
html = html.replace('<!-- __BULK_PROCESSING_MODAL__ -->\n', () => bulkModalsProcessing);

// JS
html = html.replace('/* __SHARED_AUTH__ */\n', () => sharedAuth);
html = html.replace('/* __SHARED_UTILS__ */\n', () => sharedUtils);
html = html.replace('/* __SHARED_DISPLAY_CONFIG__ */\n', () => sharedDisplayConfig);
html = html.replace('/* __SHARED_OCC_HELPERS__ */\n', () => sharedOccHelpers);
html = html.replace('/* __SHARED_DOC_HELPERS__ */\n', () => sharedDocHelpers);
html = html.replace('/* __SHARED_LIST_CONTROLLER__ */\n', () => sharedListController);
html = html.replace('/* __UTILS_JS_A__ */\n', () => utilsJsA);
html = html.replace('/* __UTILS_JS_B__ */\n', () => utilsJsB);
html = html.replace('/* __PROPS_A__ */\n', () => propsA);
html = html.replace('/* __PROPS_B__ */\n', () => propsB);
html = html.replace('/* __PROPS_C__ */\n', () => propsC);
html = html.replace('/* __PROPS_D__ */\n', () => propsD);
html = html.replace('/* __WELLS_A__ */\n', () => wellsA);
html = html.replace('/* __WELLS_B__ */\n', () => wellsB);
html = html.replace('/* __WELLS_C__ */\n', () => wellsC);
html = html.replace('/* __WELLS_D__ */\n', () => wellsD);
html = html.replace('/* __DOCS_A__ */\n', () => docsA);
html = html.replace('/* __DOCS_B__ */\n', () => docsB);
html = html.replace('/* __DOCS_C__ */\n', () => docsC);
html = html.replace('/* __INIT_JS__ */\n', () => initJs);
html = html.replace('/* __ACTIVITY_JS__ */\n', () => activityJs);
html = html.replace('/* __SHARED_OTC_PRODUCTION__ */\n', () => sharedOtcProduction);
html = html.replace('/* __SHARED_OTC_CSS__ */\n', () => sharedOtcCss);
html = html.replace('/* __SHARED_OCC_FILINGS__ */\n', () => sharedOccFilings);
html = html.replace('/* __SHARED_DOCUMENT_DETAIL__ */\n', () => sharedDocDetail);
html = html.replace('/* __PRODUCTION_JS__ */\n', () => productionJs);
html = html.replace('/* __OCC_JS__ */\n', () => occJs);
html = html.replace('/* __BULK_JS__ */\n', () => bulkJsMain);
html = html.replace('/* __BULK_VERIFY_JS__ */\n', () => bulkJsVerify);

export default html;
