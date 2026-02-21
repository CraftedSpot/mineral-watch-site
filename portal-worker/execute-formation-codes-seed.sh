#!/bin/bash
# Seed occ_formation_codes table from PDF extraction
# 5240 formation codes in 27 batches

echo 'Running migration 023...'
wrangler d1 execute oklahoma-wells --remote --file=migrations/023_occ_formation_codes.sql
sleep 2

echo 'Seeding formation codes...'
for i in $(seq -w 1 27); do
    echo "Batch $i of 27"
    wrangler d1 execute oklahoma-wells --remote --file="formation-codes-seed-0${i}.sql"
    sleep 1
done

echo 'Done! Seeded formation codes table.'
