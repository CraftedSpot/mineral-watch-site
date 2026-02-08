# Production Decline Analysis — Planning Handoff

## Context

This is a continuation of an Intelligence tab buildout session. Tonight we shipped the Pooling Rate Comparison report — the first full Intelligence report with a three-tab architecture (My Properties / My Markets / Market Research). Production Decline Analysis is the next priority report.

The full session transcript is at: `/mnt/transcripts/2026-02-06-06-10-39-intelligence-pooling-report-planning.txt`

## Intelligence Tab Architecture (Established Pattern)

Every Intelligence report follows this three-tab structure:

### My Properties
- Personal, filtered to the user's minerals
- Sortable/searchable/filterable toolbar
- Property accordion groups with summary stats in collapsed headers
- Sortable column headers (click chevron toggle asc/desc — same pattern as deduction report)
- This is the "triage" view — scan, sort, investigate

### My Markets  
- Contextual, aggregated by county or formation
- Card layout with visual indicators (bonus range bars on pooling report)
- Answers "is MY well's situation normal for the area?"

### Market Research
- Statewide insights, not scoped to user properties
- Insight cards (top 5 rankings, trends)
- Tier-gated: Professional and below see teaser + "Upgrade to Business" gate
- Business/Enterprise see full data

### Supporting Patterns
- HUD metrics bar at top (4 cards: key stats)
- Print Summary per tab (contextual button label)
- Export CSV on My Properties
- Backend caching with TTL (add cache-bust param for testing)
- Reusable CSS/JS from pooling report in intelligence-reports.txt and intelligence-questions.txt

## Production Decline Analysis — Report Design

### Purpose
Portfolio-wide production health dashboard. NOT individual well analysis (Unit Production Report already handles that — users click through from this report to Unit Report for detail). This report answers: "Which of my 287 wells need attention?"

### HUD Metrics (4 cards)
1. Total Wells — with active/idle breakdown
2. Portfolio Production — current month oil + gas totals
3. Wells in Decline — count of wells with >X% YoY decline (red = steep, amber = modest)
4. Recently Idle — wells with no reported production in 3-6 months

### My Properties Tab — Portfolio Triage
Table of ALL user's wells, sortable by decline severity. Columns:
- Well Name (links to existing Unit Production Report)
- Operator
- County
- Formation
- Well Type (vertical/horizontal)
- Current Month Production (oil BBL / gas MCF)
- YoY Change % (color coded: green = growing, amber = modest decline 0-20%, red = steep decline >20%, gray = idle)
- Water Cut % (if water data available — rising water cut signals end-of-life)
- Sparkline or mini trend indicator (last 12 months, if feasible)
- Status (Active / Recently Idle / Shut-in)

Toolbar: search box, sort dropdown (Steepest Decline, Highest Production, By Operator, By County, By Formation), county filter, status filter (All / Active / Declining / Idle)

Property grouping option: toggle between flat well list and grouped by property/unit

### My Markets Tab — Contextual Benchmarks
County/formation cards showing:
- Average YoY decline rate for wells in that county
- Number of active vs idle wells
- Top formation performance (which formations are holding up vs declining)
- Comparison indicator: "Your wells in Roger Mills are declining at 18% vs county average of 12%"

This contextualizes individual well performance. A well declining 25% in a county averaging 12% has a problem. A well declining 12% in a county averaging 14% is fine.

### Market Research Tab — Formation Type Curves (Tier-Gated)
Statewide formation-level decline benchmarks:
- Average decline curves by formation + well type (Woodford horizontal, Cherokee vertical, etc.)
- Built from historical production data (2017-present, potentially back to 2000)
- Insight cards: "Fastest declining formations," "Most resilient formations," "Average well life by formation"
- Future: percentile ranking ("this well is performing in the 72nd percentile for Woodford horizontals at 18 months")

This is the feature James's cousin pays a consultant significant money for. Formation type curves from a large dataset = high value, strong tier gate justification.

## Data Questions — Need to Verify Before Implementation

### Schema Discovery (query these first)
1. What tables hold production data? (likely `production` or `well_production` or similar)
2. What fields exist? Need: well identifier, month/date, oil volume, gas volume, water volume
3. Is data at well level, unit level, or mixed? James said "some at unit level, some at well level"
4. How many wells have 12+ months of continuous history?
5. Is there a `days_produced` field? (Important: a well producing 15 days isn't declining, it was offline)
6. Is water production captured in the data?

### Data Coverage
- Production history goes back to 2017 in current D1 tables
- Historical data back to 2000 is available to download but not yet loaded
- OTC data typically lags 2-3 months (Nov 2025-Jan 2026 may be missing for many wells)
- 287 active wells across 27 counties currently tracked

### Historical Data Decision
- Annual rollups for pre-2017 data are sufficient for type curve calculations
- Monthly granularity only needed for recent years (portfolio triage)
- Loading historical data enables formation type curves — high value feature
- Can be a separate task from the report build

## Existing Code References

### Patterns to Reuse
- Auth pattern: intelligence.ts (authenticateRequest, getUserFromSession, isIntelligenceAllowed)
- Tab switching: pooling report implementation in intelligence-reports.txt
- Sortable headers: deduction report pattern in intelligence-reports.txt
- Property accordion: pooling report property groups
- HUD metrics bar: pooling report HUD
- County filter with search: pooling report toolbar
- Unit Production Report link: already exists in portal, just needs URL construction

### Production Data Already in Use
- Unit Production Report PDF generates from existing data (see uploaded example)
- Shows 24-month history, 18-month chart, YoY and 24-month change percentages
- Chart uses oil (BBL) and gas (MCF) on same axis
- Already computes: recent production, last 12 months, lifetime totals

### Relevant Well Data
- Well-to-property matching is complete (property-well-matching.ts)
- OCC well data includes: well type, formation, operator, status
- Shut-in detection already identifies 259 potentially shut-in wells

## Implementation Approach

### Phase 1: Schema Discovery + Endpoint
1. Query D1 production tables — understand schema, coverage, data quality
2. Build `/api/intelligence/production-decline` endpoint
3. Compute YoY decline rates per well
4. Aggregate by county/formation for My Markets
5. Return structured response matching pooling report pattern

### Phase 2: Frontend
1. Question card in Intelligence tab: "Which wells are declining?" / "How is my portfolio producing?"
2. Three-tab report rendering following pooling report template
3. HUD metrics, sortable table, county cards
4. Link well names to existing Unit Production Report

### Phase 3: Enhancements
- Water cut indicator (if data available)
- Sparkline mini-charts per well row
- Formation type curves (requires historical data load)
- Print Summary per tab

## Business Context

- Harry Diamond Holdings (950 tracts) just signed as first enterprise client ($3,500/year)
- Production decline monitoring is a retention driver — checked monthly, not one-time
- Feeds into future Operator Report Card (decline + deductions + shut-ins = operator evaluation)
- Formation type curves are a premium feature worth tier-gating
- This report makes the platform indispensable vs. a basic alert service

## Tiering Strategy (Applies to All Intelligence Reports)

- Starter/Basic: My Properties with summary stats, limited report runs per month
- Professional: Full My Properties with export + My Markets
- Business/Enterprise: Full access including Market Research
- Tier gate: "Upgrade to Business" for Professional and below on Market Research tab
- Export CSV: mid-tier and above
- Suggested For You insights: available to ALL tiers (these are engagement hooks)
