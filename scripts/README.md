# Mineral Watch Scripts

Utility scripts for data management and backfill operations.

## Historical Completions Backfill

Populates the KV cache with historical completion data from OCC for instant well lookups.

### Setup

1. **Install dependencies:**
   ```bash
   cd scripts
   npm install
   ```

2. **Set environment variables:**
   ```bash
   export CLOUDFLARE_API_TOKEN="your_api_token_here"
   export CLOUDFLARE_ACCOUNT_ID="your_account_id_here"
   ```

3. **Update script configuration:**
   - Open `backfill-completions.js`
   - Replace `YOUR_COMPLETIONS_CACHE_NAMESPACE_ID` with your actual KV namespace ID

### Usage

**Full backfill (one-time):**
```bash
npm run backfill
```

**Test with subset:**
```bash
# Modify BATCH_SIZE to 10 in script for testing
npm run backfill
```

### What it does:

1. **Downloads** OCC historical completions Excel file (~50-100MB)
2. **Parses** each completion record 
3. **Formats** data for consistent API lookups
4. **Uploads** to KV with keys like `well:3512900056`
5. **Rate limits** uploads to avoid Cloudflare limits

### Expected output:

```
🚀 Starting historical completions backfill...
📥 Downloading: https://oklahoma.gov/.../completions-wells-formations-base.xlsx
📥 Progress: 100.0% (87.3MB)
✅ Download complete
📊 Parsing Excel file...
📋 Headers found: API_Number, Well_Name, Operator, County...
📊 Parsed 10000 valid records...
📊 Parsed 20000 valid records...
✅ Parsing complete: 47,832 valid completion records found
🔄 Formatting records...
✅ Formatting complete:
   📈 Valid records: 47,125
   ❌ Invalid records: 707
📤 Uploading 47,125 records to KV...
📤 Batch 1/472: Uploaded 100 of 47,125 records (0.2%)
📤 Batch 2/472: Uploaded 200 of 47,125 records (0.4%)
...
📤 Batch 472/472: Uploaded 47,125 of 47,125 records (100.0%)
🧹 Cleaned up temporary files

🎉 Backfill complete!
📊 Final stats:
   📥 Downloaded: 47,832 raw records  
   ✅ Processed: 47,125 valid records
   📤 Uploaded: 47,125 to KV cache
   🎯 Success rate: 100.0%
```

### Data structure stored in KV:

```json
{
  "api": "3512900056",
  "wellName": "Quarter Circle S 22-34 IP #1H",
  "operator": "MEWBOURNE OIL COMPANY",
  "county": "ROGER MILLS",
  "surfaceSection": "22",
  "surfaceTownship": "13N", 
  "surfaceRange": "23W",
  "bhSection": "34",
  "bhTownship": "13N",
  "bhRange": "23W",
  "formationName": "Woodford",
  "formationDepth": 12400,
  "ipGas": 2100,
  "ipOil": 45,
  "ipWater": 230,
  "pumpingFlowing": "FLOWING",
  "spudDate": "2024-10-15",
  "completionDate": "2024-11-22", 
  "firstProdDate": "2024-12-01",
  "drillType": "HORIZONTAL HOLE",
  "lateralLength": 7500,
  "totalDepth": 14800,
  "cachedAt": 1733234567890,
  "source": "historical_backfill"
}
```

### Troubleshooting:

- **Download fails:** Check internet connection and OCC URL
- **Parse fails:** OCC may have changed Excel format  
- **Upload fails:** Verify API token and account ID
- **Rate limited:** Script includes delays, but you can increase `BATCH_DELAY`
- **Out of memory:** Use streaming parser for very large files

### Next steps:

After backfill completes:
1. Update portal worker to use KV lookups
2. Test well creation with rich data
3. Set up daily monitor to update cache