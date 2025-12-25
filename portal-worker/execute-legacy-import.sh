#!/bin/bash
# Execute legacy completions update
echo "Starting legacy completions data import..."
echo "Total batches: 441"
echo "This will fill in missing depth and date data without overwriting existing values"
echo ""

start_time=$(date +%s)
processed=0
failed=0

for file in legacy-batch-*.sql; do
    if [ -f "$file" ]; then
        processed=$((processed + 1))
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Processing batch $processed/441: $file"
        
        # Execute with wrangler
        if wrangler d1 execute oklahoma-wells --remote --file="$file"; then
            echo "  ✓ Success"
        else
            echo "  ✗ Failed - check logs"
            failed=$((failed + 1))
        fi
        
        # Brief pause between batches to avoid rate limiting
        if [ $processed -lt 441 ]; then
            sleep 2
        fi
    fi
done

end_time=$(date +%s)
duration=$((end_time - start_time))

echo ""
echo "Legacy completions import complete!"
echo "Total time: $duration seconds"
echo "Batches processed: $processed"
echo "Failed batches: $failed"
echo ""
echo "Run this query to check the results:"
echo "wrangler d1 execute oklahoma-wells --remote --command=\"SELECT COUNT(*) as total, COUNT(measured_total_depth) as with_depth, COUNT(true_vertical_depth) as with_tvd, COUNT(completion_date) as with_completion, COUNT(spud_date) as with_spud FROM wells\""