#!/bin/bash

# Remove BEGIN TRANSACTION and COMMIT from all RBDMS import files
for file in sql-imports/rbdms-import-*.sql; do
    # Create a new filename with -notrans suffix
    newfile="${file%.sql}-notrans.sql"
    
    # Remove transaction statements
    grep -v "BEGIN TRANSACTION" "$file" | grep -v "COMMIT" > "$newfile"
    
    echo "Processed: $file -> $newfile"
done

echo "Transaction statements removed from all files"