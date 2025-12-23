#!/bin/bash

# Import the first 10 SQL files to D1
for i in {001..010}; do
    echo "Importing file $i..."
    wrangler d1 execute oklahoma-wells --file="sql-imports/rbdms-import-${i}-notrans.sql" --remote
    if [ $? -eq 0 ]; then
        echo "✓ Successfully imported file $i"
    else
        echo "✗ Failed to import file $i"
    fi
done

echo "Batch import complete"