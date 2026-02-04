/**
 * Operators Builder
 * Assembles the Operator Directory page from component files at build time.
 */

// Shell HTML with placeholder comments
import shell from './operators-shell.html';

// CSS
import operatorsCss from './styles/operators.txt';

// JS
import operatorsJs from './scripts/operators.txt';

// Assemble: replace placeholders with component content
let html = shell;

// CSS
html = html.replace('/* __OPERATORS_CSS__ */\n', () => operatorsCss);

// JS
html = html.replace('/* __OPERATORS_JS__ */\n', () => operatorsJs);

export default html;
