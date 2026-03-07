import { useState, useEffect, useRef, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { parseFile } from '../../lib/file-parsers';
import { formatDecimal } from '../../lib/helpers';
import { apiFetch } from '../../api/client';
import { bulkValidateWells, bulkUploadWells } from '../../api/bulk-wells';
import type { WellValidationResponse, WellValidationResult, WellSearchMatch } from '../../api/bulk-wells';
import { TEAL, BORDER, SLATE, DARK, BG_MUTED, WELL_STATUS_COLORS } from '../../lib/constants';

type ImportStep = 'upload' | 'validating' | 'preview' | 'importing' | 'results';

interface Props {
  onClose: () => void;
  onComplete?: () => void;
  onFooterChange: (footer: React.ReactNode) => void;
  onStepChange?: (step: ImportStep) => void;
}

interface ImportResults {
  successful: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface SkippedWell {
  original: Record<string, unknown>;
  reason: string;
}

const BATCH_SIZE = 25; // Match vanilla — reduced from 50 to avoid timeouts
const BATCH_THRESHOLD = 200; // Files > 200 rows use batched validation

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    AC: 'Active', PA: 'Plugged', IN: 'Inactive',
    SI: 'Shut-In', TA: 'Temp Abandon', NEW: 'New', NR: 'No Report',
  };
  return map[s] || s || 'Unknown';
}

