#!/usr/bin/env python3
"""
Download and import OCC completions data to D1 database
"""

import pandas as pd
import json
import os
import urllib.request
from datetime import datetime

# Download the Excel file
url = "https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/completions-wells-formations-base.xlsx"
local_file = "completions-wells-formations-base.xlsx"

print(f"Downloading completions data from {url}...")
urllib.request.urlretrieve(url, local_file)
print(f"Downloaded to {local_file}")

# Read the Excel file
print("Reading Excel file...")
df = pd.read_excel(local_file)

print(f"Total rows in completions file: {len(df)}")
print(f"Columns: {list(df.columns)}")

# Display first few rows to understand the structure
print("\nFirst 5 rows:")
print(df.head())

# Display data types
print("\nData types:")
print(df.dtypes)

# Check for API number column
api_columns = [col for col in df.columns if 'API' in col.upper()]
print(f"\nAPI columns found: {api_columns}")

# Count unique API numbers
if api_columns:
    api_col = api_columns[0]
    unique_apis = df[api_col].nunique()
    print(f"Unique API numbers: {unique_apis}")

# Check what other interesting columns we have
formation_cols = [col for col in df.columns if 'FORM' in col.upper()]
depth_cols = [col for col in df.columns if 'DEPTH' in col.upper() or 'TD' in col.upper()]
production_cols = [col for col in df.columns if 'PROD' in col.upper() or 'IP' in col.upper() or 'OIL' in col.upper() or 'GAS' in col.upper()]

print(f"\nFormation columns: {formation_cols}")
print(f"Depth columns: {depth_cols}")
print(f"Production columns: {production_cols}")

# Create SQL to update wells table with completion data
print("\nPreparing SQL updates...")

# We'll update the wells table with this additional data
# First, let's see what columns we can map
print("\nSample data for key columns:")
for col in api_columns + formation_cols + depth_cols + production_cols:
    if col in df.columns:
        sample = df[col].dropna().head(3).tolist()
        print(f"{col}: {sample}")