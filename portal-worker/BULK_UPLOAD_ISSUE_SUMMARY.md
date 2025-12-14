# Bulk Upload Modal Issue Summary

## The Problem
The bulk upload buttons on the dashboard have `onclick` handlers that call `openBulkUploadModal()` and `openBulkUploadWellsModal()`, but clicking them results in "function not defined" errors, even though the functions exist in the code.

## Root Cause: File Organization Confusion

### Current Situation
1. **Multiple versions of portal worker code exist in different locations:**
   - `/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/` (TypeScript-based, currently deployed)
   - `/Users/jamesprice/Documents/index*.js` (Standalone JS files with embedded HTML)
   - `/Users/jamesprice/Desktop/portal.html` (11MB file)

2. **Two different architectures are mixed:**
   - **TypeScript Architecture**: Uses separate template files (dashboard.html) that are imported by TypeScript
   - **Standalone Architecture**: Has the entire dashboard HTML embedded as a string inside index.js

3. **The deployed version uses TypeScript**, but there's confusion about whether it should use the standalone JS files.

## Technical Details

### What's Actually Deployed
- Uses `src/index.ts` as entry point (configured in wrangler.toml)
- Imports dashboard.html from `src/templates/dashboard.html`
- This template file is now 5,470 lines long

### Why Bulk Upload Isn't Working
1. The functions `openBulkUploadModal` and `openBulkUploadWellsModal` are defined in dashboard.html
2. They need to be globally available when the onclick handlers fire
3. We added `window.openBulkUploadModal = openBulkUploadModal` but it's still not working
4. This suggests the functions might be defined inside a closure or after the DOM loads

## Attempted Fix That Caused Problems
We tried switching to a standalone index.js file (from Documents folder) which:
- Appeared to be an older version
- Caused the entire site to revert
- Had to quickly restore the TypeScript setup

## Recommendations for Opus

1. **Consolidate Architecture**: Decide on either TypeScript OR standalone JS, not both
2. **Single Source of Truth**: All code should live in the repository, not scattered across Desktop/Documents
3. **Refactor Dashboard**: 5,470 lines is too large - consider splitting into components
4. **Fix Modal Functions**: Ensure they're properly exposed to global scope in whichever architecture is chosen

## Files Involved
- `/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/src/templates/dashboard.html` (current)
- `/Users/jamesprice/Documents/index-v5.js` (standalone version)
- `/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/wrangler.toml` (deployment config)

## Current Status
- Site is restored and working (except bulk upload)
- Using TypeScript-based setup
- Modal functions have been modified to use `window.` but still not working