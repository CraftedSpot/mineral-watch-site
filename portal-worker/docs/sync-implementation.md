# Airtable Sync Implementation

## Overview
The sync functionality fetches data from Airtable and syncs it to the D1 database using direct REST API calls.

## Configuration

### Environment Variables
- `MINERAL_AIRTABLE_API_KEY` - Your Airtable personal access token (already configured)

### Airtable Settings
```typescript
const AIRTABLE_BASE_ID = 'app3j3X29Uvp5stza';      // Mineral Watch Oklahoma base
const PROPERTIES_TABLE_ID = 'tblbexFvBkow2ErYm';   // 📍 Client Properties
const WELLS_TABLE_ID = 'tblqWp3rb7rT3p9SA';        // 🛢️ Client Wells
```

## Implementation Details

### API Call Function
```typescript
async function fetchAirtableRecords(
  apiKey: string,
  baseId: string,
  tableId: string,
  offset?: string
): Promise<AirtableResponse>
```
- Fetches records from Airtable using REST API
- Handles pagination with offset parameter
- Returns typed response with records array and optional offset

### Properties Sync
- Fetches from Client Properties table
- Maps fields:
  - COUNTY → county
  - SEC → section
  - TWN → township
  - RNG → range
  - ACRES → acres
  - NET ACRES → net_acres
  - Notes → notes
  - User → owner (with null-safe access)
- Uses UPSERT logic (INSERT ON CONFLICT UPDATE)

### Wells Sync
- Fetches from Client Wells table
- **Preserves OCC data** by matching on API number
- Update existing wells with:
  - airtable_record_id → Links to Airtable record
  - status → User tracking status
  - synced_at → Last sync timestamp
- Only creates new wells if API number not found in OCC data
- For new wells, inserts minimal data:
  - API Number (required)
  - Well Name
  - Operator
  - Location (County, Section, Township, Range)
  - Status tracking fields

## Features

### Batch Processing
D1 batch operations are chunked to stay within limits:
```typescript
const BATCH_SIZE = 500;
for (let i = 0; i < statements.length; i += BATCH_SIZE) {
  const chunk = statements.slice(i, i + BATCH_SIZE);
  await env.WELLS_DB.batch(chunk);
}
```
This handles up to ~25,000 records per table (50 batches × 500).

### Pagination
Both sync functions handle Airtable's pagination:
```typescript
do {
  const response = await fetchAirtableRecords(...);
  // Process records
  offset = response.offset;
} while (offset);
```

### Error Handling
- Individual record errors don't stop the sync
- Errors are collected and returned in the response
- Properties sync errors don't prevent wells sync
- First 5 errors of each type are included in response

### Progress Tracking
- Logs number of records fetched per page
- Tracks created vs updated records separately
- Updates sync_log table with results

## Testing the Sync

1. Ensure MINERAL_AIRTABLE_API_KEY is set:
   ```bash
   # Should already be set from previous configuration
   ```

2. Trigger sync via authenticated request:
   ```bash
   curl -X POST https://portal.mymineralwatch.com/api/admin/sync \
     -H "Cookie: mw_session=YOUR_SESSION_COOKIE" \
     -H "Content-Type: application/json"
   ```

3. Expected response format:
   ```json
   {
     "success": true,
     "message": "Sync completed successfully",
     "result": {
       "properties": {
         "total": 10,
         "created": 5,
         "updated": 5,
         "errors": 0
       },
       "wells": {
         "total": 20,
         "created": 10,
         "updated": 10,
         "errors": 0
       },
       "duration_ms": 1500,
       "errors": []
     }
   }
   ```

## Notes

- The sync is designed to be idempotent - safe to run multiple times
- Uses existing MINERAL_AIRTABLE_API_KEY (no new secret needed)
- Respects Airtable rate limits with proper error handling
- All dates are converted to SQL format
- Linked fields use null-safe access pattern: `fields['User']?.[0] || null`