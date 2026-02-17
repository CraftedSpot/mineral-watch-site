# Mineral Watch - System Architecture Guide

Last updated: 2026-02-17

## Overview

Mineral Watch is an Oklahoma mineral rights monitoring platform. Users upload properties (defined by PLSS legal descriptions) and track wells. The system monitors OCC (Oklahoma Corporation Commission) filings daily and alerts users to activity affecting their interests.

The platform runs entirely on Cloudflare Workers with a **D1 (SQLite) database as the sole source of truth for all detail data**, R2 for document/file storage, and Airtable limited to user/organization ownership records only (synced one-way to D1 every 15 minutes).

### D1-First Architecture (Migrated Feb 2026)

All API reads come from D1 — no Airtable calls for properties, wells, or links. V2 endpoints (`/api/properties/v2`, `/api/wells/v2`) query D1 directly. Airtable is only used for:
- User records (auth, billing, plan tier)
- Organization records (membership, plan)
- One-way sync TO D1 (Airtable → D1, never the reverse for detail data)

Enterprise fields (property codes, interest decimals, section allocations) exist **only in D1** — they are never written to Airtable.

---

## Workers and Their Roles

### portal-worker (primary API + UI)
- **Purpose:** Main API server and portal UI. Handles all user-facing API requests, serves the portal SPA, and runs the 15-minute Airtable→D1 sync.
- **Cron:** `*/15 * * * *` (Airtable sync), `0 8 * * *` (OTC trigger)
- **Bindings:**
  - D1: `WELLS_DB` (oklahoma-wells)
  - KV: `AUTH_TOKENS`, `OCC_CACHE`, `COMPLETIONS_CACHE`
  - Services: `AUTH_WORKER`, `DOCUMENTS_WORKER`, `MARKETING_WORKER`, `OCC_FETCHER`
- **Key files:** `src/index.ts` (router, ~1750 lines), `src/sync.ts` (time-budgeted phase machine sync), `src/handlers/` (API handlers), `src/templates/dashboard-builder.ts` (dashboard composition), `src/utils/auth.ts` (authenticateRequest, isSuperAdmin, impersonation), `src/constants.ts` (plan limits, CORS, Stripe price IDs)
- **Dashboard:** The portal dashboard is assembled at build time from 18 component files — see "Portal Dashboard Architecture" section below

### mineral-monitor-worker (alert engine, 5min CPU limit)
- **Purpose:** Daily OCC permit/completion monitoring, docket filings (Mon-Fri), digest emails, regional summaries.
- **Cron:** Daily 7am/8am CT (permits/completions), Sunday 8AM CT (transfers), Mon-Fri noon CT (dockets), Daily 6PM CT (digest emails)
- **Bindings:**
  - D1: `WELLS_DB` (shared)
  - KV: `MINERAL_CACHE`, `COMPLETIONS_CACHE` (shared)
  - R2: `RBDMS_BUCKET`
- **Key files:** `src/monitors/daily.js`, `src/monitors/weekly.js`, `src/monitors/docket.js` (live daily OCC docket monitor), `src/backfill/dockets.js` (historical docket backfill + gap-filler), `src/services/d1.js`
- **Email:** Resend API

### documents-worker (document processing)
- **Purpose:** Document upload (R2 storage), county record extraction, AI extraction via Claude Sonnet 4.6 (standard) or Claude Opus 4.6 (enhanced, 2 credits). Multi-well document linking, credit usage tracking.
- **Bindings:**
  - D1: `WELLS_DB` (shared)
  - R2: `UPLOADS_BUCKET`, `LOCKER_BUCKET`
  - Services: `AUTH_WORKER`, `OCC_FETCHER`
- **Key endpoint:** `POST /api/processing/relink-all` — re-matches ALL documents to properties/wells by legal description. Called automatically after every sync.

### auth-worker (authentication)
- **Purpose:** Magic link authentication, JWT session management.
- **Flow:** Sends magic links via Postmark email, sets HttpOnly session cookies on verify.
- **Cookie:** `mw_session_v4`, 30-day expiry, HttpOnly, Secure, SameSite=Lax.
- **Session invalidation:** Per-user revocation via `sess_valid_after:{userId}` in KV.
- **Bindings:** Uses Airtable API directly for user lookup (Users/Organizations tables).

### occ-fetcher (OCC API proxy)
- **Purpose:** Proxies requests to OCC ArcGIS REST API for well data, completion reports, docket searches.
- **Bindings:** R2 `UPLOADS_BUCKET`, KV `OCC_CACHE`, Service `DOCUMENTS_WORKER`

