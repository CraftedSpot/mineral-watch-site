/**
 * Intelligence Builder
 * Assembles the Intelligence page from component files at build time.
 * Follows the same pattern as map-builder.ts and dashboard-builder.ts.
 */

// Shell HTML with placeholder comments
import shell from './intelligence-shell.html';

// CSS
import baseCss from './styles/intelligence-base.txt';

// JS modules
import initJs from './scripts/intelligence-init.txt';
import insightsJs from './scripts/intelligence-insights.txt';
import questionsJs from './scripts/intelligence-questions.txt';
import reportsJs from './scripts/intelligence-reports.txt';

// Report CSS
import reportsCss from './styles/intelligence-reports.txt';

// Assemble: replace placeholders with component content
let html = shell;

// CSS
html = html.replace('/* __INTEL_CSS__ */\n', () => baseCss);

// Report CSS
html = html.replace('/* __INTEL_REPORTS_CSS__ */\n', () => reportsCss);

// JS
html = html.replace('/* __INTEL_INIT__ */\n', () => initJs);
html = html.replace('/* __INTEL_INSIGHTS__ */\n', () => insightsJs);
html = html.replace('/* __INTEL_QUESTIONS__ */\n', () => questionsJs);
html = html.replace('/* __INTEL_REPORTS__ */\n', () => reportsJs);

export default html;
