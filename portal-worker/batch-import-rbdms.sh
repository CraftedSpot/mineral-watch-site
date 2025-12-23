#!/bin/bash

# Batch Import RBDMS Wells with Progress Logging
# This script handles large-scale imports with proper logging and error handling

set -e

# Configuration
IMPORT_DIR="${1:-sql-imports}"
LOG_FILE="rbdms-import-$(date +%Y%m%d-%H%M%S).log"
REMOTE_FLAG=""
BATCH_DELAY=0.5  # Delay between batches in seconds

# Parse arguments
while [[ "$#" -gt 1 ]]; do
    case $1 in
        --remote) REMOTE_FLAG="--remote"; shift ;;
        --delay) BATCH_DELAY="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Logging function
log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message"
    echo "$message" >> "$LOG_FILE"
}

# Start import
log "=========================================="
log "RBDMS Wells Batch Import Started"
log "=========================================="
log "Import directory: $IMPORT_DIR"
log "Database: ${REMOTE_FLAG:-LOCAL}"
log "Batch delay: ${BATCH_DELAY}s"
log ""

# Check for import files
if [ ! -d "$IMPORT_DIR" ]; then
    log "ERROR: Import directory not found: $IMPORT_DIR"
    exit 1
fi

# Count import files
IMPORT_FILES=($(ls -1 "$IMPORT_DIR"/rbdms-import-*.sql 2>/dev/null | sort -V))
TOTAL_FILES=${#IMPORT_FILES[@]}

if [ $TOTAL_FILES -eq 0 ]; then
    log "ERROR: No RBDMS import files found in $IMPORT_DIR"
    log "Run 'node import-rbdms-wells.js' first to generate import files"
    exit 1
fi

log "Found $TOTAL_FILES import files"

# Get initial count
log "Getting initial record count..."
INITIAL_COUNT=$(wrangler d1 execute oklahoma-wells $REMOTE_FLAG --command="SELECT COUNT(*) as count FROM wells" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "0")
log "Initial wells in database: $(printf "%'d" $INITIAL_COUNT)"
log ""

# Track statistics
SUCCESS=0
FAILED=0
TOTAL_TIME=0
FAILED_FILES=()

# Process each file
log "Starting batch import..."
log ""

for i in "${!IMPORT_FILES[@]}"; do
    FILE="${IMPORT_FILES[$i]}"
    FILENAME=$(basename "$FILE")
    FILE_NUM=$((i + 1))
    PROGRESS=$((FILE_NUM * 100 / TOTAL_FILES))
    
    # Progress indicator
    log "[$FILE_NUM/$TOTAL_FILES] Processing $FILENAME (${PROGRESS}%)..."
    
    # Time the import
    START_TIME=$(date +%s)
    
    # Execute import
    if wrangler d1 execute oklahoma-wells $REMOTE_FLAG --file="$FILE" >> "$LOG_FILE" 2>&1; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        TOTAL_TIME=$((TOTAL_TIME + DURATION))
        SUCCESS=$((SUCCESS + 1))
        
        log "  ✅ Success (${DURATION}s)"
        
        # Show periodic progress
        if [ $((FILE_NUM % 10)) -eq 0 ] || [ $FILE_NUM -eq $TOTAL_FILES ]; then
            CURRENT_COUNT=$(wrangler d1 execute oklahoma-wells $REMOTE_FLAG --command="SELECT COUNT(*) as count FROM wells" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "unknown")
            log "  📊 Records in database: $(printf "%'d" $CURRENT_COUNT)"
        fi
    else
        FAILED=$((FAILED + 1))
        FAILED_FILES+=("$FILENAME")
        log "  ❌ Failed! (see log for details)"
    fi
    
    # Delay between imports to avoid overwhelming the database
    if [ $FILE_NUM -lt $TOTAL_FILES ]; then
        sleep $BATCH_DELAY
    fi
done

log ""
log "=========================================="
log "Import Summary"
log "=========================================="

# Get final count
FINAL_COUNT=$(wrangler d1 execute oklahoma-wells $REMOTE_FLAG --command="SELECT COUNT(*) as count FROM wells" 2>/dev/null | grep -o '"count":[0-9]*' | cut -d':' -f2 || echo "unknown")
RECORDS_ADDED=$((FINAL_COUNT - INITIAL_COUNT))

log "Total files processed: $TOTAL_FILES"
log "Successful imports: $SUCCESS"
log "Failed imports: $FAILED"
log "Total time: ${TOTAL_TIME}s (avg $((TOTAL_TIME / TOTAL_FILES))s per file)"
log ""
log "Records added: $(printf "%'d" $RECORDS_ADDED)"
log "Total records in database: $(printf "%'d" $FINAL_COUNT)"
log ""

# List failed files if any
if [ $FAILED -gt 0 ]; then
    log "Failed files:"
    for FILE in "${FAILED_FILES[@]}"; do
        log "  - $FILE"
    done
    log ""
    log "⚠️  Some imports failed. Check $LOG_FILE for details."
    exit 1
else
    log "✅ All imports completed successfully!"
fi

log ""
log "Log saved to: $LOG_FILE"

# Optional: Show sample of imported data
log ""
log "Sample imported wells:"
wrangler d1 execute oklahoma-wells $REMOTE_FLAG --command="SELECT api_number, well_name, county FROM wells ORDER BY RANDOM() LIMIT 3" | tee -a "$LOG_FILE"