### stripe-webhook
- **Purpose:** Stripe webhook signature verification (HMAC-SHA256, constant-time comparison, 5min replay protection, KV dedup). Updates Airtable User records with plan changes. Creates org records for Professional+ plans.

### tools-worker
- **Purpose:** Revenue estimator, commodity prices from EIA API (6hr KV cache).

### forum-monitor
- **Purpose:** Monitors Mineral Rights Forum 4x daily, matches TRS locations, alerts users.
- **Email:** Resend API

### marketing-worker
- **Purpose:** Metrics dashboard (Stripe, GA4, YouTube), lead tracking, content calendar.

### Other workers
- **mineralwatch-contact:** Contact form handler
- **mineral-watch-webhooks:** Generic webhook handler

---

## Portal Dashboard Architecture

The portal dashboard (`/portal/dashboard`) was a 20,107-line monolithic HTML file. It has been decomposed into 18 component files that are assembled at build time via `dashboard-builder.ts`. The browser receives the exact same single HTML page — all composition happens during Wrangler's esbuild bundling step.

### How It Works

1. `src/templates/dashboard-shell.html` (468 lines) contains the page skeleton with placeholder comments like `/* __BASE_CSS__ */`, `<!-- __ADD_WELL_MODAL__ -->`, etc.
2. `src/templates/dashboard-builder.ts` imports the shell + all component files, uses `String.replace()` to substitute each placeholder with component content.
3. `src/templates/index.ts` re-exports the assembled HTML as `dashboardHtml`.
4. Wrangler bundles everything — the browser gets one complete HTML document.

### File Extension: `.txt` (not `.js`/`.css`)

Component files use the `.txt` extension because Wrangler's esbuild:
- **Executes `.js` files** as JavaScript modules (crashes on `document` references in Workers runtime)
- **Extracts `.css` files** to separate bundles (returns `{}` instead of a string)
- **Imports `.txt` files** as raw text strings (what the builder needs)

Type declarations are in `src/types/assets.d.ts` (`declare module '*.txt'`) and `src/types/html.d.ts` (`declare module '*.html'`).

### File Structure

```
portal-worker/src/templates/
├── dashboard.html              ← Original monolith (kept as backup/reference)
├── dashboard-shell.html        ← Skeleton with placeholders (468 lines)
├── dashboard-builder.ts        ← Build-time composition logic (105 lines)
├── index.ts                    ← Re-exports dashboardHtml
│
├── styles/
│   ├── dashboard-base.txt      ← Core CSS: layout, header, tabs, cards, forms (2,730 lines)
│   └── dashboard-documents.txt ← Document/credit CSS, split via marker (697 lines)
│
├── scripts/
│   ├── dashboard-utils.txt     ← Shared utilities: escapeHtml, showToast, formatters (673 lines)
│   ├── dashboard-init.txt      ← DOMContentLoaded bootstrap, loadAllData, tab switching (214 lines)
│   ├── dashboard-properties.txt ← Properties tab: CRUD, filter, sort, details modal (979 lines)
│   ├── dashboard-wells.txt     ← Wells tab: CRUD, search, details, CSV export (1,456 lines)
│   ├── dashboard-activity.txt  ← Activity tab + stats (195 lines)
│   ├── dashboard-production.txt ← Production summary rendering (190 lines)
│   ├── dashboard-documents.txt ← Documents tab: upload, viewer, extraction, credits (8,055 lines)
│   ├── dashboard-occ.txt       ← OCC filings, completion reports, document processing (1,010 lines)
│   └── dashboard-bulk.txt      ← Bulk CSV/Excel upload for properties + wells (2,226 lines)
│
└── partials/
    ├── modal-add-property.html ← Add property form with county dropdown, TRS fields (99 lines)
    ├── modal-add-well.html     ← Add well: API search + name/location search tabs (94 lines)
    ├── modal-well-details.html ← Well detail modal shell, populated by JS (218 lines)
    ├── modal-property-details.html ← Property detail modal shell (139 lines)
    ├── modal-documents.html    ← Doc viewer + detail + upload + credits modals (321 lines)
    └── modal-bulk-upload.html  ← Bulk properties + wells + processing modals (387 lines)
```

### Split Markers

Some components contain non-contiguous code blocks (their content appears at multiple positions in the original HTML). These use split markers — special comments that `dashboard-builder.ts` splits on to produce separate fragments for each placeholder:

