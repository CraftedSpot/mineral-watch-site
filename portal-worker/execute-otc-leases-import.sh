#!/bin/bash
# Execute OTC leases import
echo "Importing OTC lease data (235977 records in 472 batches)..."
echo ""

for file in otc-leases-batch-*.sql; do
    echo -n "Processing $file... "
    wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1 | grep -o '"success": true' || echo "FAILED"
done

echo ""
echo "Import complete! Cleaning up batch files..."
rm -f otc-leases-batch-*.sql

echo "Done!"
