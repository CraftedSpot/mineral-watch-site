#!/bin/bash
# Execute completion data updates
echo "Updating wells with completion data..."

for file in completions-batch-*.sql; do
    echo "Processing $file..."
    wrangler d1 execute oklahoma-wells --remote --file="$file"
    sleep 1 # Brief pause between batches
done

echo "Completion data update finished!"