| Component | Marker(s) | Blocks |
|-----------|-----------|--------|
| `dashboard-documents.txt` (CSS) | `/* __SPLIT__ */` | 2 (credit hover + upload styles) |
| `dashboard-utils.txt` | `/* __SPLIT_UTILS_B__ */` | 2 (core utilities + toast/confirm) |
| `dashboard-properties.txt` | `__SPLIT_PROPS_B/C/D__` | 4 (tab core, add modal, details, save) |
| `dashboard-wells.txt` | `__SPLIT_WELLS_B/C/D__` | 4 (tab core, add modal, search/details, CSV) |
| `dashboard-documents.txt` (JS) | `__SPLIT_DOCS_B/C__` | 3 (main code, linked docs, window binding) |
| `modal-documents.html` | `__SPLIT_DOCS_HTML_B/C__` | 3 (manual link, viewer+detail, upload) |
| `dashboard-bulk.txt` | `/* __SPLIT_VERIFY__ */` | 2 (main script + verification) |
| `modal-bulk-upload.html` | `<!-- __SPLIT_PROCESSING__ -->` | 2 (upload modals + processing modal) |

### Cross-Module Dependencies

All JS runs in global scope (concatenated into one `<script>` block). Key shared state:

| Variable/Function | Defined In | Used By |
|-------------------|-----------|---------|
| `allProperties`, `allWells` | init | properties, wells, documents, occ |
| `showToast`, `showConfirm`, `escapeHtml` | utils | ALL modules |
| `currentUser`, `API_BASE` | shell (template vars) | ALL modules |
| `selectedProperties/Wells/Documents` | utils | properties, wells, documents |

### Editing Components

- Edit the component files directly — no need to touch `dashboard.html` or `dashboard-shell.html`
- The shell only needs editing to add/remove/reorder placeholder positions
- After changes, `npx wrangler deploy` rebuilds automatically
- To verify: the Python verification script in the session history compares composed output against `dashboard.html`

---

## D1 Database (oklahoma-wells)

### OCC/OTC Data (Source of Truth — NOT from Airtable)

| Table | Records | Source | Purpose |
|-------|---------|--------|---------|
| `wells` | ~453k | OCC SFTP monthly | Full Oklahoma well registry. Surface/BH locations, operator, status, formations |
| `otc_production` | ~7.7M | OTC SFTP monthly | Monthly production volumes by PUN (~2.5GB) |
| `puns` | ~185k | OTC data | PUN rollup summaries |
| `well_pun_links` | ~430k | OTC data | API number ↔ PUN mapping |
| `county_production_monthly` | varies | Rollup from otc_production | County-level production aggregates for map choropleth |
| `occ_docket_entries` | varies | OCC scraping daily Mon-Fri | Regulatory orders and docket items |
| `pooling_orders` | varies | OCC docket extraction | Pooling order details with bonus rates |
| `pooling_election_options` | varies | OCC docket extraction | Per-order election options (bonus/acre, royalty fraction) |
| `plss_sections` | ~70k | GeoJSON import | Section boundaries with center_lat/center_lng for geocoding |
| `statewide_activity` | ~500 | OCC scraping | Recent permits/completions for heatmap display |
| `counties` | 77 | GeoJSON import | County boundaries |
| `townships` | varies | GeoJSON import | Township boundaries |
| `documents` | varies | Upload + county records | Document metadata (files in R2) |

### User Data (Synced from Airtable every 15 min)

| Table | Records | Source | Purpose |
|-------|---------|--------|---------|
| `properties` | ~340+ | Airtable sync → D1 | User-uploaded mineral properties (Section/Township/Range) |
| `client_wells` | ~287+ | Airtable sync → D1 | Wells users track (via upload, enrichment, or track button) |
| `property_well_links` | varies | Airtable sync → D1 | Links between properties and wells (auto-matched or manual) |

**D1-only enterprise fields** (never in Airtable):
- **properties:** `property_code`, `ri_decimal`, `wi_decimal`, `orri_acres`, `orri_decimal`, `mi_acres`, `mi_decimal`, `total_acres`
- **client_wells:** `user_well_code`, `wi_nri`, `ri_nri`, `orri_nri`, `interest_source`, `interest_source_doc_id`, `interest_source_date`
- **property_well_links:** `section_allocation_pct`, `allocation_source`, `allocation_source_doc_id`

### User/Auth Data

| Table | Records | Source | Purpose |
|-------|---------|--------|---------|
| `users` | ~19 | Backfilled from Airtable | User accounts with plan, Stripe info, notification prefs |
| `organizations` | ~2 | Backfilled from Airtable | Team accounts |
| `activity_log` | growing | Monitor worker writes | Alerts sent to users |
| `user_sessions` | varies | Auth worker | Login sessions |
| `organization_invites` | varies | Portal | Team invites |
| `audit_log` | varies | Portal | Change tracking |

