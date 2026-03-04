/**
 * Post-build script: copies the Vite-built index.html into portal-worker/src/templates/
 * so it can be served via servePage() at /portal/title.
 *
 * Safety check: verifies the source file exists and was modified within 60 seconds.
 */
import { copyFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../../portal-worker/public/portal-app/index.html');
const dest = resolve(__dirname, '../../portal-worker/src/templates/portal-react-app.html');

// Verify source exists
let stat;
try {
  stat = statSync(src);
} catch {
  console.error(`\n❌ POST-BUILD FAILED: Source file not found:\n   ${src}\n`);
  console.error('   Did Vite build succeed? Check for errors above.\n');
  process.exit(1);
}

// Verify it was modified recently (within 60 seconds)
const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
if (ageSeconds > 60) {
  console.error(`\n❌ POST-BUILD FAILED: Source file is ${Math.round(ageSeconds)}s old (stale).\n`);
  console.error('   Expected a freshly-built index.html. Re-run the Vite build.\n');
  process.exit(1);
}

// Copy
copyFileSync(src, dest);
console.log(`\n✓ Copied index.html → portal-react-app.html (${stat.size} bytes)\n`);
