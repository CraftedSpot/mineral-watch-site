# Dashboard Component Decomposition Plan

## Problem
`dashboard.html` is 20,107 lines — a single monolithic file containing all CSS, HTML, and JavaScript for the entire portal dashboard. This makes it difficult to navigate, maintain, and collaborate on.

## Approach: Build-Time Composition via `dashboard-builder.ts`

The infrastructure already exists but is disabled. `dashboard-builder.ts` imports HTML files as strings (Wrangler bundles them). We'll create a **shell HTML** with placeholder comments, plus **component files** (CSS, JS, HTML partials) that get string-replaced at import time. The browser receives the same single HTML page — zero runtime changes.

### Why This Works
- Wrangler's esbuild imports `.html`, `.css`, `.js` files as strings via type declarations in `html.d.ts` and `assets.d.ts`
- `templates/index.ts` already re-exports `dashboardHtml` — we just change its source from `dashboard.html` to `dashboard-builder.ts`
- No build system changes, no new dependencies

---

## File Structure

```
portal-worker/src/templates/
├── dashboard.html              ← KEEP AS-IS (backup/reference)
├── dashboard-shell.html        ← NEW: skeleton with placeholders
├── dashboard-builder.ts        ← UPDATE: assemble components
├── index.ts                    ← UPDATE: import from builder
│
├── styles/
│   ├── dashboard-base.css      ← Core layout (header, tabs, cards, forms, tables)
│   ├── dashboard-modals.css    ← Modal overlay, close button, form styles
│   └── dashboard-documents.css ← Document upload, credits, bulk processing styles
│
├── scripts/
│   ├── dashboard-utils.js      ← Shared: escapeHtml, showToast, showConfirm, formatters
│   ├── dashboard-init.js       ← loadAllData, tab switching, DOMContentLoaded bootstrap
│   ├── dashboard-properties.js ← Properties tab + add/detail modals
│   ├── dashboard-wells.js      ← Wells tab + add/detail/search modals
│   ├── dashboard-activity.js   ← Activity tab + stats
│   ├── dashboard-documents.js  ← Documents tab + viewer + detail + upload + credits
│   ├── dashboard-occ.js        ← OCC filings, completion reports, document processing
│   ├── dashboard-production.js ← Production summary rendering
│   └── dashboard-bulk.js       ← Bulk CSV/Excel upload (properties + wells)
│
└── partials/
    ├── modal-add-property.html
    ├── modal-add-well.html
    ├── modal-well-details.html
    ├── modal-property-details.html
    ├── modal-documents.html     ← document viewer + detail + upload + credits + out-of-credits
    ├── modal-bulk-upload.html   ← bulk properties + wells + processing modals
    └── modal-manual-link.html
```

---

## Component Breakdown

### CSS Split (currently lines 9–2740, 16975–16998, 17104–17780)

| File | Content | Approx Lines |
|------|---------|-------------|
| `dashboard-base.css` | Root vars, body, header, nav, container, tabs, cards, tables, buttons, plan-info, stats, skeleton, toast, confirm dialog, forms, responsive breakpoints | ~1,400 |
| `dashboard-modals.css` | `.modal-overlay`, `.modal`, `.modal-close`, form groups, tab-nav inside modals, well search results, property form, bulk action bars | ~800 |
| `dashboard-documents.css` | Document cards, upload drop zone, credit display, credit pack modal hover, document viewer, progress bars, confidence indicators, extraction display | ~530 |

### JavaScript Split (currently lines 3643–16422, 17782–19994)

| File | Key Functions | Approx Lines |
|------|-----------|-------------|
| `dashboard-utils.js` | `escapeHtml`, `formatPhoneNumber`, `cleanCountyDisplay`, `formatActivityLocation`, `showToast`, `showConfirm`, `downloadCSV`, bulk selection helpers, global state vars | ~600 |
| `dashboard-init.js` | `loadAllData`, `updateTotalCount`, `viewOnMap`, `viewWellOnMap`, DOMContentLoaded handler, tab switching | ~200 |
| `dashboard-properties.js` | `loadProperties`, `renderPropertiesTable`, `filterProperties`, `sortProperties`, `openPropertyDetails`, `savePropertyDetails`, `exportPropertiesCSV`, linked wells management | ~1,800 |
| `dashboard-wells.js` | `loadWells`, `renderWellsTable`, `filterWells`, `sortWells`, `openWellDetailsModal`, well search, `saveWellNotes`, `printWellReport`, `exportWellsCSV`, linked properties, production hover | ~2,500 |
| `dashboard-activity.js` | `loadActivityStats`, `loadActivity` | ~200 |
| `dashboard-documents.js` | `loadDocuments`, `renderDocumentsList`, `openDocumentDetail`, `viewDocumentInModal`, `renderExtractedData`, `groupFieldsBySection`, document upload, credits/usage, document polling, manual linking | ~3,800 |
| `dashboard-occ.js` | `loadOccFilings`, `renderOccFiling`, `processOccFiling`, `loadCompletionReportsAsync`, `renderCompletionReport`, `analyzeCompletion`, OCC document polling | ~1,100 |
| `dashboard-production.js` | `loadProductionSummary`, `renderProductionSummary`, `renderNoProductionData` | ~200 |
| `dashboard-bulk.js` | All bulk CSV/Excel upload functions (already self-contained in lines 17782–19994) | ~2,200 |