### Key Column Notes

- **wells.bh_coordinate_source:** Tracks origin of bottom-hole lat/lng:
  - `occ_api` (~1,906) — exact coordinates from OCC ArcGIS API
  - `section_center` (~17,730) — approximate, computed from PLSS section centroid
  - When better data is available, only overwrite `section_center` entries
- **wells.is_horizontal:** 1 = horizontal well (~24k of 453k)
- **plss_sections format:** township = `270N` (number * 10 + direction), range = `9W` (no leading zeros), meridian = `indian` or `cimarron`
- **wells format:** township = `27N`, range = `09W` (with leading zeros), meridian = `IM` or `CM`

### D1 Schema Migrations

| Migration | Purpose |
|-----------|---------|
| `001-create_tables.sql` | Original tables (properties, client_wells, occ_wells, etc.) |
| `002-add_property_well_links.sql` | Links table |
| `003-enterprise-d1-first.sql` | Enterprise fields + well_interests + interest_discrepancies |
| `007-*` | Users, organizations, activity_log, sessions, invites, audit_log |
| `013_section_allocation.sql` | section_allocation_pct, allocation_source on property_well_links |

---

## Data Flow

### 1. OCC Data Ingestion (Monthly/Daily)

```
OCC SFTP Excel Files
    |
    v
mineral-monitor-worker (daily cron)
    |
    +---> Parse permits, completions, status changes, transfers
    +---> Match against user properties/wells in D1
    +---> Write alerts to D1 activity_log
    +---> Send alert emails via Resend API
```

The main `wells` table (453k records) is loaded from OCC data. This is NOT touched by the Airtable sync.

### 2. Airtable → D1 Sync (Every 15 Minutes)

The sync is a **time-budgeted phase machine with KV cursor** (`sync:cursor` in OCC_CACHE). At small scale (<500 records), it completes in a single cron tick (~8s). At 10K+ records, it chunks across multiple 15-minute ticks, resuming from the saved cursor.

```
Airtable (user/property/well ownership only)
    |
    v
portal-worker cron (syncAirtableData) — time-budgeted phase machine
    |
    Phase 1: syncProperties ---------> D1 properties (upsert + orphan cleanup)
    Phase 2: syncWellsCombined ------> D1 client_wells + wells (SINGLE Airtable fetch)
    Phase 3: syncPropertyWellLinks --> D1 property_well_links (upsert + orphan cleanup)
    Phase 4: cleanup ----------------> Orphan removal (safety: skipped if synced/existing < 90%)
    Phase 5: post_sync --------------> Document re-linking, BH geocoding, auto-matching
```

**Key improvement (Feb 2026):** `syncWellsCombined` merges the old `syncWells` + `syncClientWells` into a single Airtable fetch, halving API calls. Each page is upserted immediately to D1 (no accumulating all records in memory). OCC lookups for new wells are budgeted at 20 per tick.

**Orphan cleanup:** After all pages are fetched, collected Airtable record IDs are compared against D1. D1 rows not in the Airtable set are deleted. Safety guard: cleanup is skipped if the synced/existing ratio drops below 90% (prevents mass deletion from Airtable API errors).

**D1-only enterprise fields are preserved automatically** — they are not in the ON CONFLICT UPDATE clause, so syncing from Airtable never overwrites them.

### 3. Client Wells Enrichment (During Sync)

After syncing client_wells from Airtable, the sync copies OCC data from the main `wells` table:
- `is_horizontal`, `bh_section`, `bh_township`, `bh_range`
- `bh_latitude`, `bh_longitude` (includes section_center approximations)
- `lateral_length`

### 4. BH Coordinate Auto-Geocoding (During Sync)

After sync completes, `geocodeBhFromSectionCenters()` runs:
- Finds wells with `bh_section`/`bh_township`/`bh_range` but no `bh_latitude`
- Converts formats: wells `27N`/`09W`/`IM` → plss `270N`/`9W`/`indian`
- Looks up section center from `plss_sections` table
- Sets `bh_coordinate_source = 'section_center'`
- Processes up to 500 wells per cycle

### 5. Property-Well Matching

When properties are uploaded (bulk upload), `runFullPropertyWellMatching` runs:
- **Exact TRS match only** — matches on Section/Township/Range
- Checks: Surface Location match → Lateral Path (Sections Affected) match → Bottom Hole match
- Creates links in Airtable `property_well_links` table
- Links sync to D1 on next 15-minute cycle

