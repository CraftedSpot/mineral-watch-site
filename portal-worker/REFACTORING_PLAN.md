# Dashboard Refactoring Plan

## What We've Done So Far

1. **Created directory structure:**
   ```
   src/templates/
   ├── components/
   │   └── modals/
   │       ├── bulk-upload-properties.html (167 lines)
   │       ├── bulk-upload-wells.html (143 lines)  
   │       └── bulk-upload-styles.css
   └── scripts/
       └── bulk-upload.js (all bulk upload functions)
   ```

2. **Extracted bulk upload components:**
   - Properties modal HTML
   - Wells modal HTML
   - CSS styles for both modals
   - JavaScript functions for bulk upload

## Next Steps

### 1. Create Component Loader in TypeScript
```typescript
// src/templates/components/index.ts
export { default as bulkUploadPropertiesHtml } from './modals/bulk-upload-properties.html';
export { default as bulkUploadWellsHtml } from './modals/bulk-upload-wells.html';
export { default as bulkUploadStyles } from './modals/bulk-upload-styles.css';
export { default as bulkUploadScript } from '../scripts/bulk-upload.js';
```

### 2. Update dashboard.html
Remove lines 3824-4133 (the extracted modals) and replace with component placeholders:
```html
<!-- Bulk Upload Modals -->
${bulkUploadPropertiesHtml}
${bulkUploadWellsHtml}

<style>
${bulkUploadStyles}
</style>

<script>
${bulkUploadScript}
</script>
```

### 3. Update index.ts to build the dashboard
```typescript
import { 
  dashboardShellHtml,
  bulkUploadPropertiesHtml,
  bulkUploadWellsHtml,
  bulkUploadStyles,
  bulkUploadScript
} from './templates/components';

// Build complete dashboard
const dashboardHtml = dashboardShellHtml
  .replace('${bulkUploadPropertiesHtml}', bulkUploadPropertiesHtml)
  .replace('${bulkUploadWellsHtml}', bulkUploadWellsHtml)
  .replace('${bulkUploadStyles}', bulkUploadStyles)
  .replace('${bulkUploadScript}', bulkUploadScript);
```

### 4. Continue extracting other components:
- Properties tab
- Wells tab  
- Activity tab
- Other modals (property details, well details)
- Header/navigation

### 5. Benefits
- Dashboard.html reduced from 5,470 lines to ~200 lines
- Each component is manageable and focused
- Easier to debug and maintain
- Can reuse components if needed

## Important Notes
1. Test after each extraction to ensure nothing breaks
2. Keep backup of original dashboard.html until refactoring is complete
3. Consider using a build tool later to automate component assembly