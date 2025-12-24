#!/usr/bin/env python3
import sys
import subprocess

print("Checking for required Python packages...")

# Try to import required packages
try:
    import pandas as pd
    import openpyxl
    print("✓ Required packages already installed")
except ImportError:
    print("Installing required packages...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "pandas", "openpyxl"])
    import pandas as pd
    import openpyxl

print("\nReading completions Excel file...")
print("This may take a few minutes due to file size (72MB)...")

try:
    # Read the Excel file in chunks if possible
    df = pd.read_excel('completions-wells-formations-base.xlsx', engine='openpyxl')
    print(f"Successfully loaded {len(df)} rows")
    
    # Show column names
    print("\nColumn names:")
    for i, col in enumerate(df.columns):
        print(f"  {i}: {col}")
    
    # Create SQL updates
    print("\nGenerating SQL updates...")
    
    updates = []
    stats = {
        'total': 0,
        'valid_api': 0,
        'with_data': 0
    }
    
    for idx, row in df.iterrows():
        stats['total'] += 1
        
        # Get API number
        api = str(row.get('API_Number', '')).strip().replace('-', '').replace(' ', '')
        if not api or api == 'nan':
            continue
            
        stats['valid_api'] += 1
        
        # Collect updates
        update_fields = []
        
        # Formation name
        formation = row.get('Formation_Name', None)
        if pd.notna(formation) and formation:
            update_fields.append(f"formation_name = '{str(formation).replace(\"'\", \"''\")}'")
        
        # Depths
        for field, column in [
            ('formation_depth', 'Formation_Depth'),
            ('measured_total_depth', 'Measured_Total_Depth'),
            ('true_vertical_depth', 'True_Vertical_Depth')
        ]:
            value = row.get(column, None)
            if pd.notna(value):
                try:
                    update_fields.append(f"{field} = {int(float(value))}")
                except:
                    pass
        
        # Bottom hole location
        bh_long = row.get('Bottom_Hole_Long_X', None)
        bh_lat = row.get('Bottom_Hole_Lat_Y', None)
        if pd.notna(bh_long) and float(bh_long) != 0:
            update_fields.append(f"bh_longitude = {float(bh_long)}")
        if pd.notna(bh_lat) and float(bh_lat) != 0:
            update_fields.append(f"bh_latitude = {float(bh_lat)}")
        
        # Initial production
        for field, column in [
            ('ip_oil_bbl', 'Oil_BBL_Per_Day'),
            ('ip_gas_mcf', 'Gas_MCF_Per_Day'),
            ('ip_water_bbl', 'Water_BBL_Per_Day')
        ]:
            value = row.get(column, None)
            if pd.notna(value):
                try:
                    update_fields.append(f"{field} = {float(value)}")
                except:
                    pass
        
        # Create update statement if we have data
        if update_fields:
            sql = f"UPDATE wells SET {', '.join(update_fields)} WHERE api_number = '{api}';"
            updates.append(sql)
            stats['with_data'] += 1
        
        # Progress indicator
        if stats['total'] % 10000 == 0:
            print(f"  Processed {stats['total']} rows...")
    
    print(f"\nProcessing complete:")
    print(f"  Total rows: {stats['total']}")
    print(f"  Valid APIs: {stats['valid_api']}")
    print(f"  Rows with data: {stats['with_data']}")
    
    # Write SQL files
    if updates:
        # Write full file
        with open('completions-full-update.sql', 'w') as f:
            f.write('\n'.join(updates))
        print(f"\nWrote {len(updates)} updates to completions-full-update.sql")
        
        # Create batch files
        BATCH_SIZE = 500
        batch_num = 1
        for i in range(0, len(updates), BATCH_SIZE):
            batch = updates[i:i + BATCH_SIZE]
            filename = f'completions-full-batch-{str(batch_num).zfill(3)}.sql'
            with open(filename, 'w') as f:
                f.write('\n'.join(batch))
            batch_num += 1
        
        print(f"Created {batch_num - 1} batch files")
        
        # Create execution script
        script = f'''#!/bin/bash
echo "Executing {batch_num - 1} batches of completion updates..."
for i in {{1..{batch_num - 1}}}; do
    file=$(printf "completions-full-batch-%03d.sql" $i)
    echo "Processing batch $i of {batch_num - 1}: $file"
    wrangler d1 execute oklahoma-wells --remote --file="$file"
    sleep 2
done
echo "Completions update complete!"
'''
        
        with open('execute-full-completions.sh', 'w') as f:
            f.write(script)
        
        import os
        os.chmod('execute-full-completions.sh', 0o755)
        print("\nCreated execution script: ./execute-full-completions.sh")
        
except Exception as e:
    print(f"\nError: {e}")
    print("\nThe file may be too large or corrupted.")
    print("Consider downloading it again or using the daily updates file instead.")