**Note:** Property-well LINKING is exact TRS match only. ALERTING (monitor worker) uses adjacent section grid (3x3 or 5x5) which is different.

### 6. Document Linking

Documents are matched to properties/wells by:
- **Property matching:** Legal description (Section-Township-Range-County) + owner (user_id or org_id)
- **Well matching (cascading priority):**
  1. Exact API number match
  2. Well name + Section + Township + Range
  3. Well name + Township + Range
  4. Well name only (broadest)
  5. Client wells lookup (user-specific)

The `relink-all` endpoint re-processes ALL documents and overwrites stale property_id/well_id references. This runs after every sync, so re-uploading properties with new Airtable IDs works correctly.

---

## OTC Production Data Pipeline

Production data comes from the Oklahoma Tax Commission via SFTP, not from OCC.

### Key Concepts
- **PUN (Production Unit Number):** OTC's unique ID for a taxable production unit. Format: `CCC-LLLLLL-S-MMMM` (county-lease-sub-merge)
- **Relationship:** Many-to-many. One PUN can have multiple wells (unit wells), one well can have multiple PUNs (horizontal allocations)
- **base_pun:** First 10 chars of PUN (county-lease). Production summary queries use `WHERE base_pun IN (...)`.

### Data Flow
```
OTC SFTP (otcmft.tax.ok.gov)
    |
    v
Fly.io machine (mineral-watch-otc-fetch.fly.dev)
    |
    +---> fetch_production.sh downloads .dat files
    +---> process_production.py parses fixed-width, pre-aggregates
    +---> Batched upload to portal-worker /api/otc-sync/upload-pun-production
    |     (Bearer token auth: PROCESSING_API_KEY)
    |
    v
D1 Tables: otc_production (7.7M+, ~2.5GB), puns (185k), well_pun_links (430k)
    |
    v
Portal Worker API --> UI production charts (KV-cached: prod:{api10}, 24h TTL)
```

### OTC Files
| File | Size | Content | RAM needed |
|------|------|---------|------------|
| `exp_gph_reports_36*.dat` | ~1.9GB | Current production (rolling 36 months) | 2GB |
| `exp_gph_reports_gtr36*.dat` | ~6.5GB | Historical archive (>36 months) | 8GB |
| `exp_gplease*.dat` | ~110MB | Lease/PUN metadata, well names, TRS | 2GB |

### Post-Upload Checklist
After new OTC data loads: (1) verify base_pun populated, (2) county-by-county rollups to `county_production_monthly`, (3) purge `prod:*` from OCC_CACHE KV, (4) verify production summaries in UI.

**See:** `Repo Skill and Instructions/OTC-PRODUCTION-DATA-GUIDE.md` for full parsing specs, schema, and loading procedures.

---

## Document Processing Pipeline

### User Document Upload Flow
```
User uploads PDF
    |
    v
documents-worker stores in R2, creates D1 record (status: 'pending')
    |
    v
External processor (Fly.io) - Claude Vision API extraction
    |
    +---> Detects document boundaries (multi-doc PDFs split into children)
    +---> Extracts 50+ field types (legal desc, ownership, recording info, financials)
    +---> Returns confidence scores per field
    |
    v
documents-worker saves extraction results to D1
    |
    v
linkDocumentToEntities() matches to properties/wells
```

### OCC Document Fetch Flow (Automated)
```
User clicks "Analyze" on OCC filing
    |
    v
documents-worker /api/occ/fetch
    |
    v
occ-fetcher /fetch-order
    |
    +---> Search OCC Laserfiche API (GetSearchListing)
    +---> Trigger PDF generation (GeneratePDF10.aspx + polling)
    +---> Download PDF directly to R2
    +---> Register document with documents-worker
    |
    v
Same extraction + linking pipeline as user uploads
```

**See:** `Repo Skill and Instructions/occ-integration-workflow.md` for OCC API details and pitfalls.

---

## Alert System (Monitor Worker)

### Alert Levels
- **YOUR PROPERTY** — Direct TRS match on user's property
- **ADJACENT TO YOUR PROPERTY** — Activity in section adjacent to user's property (3x3 grid)
- **TRACKED WELL** — Activity on a well the user is tracking
- **HORIZONTAL PATH THROUGH PROPERTY** — Horizontal well path crosses user's property
- **STATUS CHANGE** — Well status has changed (Active→Shut In, etc.)

### Activity Types
- Intent to Drill - New Permit
- Well Completed
- Operator Transfer
- Status Change

