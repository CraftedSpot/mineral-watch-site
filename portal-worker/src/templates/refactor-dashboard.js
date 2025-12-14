const fs = require('fs');

// Read the dashboard
const dashboard = fs.readFileSync('dashboard.html', 'utf8');

// Remove bulk upload modals (from BULK UPLOAD MODAL comment to just before the next major section)
let cleaned = dashboard;

// Remove the properties modal
const propsModalStart = cleaned.indexOf('<!-- BULK UPLOAD MODAL - REDESIGNED -->');
const propsModalEnd = cleaned.indexOf('<!-- BULK UPLOAD WELLS MODAL -->');
if (propsModalStart !== -1 && propsModalEnd !== -1) {
    cleaned = cleaned.slice(0, propsModalStart) + 
              '<!-- BULK_UPLOAD_MODALS -->\n' +
              cleaned.slice(propsModalEnd);
}

// Remove the wells modal  
const wellsModalStart = cleaned.indexOf('<!-- BULK UPLOAD WELLS MODAL -->');
const wellsModalEnd = cleaned.indexOf('<style>\n/* Bulk Upload Modal - Redesigned Styles */');
if (wellsModalStart !== -1 && wellsModalEnd !== -1) {
    cleaned = cleaned.slice(0, wellsModalStart) + cleaned.slice(wellsModalEnd);
}

// Remove bulk upload CSS
const cssStart = cleaned.indexOf('/* Bulk Upload Modal - Redesigned Styles */');
const cssEnd = cleaned.indexOf('</style>', cssStart);
if (cssStart !== -1 && cssEnd !== -1) {
    // Find the actual end of bulk upload styles
    const beforeScripts = cleaned.indexOf('function escapeHtmlBulk');
    if (beforeScripts !== -1 && beforeScripts < cssEnd) {
        cleaned = cleaned.slice(0, cssStart) + 
                  '/* BULK_UPLOAD_STYLES */\n' +
                  cleaned.slice(beforeScripts);
    }
}

// Remove bulk upload JS functions
const jsStart = cleaned.indexOf('function escapeHtmlBulk');
const jsEnd = cleaned.indexOf('// Ensure bulk upload functions are globally accessible');
if (jsStart !== -1 && jsEnd !== -1) {
    cleaned = cleaned.slice(0, jsStart) + 
              '/* BULK_UPLOAD_SCRIPTS */\n' +
              cleaned.slice(jsEnd);
}

// Write the cleaned version
fs.writeFileSync('dashboard-cleaned.html', cleaned);

console.log('Dashboard cleaned. Check dashboard-cleaned.html');

// Count lines
const originalLines = dashboard.split('\n').length;
const cleanedLines = cleaned.split('\n').length;
console.log(`Original: ${originalLines} lines`);
console.log(`Cleaned: ${cleanedLines} lines`);
console.log(`Removed: ${originalLines - cleanedLines} lines`);