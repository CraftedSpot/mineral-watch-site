#!/bin/bash
# Load remaining OTC batch files, skipping the first N already-loaded batches
# Usage: ./load-remaining.sh <directory> <skip_count>

DIR="${1:?Usage: $0 <batch_dir> <skip_count>}"
SKIP="${2:-0}"

SUCCESS=0
FAILED=0
COUNT=0
SKIPPED=0

for file in "$DIR"/batch_*.sql; do
    [ -f "$file" ] || continue
    SKIPPED=$((SKIPPED + 1))
    if [ $SKIPPED -le $SKIP ]; then
        continue
    fi

    COUNT=$((COUNT + 1))
    result=$(wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1)
    if echo "$result" | grep -q '"success": true'; then
        SUCCESS=$((SUCCESS + 1))
    else
        FAILED=$((FAILED + 1))
        if [ $FAILED -le 5 ]; then
            echo "  FAILED: $file"
        fi
    fi

    if [ $((COUNT % 50)) -eq 0 ]; then
        echo "Progress: $COUNT ($SUCCESS OK, $FAILED failed)"
    fi
    sleep 0.15
done

echo "Complete: $SUCCESS OK, $FAILED failed out of $COUNT processed (skipped first $SKIP)"
