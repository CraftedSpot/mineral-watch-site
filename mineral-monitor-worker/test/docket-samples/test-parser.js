#!/usr/bin/env node

/**
 * Test script for OCC Docket Parser
 *
 * Run with: node test-parser.js
 *
 * Prerequisites:
 * - pdftotext installed (from poppler-utils)
 * - Sample PDFs in same directory
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import parser (use relative path for local testing)
const __dirname = dirname(fileURLToPath(import.meta.url));

// Inline the parser functions for standalone testing
// (In production, import from ../../src/services/docketParser.js)

// ============ Normalization Functions ============

function normalizeTownship(raw) {
  if (!raw) return null;
  const str = raw.toString().trim().toUpperCase();
  const match = str.match(/^0*(\d{1,2})\s*(N|S|NORTH|SOUTH)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2].charAt(0).toUpperCase();
    return `${num}${dir}`;
  }
  return null;
}

function normalizeRange(raw) {
  if (!raw) return null;
  const str = raw.toString().trim().toUpperCase();
  const match = str.match(/^0*(\d{1,2})\s*(E|W|EAST|WEST)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    const dir = match[2].charAt(0).toUpperCase();
    return `${num}${dir}`;
  }
  return null;
}

function normalizeSection(raw) {
  if (!raw) return null;
  const str = raw.toString().trim();
  const match = str.match(/^(?:S(?:EC(?:TION)?)?\.?\s*)?0*(\d{1,2})$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 36) {
      return num.toString();
    }
  }
  return null;
}

function normalizeCounty(raw) {
  if (!raw) return null;
  const str = raw.toString().trim();
  const clean = str.replace(/\s*\(\*\).*$/, '').replace(/\*$/, '').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function parseLegalDescription(legalStr) {
  if (!legalStr) return null;
  const match = legalStr.match(/S(\d{1,2})\s+T(\d{1,2}[NS])\s+R(\d{1,2}[EW])\s+([A-Za-z]+)/i);
  if (match) {
    return {
      section: normalizeSection(match[1]),
      township: normalizeTownship(match[2]),
      range: normalizeRange(match[3]),
      county: normalizeCounty(match[4]),
      meridian: 'IM'
    };
  }
  return null;
}

function categorizeReliefType(reliefType, reliefSought) {
  if (!reliefType) return 'OTHER';
  const text = `${reliefType} ${reliefSought || ''}`.toUpperCase();

  if (text.includes('INCREASED') && text.includes('DENSITY')) return 'INCREASED_DENSITY';
  if (text.includes('POOLING')) return 'POOLING';
  if (text.includes('SPACING') || text.includes('DRILLING AND SPACING UNIT')) return 'SPACING';
  if (text.includes('LOCATION EXCEPTION')) return 'LOCATION_EXCEPTION';
  if (text.includes('MULTI-UNIT') || text.includes('MULTIUNIT') || text.includes('HORIZONTAL')) return 'HORIZONTAL_WELL';
  if (text.includes('OPERATOR') && (text.includes('CHANGE') || text.includes('TRANSFER'))) return 'OPERATOR_CHANGE';
  if (text.includes('TRANSFER')) return 'WELL_TRANSFER';
  if (text.includes('PRIOR ORDER') || text.includes('CLARIFY') || text.includes('MODIFY')) return 'ORDER_MODIFICATION';
  if (text.includes('FINE') || text.includes('PLUG') || text.includes('CONTEMPT') ||
      text.includes('POLLUTION') || text.includes('UIC') || text.includes('DISPOSAL')) return 'ENFORCEMENT';
  return 'OTHER';
}

function parseResultStatus(resultText) {
  if (!resultText) return 'UNKNOWN';
  const text = resultText.toUpperCase();

  if (text.startsWith('C -') || text.startsWith('C-')) return 'CONTINUED';
  if (text.includes('DIS') || text.includes('DISMISSED')) return 'DISMISSED';
  if (text.includes('DMOA')) return 'DISMISSED';
  if (text.includes('MOR') || text.includes('MOTION RECOMMENDED')) return 'RECOMMENDED';
  if (text.includes('RO') || text.includes('RECORD OPENED')) return 'HEARD';
  if (text.includes('MOW') || text.includes('MOTION WITHDRAWN')) return 'WITHDRAWN';
  if (text.includes('TUA') || text.includes('TAKEN UNDER ADVISEMENT')) return 'UNDER_ADVISEMENT';
  if (text.includes('APPROVED') || text.includes('GRANTED')) return 'APPROVED';
  if (text.includes('DENIED')) return 'DENIED';
  return 'SCHEDULED';
}

function extractContinuationDate(resultText) {
  if (!resultText) return null;
  const match = resultText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const month = match[1].padStart(2, '0');
    const day = match[2].padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
  }
  return null;
}

function validateEntry(entry) {
  const errors = [];
  if (!entry.case_number?.match(/^CD\d{4}-\d{6}$/)) {
    errors.push(`Invalid case number format: ${entry.case_number}`);
  }
  if (entry.section) {
    const secNum = parseInt(entry.section, 10);
    if (secNum < 1 || secNum > 36) {
      errors.push(`Section out of range: ${entry.section}`);
    }
  }
  if (entry.township && !entry.township.match(/^\d{1,2}[NS]$/)) {
    errors.push(`Invalid township: ${entry.township}`);
  }
  if (entry.range && !entry.range.match(/^\d{1,2}[EW]$/)) {
    errors.push(`Invalid range: ${entry.range}`);
  }
  return { valid: errors.length === 0, errors };
}

// ============ Parser Functions ============

function parseEntryBlock(caseNumber, blockText) {
  const judgeMatch = blockText.match(/Judge:\s*([^\n]+)/i);
  const judge = judgeMatch ? judgeMatch[1].trim() : null;

  const partiesMatch = blockText.match(/Parties:\s*([^\n]+(?:\n(?!Legal:|Attorney:|Courtroom:|Text:)[^\n]+)*)/i);
  let applicant = null;
  if (partiesMatch) {
    const partiesText = partiesMatch[1].replace(/\n/g, ' ').trim();
    const applicantMatch = partiesText.match(/([^|]+)\s*\(Applicant\)/i);
    applicant = applicantMatch ? applicantMatch[1].trim() : partiesText.split('|')[0].trim();
  }

  const legalMatch = blockText.match(/Legal:\s*([^\n]+)/i);
  const legalStr = legalMatch ? legalMatch[1].trim() : null;
  const legal = parseLegalDescription(legalStr);

  const attorneyMatch = blockText.match(/Attorney:\s*([^\n]+)/i);
  const attorney = attorneyMatch ? attorneyMatch[1].trim() : null;

  const dateMatch = blockText.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  let hearingDate = null;
  let hearingTime = null;
  if (dateMatch) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthIndex = monthNames.findIndex(m => m.toLowerCase() === dateMatch[2].toLowerCase());
    if (monthIndex >= 0) {
      const month = (monthIndex + 1).toString().padStart(2, '0');
      const day = dateMatch[3].padStart(2, '0');
      hearingDate = `${dateMatch[4]}-${month}-${day}`;
      hearingTime = dateMatch[5];
    }
  }

  const reliefMatch = blockText.match(/Relief Type:\s*([^R\n]+?)(?:\s*Relief Sought:\s*([^R\n]*?))?(?:\s*Result:|$)/i);
  let reliefType = null;
  let reliefSought = null;
  if (reliefMatch) {
    reliefType = reliefMatch[1].trim();
    reliefSought = reliefMatch[2]?.trim() || null;
  }

  const resultMatch = blockText.match(/Result:\s*([^\n]+)/i);
  const resultText = resultMatch ? resultMatch[1].trim() : null;
  const status = parseResultStatus(resultText);
  const continuationDate = extractContinuationDate(resultText);

  const entry = {
    case_number: caseNumber,
    relief_type: categorizeReliefType(reliefType, reliefSought),
    relief_type_raw: reliefType,
    relief_sought: reliefSought,
    applicant: applicant,
    county: legal?.county || null,
    section: legal?.section || null,
    township: legal?.township || null,
    range: legal?.range || null,
    meridian: legal?.meridian || 'IM',
    hearing_date: hearingDate,
    hearing_time: hearingTime,
    status: status,
    continuation_date: continuationDate,
    judge: judge,
    attorney: attorney,
    result_raw: resultText
  };

  const validation = validateEntry(entry);
  entry._valid = validation.valid;
  entry._errors = validation.errors;

  return entry;
}

function parseFromText(text) {
  const entries = [];
  const casePattern = /\n(CD\d{4}-\d{6})\s*\n/g;

  const caseMatches = [];
  let match;
  while ((match = casePattern.exec(text)) !== null) {
    caseMatches.push({
      caseNumber: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  for (let i = 0; i < caseMatches.length; i++) {
    const current = caseMatches[i];
    const nextStart = caseMatches[i + 1]?.startIndex || text.length;
    const blockText = text.substring(current.endIndex, nextStart);

    try {
      const entry = parseEntryBlock(current.caseNumber, blockText);
      if (entry) {
        entries.push(entry);
      }
    } catch (err) {
      console.error(`Error parsing case ${current.caseNumber}:`, err.message);
    }
  }

  return entries;
}

// ============ Test Runner ============

function extractTextFromPdf(pdfPath) {
  try {
    const text = execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return text;
  } catch (err) {
    throw new Error(`Failed to extract text from ${pdfPath}: ${err.message}`);
  }
}

function testPdf(pdfPath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${pdfPath}`);
  console.log('='.repeat(60));

  // Extract text
  const text = extractTextFromPdf(pdfPath);
  console.log(`Extracted ${text.length} characters`);

  // Parse entries
  const entries = parseFromText(text);
  console.log(`Parsed ${entries.length} entries`);

  // Summary by relief type
  const byType = {};
  for (const entry of entries) {
    byType[entry.relief_type] = (byType[entry.relief_type] || 0) + 1;
  }
  console.log('\nBy Relief Type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Validation stats
  const valid = entries.filter(e => e._valid).length;
  const invalid = entries.filter(e => !e._valid).length;
  console.log(`\nValidation: ${valid} valid, ${invalid} invalid`);

  // Show validation errors
  if (invalid > 0) {
    console.log('\nValidation Errors:');
    for (const entry of entries.filter(e => !e._valid)) {
      console.log(`  ${entry.case_number}: ${entry._errors.join(', ')}`);
    }
  }

  // Show sample entries (first 3)
  console.log('\nSample Entries:');
  for (const entry of entries.slice(0, 3)) {
    console.log(`\n  Case: ${entry.case_number}`);
    console.log(`  Type: ${entry.relief_type} (${entry.relief_type_raw})`);
    console.log(`  Applicant: ${entry.applicant}`);
    console.log(`  Legal: S${entry.section} T${entry.township} R${entry.range} ${entry.county}`);
    console.log(`  Date: ${entry.hearing_date} ${entry.hearing_time || ''}`);
    console.log(`  Status: ${entry.status}`);
    if (entry.continuation_date) {
      console.log(`  Continued to: ${entry.continuation_date}`);
    }
  }

  // Filter to relevant entries
  const relevantTypes = ['INCREASED_DENSITY', 'POOLING', 'SPACING', 'LOCATION_EXCEPTION',
                         'HORIZONTAL_WELL', 'OPERATOR_CHANGE', 'WELL_TRANSFER', 'ORDER_MODIFICATION'];
  const relevant = entries.filter(e => relevantTypes.includes(e.relief_type));
  console.log(`\nRelevant for mineral rights: ${relevant.length} of ${entries.length} entries`);

  return { entries, relevant };
}

// Main
function main() {
  console.log('OCC Docket Parser Test');
  console.log('='.repeat(60));

  // Find all PDFs in current directory
  const files = readdirSync(__dirname).filter(f => f.endsWith('.pdf'));

  if (files.length === 0) {
    console.log('No PDF files found in', __dirname);
    console.log('Download samples with:');
    console.log('  curl -o docket-2026-01-09-okc.pdf "https://oklahoma.gov/content/dam/ok/en/occ/documents/ajls/jls-courts/court-clerk/docket-results/2026-01-09-okc.pdf"');
    return;
  }

  let totalEntries = 0;
  let totalRelevant = 0;
  let totalValid = 0;

  for (const file of files) {
    const { entries, relevant } = testPdf(join(__dirname, file));
    totalEntries += entries.length;
    totalRelevant += relevant.length;
    totalValid += entries.filter(e => e._valid).length;
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Files tested: ${files.length}`);
  console.log(`Total entries: ${totalEntries}`);
  console.log(`Valid entries: ${totalValid} (${(totalValid/totalEntries*100).toFixed(1)}%)`);
  console.log(`Relevant for mineral rights: ${totalRelevant} (${(totalRelevant/totalEntries*100).toFixed(1)}%)`);
}

main();
