# Pooling Order Harvester

Automated Cloudflare Worker that discovers OCC pooling orders and queues them for Claude extraction, building a comprehensive `lease_comps` market intelligence database.

## Architecture

```
mineral-monitor-worker          pooling-harvester           occ-fetcher
(daily cron, existing)          (daily cron, THIS WORKER)   (existing)
         |                              |                         |
  Scrapes OCC docket PDFs       Queries occ_docket_entries   /fetch-order:
  -> occ_docket_entries         for POOLING + HEARD/REC'd    - Search Laserfiche
                                -> calls occ-fetcher         - Download PDF
                                -> tracks in D1              - Upload to R2
                                                             - Register doc
                                                                    |
                                                             documents-worker
                                                             (existing)
                                                                    |
                                                             Python processor
                                                             (existing, has pooling
                                                              prompt + lease_exhibits)
                                                                    |
                                                             Populates:
                                                             - pooling_orders
                                                             - pooling_election_options
                                                             - lease_comps
```

Zero changes to existing workers. Slots into the pipeline using existing endpoints.

## Schedule

- **Cron**: `0 20 * * 1-5` (2 PM CT / 20:00 UTC, weekdays)
- Runs 2 hours after the docket monitor (12 PM CT) to pick up freshly scraped entries

## Rate Limiting

| Control | Value | Rationale |
|---------|-------|-----------|
| Base delay | 5,000ms | Between each /fetch-order call |
| Jitter | 0-3,000ms | Prevent predictable patterns |
| Batch size | 25/run | ~25 x 35s = ~15 min within worker timeout |
| Daily cap | 75 | ~44 min total OCC interaction/day |
| Timeout safety | 540s | Stop 1 min before CF 10-min timeout |
| Error breaker | 5 consecutive | Stop run if OCC is down |
| Budget split | 70/30 | New cases get 70%, retries get 30% |

## Harvest Lifecycle

```
pending -> fetching -> fetched -> processed
                   \-> no_order (retry with backoff)
                   \-> error (non-retryable)
                   \-> skipped (duplicate/dismissed)
```

## Retry Backoff (no_order cases)

| Attempt | Wait | Cumulative |
|---------|------|-----------|
| 1 | 3 days | 3 days |
| 2 | 9 days | 12 days |
| 3 | 27 days | 39 days |
| 4 | 81 days | 120 days |
| 5 | give up | -- |

Orders typically appear on Laserfiche 1-4 weeks after hearing. Attempt 2 catches the bulk.

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/trigger` | POST | Run a full harvest cycle (same as cron) |
| `/trigger-backfill` | POST | `{ "limit": 100, "min_hearing_date": "2024-01-01" }` |
| `/test` | POST | `{ "case_number": "CD 2024-001234" }` -- test single case |
| `/stats` | GET | Harvest stats, backlog, coverage |

## D1 Tables

Located in `documents-worker/migrations/012_pooling_harvest_tracking.sql`:

- **pooling_harvest_tracking** -- Per-case tracking (status, attempts, document_id)
- **pooling_harvest_daily_stats** -- Daily run metrics

## Cost Estimates

- ~$0.03-0.05 per order (native PDF document block, single API call)
- ~$15-25/month during backfill (~627 historical cases)
- ~$2-4/month steady state (new orders only)

The Python processor uses native PDF document blocks (`type: 'document'`) for known doc types, avoiding per-page image costs.

## Environment

```toml
[vars]
REQUEST_DELAY_MS = "5000"
REQUEST_DELAY_JITTER_MS = "3000"
BATCH_SIZE = "25"
DAILY_CAP = "75"
TIMEOUT_SAFETY_MS = "540000"
MAX_RETRY_ATTEMPTS = "5"
RETRY_BACKOFF_DAYS = "3"
OCC_FETCHER_URL = "https://occ-fetcher.photog12.workers.dev"
```

## Deployment

```bash
# Deploy
cd pooling-harvester && npx wrangler deploy

# Check stats
curl https://pooling-harvester.photog12.workers.dev/stats

# Test single case
curl -X POST https://pooling-harvester.photog12.workers.dev/test \
  -H "Content-Type: application/json" \
  -d '{"case_number": "CD 2025-002808"}'

# Manual trigger
curl -X POST https://pooling-harvester.photog12.workers.dev/trigger

# View logs
npx wrangler tail pooling-harvester
```
