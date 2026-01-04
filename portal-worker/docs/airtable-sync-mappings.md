# Airtable Sync Field Mappings

## Overview
This document describes the field mappings between Airtable and D1 database for the sync functionality.

## Base Configuration
- **Base ID**: `appRBoI9wCy4eOhzd`
- **Sync Endpoint**: `POST /api/admin/sync`

## Properties Table

### Airtable Details
- **Table Name**: Client Properties
- **Table ID**: `tblbexFvBkow2ErYm`

### Field Mapping (Simplified Structure)
| Airtable Field | D1 Column | Type | Notes |
|----------------|-----------|------|-------|
| COUNTY | county | TEXT | County name |
| SEC | section | TEXT | Section number |
| TWN | township | TEXT | Township |
| RNG | range | TEXT | Range |
| ACRES | acres | REAL | Total acres |
| NET ACRES | net_acres | REAL | Net mineral acres |
| Notes | notes | TEXT | User notes |
| User | owner | TEXT | Linked field - uses first value with null check: `fields['User']?.[0] \|\| null` |

### D1 Schema
```sql
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  airtable_record_id TEXT UNIQUE,
  county TEXT,
  section TEXT,
  township TEXT,
  range TEXT,
  acres REAL,
  net_acres REAL,
  notes TEXT,
  owner TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced_at DATETIME
);
```

## Wells Table

### Airtable Details
- **Table Name**: Client Wells
- **Table ID**: `tblqWp3rb7rT3p9SA`

### Field Mapping (Comprehensive Structure)
| Airtable Field | D1 Column | Type | Notes |
|----------------|-----------|------|-------|
| API Number | api_number | TEXT | Unique well identifier |
| Well Name | well_name | TEXT | Well name |
| Operator | operator | TEXT | Current operator |
| Status | status | TEXT | General status |
| Well Status | well_status | TEXT | Detailed well status |
| County | county | TEXT | County location |
| Section | section | TEXT | Section |
| Township | township | TEXT | Township |
| Range | range | TEXT | Range |
| Formation Name | formation_name | TEXT | Producing formation |
| Spud Date | spud_date | TEXT | Date drilling started |
| Completion Date | completion_date | TEXT | Date completed |
| First Production Date | first_production_date | TEXT | First production date |
| Data Last Updated | data_last_updated | DATETIME | Last data update |
| Last RBDMS Sync | last_rbdms_sync | DATETIME | Last RBDMS sync time |

### D1 Schema
```sql
CREATE TABLE IF NOT EXISTS wells (
  id TEXT PRIMARY KEY,
  airtable_record_id TEXT UNIQUE,
  api_number TEXT UNIQUE,
  well_name TEXT,
  operator TEXT,
  status TEXT,
  well_status TEXT,
  well_type TEXT,
  county TEXT,
  section TEXT,
  township TEXT,
  range TEXT,
  formation_name TEXT,
  spud_date TEXT,
  completion_date TEXT,
  first_production_date TEXT,
  data_last_updated DATETIME,
  last_rbdms_sync DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced_at DATETIME
);
```

## Sync Process

1. **Authentication**: Requires either:
   - Valid session cookie (authenticated user)
   - Bearer token matching `SYNC_API_KEY` environment variable

2. **Sync Flow**:
   - Fetches all records from Airtable tables
   - For each record, checks if it exists in D1 (by airtable_record_id)
   - Updates existing records or creates new ones
   - Tracks sync progress in `sync_log` table
   - Returns detailed results with counts and any errors

3. **Error Handling**:
   - Individual record errors don't stop the sync
   - Errors are collected and returned in the response
   - First 5 errors of each type are included in the response

## Usage

```bash
# Run database setup
./scripts/setup-db.sh

# Set sync API key (if using token auth)
wrangler secret put SYNC_API_KEY

# Trigger sync
curl -X POST https://portal.mymineralwatch.com/api/admin/sync \
  -H "Authorization: Bearer YOUR_SYNC_KEY"
```

## Notes

- The properties table uses a simplified structure from the Client Properties table
- Wells table maintains comprehensive tracking fields
- Linked fields (like User) use null-safe access: `fields['User']?.[0] || null`
- All date fields are converted to SQL date format
- Number fields are parsed with null handling
- The sync is designed to be idempotent - safe to run multiple times