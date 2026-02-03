#!/bin/bash
# Full OTC data load script
# Loads: otc_leases (with formation), otc_companies, operator_numbers, otc_production_financial
#
# Usage: ./execute-otc-full-load.sh [step]
#   No args = run all steps
#   1 = migrate tables only
#   2 = load leases only
#   3 = load companies only
#   4 = load operator numbers only
#   5 = load financial data only

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STEP="${1:-all}"

run_batch_dir() {
    local dir="$1"
    local label="$2"
    local pattern="${3:-batch_*.sql}"

    local total=$(ls "$dir"/$pattern 2>/dev/null | wc -l | tr -d ' ')
    if [ "$total" = "0" ]; then
        echo "  ERROR: No batch files found in $dir/"
        return 1
    fi

    echo "  Loading $total batch files from $dir/..."
    local success=0
    local failed=0
    local count=0

    for file in "$dir"/$pattern; do
        count=$((count + 1))
        result=$(wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1)
        if echo "$result" | grep -q '"success": true'; then
            success=$((success + 1))
        else
            failed=$((failed + 1))
            if [ $failed -le 3 ]; then
                echo "    FAILED: $file"
                echo "    $result" | head -5
            fi
        fi

        # Progress every 50 batches
        if [ $((count % 50)) -eq 0 ]; then
            echo "    Progress: $count/$total (${success} OK, ${failed} failed)"
        fi
        sleep 0.15
    done

    echo "  $label complete: $success succeeded, $failed failed (of $total)"
    return 0
}

# Step 1: Migrate tables (drop and recreate otc_leases + otc_production_financial)
if [ "$STEP" = "all" ] || [ "$STEP" = "1" ]; then
    echo "=== Step 1: Migrating OTC tables ==="
    result=$(wrangler d1 execute oklahoma-wells --remote --file="$SCRIPT_DIR/migrate-otc-tables.sql" 2>&1)
    if echo "$result" | grep -q '"success": true'; then
        echo "  Tables migrated successfully"
    else
        echo "  ERROR migrating tables:"
        echo "$result"
        exit 1
    fi
fi

# Step 2: Load lease data (472 batches, 235K records)
if [ "$STEP" = "all" ] || [ "$STEP" = "2" ]; then
    echo ""
    echo "=== Step 2: Loading OTC lease data ==="
    run_batch_dir "$SCRIPT_DIR/otc-leases-batches" "Lease data"
fi

# Step 3: Load company data (11 batches, 5K companies)
if [ "$STEP" = "all" ] || [ "$STEP" = "3" ]; then
    echo ""
    echo "=== Step 3: Loading OTC company data ==="
    # Company batches are the first 11 files in otc-operator-batches (batch_001 to batch_011)
    # They contain INSERT OR REPLACE INTO otc_companies
    local_success=0
    local_failed=0
    for file in "$SCRIPT_DIR"/otc-operator-batches/batch_*.sql; do
        # Check if this is a company batch (INSERT INTO otc_companies) or lease update (UPDATE otc_leases)
        if head -1 "$file" | grep -q "otc_companies"; then
            result=$(wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1)
            if echo "$result" | grep -q '"success": true'; then
                local_success=$((local_success + 1))
            else
                local_failed=$((local_failed + 1))
                echo "    FAILED: $file"
            fi
            sleep 0.15
        fi
    done
    echo "  Company data complete: $local_success succeeded, $local_failed failed"
fi

# Step 4: Update operator numbers on otc_leases (200 batches)
if [ "$STEP" = "all" ] || [ "$STEP" = "4" ]; then
    echo ""
    echo "=== Step 4: Updating operator numbers ==="
    local_success=0
    local_failed=0
    local_count=0
    for file in "$SCRIPT_DIR"/otc-operator-batches/batch_*.sql; do
        # Check if this is an operator update batch (UPDATE otc_leases)
        if head -1 "$file" | grep -q "UPDATE otc_leases"; then
            local_count=$((local_count + 1))
            result=$(wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1)
            if echo "$result" | grep -q '"success": true'; then
                local_success=$((local_success + 1))
            else
                local_failed=$((local_failed + 1))
                if [ $local_failed -le 3 ]; then
                    echo "    FAILED: $file"
                fi
            fi
            if [ $((local_count % 50)) -eq 0 ]; then
                echo "    Progress: $local_count (${local_success} OK, ${local_failed} failed)"
            fi
            sleep 0.15
        fi
    done
    echo "  Operator updates complete: $local_success succeeded, $local_failed failed"
fi

# Step 5: Load financial data (185 batches, 92K records)
if [ "$STEP" = "all" ] || [ "$STEP" = "5" ]; then
    echo ""
    echo "=== Step 5: Loading OTC financial data ==="
    run_batch_dir "$SCRIPT_DIR/otc-financial-batches" "Financial data"
fi

echo ""
echo "=== Load complete ==="
echo "Verifying counts..."
wrangler d1 execute oklahoma-wells --remote --command="SELECT 'otc_leases' as tbl, COUNT(*) as cnt FROM otc_leases UNION ALL SELECT 'otc_companies', COUNT(*) FROM otc_companies UNION ALL SELECT 'otc_production_financial', COUNT(*) FROM otc_production_financial;" 2>&1 | grep -A 2 '"results"'
