# Mineral Watch Worker Enhancement Spec

## For: Claude Code Implementation
## Priority: Pre-Launch Fixes + High-Value Additions

---

## Overview

This spec covers enhancements to the Mineral Watch monitoring worker. Changes are organized by priority tier.

**Context:** The worker processes daily OCC Excel files (ITD permits, completions) and sends email alerts to users who own properties matching the well locations.

**Philosophy:** Keep emails tight with key highlights. Users click "Track This Well" to add it to their portal. Full details (production, formation, timeline) live in the portal, not the email.

---

## Airtable Schema Reference

**Base ID:** `app3j3X29Uvp5stza`

**🛢️ Client Wells** (`tblqWp3rb7rT3p9SA`):
Current fields: API Number, User, Well Name, Status, OCC Map Link, Notes, Operator, County, Section, Township, Range, Well Type, Well Status, Operator Phone, Contact Name

**📋 Activity Log** (`tblhBZNR5pDr620NY`):
Current fields: Well Name, Detected At, API Number, Activity Type, Previous Value, New Value, Operator, Previous Operator, Alert Level, Section-Township-Range, County, OCC Link, Map Link, Email Sent, User, Email

---

## 🔴 TIER 1: Critical Fix (Do Now)

### 1.1 Add Bottom Hole Matching for Completions

**Problem:** `processCompletion()` in `daily.js` only matches on surface location. For horizontal wells, the bottom hole (where production actually happens) can be in a completely different section. Users who own minerals at the bottom hole location are not getting notified.

**File:** `src/monitors/daily.js`

**Location:** Inside `processCompletion()` function, after the surface location matching (around line 319)

**What to add:**

```javascript
// After the surface location propertyMatches loop, add:

// For horizontal wells, also check bottom hole location
// This is where the lateral ends and production actually happens
const isHorizontal = completion.Drill_Type === 'HORIZONTAL HOLE' || 
                     completion['Location Type'] === 'HH' ||
                     completion.Location_Type_Sub === 'HH';

if (isHorizontal && completion.BH_Section && completion.BH_Township && completion.BH_Range) {
  console.log(`[Daily] Completion ${api10} is horizontal - checking bottom hole location: S${completion.BH_Section} T${completion.BH_Township} R${completion.BH_Range}`);
  
  const bhMatches = await findMatchingProperties({
    section: completion.BH_Section,
    township: completion.BH_Township,
    range: completion.BH_Range,
    meridian: completion.BH_PM || completion.PM,
    county: completion.BH_County || completion.County
  }, env);
  
  for (const match of bhMatches) {
    // Avoid duplicate alerts to same user
    if (!alertsToSend.some(a => a.user.email === match.user.email)) {
      alertsToSend.push({
        user: match.user,
        alertLevel: match.alertLevel,
        matchedLocation: match.matchedSection,
        reason: 'bottom_hole_location'
      });
    }
  }
  
  console.log(`[Daily] Found ${bhMatches.length} additional matches from bottom hole location`);
}
```

**Test scenario:**
- Find a horizontal completion in the OCC file where surface and BH are different sections
- Add a test property in the BH section
- Verify the user gets alerted

---

## 🟡 TIER 2: High-Value Email Enhancements (Do Soon)

### 2.1 Add Production Highlights to Completion Emails

**Value:** Show users if this is a good well - but keep it tight (2-3 key metrics only).

**Files to modify:**
1. `src/monitors/daily.js` - Extract data from completion record
2. `src/services/email.js` - Display condensed production line

**Step 1: Extract in processCompletion() in daily.js**

When building the email data, add production fields. Find where `sendAlertEmail()` is called for completions (around line 437) and add:

```javascript
await sendAlertEmail(env, {
  // ... existing fields
  
  // Production highlights (keep it simple - just the key metrics)
  productionHighlight: buildProductionHighlight(completion),
  
  // Formation info (one line)
  formationInfo: completion.Formation_Name 
    ? `${completion.Formation_Name}${completion.Formation_Depth ? ` @ ${Number(completion.Formation_Depth).toLocaleString()} ft` : ''}`
    : null,
  
  // Is this horizontal?
  isHorizontal: completion.Drill_Type === 'HORIZONTAL HOLE' || completion.Location_Type_Sub === 'HH',
  bhLocation: (completion.Drill_Type === 'HORIZONTAL HOLE' && completion.BH_Section) 
    ? `S${completion.BH_Section} T${completion.BH_Township} R${completion.BH_Range}` 
    : null
});

// Helper function - add near top of file
function buildProductionHighlight(completion) {
  const parts = [];
  
  // Prioritize gas or oil depending on well type
  if (completion.Gas_MCF_Per_Day && completion.Gas_MCF_Per_Day > 0) {
    parts.push(`Gas: ${Number(completion.Gas_MCF_Per_Day).toLocaleString()} MCF/day`);
  }
  if (completion.Oil_BBL_Per_Day && completion.Oil_BBL_Per_Day > 0) {
    parts.push(`Oil: ${Number(completion.Oil_BBL_Per_Day).toLocaleString()} BBL/day`);
  }
  
  // Only show if we have production data
  if (parts.length === 0) return null;
  
  // Add flowing/pumping if available
  if (completion.Pumping_Flowing) {
    parts.push(`(${completion.Pumping_Flowing.toLowerCase()})`);
  }
  
  return parts.join(' · ');
}
```

