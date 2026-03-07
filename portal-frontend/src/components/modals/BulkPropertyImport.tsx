import { useState, useEffect, useRef, useCallback } from 'react';
import { Spinner } from '../ui/Spinner';
import { parseFile } from '../../lib/file-parsers';
import { bulkValidateProperties, bulkUploadProperties } from '../../api/properties';
import type { BulkValidationResponse } from '../../api/properties';
import { ORANGE, BORDER, SLATE, DARK, BG_MUTED } from '../../lib/constants';

type ImportStep = 'upload' | 'preview' | 'importing' | 'results';

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
  errors: Array<{ index: number; error: string }>;
}

export function BulkPropertyImport({ onClose, onComplete, onFooterChange, onStepChange }: Props) {
  const [step, setStep] = useState<ImportStep>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload step
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [validating, setValidating] = useState(false);

  // Preview step
  const [validationData, setValidationData] = useState<BulkValidationResponse | null>(null);

  // Import step
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  // Results step
  const [importResults, setImportResults] = useState<ImportResults | null>(null);

  // Notify parent of step changes
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

  // --- File handling ---

  const handleFile = useCallback(async (file: File) => {
    setParseError('');
    setFileName(file.name);
    setFileSize(file.size);
    setValidating(true);
    try {
      const result = await parseFile(file);
      if (result.data.length === 0) throw new Error('No data found in file');
      const validation = await bulkValidateProperties(result.data);
      setValidationData(validation);
      setStep('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setValidating(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleStartOver = useCallback(() => {
    setStep('upload');
    setFileName('');
    setFileSize(0);
    setParseError('');
    setValidationData(null);
    setImportResults(null);
    setUploadProgress(0);
    setUploadStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // --- Import (chunked for large files) ---

  const CHUNK_SIZE = 2000;

  const startImport = useCallback(async () => {
    if (!validationData) return;
    setStep('importing');
    setUploadProgress(0);
    setUploadStatus('Preparing...');

    const toImport = validationData.results
      .filter(r => r.isValid && !r.isDuplicate && r.normalized !== null)
      .map(r => r.normalized!);

    const totalChunks = Math.ceil(toImport.length / CHUNK_SIZE);
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    const allErrors: Array<{ index: number; error: string }> = [];

    try {
      for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
        const chunk = toImport.slice(i, i + CHUNK_SIZE);
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;

        if (totalChunks > 1) {
          setUploadStatus(`Importing batch ${chunkNum} of ${totalChunks} (${Math.min(i + CHUNK_SIZE, toImport.length).toLocaleString()} of ${toImport.length.toLocaleString()})...`);
        } else {
          setUploadStatus(`Importing ${toImport.length.toLocaleString()} properties...`);
        }
        setUploadProgress(Math.round((i / toImport.length) * 100));

        const result = await bulkUploadProperties(chunk);
        successful += result.results.successful;
        failed += result.results.failed;
        skipped += result.results.skipped || 0;
        if (result.results.errors) allErrors.push(...result.results.errors);

        // Brief delay between chunks to let auto-matching breathe
        if (i + CHUNK_SIZE < toImport.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (err) {
      // Network/server error — count remaining rows as failed
      const processed = successful + failed + skipped;
      failed += toImport.length - processed;
      allErrors.push({ index: processed, error: err instanceof Error ? err.message : 'Upload failed' });
    }

    setUploadProgress(100);
    setImportResults({
      successful,
      failed,
      skipped: validationData.summary.duplicates + skipped,
      errors: allErrors,
    });
    setStep('results');
  }, [validationData]);

  const handleDone = useCallback(() => {
    onComplete?.();
    onClose();
  }, [onComplete, onClose]);

  // --- Footer delegation ---

  useEffect(() => {
    if (step === 'upload') {
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        </div>
      );
    } else if (step === 'preview') {
      const canImport = validationData && !validationData.planCheck.wouldExceedLimit && validationData.summary.willImport > 0;
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button onClick={handleStartOver} style={ghostBtnStyle}>Start Over</button>
          <div style={{ display: 'flex', gap: 8 }}>
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
              {validationData && validationData.summary.willImport > 0
                ? `Import ${validationData.summary.willImport} Properties`
                : 'No properties to import'}
            </button>
          </div>
        </div>
      );
    } else if (step === 'importing') {
      onFooterChange(null);
    } else if (step === 'results') {
      onFooterChange(
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button onClick={handleDone} style={primaryBtnStyle}>Done</button>
        </div>
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, validationData]);

  // --- Render ---

  return (
    <div style={{ minHeight: 300 }}>
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div style={{ padding: '16px 20px' }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !validating && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? ORANGE : BORDER}`,
              borderRadius: 12,
              padding: '40px 20px',
              textAlign: 'center',
              cursor: validating ? 'default' : 'pointer',
              background: isDragging ? '#FEF3EC' : '#fafbfc',
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
            {validating ? (
              <>
                <Spinner size={32} color={ORANGE} />
                <div style={{ fontWeight: 600, color: DARK, fontSize: 15, marginTop: 12 }}>
                  Validating {fileName}...
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          {fileName && !validating && !parseError && (
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
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && validationData && (
        <div>
          <div style={{ padding: '16px 20px 0' }}>
            {/* Summary badges */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <SummaryBadge bg="#dcfce7" color="#166534" count={validationData.summary.valid} label="Valid" />
              {validationData.summary.invalid > 0 && (
                <SummaryBadge bg="#fee2e2" color="#991b1b" count={validationData.summary.invalid} label="Invalid" />
              )}
              {validationData.summary.duplicates > 0 && (
                <SummaryBadge bg="#f3f4f6" color="#374151" count={validationData.summary.duplicates} label="Duplicates" />
              )}
              {validationData.summary.warnings > 0 && (
                <SummaryBadge bg="#fef3c7" color="#92400e" count={validationData.summary.warnings} label="Warnings" />
              )}
              {validationData.summary.emptyRowsSkipped > 0 && (
                <SummaryBadge bg="#f3f4f6" color="#6b7280" count={validationData.summary.emptyRowsSkipped} label="Empty rows skipped" />
              )}
            </div>

            {/* Plan limit check */}
            <PlanCheckBar planCheck={validationData.planCheck} willImport={validationData.summary.willImport} />
          </div>

          {/* Preview table */}
          {(() => {
            // Detect which optional columns have data to avoid empty columns
            const results = validationData.results;
            const hasAcres = results.some((r) => {
              const n = r.normalized as Record<string, unknown> | null;
              return n && (Number(n['RI Acres']) > 0 || Number(n['WI Acres']) > 0 || Number(n.total_acres) > 0);
            });
            const hasRiDecimal = results.some((r) => {
              const n = r.normalized as Record<string, unknown> | null;
              return n && n.ri_decimal != null;
            });
            const hasCode = results.some((r) => {
              const n = r.normalized as Record<string, unknown> | null;
              return n && n.property_code;
            });
            return (
              <div style={{ maxHeight: 400, overflowY: 'auto', overflowX: 'auto', margin: '0 20px 16px', border: `1px solid ${BORDER}`, borderRadius: 8, WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: BG_MUTED, position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Section</th>
                      <th style={thStyle}>Township</th>
                      <th style={thStyle}>Range</th>
                      <th style={thStyle}>Meridian</th>
                      <th style={thStyle}>County</th>
                      <th style={thStyle}>Group</th>
                      {hasAcres && <th style={thStyle}>Acres</th>}
                      {hasRiDecimal && <th style={thStyle}>RI Decimal</th>}
                      {hasCode && <th style={thStyle}>Code</th>}
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => {
                      const n = r.normalized as Record<string, unknown> | null;
                      const hasError = r.errors.length > 0;
                      const bg = r.isDuplicate ? '#f9fafb' : hasError ? '#fef2f2' : '#fff';
                      const statusColor = r.isDuplicate ? '#6b7280' : hasError ? '#dc2626' : '#16a34a';
                      const statusText = r.isDuplicate ? 'Duplicate' : hasError ? r.errors[0] : 'Valid';
                      const riAcres = Number(n?.['RI Acres'] ?? 0);
                      const wiAcres = Number(n?.['WI Acres'] ?? 0);
                      const acresDisplay = riAcres > 0 && wiAcres > 0
                        ? `RI: ${riAcres} / WI: ${wiAcres}`
                        : riAcres > 0 ? String(riAcres) : wiAcres > 0 ? `WI: ${wiAcres}` : '-';
                      return (
                        <tr key={i} style={{ background: bg, borderBottom: `1px solid ${BORDER}` }}>
                          <td style={tdStyle}>{i + 1}</td>
                          <td style={tdStyle}>{n?.SEC ?? '-'}</td>
                          <td style={tdStyle}>{String(n?.TWN ?? '-')}</td>
                          <td style={tdStyle}>{String(n?.RNG ?? '-')}</td>
                          <td style={tdStyle}>{String(n?.MERIDIAN ?? '-')}</td>
                          <td style={tdStyle}>{cleanCounty(String(n?.COUNTY ?? '')) || '-'}</td>
                          <td style={tdStyle}>{String(n?.GROUP ?? '') || '-'}</td>
                          {hasAcres && <td style={tdStyle}>{acresDisplay}</td>}
                          {hasRiDecimal && (
                            <td style={{ ...tdStyle, fontFamily: "'SF Mono', monospace", fontSize: 12 }}>
                              {n?.ri_decimal != null ? String(n.ri_decimal) : '-'}
                            </td>
                          )}
                          {hasCode && <td style={tdStyle}>{String(n?.property_code ?? '') || '-'}</td>}
                          <td style={{ ...tdStyle, color: statusColor, fontWeight: 600 }}>{statusText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {/* Step 3: Importing */}
      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spinner size={32} color={ORANGE} />
          <div style={{ fontWeight: 600, color: DARK, fontSize: 15, marginTop: 16, marginBottom: 8 }}>
            {uploadStatus}
          </div>
          <div style={{
            background: '#e5e7eb', borderRadius: 8, height: 12, overflow: 'hidden',
            width: '80%', margin: '0 auto',
          }}>
            <div style={{
              background: ORANGE, height: '100%',
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
              ? importResults.errors[0].error
              : 'Your properties are now being monitored for OCC activity.'}
          </div>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <StatBox bg="#dcfce7" color="#166534" value={importResults.successful} label="Created" />
            <StatBox bg="#f3f4f6" color="#374151" value={importResults.skipped} label="Skipped" />
            <StatBox bg="#fee2e2" color="#991b1b" value={importResults.failed} label="Failed" />
          </div>
        </div>
      )}
    </div>
  );
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

function PlanCheckBar({ planCheck, willImport }: { planCheck: BulkValidationResponse['planCheck']; willImport: number }) {
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
        Current: {planCheck.current} &middot; Adding: {willImport} &middot; Total: {planCheck.afterUpload} of {planCheck.limit} ({planCheck.plan} plan)
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

// --- Helpers ---

function cleanCounty(county: string): string {
  return county.replace(/^\d+-/, '');
}

// --- Styles ---

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700,
  color: SLATE, borderBottom: `1px solid ${BORDER}`,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 13, color: DARK,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6,
  padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: SLATE,
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  background: ORANGE, color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'Inter', 'DM Sans', sans-serif",
};
