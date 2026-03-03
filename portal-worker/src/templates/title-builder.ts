/**
 * Title Builder
 * Assembles the Chain of Title standalone page from component files at build time.
 */

import shell from './title-shell.html';

// Shared utilities
import sharedAuth from './scripts/shared-auth.txt';
import sharedUtils from './scripts/shared-utils.txt';
import sharedDisplayConfig from './scripts/shared-display-config.txt';
import sharedDocHelpers from './scripts/shared-doc-helpers.txt';
import sharedDocDetail from './scripts/shared-document-detail.txt';
import sharedOpenDocDetail from './scripts/shared-open-doc-detail.txt';
import sharedPropertyDetail from './scripts/shared-property-detail.txt';

// Title page JS and CSS
import titlePageJs from './scripts/title-page.txt';
import titlePageCss from './styles/title-page.txt';

// Assemble
let html = shell;

html = html.replace('/* __SHARED_AUTH__ */\n', () => sharedAuth);
html = html.replace('/* __SHARED_UTILS__ */\n', () => sharedUtils);
html = html.replace('/* __SHARED_DISPLAY_CONFIG__ */\n', () => sharedDisplayConfig);
html = html.replace('/* __SHARED_DOC_HELPERS__ */\n', () => sharedDocHelpers);
html = html.replace('/* __SHARED_DOCUMENT_DETAIL__ */\n', () => sharedDocDetail);
html = html.replace('/* __SHARED_OPEN_DOC_DETAIL__ */\n', () => sharedOpenDocDetail);
html = html.replace('/* __SHARED_PROPERTY_DETAIL__ */\n', () => sharedPropertyDetail);
html = html.replace('/* __TITLE_PAGE_JS__ */\n', () => titlePageJs);
html = html.replace('/* __TITLE_PAGE_CSS__ */\n', () => titlePageCss);

export default html;