**Step 2: Update email.js - Add single production line**

In `buildHtmlBody()`, add after the well details table (around line 333):

```javascript
${data.productionHighlight ? `
<!-- Production Highlight - Single Line -->
<div style="background: #F0FDF4; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; border-left: 3px solid #22C55E;">
  <p style="margin: 0; font-size: 13px; color: #166534;">
    <strong>Initial Test:</strong> ${data.productionHighlight}
  </p>
</div>
` : ''}

${data.formationInfo ? `
<p style="font-size: 13px; color: #64748B; margin: 0 0 12px;">
  <strong style="color: #374151;">Formation:</strong> ${data.formationInfo}
</p>
` : ''}
```

**Step 3: Update plain text email**

In `buildTextBody()`, add after location:

```javascript
${data.productionHighlight ? `Initial Test: ${data.productionHighlight}\n` : ''}${data.formationInfo ? `Formation: ${data.formationInfo}\n` : ''}
```

**Result:** Completion emails show one clean line like:
> **Initial Test:** Gas: 785 MCF/day · Oil: 30 BBL/day · (flowing)

---

### 2.2 Add Formation Info to Permit Emails

**File:** `src/monitors/daily.js`

In processPermit, around line 264-278, add to the sendAlertEmail call:

```javascript
formationInfo: permit.Formation_Name 
  ? `${permit.Formation_Name}${permit.Formation_Depth ? ` @ ${Number(permit.Formation_Depth).toLocaleString()} ft` : ''}`
  : (permit.Total_Depth ? `Target depth: ${Number(permit.Total_Depth).toLocaleString()} ft` : null)
```

**File:** `src/services/email.js`

Already handled in 2.1 - the same `formationInfo` display code works for both permits and completions.

---

### 2.3 Show Horizontal Well Path in Location Line

For horizontal wells that cross sections, show both surface and bottom hole locations.

**In email.js** `buildHtmlBody()`, find where location is displayed (around line 286) and update:

```javascript
// Build location string - show path for horizontal wells
const locationDisplay = data.isHorizontal && data.bhLocation 
  ? `${data.location} → ${data.bhLocation} (horizontal)` 
  : data.location;
```

Use `locationDisplay` instead of `location` in the header area.

**Result:** Instead of just "S19 T19N R11W", horizontal wells show:
> S19 T19N R11W → S31 T19N R11W (horizontal)

---

## 🟢 TIER 3: Portal Full Details (Future)

### 3.1 Populate Extended Well Data When User Tracks a Well

When a user clicks "Track This Well" from an email or activity log, the portal worker should populate the new fields in Client Wells.

**Prerequisite:** Add new fields to 🛢️ Client Wells table in Airtable (see "Airtable Schema Additions" section below).

**In the portal worker** (wherever "Track This Well" is handled):

When creating the Client Wells record, include the extended data:

```javascript
// If we have the original completion data available:
const wellRecord = {
  'API Number': apiNumber,
  'User': [userId],
  'Well Name': wellName,
  'Status': 'Active',
  'Operator': operator,
  'County': county,
  'Section': section,
  'Township': township,
  'Range': range,
  'Well Type': wellType,
  'Well Status': wellStatus,
  'OCC Map Link': mapLink,
  'OCC Filing Link': occFilingUrl,
  
  // Extended data (new fields)
  'Formation Name': formationName || null,
  'Formation Depth': formationDepth || null,
  'Total Depth': totalDepth || null,
  'IP Oil (BBL/day)': oilBBLPerDay || null,
  'IP Gas (MCF/day)': gasMCFPerDay || null,
  'IP Water (BBL/day)': waterBBLPerDay || null,
  'Spud Date': spudDate || null,
  'Completion Date': completionDate || null,
  'First Production Date': firstProdDate || null,
  'Lateral Length': lateralLength || null,
  'Data Last Updated': new Date().toISOString()
};
```

**Note:** The extended data may need to be passed through the "Track This Well" link (as encrypted params or by storing temporarily in Activity Log and looking it up).

### 3.2 Portal Modal Enhancement

Once the Client Wells table has the extended fields, update the portal Details modal to show them:

**Current modal sections:**
- Well name, API
- Operator, Phone, Contact
- Location, County
- Well Type, OCC Status
- Notes
- Buttons: View on Map, OCC Filing

**Add new "Production" section** (only show if data exists):

```
📊 Initial Production
   Gas: 785 MCF/day
   Oil: 30 BBL/day
   Water: 1,924 BBL/day

🎯 Formation: Mississippian @ 8,560 ft

📅 Timeline
   Spud: Dec 12, 2023
   Completed: Feb 15, 2024
   First Production: Mar 9, 2024
```

This could be:
- Collapsed by default with "Show Full Details" toggle
- Or always visible if data exists

---

