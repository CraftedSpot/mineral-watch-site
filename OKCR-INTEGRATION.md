# OKCountyRecords Integration Guide

Last updated: 2026-01-31

## Overview

OKCountyRecords (OKCR) integration adds county clerk document search, retrieval, and extraction to Mineral Watch. Users can search Oklahoma county clerk indexes for leases, deeds, assignments, and other recorded instruments, then extract structured data from the documents using Claude Sonnet.

OKCR covers 67 Oklahoma counties with searchable indexes of recorded instruments. Search is free (150 results/day included). Document retrieval costs $0.40/instrument (watermarked view) or $1.00/page (clean official copy).

---

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Search endpoints (counties, instrument types, search) | Deployed |
| 2 | Document retrieval + extraction with credit billing | Not started |
| 3 | Lease comps UI combining OKCR + OTC data | Future |

---

## OKCR API Details

- **Base URL:** `https://okcountyrecords.com/api/v1`
- **Auth:** Basic Auth — API key as username, empty password
- **API Key:** Set as worker secret `OKCR_API_KEY` via `wrangler secret put`
- **Account:** $99.60 remaining balance, auto-renew at $1 minimum ($100 reload)
- **Free tier:** 150 search results/day (resets daily), $0.01/result beyond that
- **Rate limit:** One search per `api-seconds-until-next-search` header (typically ~24 hours between resets)

### Key Endpoints

| Endpoint | Method | Cost | Notes |
|----------|--------|------|-------|
| `/counties` | GET | Free | List all available counties |
| `/instrument-types?county=X` | GET | Free | Types vary by county |
| `/search?county=X&...` | GET | Free (150/day) | Pagination via response headers |
| `/images?county=X&number=Y&action=view` | GET | $0.40/instrument | Watermarked PDF |
| `/images?county=X&number=Y&action=print` | GET | $1.00/page | Clean official copy |

### Important Quirks

- **Instrument type names vary by county.** Grady uses "Oil & Gas Lease" (ampersand), Blaine uses "Oil And Gas Lease" (spelled out). Always fetch types per county first.
- **Pagination is in response headers**, not the JSON body: `API-Total-Result-Count`, `API-Result-Page-Count`, `API-Result-Page`, `API-Next-Page-Address`
- **Legal descriptions are pre-parsed** by OKCR into section/township/range fields — no need for LLM parsing of TRS from search results.
- **Free test image:** Adair County instrument #352795 (court filing, always free to view)

---

## Phase 1: Search (Deployed)

### What's Built

Three endpoints in `portal-worker/src/handlers/county-records.ts`:

**`GET /api/county-records/counties`** — No auth required
- Returns 67 counties with searching/images enabled
- Cached in KV `okcr:counties` with 7-day TTL
- Filters to `searching_enabled && images_enabled`

**`GET /api/county-records/instrument-types?county=X`** — No auth required
- Returns instrument types for a specific county
- Cached in KV `okcr:types:{county}` with 7-day TTL

**`POST /api/county-records/search`** — Auth required
- Request body: `{ county, section?, township?, range?, type?, party_name?, party_type?, indexed_date_start?, indexed_date_end?, instrument_date_start?, instrument_date_end?, text?, page? }`
- SHA-256 hash of sorted query params as cache key
- Cached in KV `okcr:search:{hash}` with 15-minute TTL
- Transforms OKCR response: extracts grantors/grantees from parties array, simplifies legal descriptions
- Returns `cached: false` and `retrieve_credits: 5` on every result (Phase 1 — no extraction cache yet)

### Files Modified

| File | Change |
|------|--------|
| `portal-worker/src/handlers/county-records.ts` | NEW — 3 handlers + 2 helpers |
| `portal-worker/src/handlers/index.ts` | Added county-records exports |
| `portal-worker/src/index.ts` | Added 3 route registrations |
| `portal-worker/src/types/env.ts` | Added `OKCR_API_KEY`, `OKCR_API_BASE` to Env |
| `portal-worker/wrangler.toml` | Added `OKCR_API_BASE` var |

### KV Caching Strategy

Reuses existing `OCC_CACHE` KV namespace with `okcr:` prefix:

| Key Pattern | TTL | Content |
|-------------|-----|---------|
| `okcr:counties` | 7 days | Array of county objects |
| `okcr:types:{county}` | 7 days | Array of instrument type objects |
| `okcr:search:{sha256-prefix}` | 15 min | Search results + pagination |

### Verified Working

- Counties endpoint: 67 counties returned
- Instrument types: 531 types for Grady County
- Auth gate: Search returns 401 without valid session
- Error handling: Invalid county returns 404, missing params returns 400

---

## Phase 2: Retrieval + Extraction (Not Started)

### Credit Pricing Model

| Action | Credits | OKCR Cost | Notes |
|--------|---------|-----------|-------|
| Extract (watermarked) | 5 flat | $0.40 | Watermark doesn't affect extraction |
| Official copy (clean) | 5 per page | $1.00/page | Includes extraction for free |
| Cached result | 0 | $0.00 | Previously extracted document |

Official copy includes extraction automatically — better source quality means better extraction, and it caches for future extract requests at 0 credits.

### Extraction Model

**Claude Sonnet 4** (`claude-sonnet-4-20250514`) at ~$0.035/doc for 4-page lease.

Haiku was tested and rejected — it missed royalty fraction (returned null), quarter section, bonus per acre, and pooling terms. Sonnet extracts all fields correctly including royalty (e.g., "1/5" → 0.2), surface restrictions, and clause summaries.

Watermark testing confirmed: "NOT AN OFFICIAL COPY" diagonal watermark does NOT interfere with Claude vision extraction.

