# Mineral Watch - System Architecture Guide

Last updated: 2026-01-27

## Overview

Mineral Watch is an Oklahoma mineral rights monitoring platform. Users upload properties (defined by PLSS legal descriptions) and track wells. The system monitors OCC (Oklahoma Corporation Commission) filings daily and alerts users to activity affecting their interests.

The platform runs entirely on Cloudflare Workers with a D1 (SQLite) database as the primary data store, Airtable as a secondary input interface for user data, and R2 for document/file storage.

---

## Workers and Their Roles

### portal-worker (primary API + UI)
- **Purpose:** Main API server and portal UI. Handles all user-facing API requests, serves the portal SPA, and runs the 15-minute Airtable sync.
- **Cron:** `*/15 * * * *` (Airtable sync every 15 minutes)
- **Bindings:**
  - D1: `WELLS_DB` (oklahoma-wells)
  - KV: `AUTH_TOKENS`, `OCC_CACHE`, `COMPLETIONS_CACHE`
  - Services: `AUTH_WORKER`, `DOCUMENTS_WORKER`, `OCC_FETCHER`
- **Key files:** `src/index.ts` (router), `src/sync.ts` (Airtable sync), `src/handlers/` (API handlers)

### mineral-monitor-worker (alert engine)
- **Purpose:** Processes OCC Excel files daily, detects new permits/completions/transfers, finds matching users, creates alerts, sends emails.
- **Cron:** Daily 8AM CT (permits/completions), Sunday 8AM CT (transfers), Mon-Fri noon CT (dockets), Daily 6PM CT (digest emails)
- **Bindings:**
  - D1: `WELLS_DB` (shared)
  - KV: `MINERAL_CACHE`, `COMPLETIONS_CACHE` (shared)
  - R2: `RBDMS_BUCKET`
- **Key files:** `src/monitors/daily.js`, `src/monitors/weekly.js`, `src/services/d1.js`
- **Migration status:** Reads from D1 for properties/users/wells. Writes alerts to D1 `activity_log`. Still uses Airtable for some user preference lookups.

### documents-worker (document processing)
- **Purpose:** Handles document uploads, AI extraction of legal descriptions, and document-to-property/well linking.
- **Bindings:**
  - D1: `WELLS_DB` (shared)
  - R2: `UPLOADS_BUCKET`, `LOCKER_BUCKET`
  - Services: `AUTH_WORKER`, `OCC_FETCHER`
- **Key endpoint:** `POST /api/processing/relink-all` — re-matches ALL documents to properties/wells by legal description. Called automatically after every sync.

### auth-worker (authentication)
- **Purpose:** Handles login, magic links, session verification.
- **Minimal bindings:** Uses Airtable API directly for user lookup. Plans to migrate to D1.

### occ-fetcher (OCC API proxy)
- **Purpose:** Proxies requests to OCC ArcGIS REST API for well data, completion reports, docket searches.
- **Bindings:** R2 `UPLOADS_BUCKET`, KV `OCC_CACHE`, Service `DOCUMENTS_WORKER`

### puns-harvester (DISABLED)
- **Purpose:** Harvests PUN (Permanent Unit Number) data from OCC. Currently disabled awaiting OTC re-import with 6-digit PUN format.

### Other workers
- **mineralwatch-contact:** Contact form handler
- **mineral-watch-webhooks:** Generic webhook handler
- **stripe-webhook:** Stripe payment event handler

---

## D1 Database (oklahoma-wells)

### OCC/OTC Data (Source of Truth - NOT from Airtable)

| Table | Records | Source | Purpose |
|-------|---------|--------|---------|
| `wells` | ~453k | OCC SFTP monthly | Full Oklahoma well registry. Surface/BH locations, operator, status, formations |
| `otc_production` | ~6.6M | OTC SFTP monthly | Monthly production volumes by PUN |
| `puns` | ~185k | OTC data | PUN rollup summaries |
| `well_pun_links` | ~430k | OTC data | API number <-> PUN mapping |
| `occ_docket_entries` | varies | OCC scraping | Regulatory orders and docket items |
| `plss_sections` | ~70k | GeoJSON import | Section boundaries with center_lat/center_lng for geocoding |
| `statewide_activity` | ~500 | OCC scraping | Recent permits/completions for heatmap display |
| `counties` | 77 | GeoJSON import | County boundaries |
| `townships` | varies | GeoJSON import | Township boundaries |

