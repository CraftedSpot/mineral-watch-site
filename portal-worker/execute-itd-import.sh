#!/bin/bash
# Execute ITD formation data import
# Generated: 2026-02-20T23:52:40.858968
# Batches: 89
# Updates: 88,595
echo "Starting ITD formation import..."
echo "Total batches: 89"
echo ""

start_time=$(date +%s)
processed=0
errors=0

for file in itd-formation-batch-*.sql; do
    if [ -f "$file" ]; then
        processed=$((processed + 1))
        echo "[$(date '+%H:%M:%S')] Batch $processed/89: $file"

        if wrangler d1 execute oklahoma-wells --remote --file="$file"; then
            echo "  OK"
        else
            echo "  FAILED"
            errors=$((errors + 1))
        fi

        # Brief pause between batches
        if [ $processed -lt 89 ]; then
            sleep 2
        fi
    fi
done

end_time=$(date +%s)
duration=$((end_time - start_time))

echo ""
echo "ITD formation import complete!"
echo "Time: $duration seconds"
echo "Batches: $processed"
echo "Errors: $errors"
echo ""
echo "Next steps:"
echo "  1. Verify: SELECT COUNT(*) as total, SUM(CASE WHEN formation_name IS NOT NULL THEN 1 ELSE 0 END) as has_formation FROM wells;"
echo "  2. Check normalization: SELECT COUNT(*) FROM wells WHERE formation_name IS NOT NULL AND formation_group IS NULL;"
echo "  3. Re-run risk profile assignment if needed"