### Horizontal Well Detection
The monitor detects horizontal wells via:
1. Drill type codes: `HH`, `HORIZONTAL HOLE`, `DH`, `DIRECTIONAL HOLE`
2. Well name patterns: ends with `H`, `MH`, `HX`
3. Bottom hole data differs from surface location

For horizontal wells, the monitor alerts users along the entire path (surface → bottom hole).

### Organization Support
When a property/well belongs to an organization, ALL organization members receive alerts.

### Duplicate Prevention
Checks last 7 days of `activity_log` to prevent re-alerting for same well/activity/user combination.

### Track Well Feature
New permit alert emails include a "Track This Well" button (for YOUR PROPERTY and ADJACENT alerts only). Uses HMAC-signed URLs that expire in 48 hours.

### Test Endpoints
```
# Test permit alert
curl "https://mineral-watch-monitor.photog12.workers.dev/test/daily?permitApi=3504523551"

# Test completion alert
curl "https://mineral-watch-monitor.photog12.workers.dev/test/daily?completionApi=3504523551"

# Test transfer
curl "https://mineral-watch-monitor.photog12.workers.dev/test/weekly-transfers?testApi=3504523551"

# Test status change
curl "https://mineral-watch-monitor.photog12.workers.dev/test/status-change?api=3504523551&newStatus=IA"
```

**See:** `Repo Skill and Instructions/MONITOR-WORKER-GUIDE.md` for full test matrix and troubleshooting.

---

## Authentication Flow

### Login (Magic Link)
```
User enters email → auth-worker generates HMAC token → Postmark sends magic link
    → User clicks link to /portal/verify?token=...
    → Portal redirects to /api/auth/set-session
    → set-session calls auth-worker /api/auth/verify
    → Auth-worker verifies token, sets HttpOnly session cookie (mw_session_v4, 30-day)
    → User redirected to dashboard
```

### Organization Invites
```
Admin invites email → portal-worker generates hex token, stores in KV
    → Postmark sends invite link → Same /portal/verify flow
    → portal-worker verifies KV token
    → POST /api/auth/set-session-cookie sets HttpOnly cookie server-side
    → Redirect to dashboard
```

### Session Details
- **Cookie:** `mw_session_v4`, HttpOnly, Secure, SameSite=Lax, 30-day expiry
- **Per-user revocation:** `sess_valid_after:{userId}` in AUTH_TOKENS KV
- **Super admin:** `SUPER_ADMIN_EMAILS` in `constants.ts` — only `james@mymineralwatch.com`
- **Impersonation:** `?act_as=recXXX` on any dashboard URL. `authenticateRequest()` returns target user's session with `impersonating` metadata. Frontend fetch interceptor appends `act_as` to all `/api/` calls.

### Security (Audited Feb 2026)
- CORS restricted to `https://portal.mymineralwatch.com` (no wildcard)
- All D1 queries use parameterized `.bind()` — no SQL injection
- Stripe webhooks: HMAC-SHA256 signature verification, 5min replay protection, KV dedup
- Plan enforcement on every feature-addition endpoint
- OTC sync endpoints: Bearer token auth (`PROCESSING_API_KEY`)
- Docket matching: `json_each()` + `json_extract()` for precise JSON array matching (no LIKE)
- CSP with X-Frame-Options: DENY, nosniff, strict referrer policy

---

## Airtable Reference

**Base:** Mineral Watch Oklahoma (`app3j3X29Uvp5stza`)

**Important:** Airtable's role is now **limited to user/org ownership records**. All detail reads come from D1. Airtable is NOT the source of truth for property/well detail data — D1 is. The 15-minute sync pushes Airtable ownership data TO D1. Enterprise fields (interests, allocations, property codes) exist **only in D1**.

| Table | Table ID | D1 Equivalent | Role |
|-------|----------|---------------|------|
| Users | `tblmb8sZtfn2EW900` | `users` | Auth, billing, plan tier |
| Organization | `tblqP3BK0zSuaJJ8P` | `organizations` | Team membership |
| Client Properties | `tblbexFvBkow2ErYm` | `properties` | Ownership → synced to D1 |
| Client Wells | `tblqWp3rb7rT3p9SA` | `client_wells` | Ownership → synced to D1 |
| Property-Well Links | `tblcLilnMgeXvxXKT` | `property_well_links` | Links → synced to D1 |
| Activity | `tblhBZNR5pDr620NY` | `activity_log` | Legacy (dual-write) |
| Well Locations | `tblAvTwkBjU8Qwlm7` | — | Deprecated |
| Statewide Activity | `tblbM8kwkRyFS9eaj` | `statewide_activity` | Legacy |

