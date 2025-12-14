/**
 * Dashboard Builder
 * Assembles the dashboard from components
 */

// Import base dashboard (with bulk upload sections removed)
import dashboardBase from './dashboard-refactored.html';

// Import bulk upload components  
import bulkUploadPropertiesModal from './components/modals/bulk-upload-properties.html';
import bulkUploadWellsModal from './components/modals/bulk-upload-wells.html';
import bulkUploadStyles from './components/modals/bulk-upload-styles.css';
import bulkUploadScript from './scripts/bulk-upload.js';

// Build the complete dashboard
export function buildDashboard(): string {
    // For now, let's append everything at the end before closing body tag
    const modalsHtml = bulkUploadPropertiesModal + '\n' + bulkUploadWellsModal;
    const stylesHtml = `<style>\n/* Bulk Upload Styles */\n${bulkUploadStyles}\n</style>`;
    const scriptsHtml = `<script>\n// Bulk Upload Scripts\n${bulkUploadScript}\n</script>`;
    
    // Find closing body tag and insert before it
    const insertPoint = dashboardBase.lastIndexOf('</body>');
    
    if (insertPoint === -1) {
        // Fallback: just append
        return dashboardBase + modalsHtml + stylesHtml + scriptsHtml;
    }
    
    return dashboardBase.slice(0, insertPoint) + 
           modalsHtml + '\n' + 
           stylesHtml + '\n' + 
           scriptsHtml + '\n' + 
           dashboardBase.slice(insertPoint);
}

export default buildDashboard();