### HTML Partials Split (currently lines 3090–3503, 16428–20088)

| File | Content | Approx Lines |
|------|---------|-------------|
| `modal-add-property.html` | Add property form (TRS fields, acres, notes) | ~100 |
| `modal-add-well.html` | Add well with API search + name/location search tabs | ~100 |
| `modal-well-details.html` | Well detail modal shell (populated dynamically by JS) | ~220 |
| `modal-property-details.html` | Property detail modal shell (populated dynamically by JS) | ~120 |
| `modal-documents.html` | Document viewer, document detail, upload, out-of-credits, credit pack | ~250 |
| `modal-bulk-upload.html` | Bulk properties + wells + bulk processing modals | ~350 |
| `modal-manual-link.html` | Manual document linking modal | ~30 |

---

## Build System: `dashboard-builder.ts`

```typescript
import shell from './dashboard-shell.html';
// CSS
import baseCss from './styles/dashboard-base.css';
import modalsCss from './styles/dashboard-modals.css';
import documentsCss from './styles/dashboard-documents.css';
// JS
import utilsJs from './scripts/dashboard-utils.js';
import initJs from './scripts/dashboard-init.js';
import propertiesJs from './scripts/dashboard-properties.js';
import wellsJs from './scripts/dashboard-wells.js';
import activityJs from './scripts/dashboard-activity.js';
import documentsJs from './scripts/dashboard-documents.js';
import occJs from './scripts/dashboard-occ.js';
import productionJs from './scripts/dashboard-production.js';
import bulkJs from './scripts/dashboard-bulk.js';
// HTML partials
import addPropertyModal from './partials/modal-add-property.html';
import addWellModal from './partials/modal-add-well.html';
import wellDetailsModal from './partials/modal-well-details.html';
import propertyDetailsModal from './partials/modal-property-details.html';
import documentModals from './partials/modal-documents.html';
import bulkUploadModals from './partials/modal-bulk-upload.html';
import manualLinkModal from './partials/modal-manual-link.html';

let html = shell;
// CSS replacements
html = html.replace('/* __BASE_CSS__ */', baseCss);
html = html.replace('/* __MODALS_CSS__ */', modalsCss);
html = html.replace('/* __DOCUMENTS_CSS__ */', documentsCss);
// HTML partial replacements
html = html.replace('<!-- __ADD_PROPERTY_MODAL__ -->', addPropertyModal);
html = html.replace('<!-- __ADD_WELL_MODAL__ -->', addWellModal);
html = html.replace('<!-- __WELL_DETAILS_MODAL__ -->', wellDetailsModal);
html = html.replace('<!-- __PROPERTY_DETAILS_MODAL__ -->', propertyDetailsModal);
html = html.replace('<!-- __DOCUMENT_MODALS__ -->', documentModals);
html = html.replace('<!-- __BULK_UPLOAD_MODALS__ -->', bulkUploadModals);
html = html.replace('<!-- __MANUAL_LINK_MODAL__ -->', manualLinkModal);
// JS replacements (order matters: utils first, features, init last)
html = html.replace('/* __UTILS_JS__ */', utilsJs);
html = html.replace('/* __PROPERTIES_JS__ */', propertiesJs);
html = html.replace('/* __WELLS_JS__ */', wellsJs);
html = html.replace('/* __ACTIVITY_JS__ */', activityJs);
html = html.replace('/* __DOCUMENTS_JS__ */', documentsJs);
html = html.replace('/* __OCC_JS__ */', occJs);
html = html.replace('/* __PRODUCTION_JS__ */', productionJs);
html = html.replace('/* __INIT_JS__ */', initJs);
html = html.replace('/* __BULK_JS__ */', bulkJs);

export default html;
```

---

## `dashboard-shell.html` Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Mineral Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
    /* __BASE_CSS__ */
    </style>
    <style>
    /* __MODALS_CSS__ */
    </style>
    <style>
    /* __DOCUMENTS_CSS__ */
    </style>
