/**
 * Dashboard Builder
 * Assembles the dashboard from components
 */

// Import the cleaned dashboard
import dashboardBase from './dashboard-cleaned.html';

// Import bulk upload components  
import bulkUploadPropertiesModal from './components/modals/bulk-upload-properties.html';
import bulkUploadWellsModal from './components/modals/bulk-upload-wells.html';
import bulkUploadStyles from './components/modals/bulk-upload-styles.css';

// For now, let's just use the original dashboard while we fix the build
const dashboardHtml = dashboardBase;

export default dashboardHtml;