## 🔵 TIER 4: Nice-to-Have Refinements

### 4.1 Smarter "What This Means" for Completions with Production Data

Update `getExplanation()` in email.js to include production context:

```javascript
'Well Completed': {
  meaning: data.productionData?.gasMCFPerDay > 500 
    ? `Drilling is complete and the well is producing. Initial tests show strong gas production at ${data.productionData.gasMCFPerDay} MCF/day.`
    : 'Drilling is complete and the well is now producing oil or gas.',
  tip: '🎉 Royalty checks should follow. First payment typically arrives 3-6 months after completion.',
  tipType: 'success'
}
```

### 4.2 Add "View Full Details" Link to Portal

In the email action buttons, add a link to the portal well details page:

```javascript
${data.apiNumber ? `
<td align="center" style="padding: 2px;">
  <a href="https://mymineralwatch.com/wells/${data.apiNumber}" style="...">View Full Details →</a>
</td>
` : ''}
```

---

## Testing Checklist

### For Tier 1 (BH Matching):
- [ ] Find a horizontal completion in today's OCC file
- [ ] Note the BH_Section, BH_Township, BH_Range
- [ ] Add a test property at that BH location
- [ ] Run daily monitor
- [ ] Verify user gets alert with reason: 'bottom_hole_location'

### For Tier 2 (Production Data):
- [ ] Trigger daily monitor with a completion that has production data
- [ ] Verify email includes production test section
- [ ] Verify formatting (numbers with commas, units correct)
- [ ] Test with completion that has NO production data (should not show section)
- [ ] Check plain text version too

### For Tier 2 (Formation Info):
- [ ] Verify formation name appears in permit emails (when available)
- [ ] Verify formation appears in completion emails
- [ ] Test with records that have no formation data (should not show)

---

## Field Mapping Reference

### Completions Excel → Code Variables

| Excel Column | Use For |
|--------------|---------|
| `BH_Section` | Bottom hole matching |
| `BH_Township` | Bottom hole matching |
| `BH_Range` | Bottom hole matching |
| `BH_PM` | Bottom hole matching |
| `Drill_Type` | Detect horizontal ("HORIZONTAL HOLE") |
| `Location_Type_Sub` | Detect horizontal ("HH") |
| `Oil_BBL_Per_Day` | Production display |
| `Gas_MCF_Per_Day` | Production display |
| `Water_BBL_Per_Day` | Production display |
| `Gas_Oil_Ratio` | Production display |
| `Pumping_Flowing` | Production display |
| `Test_Date` | Production display |
| `Oil_Gravity` | Production display (optional) |
| `Formation_Name` | Formation display |
| `Formation_Depth` | Formation display |
| `Total_Depth` | Depth display |
| `Length` | Lateral length (horizontal wells) |
| `Spud` | Timeline (portal) |
| `Well_Completion` | Timeline (portal) |
| `First_Prod` | Timeline (portal) |
| `OTC_Prod_Unit_No` | Future production tracking |

### ITD (Permits) Excel → Code Variables

| Excel Column | Use For |
|--------------|---------|
| `Formation_Name` | Formation display |
| `Total_Depth` | Depth display |
| `Drill_Type` | Detect horizontal ("HH", "DH") |
| `PBH_Section` | Already used for BH matching ✅ |
| `PBH_Township` | Already used for BH matching ✅ |
| `PBH_Range` | Already used for BH matching ✅ |

---

## Answers / Decisions (from James)

1. **Airtable schema:** Will add fields to Client Wells for full details in portal. Activity Log stays as notification history.

2. **Email length:** Keep it tight - 2-3 key production metrics max. Full details go in portal.

3. **Portal URL:** TBD - check with Claude Code. May expand current modal first, add dedicated page later.

4. **Dry run testing:** Yes, test changes in dry-run mode before going live.

---

## Airtable Schema Additions (For Future Portal Full Details)

When ready to show full well details in the portal, add these fields to **🛢️ Client Wells** table:

| Field Name | Field Type | Description |
|------------|------------|-------------|
| `Formation Name` | Single line text | Target formation (e.g., "Mississippian") |
| `Formation Depth` | Number (integer) | Formation depth in feet |
| `Total Depth` | Number (integer) | Total measured depth |
| `Spud Date` | Date | When drilling started |
| `Completion Date` | Date | When well was completed |
| `First Production Date` | Date | First production date |
| `IP Oil (BBL/day)` | Number (decimal) | Initial production - oil barrels/day |
| `IP Gas (MCF/day)` | Number (decimal) | Initial production - gas MCF/day |
| `IP Water (BBL/day)` | Number (decimal) | Initial production - water barrels/day |
| `Lateral Length` | Number (integer) | Horizontal lateral length in feet |
| `OCC Filing Link` | URL | Link to OCC permit/filing document |
| `Data Last Updated` | Date | When OCC data was last refreshed |

**Note:** These fields would be populated when:
1. User clicks "Track This Well" from an email/activity alert
2. Periodically refreshed by a background job (future)

For now, just add the fields to Airtable manually. The worker can start populating them when creating tracked wells from "Track This Well" links.
