# Smart Well Matching Logic Reference

This document contains the smart well matching logic used in the bulk well import feature. It employs a cascading search strategy with multiple fallback approaches and scoring mechanisms.

## Overview

The well matching system uses a cascading search approach that tries multiple strategies in order of specificity:
1. Most specific matches first (name + location)
2. Falls back to broader searches if no results
3. Applies match scoring to rank results

## Key Components

### 1. Well Name Normalization

```typescript
// Clean well name: remove quotes that prevent matching
// CSV has: FEIKES "A" UNIT, ADAMS "Q", RICHARDSON "B" 
// D1 has: FEIKES A UNIT, ADAMS Q, RICHARDSON B
const cleanedWellName = fullWellName.replace(/["""'']/g, '').trim();

// For fuzzy matching, extract the base well name (before well number)
// Examples: "MCCARTHY 1506 3H-30X" -> "MCCARTHY 1506"
const wellNameParts = cleanedWellName.match(/^(.*?)\s+(\d+[A-Z]?-\d+[A-Z]?X?|\#\d+[A-Z]?-\d+[A-Z]?X?)$/i);
const baseWellName = wellNameParts ? wellNameParts[1].trim() : cleanedWellName;
```

### 2. Location Normalization

```typescript
// Normalize township/range with proper padding
let normalizedTownship = township.toUpperCase();
let normalizedRange = range.toUpperCase();

// Add missing suffixes
if (normalizedTownship && normalizedTownship.match(/^\d+$/)) {
  normalizedTownship = `${normalizedTownship}N`;
}
if (normalizedRange && normalizedRange.match(/^\d+$/)) {
  normalizedRange = `${normalizedRange}W`;
}

// Pad single digits
if (normalizedTownship) {
  normalizedTownship = normalizedTownship.replace(/^(\d)([NS])$/i, '0$1$2');
}
if (normalizedRange) {
  normalizedRange = normalizedRange.replace(/^(\d)([EW])$/i, '0$1$2');
}

// Determine meridian based on county
const panhandleCounties = ['CIMARRON', 'TEXAS', 'BEAVER'];
const meridian = county && panhandleCounties.includes(county.toUpperCase()) ? 'CM' : 'IM';
```

### 3. Cascading Search Strategies

#### Strategy 1: Name + Section + T-R (Most Specific)
```sql
SELECT w.*, 
  CASE 
    WHEN UPPER(operator) LIKE UPPER(?1) THEN 100
    ELSE 90
  END as match_score
FROM wells w
WHERE UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
  AND section = ?3 AND township = ?4 AND range = ?5 AND meridian = ?6
ORDER BY match_score DESC, well_status = 'AC' DESC
LIMIT 15
```

#### Strategy 1.5: Exact Name Match Statewide
Handles variations like:
- "MCCARTHY #1506" vs "MCCARTHY 1506"
- With and without # symbols

#### Strategy 2: Name + T-R (No Section)
Useful for horizontal wells that span multiple sections
```sql
SELECT w.*, 
  CASE 
    WHEN UPPER(operator) LIKE UPPER(?1) AND section = ?2 THEN 90
    WHEN UPPER(operator) LIKE UPPER(?1) THEN 85
    WHEN section = ?2 THEN 80
    ELSE 70
  END as match_score
FROM wells w
WHERE (
  UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?3)
  OR UPPER(well_name) LIKE UPPER(?4)
)
  AND township = ?5 AND range = ?6 AND meridian = ?7
```

#### Strategy 2b: Location + Section Only
When well name is not available

#### Strategy 3: Name Only (Broadest Search)
```sql
SELECT w.*, 
  CASE 
    WHEN UPPER(operator) LIKE UPPER(?1) THEN 60
    ELSE 50
  END as match_score
FROM wells w
WHERE (
  UPPER(well_name || ' ' || COALESCE(well_number, '')) LIKE UPPER(?2)
  OR UPPER(well_name) LIKE UPPER(?3)
)
ORDER BY match_score DESC, well_status = 'AC' DESC
```

## Match Scoring

Scores range from 100 (best match) to 50 (weak match):
- **100**: Name + Location + Operator match
- **90**: Name + Location match
- **85**: Name + T-R + Operator match
- **80**: Name + T-R + Section match
- **70**: Name + T-R match only
- **60**: Name + Operator match only
- **50**: Name match only

## Key Features

1. **Quote Removal**: Handles quotes in well names (e.g., FEIKES "A" UNIT → FEIKES A UNIT)
2. **Base Name Extraction**: Matches variations like "MCCARTHY 1506 3H-30X" vs "MCCARTHY 1506 #1H-30X"
3. **Missing Suffix Handling**: Adds default suffixes (N for township, W for range)
4. **Padding**: Ensures consistent format (9N → 09N)
5. **Meridian Detection**: Auto-determines based on county
6. **Active Well Priority**: Sorts active wells first when scores are equal
7. **Multiple Name Variations**: Searches with/without well numbers, with/without # symbols

## Usage in Document Linking

This logic could be adapted for document-to-well linking by:
1. Using the same normalization functions
2. Implementing cascading search when API number is missing
3. Applying match scoring to rank potential matches
4. Presenting top matches to user for confirmation when multiple candidates exist

## Example Transformations

Input → Normalized:
- Township: "9" → "09N"
- Township: "9N" → "09N"
- Range: "5" → "05W"
- Well Name: ADAMS "Q" → ADAMS Q
- Well Name: MCCARTHY #1506 → searches for both "MCCARTHY 1506" and "MCCARTHY #1506"