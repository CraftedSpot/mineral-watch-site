/**
 * Marketing Builder
 * Assembles the Marketing Command Center page from component files at build time.
 */

// Shell HTML with placeholder comments
import shell from './marketing-shell.html';

// CSS
import marketingCss from './styles/marketing.txt';

// JS
import marketingJs from './scripts/marketing.txt';

// Assemble: replace placeholders with component content
let html = shell;

// CSS
html = html.replace('/* __MARKETING_CSS__ */\n', () => marketingCss);

// JS
html = html.replace('/* __MARKETING_JS__ */\n', () => marketingJs);

export default html;