### New Endpoint

**`POST /api/county-records/retrieve`** — Auth required, credits required

```typescript
// Request
{
  county: string,
  instrument_number: string,
  format: 'extract' | 'official'  // watermarked vs clean
}

// Credit calculation
const credits = format === 'extract'
  ? 5
  : pageCount * 5;
```

### Portal-Worker Flow

1. Check cache (`county_record_extractions` D1 table) → return free if exists
2. Check user credits >= required amount
3. Insert "processing" row for race condition handling:
   ```sql
   INSERT OR IGNORE INTO county_record_extractions
   (county, instrument_number, status) VALUES (?, ?, 'processing');
   ```
   - If inserted (`changes = 1`), proceed with retrieval
   - If ignored (`changes = 0`), another request is already processing — return "processing, check back" or poll
4. Call documents-worker via service binding
5. Deduct credits after successful extraction
6. Update row with extraction result
7. Link to matching properties/wells via TRS
8. Return extracted data to user

### Documents-Worker Endpoint (New)

**`POST /extract-county-record`** — Internal only, service binding

```typescript
// Request
{
  county: string,
  instrument_number: string,
  image_number: number,
  format: 'extract' | 'official'
}
```

Flow:
1. Fetch PDF from OKCR:
   ```typescript
   const action = format === 'official' ? 'print' : 'view';
   const url = `${OKCR_API_BASE}/images?county=${county}&number=${imageNumber}&action=${action}`;
   ```
2. Store in R2: `county-records/{county}/{instrument_number}.pdf`
3. Run extraction using existing schemas (see below)
4. Return structured data + R2 path

### D1 Schema

```sql
CREATE TABLE county_record_extractions (
  county TEXT NOT NULL,
  instrument_number TEXT NOT NULL,
  instrument_type TEXT,
  recorded_date TEXT,
  grantor TEXT,
  grantee TEXT,
  legal_description TEXT,
  section TEXT,
  township TEXT,
  range TEXT,
  quarter_section TEXT,
  effective_date TEXT,
  primary_term_months INTEGER,
  royalty_fraction REAL,
  option_terms TEXT,
  consideration TEXT,
  r2_path TEXT,
  page_count INTEGER,
  status TEXT DEFAULT 'complete',  -- 'processing' | 'complete' | 'failed'
  raw_extraction_json TEXT,
  extracted_at TEXT,
  extraction_model TEXT,
  UNIQUE(county, instrument_number)
);

CREATE INDEX idx_cre_trs ON county_record_extractions(section, township, range);
```

### Extraction Schemas

Use existing schemas already built in the codebase. Do not create new extraction prompts.

| County Record Type | Existing Schema |
|-------------------|-----------------|
| Oil & Gas Lease | Lease v2 |
| Mineral Deed | Mineral Deed v2 |
| Assignment | Assignment of Lease |
| Quit Claim Deed | Quit Claim Deed |
| Affidavit of Heirship | Affidavit of Heirship |

For document types without schemas → generic extraction (grantor, grantee, legal description, effective date, key terms).

### Service Binding

Portal-worker `wrangler.toml` (already configured):
```toml
[[services]]
binding = "DOCUMENTS_WORKER"
service = "documents-worker"
```

Both workers need `OKCR_API_KEY` and `OKCR_API_BASE`.

---

## Phase 3: Lease Comps UI (Future)

Combine county records with OTC production data for mineral rights research:

- User searches by TRS (section/township/range)
- Show nearby O&G leases from OKCountyRecords index
- Show formation context from `otc_leases` (Woodford, Meramec, etc.)
- Show production status — is it HBP (held by production)?
- User extracts specific documents to see terms (royalty, bonus, primary term)

This combines OKCR county clerk data with the existing OTC production pipeline (6.5M production records, 456K well-PUN links) to give users a complete picture of lease activity in their area.

---

## Future: Anonymized Lease Comps from User Uploads

When users upload their own leases (via document locker or bulk upload), extract and store terms (royalty fraction, bonus per acre, primary term) linked to TRS. Aggregate anonymized terms by section to show "nearby lease terms" even where no OKCR pull has occurred.

Over time, this becomes proprietary data that reduces OKCR dependency. Users contribute to a shared dataset just by using the platform — the more users in an area, the better the comps data gets.

Key fields to aggregate by TRS:
- Royalty fraction (median, range)
- Bonus per acre (median, range)
- Primary term months (common values)
- Operator (who's leasing in the area)
- Date range (are terms trending up or down?)

Privacy: No user identification, no specific tract details. Only aggregated statistics per section with minimum threshold (e.g., 3+ leases) before showing data.

---

## Configuration Reference

### Environment Variables

| Variable | Location | Value |
|----------|----------|-------|
| `OKCR_API_BASE` | `wrangler.toml` [vars] | `https://okcountyrecords.com/api/v1` |
| `OKCR_API_KEY` | Worker secret | Set via `wrangler secret put OKCR_API_KEY` |

### Deployment

```bash
cd portal-worker
wrangler deploy
# If API key needs to be set/updated:
wrangler secret put OKCR_API_KEY
```

### Testing

```bash
# Counties (no auth)
curl https://portal.mymineralwatch.com/api/county-records/counties

# Instrument types (no auth)
curl https://portal.mymineralwatch.com/api/county-records/instrument-types?county=Grady

# Search (requires auth cookie from browser)
curl -X POST https://portal.mymineralwatch.com/api/county-records/search \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"county":"Grady","type":"Oil & Gas Lease","section":"4","township":"7N","range":"8W"}'
```
