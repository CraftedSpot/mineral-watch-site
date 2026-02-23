/**
 * Admin Builder
 * Assembles the Admin Dashboard page from component files at build time.
 */

import shell from './admin-shell.html';
import adminCss from './styles/admin.txt';
import adminJs from './scripts/admin.txt';

let html = shell;
html = html.replace('/* __ADMIN_CSS__ */\n', () => adminCss);
html = html.replace('/* __ADMIN_JS__ */\n', () => adminJs);

export default html;
