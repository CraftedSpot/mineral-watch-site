#!/usr/bin/env python3
import pandas as pd
from datetime import datetime

# Read the Excel file
df = pd.read_excel('/tmp/itd-daily.xlsx')

print(f"Total records: {len(df)}")
print(f"Columns: {list(df.columns)}")

# Find date columns
date_columns = [col for col in df.columns if 'date' in col.lower() or 'spud' in col.lower()]
print(f"\nDate columns found: {date_columns}")

# Show sample of data
print("\nFirst 5 rows:")
print(df.head())

# For each date column, show the latest dates
for col in date_columns:
    if col in df.columns:
        # Convert to datetime and drop NaN values
        dates = pd.to_datetime(df[col], errors='coerce').dropna()
        if len(dates) > 0:
            print(f"\n{col}:")
            print(f"  Latest: {dates.max()}")
            print(f"  Earliest: {dates.min()}")
            print(f"  Count: {len(dates)}")
            
            # Show most recent 10 unique dates
            recent_dates = dates.sort_values(ascending=False).drop_duplicates().head(10)
            print(f"  Recent dates:")
            for date in recent_dates:
                print(f"    {date.date()}")