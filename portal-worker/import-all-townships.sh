#!/bin/bash
# Import all township batches

echo "Importing townships into D1..."
echo "This will import 2078 townships in 42 batches"
echo ""

# Track progress
SUCCESS=0
FAILED=0

for i in {1..42}; do
  echo -n "Importing batch $i of 42..."
  
  if npx wrangler d1 execute oklahoma-wells --file=./imports-correct/townships-batch-$i.sql --remote > /dev/null 2>&1; then
    echo " ✓"
    ((SUCCESS++))
  else
    echo " ✗ (failed)"
    ((FAILED++))
    # Continue with next batch even if one fails
  fi
  
  # Small delay between batches to avoid rate limiting
  sleep 1
done

echo ""
echo "Import complete!"
echo "Successful batches: $SUCCESS"
echo "Failed batches: $FAILED"
echo ""
echo "Checking final count..."
npx wrangler d1 execute oklahoma-wells --command="SELECT COUNT(*) as count, COUNT(DISTINCT meridian) as meridians FROM townships;" --remote