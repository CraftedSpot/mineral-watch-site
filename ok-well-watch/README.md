# ok-well-watch (Daily Monitoring Worker)

**BACKUP VERSION - Original working code before design changes**

## Overview

Daily Cloudflare Worker that monitors the Oklahoma Corporation Commission (OCC) API for new well activity and sends personalized email alerts to users based on their properties and specific well interests.

## Key Features

- **Daily Cron Trigger**: Runs at 8 AM CST every day
- **Incremental Processing**: Uses checkpoint system to only fetch new wells since last run
- **Dual Monitoring**: Tracks both location-based (properties) and API-based (specific wells) interests
- **Status & Operator Tracking**: Per-user tracking of well status and operator changes
- **Adjacent Section Coverage**: Monitors 8 adjacent sections around each property
- **Detailed Email Alerts**: Rich HTML emails with explanations and action items

## How It Works

1. **Checkpoint Retrieval**: Gets last processed `objectid` from KV storage
2. **New Wells Fetch**: Queries OCC API for wells with `objectid > checkpoint`
3. **User Processing**: For each active user:
   - Fetches their properties and specific wells from Airtable
   - Builds watch lists for sections and API numbers
   - Matches new wells against their interests
   - Tracks status/operator changes per user
   - Sends personalized email alerts
4. **Checkpoint Update**: Stores highest `objectid` for next run

## Dependencies

- **KV Namespace**: `MINERAL_DB` for checkpoint and per-user tracking storage
- **Secrets**: `POSTMARK_API_KEY`, `AIRTABLE_API_KEY`
- **Airtable Tables**: 
  - `👤 Users` (user accounts)
  - `📍 Client Properties` (location-based monitoring)
  - `🛢️ Client Wells` (API-based monitoring)

## Email Types

- **New Wells**: First-time detection of wells on monitored properties
- **Status Changes**: Well status transitions (ND→SP, AC→PA, etc.)
- **Operator Transfers**: Change in well operator with detailed action guidance

## Deployment

```bash
cd ok-well-watch
wrangler deploy
```

Set secrets:
```bash
wrangler secret put POSTMARK_API_KEY
wrangler secret put AIRTABLE_API_KEY
```

Configure KV namespace ID in `wrangler.toml`.

---

*This is the daily worker that handles new well detection and immediate notifications.*