#!/bin/bash
# GTR36 Production Data Import Script
# Executes SQL batches against D1 in sequence

BATCH_DIR="/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-production-batches/20260119_145302"
LOG_FILE="/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/production-import.log"

echo "Starting production data import at $(date)" | tee "$LOG_FILE"
echo "Batch directory: $BATCH_DIR" | tee -a "$LOG_FILE"

cd /Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker

total=$(ls -1 "$BATCH_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')
echo "Total batches to process: $total" | tee -a "$LOG_FILE"

success=0
failed=0
count=0

for file in "$BATCH_DIR"/batch_*.sql; do
    count=$((count + 1))

    # Skip first batch (already done)
    if [[ "$file" == *"batch_0001.sql" ]]; then
        echo "[$count/$total] Skipping batch_0001 (already imported)" | tee -a "$LOG_FILE"
        success=$((success + 1))
        continue
    fi

    # Execute batch
    result=$(npx wrangler d1 execute oklahoma-wells --remote --file "$file" 2>&1)

    if echo "$result" | grep -q '"success": true'; then
        success=$((success + 1))
        if ((count % 100 == 0)); then
            echo "[$count/$total] Progress: $success succeeded, $failed failed - $(date)" | tee -a "$LOG_FILE"
        fi
    else
        failed=$((failed + 1))
        echo "[$count/$total] FAILED: $(basename "$file")" | tee -a "$LOG_FILE"
        echo "$result" >> "$LOG_FILE"
    fi
done

echo "" | tee -a "$LOG_FILE"
echo "Import complete at $(date)" | tee -a "$LOG_FILE"
echo "Results: $success succeeded, $failed failed out of $total total" | tee -a "$LOG_FILE"
