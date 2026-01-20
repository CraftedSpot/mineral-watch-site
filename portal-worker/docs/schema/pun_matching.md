# PUN Matching System

This document describes the schema and logic for linking OCC wells (API numbers) to OTC Production Unit Numbers (PUNs).

## Overview

Oklahoma wells are tracked by two systems:
- **OCC (Corporation Commission)**: Uses 10-digit API numbers (e.g., `3504323686`)
- **OTC (Tax Commission)**: Uses PUNs in format `XXX-XXXXXX-X-XXXX` (county-lease-sub-merge)

Matching these identifiers enables production data display, royalty calculations, and document linking.

## Tables

### `wells`
Primary well records from OCC/RBDMS data.

| Column | Type | Description |
|--------|------|-------------|
| `api_number` | TEXT | 10-digit API (unique identifier) |
| `well_name` | TEXT | Well name from OCC |
| `well_name_normalized` | TEXT | Uppercase, punctuation stripped |
| `otc_prod_unit_no` | TEXT | PUN from OCC completion (if available) |
| `county` | TEXT | County name |
| TRS columns | | Section, township, range |

### `puns`
Master table of OTC Production Unit Numbers.

| Column | Type | Description |
|--------|------|-------------|
| `pun` | TEXT | Formatted PUN (XXX-XXXXXX-X-XXXX) |
| `pun_normalized` | TEXT | Dashes removed (14 chars) |
| `lease_name` | TEXT | Lease name from OTC |
| `county` | TEXT | County name |
| `trs_section`, `trs_township`, `trs_range` | | Location from OTC leases |
| `first_prod_month` | TEXT | YYYYMM of first production |
| `last_prod_month` | TEXT | YYYYMM of most recent production |
| `total_oil_bbl` | REAL | Lifetime oil production (barrels) |
| `total_gas_mcf` | REAL | Lifetime gas production (MCF) |
| `status` | TEXT | Active, Shut-in, etc. |
| `peak_month` | TEXT | YYYYMM of highest production |
| `peak_month_oil_bbl` | REAL | Oil volume in peak month |
| `decline_rate_12m` | REAL | % change over 12 months |
| `is_stale` | INTEGER | 1 if no production in 6+ months |

### `well_pun_links`
Crosswalk table linking APIs to PUNs with provenance.

| Column | Type | Description |
|--------|------|-------------|
| `api_number` | TEXT | Well API |
| `pun` | TEXT | Linked PUN |
| `link_status` | TEXT | unlinked, proposed, verified, rejected |
| `match_method` | TEXT | How the link was created |
| `confidence` | TEXT | high, medium, low |
| `confidence_score` | REAL | 0.0 to 1.0 numeric confidence |
| `verified` | INTEGER | 1 if user confirmed |
| `needs_review` | INTEGER | 1 if ambiguous match |
| `allocation_percent` | REAL | For multi-PUN wells (e.g., 50%) |
| `document_sources` | TEXT | JSON array of supporting documents |
| `last_reviewed_by_user_id` | INTEGER | User who last reviewed |
| `last_reviewed_at` | TEXT | Timestamp of review |

### `otc_production`
Monthly production data by PUN.

| Column | Type | Description |
|--------|------|-------------|
| `pun` | TEXT | Production Unit Number |
| `year_month` | TEXT | YYYYMM |
| `product_code` | TEXT | 1=Oil, 3=Condensate, 5=Gas, 6=Gas |
| `gross_volume` | REAL | Production volume |
| `gross_value` | REAL | Reported value |

## Link Status Values

| Status | Description | UI Display |
|--------|-------------|------------|
| `unlinked` | No confident match found | "Not linked yet" |
| `proposed` | Algorithmic match, awaiting review | "Linked" with review option |
| `verified` | User confirmed the match | "Linked" (green badge) |
| `rejected` | User rejected proposed match | Hidden from production display |
| `user_overridden` | User manually set a different PUN | "Linked" (user override) |

## Match Methods

| Method | Description | Typical Confidence |
|--------|-------------|-------------------|
| `rbdms` | Direct PUN from OCC completion data | High (0.95+) |
| `document` | Extracted from 1002A or other OCC document | High (0.90+) |
| `trs_name` | TRS + well name matching | Medium (0.70-0.85) |
| `trs_operator` | TRS + operator matching | Medium (0.60-0.80) |
| `name_only` | Fuzzy name match without TRS | Low (0.40-0.60) |
| `user` | Manually linked by user | High (1.0) |

## Computing Trend Flags

Recompute these on production data import:

```sql
-- Update is_stale flag (no production in 6+ months)
UPDATE puns SET
  is_stale = CASE
    WHEN last_prod_month < strftime('%Y%m', 'now', '-6 months') THEN 1
    ELSE 0
  END,
  months_since_production = (
    (strftime('%Y', 'now') - substr(last_prod_month, 1, 4)) * 12 +
    (strftime('%m', 'now') - substr(last_prod_month, 5, 2))
  );

-- Update decline_rate_12m
-- (Requires comparing last 3 months avg to same period last year)
```

## Document Provenance Format

The `document_sources` column stores JSON:

```json
[
  {
    "type": "1002A",
    "id": "1144764",
    "entry_id": 12345,
    "extracted_at": "2025-01-20T12:00:00Z",
    "confidence": 0.99,
    "fields": ["API", "PUN"]
  }
]
```

## User Review Workflow

1. User views well with `link_status = 'proposed'`
2. UI shows "Review PUN Link" option
3. User confirms or rejects:
   - **Confirm**: Sets `verified = 1`, `link_status = 'verified'`, records user_id
   - **Reject**: Sets `link_status = 'rejected'`, records user_id
   - **Override**: User enters different PUN, creates new link with `match_method = 'user'`

## Multi-PUN Wells (Horizontal/Multiunit)

Some wells report to multiple PUNs (e.g., horizontal wells crossing sections):

```
NEWLEY 15-22-1XH
├── 043-226597-0-0000 (Section 22, 49.97%)
└── 043-226974-0-0000 (Section 15, 50.03%)
```

Use `allocation_percent` to track ownership split. Production queries should:
1. Sum across all linked PUNs, OR
2. Apply allocation percentages for accurate per-PUN attribution

## Data Sources

| Source | File | Refresh | Contains |
|--------|------|---------|----------|
| OTC SFTP | `exp_gph_reports_*.dat` | Monthly | Full production history |
| OTC SFTP | `exp_gplease*.dat` | Monthly | PUN master/TRS data |
| OTC SFTP | `exp_gpland*.csv` | Monthly | Recent tax filings |
| OCC API | 1002A forms | On-demand | API + PUN on completion reports |

## OTC SFTP Connection

```
Host: otcmft.tax.ok.gov
User: mineralwatchcllc-gp
Password: [stored in Fly secrets as OTC_PASSWORD]
Directory: Gross Production Extracts/Gross-Production-Extracts
```

Automation: `mineral-watch-otc-fetch` Fly.io app with static IP `209.71.72.222`.
