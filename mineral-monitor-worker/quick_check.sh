#!/bin/bash
# Download the ITD file and check its content
echo "Downloading ITD daily file..."
curl -s "https://oklahoma.gov/content/dam/ok/en/occ/documents/og/ogdatafiles/ITD-wells-formations-daily.xlsx" -o itd_temp.xlsx

echo "File size: $(ls -lh itd_temp.xlsx | awk '{print $5}')"

# Use strings to extract readable text and look for dates
echo -e "\nSearching for recent dates in 2025-12 format:"
strings itd_temp.xlsx | grep -E "2025-12-1[4-7]" | head -10

echo -e "\nSearching for dates in 12/1[4-7]/2025 format:"
strings itd_temp.xlsx | grep -E "12/1[4-7]/2025" | head -10

echo -e "\nSearching for any December 2025 dates:"
strings itd_temp.xlsx | grep -i "dec.*2025\|2025.*dec\|12/.*2025" | head -10

# Clean up
rm itd_temp.xlsx