#!/bin/bash
# Continue GTR36 Production Import from batch 2
# Skips batches 1 and 2082 (already imported)

BATCH_DIR="/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-production-batches/20260119_145302"
cd /Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker

count=0
success=0
failed=0

for file in "$BATCH_DIR"/batch_*.sql; do
    batch_name=$(basename "$file")

    # Skip already imported batches
    if [[ "$batch_name" == "batch_0001.sql" ]] || [[ "$batch_name" == "batch_2082.sql" ]]; then
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

    # Progress every 50 batches
    if ((count % 50 == 0)); then
        echo "Progress: $count processed, $success success, $failed failed"
    fi
done

echo ""
echo "COMPLETE: $count processed, $success success, $failed failed"
