#!/usr/bin/env node
/**
 * Build map-scripts.js — concatenates vanilla map modules into a single file
 * for the React-hosted map page. Excludes shared modules (React handles those).
 *
 * Usage:
 *   node scripts/build-map-scripts.js
 *
 * Output:
 *   public/portal/map-assets/map-scripts.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', 'src', 'templates', 'scripts');
const OUTPUT = path.join(__dirname, '..', 'public', 'portal', 'map-assets', 'map-scripts.js');

// Module order matters — dependencies must load before dependents
const MODULES = [
  'map-utils.txt',          // Utility functions (formatTRS, toTitleCase, etc.)
  'map-controls.txt',       // Control toggle functions
  'map-core.txt',           // Map initialization, dark mode, status colors
  'map-geo.txt',            // County/township boundaries, section rendering
  'map-wells-tracked.txt',  // Tracked wells layer + bridge-based expandWellCard
  'map-occ.txt',            // OCC filings stubs (React handles these now)
  'map-documents.txt',      // Document detail bridge call
  'map-properties.txt',     // Property layer + bridge-based expandActivityCard/expandNearbyWellCard
  'map-layers.txt',         // Pooling, choropleth, overlay layers
  'map-activity.txt',       // Activity layer (permits/completions)
  'map-nearby.txt',         // Nearby wells layer + operator modal
  'map-init.txt',           // Initialization (must be last — wires up event listeners)
];

let output = `// map-scripts.js — Generated ${new Date().toISOString()}\n`;
output += `// Do not edit directly. Rebuild with: node scripts/build-map-scripts.js\n\n`;

for (const mod of MODULES) {
  const filePath = path.join(SCRIPTS_DIR, mod);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing module: ${mod}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  output += `// ═══════════════════════════════════════════════\n`;
  output += `// Module: ${mod}\n`;
  output += `// ═══════════════════════════════════════════════\n`;
  output += content;
  output += `\n\n`;
}

fs.writeFileSync(OUTPUT, output);
const sizeKB = (fs.statSync(OUTPUT).size / 1024).toFixed(1);
console.log(`Built ${OUTPUT}`);
console.log(`  ${MODULES.length} modules, ${sizeKB} KB`);
