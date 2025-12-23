# Wells Data Import Script

This script converts CSV or JSON wells data into SQL INSERT statements for importing into the D1 oklahoma-wells database.

## Usage

```bash
node import-wells.js <input-file> [output-directory]
```

- `<input-file>`: Path to your CSV or JSON file containing wells data
- `[output-directory]`: Optional directory for SQL output files (default: ./sql-imports)

## Supported Formats

### CSV Format
The CSV file should have the following columns:
- `api_number` (required) - Unique API number for the well
- `well_name` - Name of the well
- `well_number` - Well number designation
- `section` (required) - Section number (1-36)
- `township` (required) - Township (e.g., "9N")
- `range` (required) - Range (e.g., "5W")
- `meridian` (required) - Either "IM" (Indian Meridian) or "CM" (Cimarron Meridian)
- `county` - County name
- `latitude` - Decimal latitude
- `longitude` - Decimal longitude
- `operator` - Operating company
- `well_type` - Type of well (Oil, Gas, etc.)
- `well_status` - Current status (Active, Producing, etc.)
- `spud_date` - Date drilling started (YYYY-MM-DD format)
- `completion_date` - Date well was completed (YYYY-MM-DD format)

### JSON Format
JSON file should contain an array of objects with the same field names as the CSV columns.

## Examples

### Generate example data files:
```bash
node import-wells.js --example
```

This creates `example-wells.csv` and `example-wells.json` for reference.

### Import a CSV file:
```bash
node import-wells.js wells-data.csv
```

### Import a JSON file with custom output directory:
```bash
node import-wells.js wells-data.json ./my-imports
```

## Output

The script generates SQL files in chunks of 1000 records:
- `wells-import-01.sql`
- `wells-import-02.sql`
- etc.

Each file is wrapped in a transaction for safe importing.

## Importing to D1

After generating the SQL files, import them to your D1 database:

```bash
# For local database
wrangler d1 execute oklahoma-wells --file=./sql-imports/wells-import-01.sql

# For remote database
wrangler d1 execute oklahoma-wells --file=./sql-imports/wells-import-01.sql --remote
```

## Data Validation

The script performs the following validations:
- Skips records without an API number
- Validates meridian values (must be IM or CM, defaults to IM if invalid)
- Validates section numbers (must be 1-36)
- Escapes SQL special characters in text fields
- Handles NULL values appropriately

## Large Dataset Tips

For very large datasets:
1. The script automatically chunks data into 1000-record files
2. Import files sequentially to avoid overwhelming the database
3. Consider running imports during off-peak hours
4. Monitor D1 database size limits