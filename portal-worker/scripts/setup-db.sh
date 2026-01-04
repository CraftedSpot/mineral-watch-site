#!/bin/bash

# Setup D1 database tables for Airtable sync
# Run this script to create the necessary tables

echo "Setting up D1 database tables for properties and wells sync..."

# Run the SQL file against the D1 database
wrangler d1 execute oklahoma-wells --file=schema/create_tables.sql

echo "Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Set the SYNC_API_KEY secret: wrangler secret put SYNC_API_KEY"
echo "2. Configure Airtable MCP integration if not already done"
echo "3. Test the sync endpoint: POST /api/admin/sync"