#!/bin/bash

# Import RBDMS Wells to D1 Database
# This script downloads the latest RBDMS data and imports it into D1

set -e

echo "=================================="
echo "RBDMS Wells Import to D1 Database"
echo "=================================="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "Error: wrangler CLI not found. Please install it first:"
    echo "npm install -g wrangler"
    exit 1
fi

# Parse command line arguments
DOWNLOAD=false
REMOTE=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --download) DOWNLOAD=true ;;
        --remote) REMOTE=true ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --download    Download fresh data from OCC before importing"
            echo "  --remote      Import to remote D1 database (default: local)"
            echo "  --help        Show this help message"
            echo ""
            echo "Example:"
            echo "  $0 --download --remote"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Set up paths
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Download if requested
if [ "$DOWNLOAD" = true ]; then
    echo "Downloading latest RBDMS data from OCC..."
    node import-rbdms-wells.js --download
else
    # Check if data file exists
    if [ ! -f "rbdms-wells.csv" ]; then
        echo "No rbdms-wells.csv found. Downloading from OCC..."
        node import-rbdms-wells.js --download
    else
        echo "Using existing rbdms-wells.csv"
        echo "Use --download flag to fetch fresh data"
    fi
fi

echo ""
echo "Processing RBDMS data..."
node import-rbdms-wells.js

# Count SQL files
SQL_COUNT=$(ls -1 sql-imports/rbdms-import-*.sql 2>/dev/null | wc -l)

if [ "$SQL_COUNT" -eq 0 ]; then
    echo "Error: No SQL import files found"
    exit 1
fi

echo ""
echo "Found $SQL_COUNT SQL import files"
echo ""

# Prepare wrangler command
if [ "$REMOTE" = true ]; then
    WRANGLER_CMD="wrangler d1 execute oklahoma-wells --remote"
    echo "Importing to REMOTE D1 database..."
else
    WRANGLER_CMD="wrangler d1 execute oklahoma-wells"
    echo "Importing to LOCAL D1 database..."
fi

# Import confirmation
read -p "Ready to import $SQL_COUNT files. Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Import cancelled"
    exit 0
fi

echo ""
echo "Starting import..."
echo ""

# Import each file
SUCCESS=0
FAILED=0

for file in sql-imports/rbdms-import-*.sql; do
    filename=$(basename "$file")
    echo -n "Importing $filename... "
    
    if $WRANGLER_CMD --file="$file" > /dev/null 2>&1; then
        echo "✓"
        ((SUCCESS++))
    else
        echo "✗"
        ((FAILED++))
        echo "  Error: Failed to import $filename"
    fi
    
    # Small delay to avoid overwhelming the database
    sleep 0.5
done

echo ""
echo "=================================="
echo "Import Summary"
echo "=================================="
echo "Total files: $SQL_COUNT"
echo "Successful: $SUCCESS"
echo "Failed: $FAILED"
echo ""

if [ "$FAILED" -gt 0 ]; then
    echo "⚠️  Some imports failed. Check the errors above."
    exit 1
else
    echo "✅ All imports completed successfully!"
    
    # Quick verification
    echo ""
    echo "Verifying import..."
    
    if [ "$REMOTE" = true ]; then
        VERIFY_CMD="wrangler d1 execute oklahoma-wells --remote --command"
    else
        VERIFY_CMD="wrangler d1 execute oklahoma-wells --command"
    fi
    
    WELL_COUNT=$($VERIFY_CMD "SELECT COUNT(*) as count FROM wells" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2)
    
    if [ -n "$WELL_COUNT" ]; then
        echo "Total wells in database: $(echo $WELL_COUNT | sed ':a;s/\B[0-9]\{3\}\>/,&/;ta')"
    fi
fi

echo ""
echo "Done!"