**Key records:** James's user = `recEpgbS88AbuzAH8`, Price Oil & Gas org = `recXvUmWkcgOC04nN`, HHD user = `recdFkQaUWINCbxsG` (John Stobb, jcs@hhdinc.com), HHD org = `recNktWjeZshSUd6N`

---

## Detailed Guides Index

For deeper dives, see `Repo Skill and Instructions/`:
- **MONITOR-WORKER-GUIDE.md** — Alert engine, test endpoints, horizontal detection, email batching
- **MONITORING-TESTING-PROTOCOLS.md** — End-to-end testing procedures
- **OTC-PRODUCTION-DATA-GUIDE.md** — OTC SFTP files, PUN format, parsing specs, loading procedures
- **COMPLETION_REPORTS_IMPLEMENTATION.md** — Completion report extraction and processing
- **occ-integration-workflow.md** — OCC Laserfiche API, PDF generation, document fetch pipeline
- **DOCUMENTS-FEATURE.md** — Document upload, AI extraction, confidence scoring, auto-linking
- **AUTH-SYSTEM-GUIDE.md** — Auth flows, magic links, session management
- **schema-guidelines.md** — Full D1 schema reference with all columns
- **additional-schema-patterns.md** — Schema patterns for future features

---

## Safe vs Risky Operations

### SAFE (user data tables, small)
- Any CRUD on: `properties`, `client_wells`, `property_well_links`, `users`, `organizations`, `activity_log`
- Running the Airtable sync
- Running property-well matching
- Running document relinking
- Backfill operations on `plss_sections` (reference data)

### RISKY (large OCC/OTC tables, source of truth)
- Direct modification to `wells` (453k records) — only safe for: adding columns, updating specific rows by ID/API, backfill operations with WHERE clause
- Direct modification to `otc_production` (6.6M records)
- Any UPDATE without a WHERE clause
- TRUNCATE operations without backup
- Modifying `well_pun_links` (430k records)

### NEVER DO
- Bulk DELETE on `wells` table
- DROP TABLE on any OCC/OTC table
- Force push to main
- Modify `wells` data that came from OCC (operator, status, etc.) — the OCC data is the source of truth

---

## Key Endpoints

### Portal Worker API — V2 (D1-first, current)
- `GET /api/properties/v2` — List user's properties (D1 only)
- `GET /api/wells/v2` — List user's tracked wells (D1 only, with production)
- `GET /api/property-link-counts` — Grid counter (wells/docs/filings) for properties
- `GET /api/well-link-counts` — Grid counter for wells
- `GET /api/docket-entries` — OCC filings modal data
- `GET /api/completion-reports/:apiNumber` — Production summary (batched D1)
- `GET /api/map/counties` — County GeoJSON boundaries
- `GET /api/map/townships` — Township GeoJSON boundaries
- `GET /api/map/county-production` — Choropleth production data
- `GET /api/map/pooling-rates` — Pooling bonus rates by township
- `POST /api/auth/set-session-cookie` — Set HttpOnly cookie server-side

### Portal Worker API — Admin
- `POST /api/admin/sync` — Trigger Airtable sync
- `GET /api/admin/impersonate-info?user_id=recXXX` — Impersonation banner info
- `POST /api/admin/backfill-section-centers` — Compute PLSS section centroids
- `POST /api/admin/backfill-bh-coordinates` — Geocode BH coords from section centers

### Portal Worker API — Bulk & Matching
- `POST /api/bulk/validate-properties` / `upload-properties` — Bulk property upload (D1-first)
- `POST /api/bulk/validate-wells` / `upload-wells` — Bulk well upload (D1-first)
- `POST /api/match-property-wells` — Run property-well matching

### Portal Worker API — OTC Sync (Bearer token auth)
- `POST /api/otc-sync/upload-pun-production` — Batched production upload from Fly
- `POST /api/otc-sync/upload-pun-metadata` — PUN lease metadata upload
- `POST /api/otc-sync/upload-well-pun-links` — Well-PUN link upload

### Documents Worker API
- `POST /api/processing/relink-all` — Re-link all documents to current properties/wells
- `POST /api/documents/relink` — Re-link unlinked documents only

---

## Subscription Plans

