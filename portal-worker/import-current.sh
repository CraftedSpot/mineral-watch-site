#!/bin/bash
# Import current production data (12/36 month files)

BATCH_DIR="/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-current-batches/20260119_150603"
cd /Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker

count=0
success=0
failed=0

for file in "$BATCH_DIR"/batch_*.sql; do
    batch_name=$(basename "$file")

    # Skip already imported batch
    if [[ "$batch_name" == "batch_1147.sql" ]]; then
        echo "Skipping $batch_name (already imported)"
        continue
    fi

    count=$((count + 1))

    # Execute batch
    if npx wrangler d1 execute oklahoma-wells --remote --file "$file" > /dev/null 2>&1; then
        success=$((success + 1))
    else
        failed=$((failed + 1))
        echo "FAILED: $batch_name"
    fi

    # Progress every 100 batches
    if ((count % 100 == 0)); then
        echo "Progress: $count processed, $success success, $failed failed"
    fi
done

echo ""
echo "COMPLETE: $count processed, $success success, $failed failed"
