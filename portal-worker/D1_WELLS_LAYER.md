# D1 Wells Layer Feature

## Overview

The Oklahoma map now includes a toggleable layer that displays wells from the D1 database. This layer dynamically loads wells based on the current map view, providing users with comprehensive well data from the RBDMS system.

## Features

### 1. **Toggle Control**
- Located in the "Overlays" dropdown menu
- Labeled as "Nearby Wells (D1)"
- Can be toggled on/off independently from other layers

### 2. **Dynamic Loading**
- Wells are loaded based on the current map viewport
- Only loads when zoomed in to level 10 or higher
- Automatically updates when panning or zooming
- Debounced updates (500ms delay) to prevent excessive API calls

### 3. **Visual Design**
- Purple circle markers (#8B5CF6) with darker purple borders
- 8px radius circles
- 60% fill opacity for visibility without obscuring other features
- Consistent with the app's design language

### 4. **Well Information Popups**
Each well marker displays:
- Well name
- API number
- Operator
- Location (Section-Township-Range-Meridian)
- County
- Well status
- Spud date (if available)
- Completion date (if available)

### 5. **Performance Optimizations**
- Limits to 500 wells per view to prevent UI overload
- Only queries sections visible in the current map bounds
- Uses the `/api/nearby-wells` endpoint with TRS-based queries
- Leverages D1's TRSM index for fast lookups

## Technical Implementation

### Frontend Changes

1. **HTML** (`oklahoma_map.html`):
   - Added toggle checkbox in overlays menu
   - Added legend entry for D1 wells

2. **JavaScript**:
   - `nearbyWellsLayer`: New Leaflet feature group for D1 wells
   - `toggleNearbyWells()`: Handles toggle on/off
   - `loadNearbyWells()`: Fetches wells from API based on viewport
   - `getVisibleTRSSections()`: Determines which TRS sections are in view
   - Auto-update on map movement when layer is enabled

### API Integration

The feature uses the `/api/nearby-wells` endpoint:
```javascript
GET /api/nearby-wells?trs=15-9N-5W-IM&trs=16-9N-5W-IM&limit=500
```

### Layer Ordering

The wells layer hierarchy (bottom to top):
1. Activity heatmap (bottom)
2. Nearby wells (D1)
3. Tracked wells (user's wells)
4. Properties (top - most clickable)

## User Experience

1. **Initial State**: Layer is off by default
2. **Enabling**: Click "Overlays" → Check "Nearby Wells (D1)"
3. **Zoom Requirement**: Must zoom to level 10+ to see wells
4. **Status Updates**: Map status shows loading progress
5. **Interaction**: Click any well marker for detailed information

## Future Enhancements

1. **Filtering**: Add ability to filter by:
   - Well status (Active, P&A, etc.)
   - Operator
   - Date ranges
   - Well type

2. **Clustering**: Implement marker clustering for dense areas

3. **Performance**: 
   - Add caching for recently viewed areas
   - Progressive loading for large datasets

4. **Search**: Integrate with map search to find wells by API number

## Dependencies

- D1 database with wells data imported
- `/api/nearby-wells` endpoint configured
- Leaflet.js for map rendering
- Proper authentication (wells data requires user login)