</head>
<body>
    <!-- Header, nav, tabs, tab content containers (inline — ~150 lines) -->

    <!-- __ADD_PROPERTY_MODAL__ -->
    <!-- __ADD_WELL_MODAL__ -->
    <!-- __WELL_DETAILS_MODAL__ -->
    <!-- __PROPERTY_DETAILS_MODAL__ -->
    <!-- __DOCUMENT_MODALS__ -->
    <!-- __MANUAL_LINK_MODAL__ -->
    <!-- __BULK_UPLOAD_MODALS__ -->

    <script>
    /* __UTILS_JS__ */
    /* __PROPERTIES_JS__ */
    /* __WELLS_JS__ */
    /* __ACTIVITY_JS__ */
    /* __DOCUMENTS_JS__ */
    /* __OCC_JS__ */
    /* __PRODUCTION_JS__ */
    /* __INIT_JS__ */
    </script>

    <!-- External deps -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>if (typeof pdfjsLib !== 'undefined') pdfjsLib.GlobalWorkerOptions.workerSrc = '...';</script>
    <script src="https://unpkg.com/pdf-lib/dist/pdf-lib.min.js"></script>
    <script src="https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js"></script>

    <script>
    /* __BULK_JS__ */
    </script>
</body>
</html>
```

---

## Migration Strategy: Incremental, One Component at a Time

### Phase 1: Foundation (Do First)
1. Create `dashboard-shell.html` — copy dashboard.html, replace the main CSS block (lines 9–2740) with `/* __BASE_CSS__ */` placeholder
2. Extract `styles/dashboard-base.css` — the CSS content from those lines
3. Update `dashboard-builder.ts` — add the CSS import + replacement
4. Update `templates/index.ts` — import from builder: `import dashboardHtml from './dashboard-builder.ts'`
5. **Deploy and verify** the page renders identically

### Phase 2: Extract Remaining CSS
6. Extract `styles/dashboard-modals.css` — modal-specific styles from the base CSS
7. Extract `styles/dashboard-documents.css` — lines 16975–16998 + 17104–17780

### Phase 3: Extract Bulk Upload (Easiest JS — Already Self-Contained)
8. Extract `scripts/dashboard-bulk.js` — lines 17782–19994
9. Extract `partials/modal-bulk-upload.html` — bulk upload modal HTML

### Phase 4: Extract Shared Utilities
10. Extract `scripts/dashboard-utils.js` — shared functions other modules depend on

### Phase 5: Extract Feature Modules (One at a Time, Smallest First)
11. `scripts/dashboard-activity.js` (smallest, fewest dependencies)
12. `scripts/dashboard-production.js` (small, self-contained)
13. `scripts/dashboard-occ.js` (medium, used by wells + properties detail modals)
14. `scripts/dashboard-properties.js` + `partials/modal-add-property.html` + `partials/modal-property-details.html`
15. `scripts/dashboard-wells.js` + `partials/modal-add-well.html` + `partials/modal-well-details.html`
16. `scripts/dashboard-documents.js` + `partials/modal-documents.html` + `partials/modal-manual-link.html`
17. `scripts/dashboard-init.js` (bootstrap/glue code, do last)

### Phase 6: Cleanup
18. Delete original `dashboard.html` (or rename to `.backup`)
19. Delete stale `dashboard-cleaned.html` and `test-integration.ts`

---

## Cross-Module Dependencies

All JS files share global scope (concatenated into one `<script>` block). Key shared state:

| Variable | Defined In | Used By |
|----------|-----------|---------|
| `allProperties`, `allWells`, `allDocuments` | init | properties, wells, documents, occ |
| `selectedProperties`, `selectedWells`, `selectedDocuments` | utils | properties, wells, documents |
| `propertyLinkCounts`, `wellLinkCounts` | properties/wells | documents, occ |
| `showToast`, `showConfirm`, `escapeHtml` | utils | ALL modules |
| `currentUser`, `API_BASE` | init (inline template vars) | ALL modules |

Load order in the `<script>` block: **utils → properties → wells → activity → documents → occ → production → init**. Bulk upload is in its own separate `<script>` block after external deps.

---

## Verification

After each extraction phase:
1. `wrangler dev` — load dashboard locally
2. Verify all 4 tabs render (properties, wells, activity, documents)
3. Open each modal (add property, add well, well details, property details, document viewer)
4. Test bulk upload flow
5. Check browser console — zero new errors
6. Compare bundle size: `wrangler deploy --dry-run` output should match original

Final state: `dashboard-shell.html` ~150 lines. Largest component: `dashboard-documents.js` ~3,800 lines.

---

## Files Modified

| File | Action |
|------|--------|
| `src/templates/dashboard-builder.ts` | **Update** — full composition logic |
| `src/templates/index.ts` | **Update** — import from builder |
| `src/templates/dashboard-shell.html` | **Create** (~150 lines) |
| `src/templates/styles/*.css` | **Create** — 3 files |
| `src/templates/scripts/*.js` | **Create** — 9 files |
| `src/templates/partials/*.html` | **Create** — 7 files |
| `src/templates/dashboard.html` | **Keep** as backup until verified |
| `src/templates/dashboard-cleaned.html` | **Delete** (stale) |
| `src/templates/test-integration.ts` | **Delete** (stale) |
