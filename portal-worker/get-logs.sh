#!/bin/bash
# Start wrangler tail in background and filter for errors
wrangler tail --format=pretty | grep -A5 -B5 "Backfill.*Failed\|error"