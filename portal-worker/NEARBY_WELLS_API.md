# Nearby Wells API Documentation

The Nearby Wells API allows you to query wells from the D1 database based on Township-Range-Section-Meridian (TRSM) values.

## Prerequisites

- D1 Database (`oklahoma-wells`) must be configured in `wrangler.toml`
- Wells data must be imported using the import scripts
- User must be authenticated

## Endpoints

### 1. Query Wells by TRS Values

```
GET /api/nearby-wells
```

Query wells matching one or more specific TRS locations.

#### Query Parameters

- `trs` (required, repeatable): TRS values in format "section-township-range-meridian"
  - Section: 1-36
  - Township: e.g., "9N", "10S"
  - Range: e.g., "5W", "4E"
  - Meridian: "IM" (Indian Meridian) or "CM" (Cimarron Meridian)
- `limit` (optional): Maximum results per page (default: 100, max: 1000)
- `offset` (optional): Pagination offset (default: 0)

#### Examples

Single TRS query:
```
GET /api/nearby-wells?trs=15-9N-5W-IM
```

Multiple TRS query:
```
GET /api/nearby-wells?trs=15-9N-5W-IM&trs=16-9N-5W-IM&trs=21-9N-5W-IM
```

With pagination:
```
GET /api/nearby-wells?trs=15-9N-5W-IM&limit=50&offset=100
```

#### Response

```json
{
  "success": true,
  "data": {
    "wells": [
      {
        "api_number": "3501122334",
        "well_name": "SMITH 1-15",
        "well_number": "1-15",
        "section": 15,
        "township": "9N",
        "range": "5W",
        "meridian": "IM",
        "county": "Cleveland",
        "latitude": 35.123,
        "longitude": -97.456,
        "operator": "XTO Energy",
        "well_type": "Oil",
        "well_status": "Active",
        "spud_date": "2023-01-15",
        "completion_date": "2023-03-20"
      }
    ],
    "pagination": {
      "offset": 0,
      "limit": 100,
      "total": 245,
      "hasMore": true
    },
    "query": {
      "trs": ["15-9N-5W-IM"],
      "executionTime": 23
    }
  }
}
```

### 2. Query Surrounding Wells

```
GET /api/wells/surrounding
```

Query wells in sections surrounding a center point.

#### Query Parameters

- `section` (required): Center section (1-36)
- `township` (required): Township (e.g., "9N")
- `range` (required): Range (e.g., "5W")
- `meridian` (required): "IM" or "CM"
- `radius` (optional): Search radius in sections (0-3, default: 1)
- `limit` (optional): Maximum results (default: 100, max: 1000)

#### Examples

Wells in same section only:
```
GET /api/wells/surrounding?section=15&township=9N&range=5W&meridian=IM&radius=0
```

Wells in surrounding sections (1 section radius):
```
GET /api/wells/surrounding?section=15&township=9N&range=5W&meridian=IM&radius=1
```

#### Response

```json
{
  "success": true,
  "data": {
    "wells": [...],
    "query": {
      "center": {
        "section": 15,
        "township": "9N",
        "range": "5W",
        "meridian": "IM"
      },
      "radius": 1,
      "sectionsSearched": [9, 10, 14, 15, 16, 21, 22]
    }
  }
}
```

## Error Responses

### Missing Parameters
```json
{
  "error": "Missing required parameter",
  "message": "Please provide at least one TRS value using ?trs=section-township-range-meridian"
}
```

### Invalid Format
```json
{
  "error": "Invalid TRS format",
  "message": "Invalid TRS value: \"15-9N-5W\". Expected format: \"section-township-range-meridian\" (e.g., \"15-9N-5W-IM\")"
}
```

### Invalid Values
```json
{
  "error": "Invalid section",
  "message": "Invalid section \"40\". Must be a number between 1 and 36"
}
```

### Database Not Available
```json
{
  "error": "Wells database not configured",
  "message": "The nearby wells feature is not available at this time"
}
```

## Usage in Frontend

### JavaScript Example

```javascript
// Query wells in specific TRS locations
async function findNearbyWells(trsValues) {
  const params = new URLSearchParams();
  trsValues.forEach(trs => params.append('trs', trs));
  
  const response = await fetch(`/api/nearby-wells?${params}`, {
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }
  
  return response.json();
}

// Example usage
const trsValues = ['15-9N-5W-IM', '16-9N-5W-IM'];
const result = await findNearbyWells(trsValues);
console.log(`Found ${result.data.wells.length} wells`);
```

### Pagination Example

```javascript
async function getAllWells(trsValues) {
  const allWells = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const params = new URLSearchParams();
    trsValues.forEach(trs => params.append('trs', trs));
    params.set('limit', limit);
    params.set('offset', offset);
    
    const response = await fetch(`/api/nearby-wells?${params}`);
    const data = await response.json();
    
    allWells.push(...data.data.wells);
    
    if (!data.data.pagination.hasMore) {
      break;
    }
    
    offset += limit;
  }
  
  return allWells;
}
```

## Performance Considerations

1. The TRSM index (`idx_wells_trsm`) ensures fast queries even with large datasets
2. Limit queries to reasonable numbers of TRS values (< 100) for best performance
3. Use pagination for large result sets
4. The surrounding wells endpoint is limited to same township/range for simplicity

## Integration with Map

These endpoints are designed to work with the Oklahoma map feature:

1. User clicks on sections in the map
2. Frontend collects TRS values for selected sections
3. Query `/api/nearby-wells` with collected TRS values
4. Display wells on map with markers
5. Show well details in popup/modal when clicked

## Future Enhancements

1. Add filtering by well status, operator, or well type
2. Support for geographic (lat/lon) queries
3. Export results as CSV/JSON
4. Real-time updates when new wells are added
5. Cross-township/range searches for surrounding wells