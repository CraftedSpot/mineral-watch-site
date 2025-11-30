# Mineral Watch Oklahoma - Well Monitoring Worker

Version 2.0 - Excel-based architecture using official OCC data files.

## Overview

This Cloudflare Worker monitors Oklahoma Corporation Commission (OCC) filings for well activity that matches user-owned mineral properties or tracked wells. It processes official OCC Excel files daily and sends email alerts via Postmark.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   OCC Excel     │────▶│  Cloudflare      │────▶│  Airtable   │
│   Files (Daily) │     │  Worker (Cron)   │     │  Database   │
└─────────────────┘     └────────┬─────────┘     └─────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    Postmark     │
                        │  Email Alerts   │
                        └─────────────────┘
```

## Data Sources

| File | Schedule | Purpose |
|------|----------|---------|
| ITD-wells-formations-daily.xlsx | Daily | New drilling permits |
| well-completions-last-7-days.xlsx | Daily | Well completions |
| well-transfers-30-days.xlsx | Weekly | Operator transfers |

## Alert Types

- **YOUR PROPERTY** - Activity directly on user's mineral property
- **ADJACENT SECTION** - Activity in section adjacent to user's property (if enabled)
- **TRACKED WELL** - Activity on a specific API number the user monitors

## Setup

### 1. Create KV Namespace

```bash
wrangler kv:namespace create MINERAL_CACHE
```

Update `wrangler.toml` with the returned namespace ID.

### 2. Set Secrets

```bash
wrangler secret put AIRTABLE_API_KEY
wrangler secret put POSTMARK_API_KEY
wrangler secret put TRIGGER_SECRET
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Deploy

```bash
npm run deploy
```

## Development

### Local Testing

```bash
# Start dev server with scheduled handler support
npm run dev

# Trigger daily run
npm run test-daily

# Trigger weekly run
npm run test-weekly
```

### View Logs

```bash
npm run tail
```

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | None | Health check and run status |
| `/trigger/daily` | POST | Bearer token | Manual daily run |
| `/trigger/weekly` | POST | Bearer token | Manual weekly run |

## Airtable Schema

### Users (`tblmb8sZtfn2EW900`)
- Email (primary identifier)
- Name, Plan, Status
- Linked: Client Properties, Client Wells, Activity Log

### Client Properties (`tblbexFvBkow2ErYm`)
- SEC, TWN, RNG, MERIDIAN, COUNTY
- Monitor Adjacent (checkbox)
- Linked: User

### Client Wells (`tblqWp3rb7rT3p9SA`)
- API Number (10-digit)
- Linked: User

### Activity Log (`tblhBZNR5pDr620NY`)
- API Number, Activity Type, Alert Level
- Deduplication key: API + Activity Type + User + 7-day window

## PLSS Notes

Oklahoma uses the Public Land Survey System (PLSS) with:
- **Indian Meridian (IM)** - Used for most of Oklahoma
- **Cimarron Meridian (CM)** - Used for Panhandle (Cimarron, Texas, Beaver counties)

Sections are numbered in a serpentine pattern:
```
 6  5  4  3  2  1
 7  8  9 10 11 12
18 17 16 15 14 13
19 20 21 22 23 24
30 29 28 27 26 25
31 32 33 34 35 36
```

## Error Handling

- Errors are logged to console (viewable via `wrangler tail`)
- Last error is stored in KV for health check visibility
- Individual record errors don't stop the entire run
- Failed cron runs are marked in Cloudflare dashboard

## Maintenance

### OCC URL Changes

If OCC changes their file URLs, update `src/services/occ.js`:

```javascript
const OCC_FILE_URLS = {
  itd: 'https://oklahoma.gov/...',
  completions: 'https://oklahoma.gov/...',
  transfers: 'https://oklahoma.gov/...'
};
```

### Adding Activity Types

Update the `Activity Type` single select field in Airtable, then update `mapApplicationType()` in `src/monitors/daily.js`.
