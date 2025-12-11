#!/bin/bash

# Script to backfill formation data for completion activities
# Run this after the updated worker is deployed

echo "🔄 Starting formation data backfill..."

# Replace with your actual admin email if different
ADMIN_EMAIL="jamesrprice3@gmail.com"

# Make the API call to backfill formations
curl -X POST https://portal.mymineralwatch.com/api/backfill-formations \
  -H "Content-Type: application/json" \
  -H "Cookie: mineral-watch-auth=YOUR_AUTH_TOKEN_HERE" \
  -d "{}" \
  -v

echo "✅ Backfill request sent!"
echo "Check the response for results."