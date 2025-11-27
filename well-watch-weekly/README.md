# well-watch-weekly (Weekly Status Monitoring Worker)

**BACKUP VERSION - Original working code before design changes**

## Overview

Weekly Cloudflare Worker that rescans all wells on user properties to detect status and operator changes that may have been missed or occurred between daily scans.

## Key Features

- **Weekly Cron Trigger**: Runs every Sunday at 9 AM CST
- **Comprehensive Rescan**: Queries all sections and API numbers per user
- **Change Detection**: Focuses only on status and operator changes (not new wells)
- **Batched Processing**: Efficient API calls with proper rate limiting
- **Detailed Change Tracking**: Per-user history of well status and operators

## How It Works

1. **User Iteration**: For each active user:
   - Fetches their properties and specific wells
   - Builds comprehensive section list (including adjacents)
   - Queries OCC API in batches for all relevant wells
2. **Change Detection**: Compares current vs stored status/operator per user
3. **Alert Generation**: Sends weekly digest emails for detected changes
4. **Status Updates**: Updates KV storage with current status/operator values

## Differences from Daily Worker

- **No Checkpoint**: Rescans all user interests, not just new wells
- **Change Focus**: Only alerts on status/operator changes, not new wells
- **Batched Queries**: Groups sections and APIs for efficient processing
- **Weekly Digest**: Different email template emphasizing "weekly review"

## Dependencies

- **KV Namespace**: `MINERAL_DB` for per-user well tracking
- **Secrets**: `POSTMARK_API_KEY`, `AIRTABLE_API_KEY`
- **Airtable Tables**: 
  - `👤 Users` (user accounts)
  - `📍 Client Properties` (location-based monitoring)  
  - `🛢️ Client Wells` (API-based monitoring)

## Email Format

Weekly digest emails with:
- Summary of operator transfers and status changes
- Detailed explanations per change type
- Different styling (amber background) to distinguish from daily alerts
- Schedule explanation (daily vs weekly purpose)

## Deployment

```bash
cd well-watch-weekly
wrangler deploy
```

Set secrets:
```bash
wrangler secret put POSTMARK_API_KEY
wrangler secret put AIRTABLE_API_KEY
```

Configure KV namespace ID in `wrangler.toml`.

---

*This is the weekly worker that catches status/operator changes on existing wells.*