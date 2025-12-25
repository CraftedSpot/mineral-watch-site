#!/bin/bash
# Import operator data to D1

echo "Creating operators table..."
wrangler d1 execute oklahoma-wells --remote --file=create-operators-table.sql

echo "Importing operator data..."
for file in operators-batch-*.sql; do
    if [ -f "$file" ]; then
        echo "  Importing $file..."
        wrangler d1 execute oklahoma-wells --remote --file="$file" -y
    fi
done

echo "Done! Verifying import..."
wrangler d1 execute oklahoma-wells --remote --command="SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'OPEN' THEN 1 END) as open FROM operators"
