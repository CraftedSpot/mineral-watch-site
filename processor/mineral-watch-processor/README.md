# Mineral Watch Document Processor

A background service running on Fly.io that processes uploaded mineral rights documents:

1. **Polls** for queued documents from the documents-worker API
2. **Downloads** PDFs from Cloudflare R2
3. **Converts** to images using pdftoppm (free, local)
4. **Extracts** data using Claude Vision API with per-field confidence scoring
5. **Updates** D1 database with structured results
6. **Notifies** users via Postmark when processing is complete

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE                                                         │
│  Portal Worker → Documents Worker → R2 (PDFs) + D1 (metadata)       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ API calls
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FLY.IO - mineral-watch-processor                                   │
│  Python service polling every 30 seconds                            │
│  - pdftoppm for PDF→image conversion                                │
│  - Claude Vision for extraction                                     │
│  - Postmark for email notifications                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

Set these as Fly.io secrets:

```bash
fly secrets set PROCESSING_API_KEY="your-shared-secret"
fly secrets set ANTHROPIC_API_KEY="sk-ant-..."
fly secrets set POSTMARK_API_KEY="your-postmark-key"
fly secrets set DOCUMENTS_API_URL="https://documents-worker.your-domain.workers.dev"
```

## Deployment

```bash
# Deploy to Fly.io
fly deploy

# View logs
fly logs

# Check status
fly status
```

## Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DOCUMENTS_API_URL="https://documents-worker.your-domain.workers.dev"
export PROCESSING_API_KEY="your-key"
export ANTHROPIC_API_KEY="sk-ant-..."
export POSTMARK_API_KEY="your-key"

# Run
python -m src.main
```

## Extracted Data Schema

The processor extracts the following with per-field confidence scores:

- **Document type**: mineral_deed, royalty_deed, division_order, lease, etc.
- **Parties**: Grantor/Grantee names and addresses
- **Interest**: Fractional interest conveyed (e.g., "1/8")
- **Legal description**: Section, Township, Range, County, Quarter, Acres
- **Recording info**: Book, Page, Recording date
- **Execution date**: When document was signed
- **Consideration**: Dollar amount

Each field includes a confidence score (0.0-1.0):
- 0.9-1.0: High confidence (clear, readable)
- 0.6-0.89: Medium confidence (some uncertainty)
- 0.0-0.59: Low confidence (needs review)

## Health Check

The service exposes a health endpoint at `GET /health` for Fly.io monitoring.