| Plan | Properties | Wells | Key Features |
|------|-----------|-------|--------------|
| Free | 1 | 1 | Basic monitoring |
| Starter | 10 | 10 | Adjacent monitoring, documents |
| Standard | 50 | 50 | Full monitoring, bulk upload |
| Professional | 250 | 250 | Organization support, team sharing |
| Business | 500 | 500 | Full enterprise features |
| Enterprise 1K | 1,000 | 1,000 | Custom (HHD account) |

---

## Important Limits

- **D1 bound parameters:** 100 per prepared statement. STR queries use 3 params each → max 33 STR combos per query. `BATCH_SIZE_D1 = 30` in link-counts handlers.
- **D1 batch:** 500 statements per batch.
- **D1 CPU time:** Never inline full-table subqueries on large tables (7.7M rows). Query in batches of 50 with `WHERE ... IN (...)`.
- **SQLite type comparison:** `INTEGER 7 ≠ TEXT '7'` — always use `String()` when binding to TEXT columns.
- **Airtable:** 10 records per API call, 500ms delay between batches.
- **OTC Fly machine:** Default `shared-cpu-1x:2048MB`. Scale to 8GB for gtr36 processing.
- **OTC PUN batches:** `PUN_API_BATCH_SIZE=5000` (Python), `BATCH_SIZE=500` (upload handler).
- **Production KV cache:** `prod:{api10}` in OCC_CACHE, 24h TTL. Must purge after data loads.

## Environment and Deployment

- **Platform:** Cloudflare Workers (all workers)
- **Database:** Cloudflare D1 (oklahoma-wells, shared across portal-worker, monitor-worker, documents-worker)
- **Storage:** Cloudflare R2 (uploads, digital locker, RBDMS cache)
- **Cache:** Cloudflare KV (OCC_CACHE, COMPLETIONS_CACHE, AUTH_TOKENS)
- **Email:** Postmark (magic links via auth-worker), Resend (alerts/digests via monitor-worker, forum-monitor)
- **Payments:** Stripe (checkout, subscriptions, credit packs)
- **AI:** Anthropic Claude (Sonnet 4.6 standard, Opus 4.6 enhanced) via documents-worker
- **Commodity prices:** EIA API via tools-worker (6hr KV cache)
- **User ownership data:** Airtable (synced one-way to D1 every 15 min)
- **Production data:** OTC via Fly.io machine (daily automated pipeline)
- **Domain:** portal.mymineralwatch.com (portal-worker), auth.mymineralwatch.com (auth-worker)
- **Deploy:** `npx wrangler deploy` from each worker directory

---

## Migration Status (as of Feb 2026)

### Completed (D1-First Migration)
- **V2 endpoints**: `/api/properties/v2` and `/api/wells/v2` read exclusively from D1 — zero Airtable calls
- **Wells V2**: Single D1 query joins `client_wells → wells → operators`, separate batched production query
- **Enterprise fields in D1 only**: property codes, interest decimals, section allocations
- **Time-budgeted sync**: Phase machine with KV cursor, merged wells double-fetch, 90% safety guard
- **Bulk import D1-first**: CSV → D1 (all fields) → Airtable (ownership only) → auto-match
- Migration 007: D1 tables for users, organizations, activity_log, sessions, invites, audit_log
- Backfilled users (19) and organizations (2) from Airtable to D1
- Monitor worker reads properties/users/wells from D1, writes alerts to D1 activity_log
- OTC production pipeline: 7.7M+ records via Fly.io automated daily sync
- Security audit (Feb 2026): CORS restricted, HttpOnly cookies, json_extract docket matching
- Dashboard decomposed from 20,107-line monolith into 18 build-time components (Jan 2026)
- PLSS section centers computed (70,030 sections), BH coordinates backfilled (17,730 wells)
- Auto-geocoding runs every sync cycle for new wells
- Document AI extraction: Claude Sonnet 4.6 (standard) / Opus 4.6 (enhanced, 2 credits)
- Multi-well document linking with alphanumeric-only name normalization
- Section allocation for horizontals (division order extraction → property_well_links)
- Revenue estimator modal with multi-interest display
- Pooling rates choropleth map layer

### Still Using Airtable (Limited)
- **Users & Organizations**: Auth, billing, plan tier, org membership — Airtable is source of truth
- **Ownership records**: Properties, wells, links synced FROM Airtable TO D1 (one-way)
- Auth worker: looks up users in Airtable directly
- Property-well matching: still creates links in Airtable (synced to D1)

### Future Migration Targets
- Auth worker: migrate user lookup from Airtable to D1
- Property-well matching: move matching logic to D1 (eliminate Airtable dependency)
- Direct property/well CRUD in D1 (bypass Airtable for data entry)
