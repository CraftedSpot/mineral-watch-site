#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const IMPORT_DIRS = ['./sql-imports', './test-imports'];
const LOG_FILE = 'import-log.txt';

// Set up logging
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  logStream.write(logMessage + '\n');
};

// Find all import files
function findImportFiles() {
  const files = [];
  
  for (const dir of IMPORT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    
    const dirFiles = fs.readdirSync(dir)
      .filter(f => f.match(/^(wells-import-|rbdms-import-)\d+\.sql$/))
      .map(f => path.join(dir, f));
    
    files.push(...dirFiles);
  }
  
  // Sort files to ensure proper order
  return files.sort((a, b) => {
    const aNum = parseInt(a.match(/(\d+)\.sql$/)[1]);
    const bNum = parseInt(b.match(/(\d+)\.sql$/)[1]);
    return aNum - bNum;
  });
}

// Execute a single SQL file
function executeSQL(filePath, isRemote = false) {
  const fileName = path.basename(filePath);
  const remoteFlag = isRemote ? '--remote' : '';
  const cmd = `wrangler d1 execute oklahoma-wells ${remoteFlag} --file="${filePath}"`;
  
  try {
    log(`Executing ${fileName}...`);
    const startTime = Date.now();
    
    const output = execSync(cmd, { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const duration = Date.now() - startTime;
    
    // Parse output for success indicators
    const success = output.includes('success": true') || output.includes('commands executed successfully');
    
    if (success) {
      log(`✅ ${fileName} executed successfully (${duration}ms)`);
      return { success: true, duration };
    } else {
      log(`⚠️  ${fileName} completed with warnings (${duration}ms)`);
      log(`   Output: ${output.substring(0, 200)}...`);
      return { success: true, duration, warning: true };
    }
    
  } catch (error) {
    log(`❌ ${fileName} failed: ${error.message}`);
    if (error.stdout) {
      log(`   Output: ${error.stdout.toString().substring(0, 200)}...`);
    }
    return { success: false, error: error.message };
  }
}

// Get current record count
function getRecordCount(isRemote = false) {
  try {
    const remoteFlag = isRemote ? '--remote' : '';
    const cmd = `wrangler d1 execute oklahoma-wells ${remoteFlag} --command="SELECT COUNT(*) as count FROM wells"`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    
    const match = output.match(/"count":\s*(\d+)/);
    if (match) {
      return parseInt(match[1]);
    }
  } catch (error) {
    log(`Failed to get record count: ${error.message}`);
  }
  return null;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const isRemote = args.includes('--remote');
  const isDryRun = args.includes('--dry-run');
  
  log('=== Wells Import Execution Started ===');
  log(`Mode: ${isRemote ? 'REMOTE' : 'LOCAL'} database`);
  
  // Find import files
  const importFiles = findImportFiles();
  
  if (importFiles.length === 0) {
    log('No import files found in sql-imports/ or test-imports/');
    log('Run import-wells.js or import-rbdms-wells.js first');
    process.exit(1);
  }
  
  log(`Found ${importFiles.length} import files:`);
  importFiles.forEach(f => log(`  - ${f}`));
  
  if (isDryRun) {
    log('Dry run mode - no actual execution');
    process.exit(0);
  }
  
  // Get initial record count
  const initialCount = getRecordCount(isRemote);
  if (initialCount !== null) {
    log(`Initial record count: ${initialCount.toLocaleString()}`);
  }
  
  // Execute imports
  log('');
  log('Starting imports...');
  
  const results = {
    total: importFiles.length,
    success: 0,
    warnings: 0,
    failed: 0,
    totalDuration: 0
  };
  
  for (let i = 0; i < importFiles.length; i++) {
    const file = importFiles[i];
    log('');
    log(`[${i + 1}/${importFiles.length}] Processing ${path.basename(file)}`);
    
    const result = executeSQL(file, isRemote);
    
    if (result.success) {
      results.success++;
      if (result.warning) results.warnings++;
      if (result.duration) results.totalDuration += result.duration;
    } else {
      results.failed++;
      
      // Ask to continue on failure
      if (i < importFiles.length - 1) {
        log('');
        log('Import failed. Continue with remaining files? (y/N)');
        // In automated environment, we'll continue
        log('Continuing with remaining imports...');
      }
    }
    
    // Progress percentage
    const progress = ((i + 1) / importFiles.length * 100).toFixed(1);
    log(`Progress: ${progress}% complete`);
  }
  
  // Get final record count
  log('');
  const finalCount = getRecordCount(isRemote);
  
  // Summary
  log('');
  log('=== Import Summary ===');
  log(`Total files: ${results.total}`);
  log(`Successful: ${results.success}`);
  log(`Warnings: ${results.warnings}`);
  log(`Failed: ${results.failed}`);
  log(`Total time: ${(results.totalDuration / 1000).toFixed(1)}s`);
  
  if (initialCount !== null && finalCount !== null) {
    const added = finalCount - initialCount;
    log(`Records added: ${added.toLocaleString()}`);
    log(`Total records: ${finalCount.toLocaleString()}`);
  }
  
  log('');
  log(`Log saved to: ${LOG_FILE}`);
  
  logStream.end();
  
  // Exit with error if any imports failed
  process.exit(results.failed > 0 ? 1 : 0);
}

// Handle errors
process.on('uncaughtException', (error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});

// Show help
if (process.argv.includes('--help')) {
  console.log('Usage: node execute-imports.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --remote    Execute against remote D1 database');
  console.log('  --dry-run   Show what would be executed without running');
  console.log('  --help      Show this help message');
  console.log('');
  console.log('This script executes all wells-import-*.sql and rbdms-import-*.sql files');
  console.log('found in sql-imports/ and test-imports/ directories.');
  process.exit(0);
}

// Run
main();