### User Data (Synced from Airtable every 15 min)

| Table | Records | Source | Purpose |
|-------|---------|--------|---------|
| `properties` | ~500-1k | Airtable sync | User-uploaded mineral properties (Section/Township/Range) |
| `client_wells` | ~850 | Airtable sync | Wells users track (via upload, enrichment, or track button) |
| `property_well_links` | varies | Airtable sync | Links between properties and wells (auto-matched or manual) |

### User/Auth Data (D1 native, created in Migration 007)

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
    +---> Send alert emails via Postmark
```

The main `wells` table (453k records) is loaded from OCC data. This is NOT touched by the Airtable sync.

### 2. Airtable Sync (Every 15 Minutes)

```
Airtable (user-entered data)
    |
    v
portal-worker cron (syncAirtableData)
    |
    +---> syncProperties() -----> D1 properties (upsert + orphan cleanup)
    +---> syncWells() ----------> D1 wells (updates airtable_record_id on matching API#)
    +---> syncClientWells() ----> D1 client_wells (upsert + orphan cleanup + enrichment)
    +---> syncPropertyWellLinks() -> D1 property_well_links (upsert + orphan cleanup)
    |
    +---> Trigger documents-worker relink-all (matches docs by legal description)
    +---> Auto-geocode BH coordinates (fills in section_center coords for new wells)
```

**Orphan cleanup:** After each sync function upserts all Airtable records, it queries D1 for any rows whose `airtable_record_id` is NOT in the Airtable set and deletes them. This handles record deletions in Airtable being reflected in D1.

### 3. Client Wells Enrichment (During Sync)

After syncing client_wells from Airtable, the sync copies OCC data from the main `wells` table:
- `is_horizontal`, `bh_section`, `bh_township`, `bh_range`
- `bh_latitude`, `bh_longitude` (includes section_center approximations)
- `lateral_length`

### 4. BH Coordinate Auto-Geocoding (During Sync)

After sync completes, `geocodeBhFromSectionCenters()` runs:
- Finds wells with `bh_section`/`bh_township`/`bh_range` but no `bh_latitude`
- Converts formats: wells `27N`/`09W`/`IM` -> plss `270N`/`9W`/`indian`
- Looks up section center from `plss_sections` table
- Sets `bh_coordinate_source = 'section_center'`
- Processes up to 500 wells per cycle

### 5. Property-Well Matching

When properties are uploaded (bulk upload), `runFullPropertyWellMatching` runs in Airtable:
- **Exact TRS match only** — matches on Section/Township/Range
- Checks: Surface Location match -> Lateral Path (Sections Affected) match -> Bottom Hole match
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

### Data Flow
```
OTC SFTP (otcmft.tax.ok.gov)
    |
    v
Fly.io Download Script (monthly)
    |
    +---> Parse fixed-width .dat files
    +---> Stream to D1 via portal-worker upload endpoints
    |
    v
D1 Tables: otc_production (6.6M), puns (185k), well_pun_links (430k)
    |
    v
Portal Worker API --> UI production charts
```

### OTC Files
| File | Size | Content |
|------|------|---------|
| `exp_gph_reports_36*.dat` | ~1.9GB | Current production (rolling 36 months) |
| `exp_gph_reports_gtr36*.dat` | ~6.5GB | Historical archive (>36 months) |
| `exp_gplease*.dat` | ~110MB | Lease/PUN metadata, well names, TRS |

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
    → Auth-worker verifies token, sets session cookie
    → User redirected to dashboard
```

### Organization Invites
```
Admin invites email → portal-worker generates hex token, stores in KV
    → Postmark sends invite link → Same /portal/verify flow
    → portal-worker verifies KV token, creates session
```

---

## Airtable Reference

**Base:** Mineral Watch Oklahoma (`app3j3X29Uvp5stza`)

| Table | Table ID | D1 Equivalent |
|-------|----------|---------------|
| Users | `tblmb8sZtfn2EW900` | `users` |
| Organization | `tblqP3BK0zSuaJJ8P` | `organizations` |
| Client Properties | `tblbexFvBkow2ErYm` | `properties` |
| Client Wells | `tblqWp3rb7rT3p9SA` | `client_wells` |
| Activity | `tblhBZNR5pDr620NY` | `activity_log` |
| Well Locations | `tblAvTwkBjU8Qwlm7` | (deprecated) |
| Statewide Activity | `tblbM8kwkRyFS9eaj` | `statewide_activity` |

**Key records:** James's user = `recEpgbS88AbuzAH8`, Price Oil & Gas org = `recXvUmWkcgOC04nN`

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

### Portal Worker API
- `POST /api/admin/sync` — Trigger Airtable sync (requires SYNC_API_KEY)
- `POST /api/admin/backfill-section-centers` — Compute PLSS section centroids
- `POST /api/admin/backfill-bh-coordinates` — Geocode BH coords from section centers
- `POST /api/match-property-wells` — Run property-well matching
- `POST /api/bulk/validate-properties` / `upload-properties` — Bulk property upload
- `POST /api/bulk/validate-wells` / `upload-wells` — Bulk well upload
- `GET /api/wells` — List user's tracked wells
- `GET /api/properties` — List user's properties
- `GET /api/well-enrichment/:apiNumber` — Get OCC enrichment data for a well

### Documents Worker API
- `POST /api/processing/relink-all` — Re-link all documents to current properties/wells
- `POST /api/documents/relink` — Re-link unlinked documents only

---

## Subscription Plans

| Feature | Free | Pro | Team |
|---------|------|-----|------|
| Properties | 5 | 50 | Unlimited |
| Wells | 10 | 100 | Unlimited |
| Adjacent monitoring | No | Yes | Yes |
| Document storage | No | Yes | Yes |
| Organization/sharing | No | No | Yes |

---

## Environment and Deployment

- **Platform:** Cloudflare Workers (all workers)
- **Database:** Cloudflare D1 (oklahoma-wells, shared across portal-worker, monitor-worker, documents-worker)
- **Storage:** Cloudflare R2 (uploads, digital locker, RBDMS cache)
- **Cache:** Cloudflare KV (OCC cache, completions cache, auth tokens)
- **Email:** Postmark
- **Payments:** Stripe
- **User data input:** Airtable (synced to D1 every 15 min)
- **Domain:** portal.mymineralwatch.com (portal-worker), auth.mymineralwatch.com (auth-worker)
- **Deploy:** `npx wrangler deploy` from each worker directory

---

## Migration Status (as of Jan 2026)

### Completed
- Migration 007: Created D1 tables for users, organizations, activity_log, sessions, invites, audit_log
- Backfilled users (19) and organizations (2) from Airtable to D1
- Monitor worker reads properties/users/wells from D1 (not Airtable)
- Monitor worker writes alerts to D1 activity_log (not Airtable)
- Sync enriches client_wells from main wells table (is_horizontal, BH location, lateral_length)
- PLSS section centers computed (70,030 sections)
- BH coordinates backfilled from section centers (17,730 wells)
- Auto-geocoding runs every sync cycle for new wells
- Orphan cleanup in sync (deletes D1 records removed from Airtable)

### Still Using Airtable
- User data entry (properties, wells) — users interact with Airtable, synced to D1
- Property-well matching — runs in Airtable after bulk upload
- Auth worker — still looks up users in Airtable directly
- Some user preference lookups in monitor worker

### Future Migration Targets
- Auth worker: migrate user lookup from Airtable to D1
- Property-well matching: move matching logic to D1 (eliminate Airtable dependency)
- User data entry: build portal UI for direct property/well management (bypass Airtable)
- Organization activity log: fix isolation issue (currently filters by user, not org)