export function BulkWellImport({ onClose, onComplete, onFooterChange, onStepChange }: Props) {
  const [step, setStep] = useState<ImportStep>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  // Upload step
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);

  // Validating step (batch progress)
  const [validateProgress, setValidateProgress] = useState(0);
  const [validateStatus, setValidateStatus] = useState('');

  // Preview step
  const [validationData, setValidationData] = useState<WellValidationResponse | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Import step
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  // Results step
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [skippedWells, setSkippedWells] = useState<SkippedWell[]>([]);

  useEffect(() => {
    // Map 'validating' to 'upload' for parent (controls tab locking)
    onStepChange?.(step === 'validating' ? 'upload' : step);
  }, [step, onStepChange]);

  // --- Compute importable count ---
  const getImportableCount = useCallback(() => {
    if (!validationData) return 0;
    let count = 0;
    validationData.results.forEach((r, i) => {
      if (r.isDuplicate || !r.isValid) return;
      if (r.matchStatus === 'has_api' || r.matchStatus === 'exact') count++;
      else if (r.matchStatus === 'ambiguous' && selections[i] && selections[i] !== 'SKIP') count++;
    });
    return count;
  }, [validationData, selections]);

  // --- Batched validation (matches vanilla pattern) ---
  const validateWells = useCallback(async (rows: Record<string, unknown>[]) => {
    cancelRef.current = false;
    const totalRows = rows.length;

    if (totalRows <= BATCH_THRESHOLD) {
      // Small file — single request
      return bulkValidateWells(rows);
    }

    // Large file — batch in groups of BATCH_SIZE with progress
    setStep('validating');
    setValidateProgress(0);
    setValidateStatus(`Processing ${totalRows} wells in batches...`);

    const merged: WellValidationResponse = {
      results: [],
      summary: { total: 0, exactMatches: 0, needsReview: 0, notFound: 0, hasApi: 0, duplicates: 0, willImport: 0, canImport: false },
      planCheck: { current: 0, limit: 0, plan: '', afterUpload: 0, wouldExceedLimit: false },
    };

    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      if (cancelRef.current) throw new Error('Validation cancelled');

      const batch = rows.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      setValidateProgress(Math.round((i / totalRows) * 100));
      setValidateStatus(`Processing batch ${batchNum}/${totalBatches}...`);

      const batchResult = await bulkValidateWells(batch);

      // Merge results
      merged.results = merged.results.concat(batchResult.results);
      merged.summary.total += batchResult.summary.total;
      merged.summary.exactMatches += batchResult.summary.exactMatches;
      merged.summary.needsReview += batchResult.summary.needsReview;
      merged.summary.notFound += batchResult.summary.notFound;
      merged.summary.hasApi += batchResult.summary.hasApi;
      merged.summary.duplicates += batchResult.summary.duplicates;
      merged.summary.willImport += batchResult.summary.willImport;
      // Use last batch's plan check (most accurate)
      merged.planCheck = batchResult.planCheck;

      // Pause between batches to avoid rate limiting
      if (i + BATCH_SIZE < totalRows) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    merged.summary.canImport = merged.summary.willImport > 0 && !merged.planCheck.wouldExceedLimit;
    setValidateProgress(100);
    return merged;
  }, []);

  // --- File handling ---
  const handleFile = useCallback(async (file: File) => {
    setParseError('');
    setFileName(file.name);
    setFileSize(file.size);
    try {
      const result = await parseFile(file);
      if (result.data.length === 0) throw new Error('No data found in file');

      // For small files, show spinner inline. For large files, validateWells switches to 'validating' step.
      if (result.data.length <= BATCH_THRESHOLD) {
        setStep('validating');
        setValidateStatus(`Validating ${result.data.length} wells...`);
        setValidateProgress(0);
      }

      const validation = await validateWells(result.data);
      setValidationData(validation);
      setSelections({});
      setExpandedRow(null);
      setStep('preview');
    } catch (err) {
      if ((err as Error).message === 'Validation cancelled') {
        setStep('upload');
        return;
      }
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
      setStep('upload');
    }
  }, [validateWells]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStartOver = useCallback(() => {
    cancelRef.current = true;
    setStep('upload');
    setFileName('');
    setFileSize(0);
    setParseError('');
    setValidationData(null);
    setSelections({});
    setExpandedRow(null);
    setImportResults(null);
    setSkippedWells([]);
    setUploadProgress(0);
    setUploadStatus('');
    setValidateProgress(0);
    setValidateStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // --- Import with simulated progress (matches vanilla) ---
  const startImport = useCallback(async () => {
    if (!validationData) return;
    setStep('importing');
    setUploadProgress(0);

    const importable = getImportableCount();
    setUploadStatus(`Validating ${importable} wells...`);

    // Collect skipped wells for download
    const skipped: SkippedWell[] = [];
    validationData.results.forEach((r, index) => {
      if (r.matchStatus === 'not_found') {
        skipped.push({ original: r.original, reason: 'Not Found' });
      } else if (r.isDuplicate) {
        skipped.push({ original: r.original, reason: 'Duplicate' });
      } else if (r.matchStatus === 'ambiguous') {
        const sel = selections[index];
        if (!sel || sel === 'SKIP') {
          skipped.push({ original: r.original, reason: 'Skipped (No Match Selected)' });
        }
      } else if (r.errors && r.errors.length > 0) {
        skipped.push({ original: r.original, reason: r.errors[0] });
      }
    });
    setSkippedWells(skipped);

    // Simulated progress animation (matches vanilla: 30/60/90 thresholds)
    let simulated = 0;
    const progressInterval = setInterval(() => {
      simulated = Math.min(simulated + Math.random() * 15, 90);
      setUploadProgress(Math.round(simulated));
      if (simulated < 30) {
        setUploadStatus(`Validating ${importable} wells...`);
      } else if (simulated < 60) {
        setUploadStatus('Fetching well data from OCC...');
      } else {
        setUploadStatus('Creating well records...');
      }
    }, 500);

    try {
      const result = await bulkUploadWells(validationData.results, selections);
      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadStatus('Processing complete!');

      // Brief delay to show completion
      await new Promise(resolve => setTimeout(resolve, 500));

      setImportResults({
        successful: result.results.successful,
        failed: result.results.failed,
        skipped: result.results.skipped,
        errors: result.results.errors || [],
      });
      setStep('results');

      // Auto-relink documents after wells import (matches vanilla)
      if (result.results.successful > 0) {
        try {
          await apiFetch<{ linked: number }>('/api/documents/relink', { method: 'POST' });
        } catch {
          // Non-fatal — don't show error to user
        }
      }
    } catch (err) {
      clearInterval(progressInterval);
      setImportResults({
        successful: 0,
        failed: importable,
        skipped: 0,
        errors: [err instanceof Error ? err.message : 'Upload failed'],
      });
      setStep('results');
    }
  }, [validationData, selections, getImportableCount]);

  const handleDone = useCallback(() => {
    onComplete?.();
    onClose();
  }, [onComplete, onClose]);

  // --- Selection handling ---
  const handleSelect = useCallback((rowIndex: number, apiNumber: string) => {
    setSelections(prev => ({ ...prev, [rowIndex]: apiNumber }));
    setExpandedRow(null);
  }, []);

  const handleSkip = useCallback((rowIndex: number) => {
    setSelections(prev => ({ ...prev, [rowIndex]: 'SKIP' }));
    setExpandedRow(null);
  }, []);

  // --- Select All Best Matches (matches vanilla's selectAllExactMatches) ---
  const selectAllBestMatches = useCallback(() => {
    if (!validationData) return;
    const newSelections = { ...selections };
    validationData.results.forEach((r, i) => {
      if (r.matchStatus === 'ambiguous' && r.searchResults && r.searchResults.matches.length > 0 && !newSelections[i]) {
        newSelections[i] = r.searchResults.matches[0].api_number;
      }
    });
    setSelections(newSelections);
  }, [validationData, selections]);

  // --- Download Skipped Wells CSV (matches vanilla's downloadSkippedWells) ---
  const downloadSkippedCSV = useCallback(() => {
    if (skippedWells.length === 0) return;
    const allKeys = new Set<string>();
    skippedWells.forEach(item => Object.keys(item.original).forEach(k => allKeys.add(k)));
    const headers = ['Skip_Reason', ...Array.from(allKeys)];

    const csvRows = [headers.join(',')];
    skippedWells.forEach(item => {
      const row = headers.map(h => {
        const val = h === 'Skip_Reason' ? item.reason : (item.original[h] || '');
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skipped-wells.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [skippedWells]);

  // --- Footer delegation ---
  useEffect(() => {
    if (step === 'upload') {
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        </div>,
      );
    } else if (step === 'validating') {
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={handleStartOver} style={ghostBtnStyle}>Cancel</button>
        </div>,
      );
    } else if (step === 'preview') {
      const importable = getImportableCount();
      const unresolvedCount = validationData
        ? validationData.results.filter((r, i) => r.needsSelection && !selections[i]).length
        : 0;
      const canImport = validationData && !validationData.planCheck.wouldExceedLimit && importable > 0;
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button onClick={handleStartOver} style={ghostBtnStyle}>Start Over</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {unresolvedCount > 0 && (
              <span style={{ fontSize: 12, color: '#d97706' }}>
                {unresolvedCount} need{unresolvedCount === 1 ? 's' : ''} selection
              </span>
            )}
            <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
            <button
              onClick={startImport}
              disabled={!canImport}
              style={{
                ...primaryBtnStyle,
                opacity: canImport ? 1 : 0.5,
                cursor: canImport ? 'pointer' : 'not-allowed',
              }}
            >
              {importable > 0
                ? `Import ${importable} Well${importable === 1 ? '' : 's'}`
                : 'No wells to import'}
            </button>
          </div>
        </div>,
      );
    } else if (step === 'importing') {
      onFooterChange(null);
    } else if (step === 'results') {
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={handleDone} style={primaryBtnStyle}>Done</button>
        </div>,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, validationData, selections]);

  // Check if there are unresolved ambiguous wells for the quick-action button
  const hasUnresolved = validationData
    ? validationData.results.some((r, i) => r.needsSelection && !selections[i])
    : false;

  return (
    <div style={{ minHeight: 300 }}>
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div style={{ padding: '16px 20px' }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? TEAL : BORDER}`,
              borderRadius: 12,
              padding: '40px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? '#f0fdfa' : '#fafbfc',
              transition: 'all 0.15s',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt,.tsv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              style={{ display: 'none' }}
            />
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={SLATE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div style={{ fontWeight: 600, color: DARK, fontSize: 15, marginBottom: 4 }}>
              Drop a file here, or click to browse
            </div>
            <div style={{ fontSize: 13, color: SLATE }}>
              Supports CSV and Excel (.xlsx) files
            </div>
          </div>

          {fileName && !parseError && (
            <div style={{ marginTop: 12, fontSize: 13, color: SLATE }}>
              {fileName} ({(fileSize / 1024).toFixed(1)} KB)
            </div>
          )}

          {parseError && (
            <div style={{
              marginTop: 12, background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#991b1b',
            }}>
              {parseError}
            </div>
          )}

          {/* Column guide */}
          <div style={{
            marginTop: 16, padding: '12px 14px', background: BG_MUTED,
            borderRadius: 8, fontSize: 12, color: SLATE,
          }}>
            <div style={{ fontWeight: 700, color: DARK, marginBottom: 6 }}>Supported columns:</div>
            <div style={{ lineHeight: 1.8 }}>
              <span style={{ fontWeight: 600 }}>Required:</span> API Number (or Well Name for search)<br />
              <span style={{ fontWeight: 600 }}>Optional:</span> Well Name, Operator, RI NRI, WI NRI, ORRI NRI,
              Net Mineral Acres, Unit Acres, Lease Royalty Rate, Tract Participation, Well Code, PUN, Notes
            </div>
          </div>
        </div>
      )}

      {/* Step 1b: Validating (batch progress) */}
      {step === 'validating' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spinner size={32} color={TEAL} />
          <div style={{ fontWeight: 600, color: DARK, fontSize: 15, marginTop: 16, marginBottom: 8 }}>
            {validateStatus}
          </div>
          <div style={{ fontSize: 12, color: SLATE, marginBottom: 12 }}>
            Matching wells against statewide database
          </div>
          <div style={{
            background: '#e5e7eb', borderRadius: 8, height: 12, overflow: 'hidden',
            width: '80%', margin: '0 auto',
          }}>
            <div style={{
              background: TEAL, height: '100%',
              width: `${validateProgress}%`,
              transition: 'width 0.3s ease',
              borderRadius: 8,
            }} />
          </div>
          <div style={{ fontSize: 13, color: SLATE, marginTop: 8 }}>
            {validateProgress}%
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && validationData && (
        <div>
          <div style={{ padding: '16px 20px 0' }}>
            {/* Summary badges */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {validationData.summary.hasApi > 0 && (
                <SummaryBadge bg="#dcfce7" color="#166534" count={validationData.summary.hasApi} label="API Matched" />
              )}
              {validationData.summary.exactMatches > 0 && (
                <SummaryBadge bg="#dbeafe" color="#1e40af" count={validationData.summary.exactMatches} label="Search Matched" />
              )}
              {validationData.summary.needsReview > 0 && (
                <SummaryBadge bg="#fef3c7" color="#92400e" count={validationData.summary.needsReview} label="Needs Review" />
              )}
              {validationData.summary.notFound > 0 && (
                <SummaryBadge bg="#fee2e2" color="#991b1b" count={validationData.summary.notFound} label="Not Found" />
              )}
              {validationData.summary.duplicates > 0 && (
                <SummaryBadge bg="#f3f4f6" color="#374151" count={validationData.summary.duplicates} label="Duplicates" />
              )}
            </div>

            {/* Quick actions for ambiguous wells */}
            {hasUnresolved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <button
                  onClick={selectAllBestMatches}
                  style={{
                    background: '#eff6ff', border: `1px solid #93c5fd`, borderRadius: 6,
                    padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#1e40af',
                    cursor: 'pointer',
                    fontFamily: "'Inter', 'DM Sans', sans-serif",
                  }}
                >
                  Select All Best Matches
                </button>
                <span style={{ fontSize: 11, color: SLATE }}>Review selections before importing</span>
              </div>
            )}

            {/* Plan limit check */}
            <PlanCheckBar planCheck={validationData.planCheck} willImport={getImportableCount()} />
          </div>

          {/* Preview rows */}
          <div style={{ maxHeight: 420, overflowY: 'auto', margin: '0 20px 16px' }}>
            {validationData.results.map((r, i) => (
              <WellPreviewRow
                key={i}
                result={r}
                index={i}
                selection={selections[i]}
                isExpanded={expandedRow === i}
                onToggle={() => setExpandedRow(expandedRow === i ? null : i)}
                onSelect={handleSelect}
                onSkip={handleSkip}
              />
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Importing */}
      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spinner size={32} color={TEAL} />
          <div style={{ fontWeight: 600, color: DARK, fontSize: 15, marginTop: 16, marginBottom: 8 }}>
            {uploadStatus}
          </div>
          <div style={{
            background: '#e5e7eb', borderRadius: 8, height: 12, overflow: 'hidden',
            width: '80%', margin: '0 auto',
          }}>
            <div style={{
              background: TEAL, height: '100%',
              width: `${uploadProgress}%`,
              transition: 'width 0.3s ease',
              borderRadius: 8,
            }} />
          </div>
          <div style={{ fontSize: 13, color: SLATE, marginTop: 8 }}>
            {uploadProgress}%
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 'results' && importResults && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>
            {importResults.failed === 0 ? '\u2705' : '\u26A0\uFE0F'}
          </div>
          <div style={{ fontWeight: 700, color: DARK, fontSize: 18, marginBottom: 4 }}>
            {importResults.failed === 0 ? 'Import Complete!' : 'Import Completed with Errors'}
          </div>
          <div style={{ fontSize: 13, color: SLATE, marginBottom: 24 }}>
            {importResults.errors.length > 0 && importResults.successful === 0
              ? importResults.errors[0]
              : 'Wells are now being auto-matched to your properties.'}
          </div>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <StatBox bg="#dcfce7" color="#166534" value={importResults.successful} label="Created" />
            <StatBox bg="#f3f4f6" color="#374151" value={importResults.skipped} label="Skipped" />
            <StatBox bg="#fee2e2" color="#991b1b" value={importResults.failed} label="Failed" />
          </div>

          {/* Download Skipped Wells CSV */}
          {skippedWells.length > 0 && (
            <button
              onClick={downloadSkippedCSV}
              style={{
                marginTop: 20, background: 'none', border: `1px solid ${BORDER}`,
                borderRadius: 6, padding: '8px 16px', fontSize: 13, color: TEAL,
                cursor: 'pointer', fontWeight: 600,
                fontFamily: "'Inter', 'DM Sans', sans-serif",
              }}
            >
              Download {skippedWells.length} Skipped Wells (CSV)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- WellPreviewRow ---

function WellPreviewRow({
  result: r,
  index,
  selection,
  isExpanded,
  onToggle,
  onSelect,
  onSkip,
}: {
  result: WellValidationResult;
  index: number;
  selection?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (index: number, api: string) => void;
  onSkip: (index: number) => void;
}) {
  const { matchStatus, normalized: n, isDuplicate, errors, warnings, searchResults } = r;

  // Status badge
  let statusBg = '#dcfce7';
  let statusColor = '#166534';
  let statusText = 'Ready';

  if (isDuplicate) {
    statusBg = '#f3f4f6'; statusColor = '#6b7280'; statusText = 'Duplicate';
  } else if (errors.length > 0) {
    statusBg = '#fee2e2'; statusColor = '#991b1b'; statusText = 'Error';
  } else if (matchStatus === 'ambiguous') {
    if (selection === 'SKIP') {
      statusBg = '#f3f4f6'; statusColor = '#6b7280'; statusText = 'Skipped';
    } else if (selection) {
      statusBg = '#dbeafe'; statusColor = '#1e40af'; statusText = 'Selected';
    } else {
      statusBg = '#fef3c7'; statusColor = '#92400e'; statusText = 'Review';
    }
  } else if (matchStatus === 'not_found') {
    statusBg = '#fee2e2'; statusColor = '#991b1b'; statusText = 'Not Found';
  } else if (matchStatus === 'exact') {
    statusBg = '#dbeafe'; statusColor = '#1e40af'; statusText = 'Matched';
  }

  // Display name
  const displayName = n?.csvWellName || n?.wellName || '(no name)';
  const displayApi = n?.apiNumber || '';

  // Interest columns from original CSV
  const orig = r.original || {};
  const riNri = findInterest(orig, ['RI NRI', 'ri_nri', 'NRI', 'nri', 'Decimal', 'decimal', 'Decimal Interest', 'RI Decimal']);
  const wiNri = findInterest(orig, ['WI NRI', 'wi_nri', 'WI', 'wi', 'Working Interest']);
  const orriNri = findInterest(orig, ['ORRI NRI', 'orri_nri', 'ORRI', 'orri', 'Override']);

  const hasInterest = riNri != null || wiNri != null || orriNri != null;

  return (
    <div style={{
      border: `1px solid ${isExpanded ? TEAL : BORDER}`,
      borderRadius: 8, marginBottom: 6,
      background: isDuplicate || matchStatus === 'not_found' ? '#fafafa' : '#fff',
      transition: 'border-color 0.15s',
    }}>
      {/* Main row */}
      <div
        onClick={r.needsSelection ? onToggle : undefined}
        style={{
          display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 8,
          cursor: r.needsSelection ? 'pointer' : 'default',
        }}
      >
        <span style={{
          fontSize: 11, color: SLATE, fontWeight: 600, minWidth: 28, textAlign: 'right',
        }}>
          {r.row}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: DARK, fontSize: 13 }}>{displayName}</span>
            {displayApi && (
              <span style={{ fontSize: 12, color: SLATE, fontFamily: "'SF Mono', monospace" }}>
                {displayApi}
              </span>
            )}
            {n?.punResolved && (
              <span style={{ fontSize: 11, color: '#7c3aed', background: '#f5f3ff', padding: '1px 6px', borderRadius: 4 }}>
                PUN {n.punResolved}
              </span>
            )}
          </div>
          {hasInterest && (
            <div style={{ fontSize: 11, color: '#059669', marginTop: 1 }}>
              {riNri != null && <span style={{ fontFamily: "'SF Mono', monospace" }}>NRI {formatDecimal(riNri)}</span>}
              {wiNri != null && <span style={{ color: '#94a3b8', marginLeft: 6, fontFamily: "'SF Mono', monospace" }}>WI {formatDecimal(wiNri)}</span>}
              {orriNri != null && <span style={{ color: '#94a3b8', marginLeft: 6, fontFamily: "'SF Mono', monospace" }}>ORRI {formatDecimal(orriNri)}</span>}
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>
              {warnings[0]}
            </div>
          )}
          {errors.length > 0 && (
            <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>
              {errors[0]}
            </div>
          )}
        </div>

        <span style={{
          fontSize: 11, fontWeight: 700, color: statusColor,
          background: statusBg, padding: '3px 8px', borderRadius: 4,
          whiteSpace: 'nowrap',
        }}>
          {statusText}
        </span>

        {r.needsSelection && (
          <span style={{ fontSize: 14, color: SLATE, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            &#9662;
          </span>
        )}
      </div>

      {/* Expanded: match selection */}
      {isExpanded && searchResults && searchResults.matches.length > 0 && (
        <div style={{
          borderTop: `1px solid ${BORDER}`, padding: '8px 12px 10px',
          background: BG_MUTED,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: SLATE, marginBottom: 6 }}>
            Select the correct well:
          </div>
          {searchResults.matches.map((m: WellSearchMatch) => {
            const isSelected = selection === m.api_number;
            const sColor = WELL_STATUS_COLORS[m.well_status] || '#6b7280';
            const location = m.section && m.township && m.range
              ? `S${m.section}-${m.township}-${m.range}` : '';
            return (
              <button
                key={m.api_number}
                onClick={() => onSelect(index, m.api_number)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: isSelected ? '#eff6ff' : '#fff',
                  border: `1px solid ${isSelected ? '#3b82f6' : BORDER}`,
                  borderRadius: 6, padding: '6px 10px', marginBottom: 4,
                  cursor: 'pointer', fontFamily: "'Inter', 'DM Sans', sans-serif",
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 12, color: DARK }}>{m.well_name || 'Unnamed'}</strong>
                    <span style={{ fontSize: 11, color: SLATE, marginLeft: 6, fontFamily: "'SF Mono', monospace" }}>
                      {m.api_number}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: sColor,
                    background: `${sColor}18`, padding: '2px 6px', borderRadius: 3,
                  }}>
                    {statusLabel(m.well_status)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                  {location && <span>{location}</span>}
                  {location && m.county && <span> &middot; </span>}
                  {m.county && <span>{m.county}</span>}
                  {m.operator && <span> &middot; {m.operator}</span>}
                </div>
              </button>
            );
          })}
          <button
            onClick={() => onSkip(index)}
            style={{
              display: 'block', width: '100%', textAlign: 'center',
              background: selection === 'SKIP' ? '#f1f5f9' : 'none',
              border: `1px solid ${selection === 'SKIP' ? '#94a3b8' : BORDER}`,
              borderRadius: 6, padding: '5px 10px', marginTop: 4,
              cursor: 'pointer', fontSize: 11, color: SLATE, fontWeight: 600,
              fontFamily: "'Inter', 'DM Sans', sans-serif",
            }}
          >
            Skip this well
          </button>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function findInterest(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = parseFloat(String(v));
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

// --- Sub-components ---

function SummaryBadge({ bg, color, count, label }: { bg: string; color: string; count: number; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color, fontSize: 13, fontWeight: 600,
      padding: '4px 10px', borderRadius: 20,
    }}>
      {count} {label}
    </span>
  );
}

function PlanCheckBar({ planCheck, willImport }: { planCheck: WellValidationResponse['planCheck']; willImport: number }) {
  const exceeded = planCheck.wouldExceedLimit;
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8, marginBottom: 16,
      background: exceeded ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${exceeded ? '#fca5a5' : '#86efac'}`,
    }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: exceeded ? '#991b1b' : '#166534' }}>
        {exceeded ? 'Would Exceed Plan Limit' : 'Within Plan Limit'}
      </div>
      <div style={{ fontSize: 12, color: exceeded ? '#dc2626' : '#4ade80', marginTop: 2 }}>
        Current: {planCheck.current} &middot; Adding: {willImport} &middot; Total: {planCheck.current + willImport} of {planCheck.limit} ({planCheck.plan} plan)
      </div>
    </div>
  );
}

function StatBox({ bg, color, value, label }: { bg: string; color: string; value: number; label: string }) {
  return (
    <div style={{
      background: bg, borderRadius: 10, padding: '16px 24px',
      minWidth: 90, textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// --- Styles ---

const ghostBtnStyle: React.CSSProperties = {
  background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: SLATE,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  background: TEAL, color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};
