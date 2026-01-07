#!/bin/bash
# Import all county batches

echo "Importing counties into D1..."

for i in {1..8}; do
  echo "Importing batch $i of 8..."
  npx wrangler d1 execute oklahoma-wells --file=./imports/counties-batch-$i.sql --remote
  sleep 2 # Small delay between batches
done

echo "Counties import complete!"