#!/usr/bin/env node

const fs = require('fs').promises;
const { execSync } = require('child_process');

async function splitAndImportBatch(batchFile, startIndex) {
  const content = await fs.readFile(batchFile, 'utf8');
  const statements = content.trim().split(';\n').filter(s => s.trim());
  
  console.log(`Found ${statements.length} statements in ${batchFile}`);
  
  // Import one by one
  for (let i = 0; i < statements.length; i++) {
    const tempFile = `imports/county-single-${startIndex + i}.sql`;
    await fs.writeFile(tempFile, statements[i] + ';');
    
    console.log(`Importing county ${startIndex + i}...`);
    try {
      execSync(`npx wrangler d1 execute oklahoma-wells --file=${tempFile} --remote`, { stdio: 'inherit' });
      console.log(`✓ Successfully imported county ${startIndex + i}`);
    } catch (error) {
      console.log(`✗ Failed to import county ${startIndex + i}, skipping...`);
    }
    
    // Clean up temp file
    await fs.unlink(tempFile);
  }
}

async function main() {
  try {
    console.log('Importing remaining counties...\n');
    
    // Import batch 7 (10 counties starting at index 61)
    await splitAndImportBatch('imports/counties-batch-7.sql', 61);
    
    // Import batch 8 (7 counties starting at index 71) 
    await splitAndImportBatch('imports/counties-batch-8.sql', 71);
    
    console.log('\nDone! Checking final count...');
    execSync('npx wrangler d1 execute oklahoma-wells --command="SELECT COUNT(*) as count FROM counties;" --remote', { stdio: 'inherit' });
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();