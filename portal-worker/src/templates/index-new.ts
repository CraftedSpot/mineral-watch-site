/**
 * Template Exports with Component Assembly
 * 
 * Centralized exports for all HTML templates used in the Portal Worker
 */

// Import base templates
import dashboardBaseHtml from './dashboard.html';
import loginHtml from './login.html';
import accountHtml from './account.html';
import upgradeHtml from './upgrade.html';
import myPropertiesMapHtml from './my_properties_map.html';
import oklahomaMapHtml from './oklahoma_map.html';
import adminBackfillHtml from './admin-backfill.html';

// Import bulk upload components
import bulkUploadPropertiesHtml from './components/modals/bulk-upload-properties.html';
import bulkUploadWellsHtml from './components/modals/bulk-upload-wells.html';
import bulkUploadStyles from './components/modals/bulk-upload-styles.css';
import bulkUploadScript from './scripts/bulk-upload.js';

// Assemble dashboard with components
const dashboardHtml = dashboardBaseHtml
    .replace('<!-- BULK_UPLOAD_MODALS -->', bulkUploadPropertiesHtml + '\n' + bulkUploadWellsHtml)
    .replace('<!-- BULK_UPLOAD_STYLES -->', `<style>\n${bulkUploadStyles}\n</style>`)
    .replace('<!-- BULK_UPLOAD_SCRIPTS -->', `<script>\n${bulkUploadScript}\n</script>`);

export { dashboardHtml, loginHtml, accountHtml, upgradeHtml, myPropertiesMapHtml, oklahomaMapHtml, adminBackfillHtml };