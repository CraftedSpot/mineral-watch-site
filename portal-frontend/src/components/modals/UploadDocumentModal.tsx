import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { ModalShell } from '../ui/ModalShell';
import { Button } from '../ui/Button';
import { TEAL, BORDER, SLATE, TEXT_MUTED, TEXT_FAINT, GREEN } from '../../lib/constants';
import {
  uploadDocument,
  uploadDocuments,
  pollPrescanStatus,
  confirmProcessing,
  fetchUsageStats,
} from '../../api/documents';
import type { UsageResponse } from '../../api/documents';

// --- Constants ---
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']);
const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif']);
const MAX_FILE_SIZE = 200 * 1024 * 1024;  // 200MB per file
const DIRECT_UPLOAD_THRESHOLD = 95 * 1024 * 1024; // >95MB uses presigned R2 upload
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;
const MAX_FILES = 500;
const PRESCAN_PAGE_THRESHOLD = 4;
const BATCH_SIZE_LIMIT = 90 * 1024 * 1024; // 90MB — CF 100MB body limit with margin
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT = 120_000; // 2 minutes
const AUTO_CLOSE_MS = 3000;
const UPLOAD_TIMEOUT = 120_000; // 2 minutes per file upload

const PDFJS_VERSION = '3.11.174';
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

type Phase = 'select' | 'uploading' | 'scanning' | 'confirm' | 'done' | 'error';

interface FileEntry {
  file: File;
  pages: number | null; // null = loading
  needsPrescan: boolean;
}

interface Props {
  onClose: () => void;
  modalId: string;
  enhanced?: boolean;
  onUploadComplete?: () => void;
}

// --- pdf.js loader ---
let pdfjsLoaded = false;
let pdfjsLoading: Promise<void> | null = null;

function loadPdfJs(): Promise<void> {
  if (pdfjsLoaded) return Promise.resolve();
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise<void>((resolve, reject) => {
    // Load worker first
    const workerScript = document.createElement('script');
    workerScript.src = `${PDFJS_CDN}/pdf.worker.min.js`;
    workerScript.onload = () => {
      const mainScript = document.createElement('script');
      mainScript.src = `${PDFJS_CDN}/pdf.min.js`;
      mainScript.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = (window as any).pdfjsLib;
        if (lib) {
          lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
          pdfjsLoaded = true;
          resolve();
        } else {
          reject(new Error('pdf.js failed to initialize'));
        }
      };
      mainScript.onerror = () => reject(new Error('Failed to load pdf.js'));
      document.head.appendChild(mainScript);
    };
    workerScript.onerror = () => reject(new Error('Failed to load pdf.js worker'));
    document.head.appendChild(workerScript);
  });
  return pdfjsLoading;
}

async function getPdfPageCount(file: File): Promise<number> {
  try {
    await loadPdfJs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lib = (window as any).pdfjsLib;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await lib.getDocument({ data }).promise;
    return pdf.numPages;
  } catch {
    // Fallback: rough estimate
    return Math.ceil(file.size / 100_000);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot).toLowerCase() : '';
}

function validateFile(file: File): string | null {
  const ext = getFileExt(file.name);
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.has(ext)) {
    return `${file.name}: unsupported file type`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${file.name}: exceeds 200MB limit`;
  }
  return null;
}

// --- Spinner ---
function Spinner({ size = 20, color = TEAL }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// --- Main Component ---
export function UploadDocumentModal({ onClose, enhanced = false, onUploadComplete }: Props) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('select');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  // Scanning state
  const [scanDocId, setScanDocId] = useState<string | null>(null);
  const [scanFilename, setScanFilename] = useState('');
  const [scanPages, setScanPages] = useState(0);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef(0);

  // Confirm state
  const [prescanData, setPrescanData] = useState<{
    document_count: number;
    page_count: number;
    estimated_credits: number;
  } | null>(null);

  // Done state
  const [doneCount, setDoneCount] = useState(0);
  const [failedFiles, setFailedFiles] = useState<string[]>([]);

  // Error state
  const [errorMessage, setErrorMessage] = useState('');
  const [errorCanRetry, setErrorCanRetry] = useState(true);

  const creditsPerDoc = enhanced ? 2 : 1;

  // Fetch credits on mount
  useEffect(() => {
    fetchUsageStats().then(setUsage).catch(() => {});
  }, []);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Auto-close on done
  useEffect(() => {
    if (phase === 'done' && failedFiles.length === 0) {
      const t = setTimeout(() => onClose(), AUTO_CLOSE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, failedFiles.length, onClose]);

  // --- File handling ---
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const newFiles: FileEntry[] = [];
    const errors: string[] = [];
    const existingNames = new Set(files.map((f) => `${f.file.name}:${f.file.size}`));

    for (const file of Array.from(incoming)) {
      const key = `${file.name}:${file.size}`;
      if (existingNames.has(key)) continue; // skip dupes

      const err = validateFile(file);
      if (err) { errors.push(err); continue; }

      existingNames.add(key);
      newFiles.push({ file, pages: isPdf(file) ? null : 1, needsPrescan: false });
    }

    if (errors.length) toast.error(errors.join('\n'));

    const combined = [...files, ...newFiles];
    if (combined.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files allowed`);
      return;
    }
    const totalSize = combined.reduce((s, f) => s + f.file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      toast.error('Total size exceeds 500MB limit');
      return;
    }

    setFiles(combined);

    // Load PDF page counts
    for (const entry of newFiles) {
      if (isPdf(entry.file)) {
        getPdfPageCount(entry.file).then((pages) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === entry.file
                ? { ...f, pages, needsPrescan: pages >= PRESCAN_PAGE_THRESHOLD }
                : f,
            ),
          );
        });
      }
    }
  }, [files, toast]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // --- Drop handlers ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // --- Upload logic ---
  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;

    setPhase('uploading');
    const prescanFiles = files.filter((f) => f.needsPrescan);
    const nonPrescanFiles = files.filter((f) => !f.needsPrescan);

    try {
      // Case 1: Single file that needs prescan
      if (files.length === 1 && prescanFiles.length === 1) {
        const f = prescanFiles[0];
        setUploadProgress({ current: 1, total: 1 });
        const result = await uploadDocument(f.file, { enhanced, prescan: true });
        setScanDocId(result.id);
        setScanFilename(f.file.name);
        setScanPages(f.pages || 0);
        startPolling(result.id);
        setPhase('scanning');
        return;
      }

      // Case 2: Multiple files, some need prescan
      // Upload all — prescan files get pending_prescan, first one gets scan flow
      if (prescanFiles.length > 0) {
        const allFiles = files.map((f) => f.file);
        const prescanIndices = files
          .map((f, i) => (f.needsPrescan ? i : -1))
          .filter((i) => i >= 0);

        setUploadProgress({ current: 1, total: 1 });
        const totalSize = allFiles.reduce((s, f) => s + f.size, 0);

        let firstPrescanId: string | null = null;

        if (totalSize <= BATCH_SIZE_LIMIT) {
          // Batch upload
          const result = await uploadDocuments(allFiles, { enhanced, prescanIndices });
          setDoneCount(result.uploaded);
          setFailedFiles(result.errors.map((e) => e.filename));

          // Find the first prescan result
          for (const r of result.results) {
            if (r.success && r.status === 'pending_prescan' && r.id) {
              firstPrescanId = r.id;
              break;
            }
          }
        } else {
          // Sequential upload
          let uploaded = 0;
          const errors: string[] = [];
          setUploadProgress({ current: 0, total: allFiles.length });

          for (let i = 0; i < files.length; i++) {
            const entry = files[i];
            setUploadProgress({ current: i + 1, total: allFiles.length });
            try {
              const result = await uploadDocument(entry.file, {
                enhanced,
                prescan: entry.needsPrescan,
              });
              uploaded++;
              if (entry.needsPrescan && !firstPrescanId) {
                firstPrescanId = result.id;
              }
            } catch {
              errors.push(entry.file.name);
            }
          }
          setDoneCount(uploaded);
          setFailedFiles(errors);
        }

        // If we have a prescan file, go to scanning
        if (firstPrescanId) {
          const f = prescanFiles[0];
          setScanDocId(firstPrescanId);
          setScanFilename(f.file.name);
          setScanPages(f.pages || 0);
          startPolling(firstPrescanId);
          setPhase('scanning');
          return;
        }

        // Otherwise done
        finishUpload();
        return;
      }

      // Case 3: All files are small/no prescan
      const totalSize = nonPrescanFiles.reduce((s, f) => s + f.file.size, 0);

      if (nonPrescanFiles.length > 1 && totalSize <= BATCH_SIZE_LIMIT) {
        // Batch upload
        setUploadProgress({ current: 1, total: 1 });
        const result = await uploadDocuments(
          nonPrescanFiles.map((f) => f.file),
          { enhanced },
        );
        setDoneCount(result.uploaded);
        setFailedFiles(result.errors.map((e) => e.filename));
      } else {
        // Sequential upload
        let uploaded = 0;
        const errors: string[] = [];
        setUploadProgress({ current: 0, total: nonPrescanFiles.length });

        for (let i = 0; i < nonPrescanFiles.length; i++) {
          setUploadProgress({ current: i + 1, total: nonPrescanFiles.length });
          try {
            await uploadDocument(nonPrescanFiles[i].file, { enhanced });
            uploaded++;
          } catch {
            errors.push(nonPrescanFiles[i].file.name);
          }
        }
        setDoneCount(uploaded);
        setFailedFiles(errors);
      }

      finishUpload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setErrorMessage(msg);
      setErrorCanRetry(true);
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, enhanced]);

  function finishUpload() {
    setPhase('done');
    onUploadComplete?.();
  }

  // --- Prescan polling ---
  function startPolling(docId: string) {
    setScanTimedOut(false);
    pollStartRef.current = Date.now();
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      // Timeout check
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setScanTimedOut(true);
        return;
      }

      try {
        const status = await pollPrescanStatus(docId);
        if (status.status === 'prescan_complete') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPrescanData({
            document_count: status.document_count || 0,
            page_count: status.page_count || 0,
            estimated_credits: status.estimated_credits || 0,
          });
          // Refresh credits for confirm phase
          fetchUsageStats().then(setUsage).catch(() => {});
          setPhase('confirm');
        }
      } catch {
        // Ignore individual poll failures
      }
    }, POLL_INTERVAL);
  }

  const handleConfirmProcessing = useCallback(async () => {
    if (!scanDocId) return;
    try {
      await confirmProcessing(scanDocId);
      setDoneCount((prev) => prev + 1);
      finishUpload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm processing';
      if (msg.includes('Insufficient credits') || msg.includes('402')) {
        setErrorMessage('Insufficient credits — purchase more credits, then find this document in your list to resume processing.');
        setErrorCanRetry(false);
      } else {
        setErrorMessage(msg);
        setErrorCanRetry(true);
      }
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDocId]);

  const handleProcessAnyway = useCallback(async () => {
    if (!scanDocId) return;
    try {
      await confirmProcessing(scanDocId);
      setDoneCount((prev) => prev + 1);
      finishUpload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Processing failed';
      setErrorMessage(msg);
      setErrorCanRetry(true);
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDocId]);

  const handleKeepWaiting = useCallback(() => {
    if (scanDocId) {
      setScanTimedOut(false);
      startPolling(scanDocId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDocId]);

  const resetToSelect = useCallback(() => {
    setPhase('select');
    setFiles([]);
    setErrorMessage('');
    setScanDocId(null);
    setPrescanData(null);
    setDoneCount(0);
    setFailedFiles([]);
  }, []);

  // --- Computed values ---
  const totalSize = files.reduce((s, f) => s + f.file.size, 0);
  const totalPages = files.reduce((s, f) => s + (f.pages || 0), 0);
  const anyPrescan = files.some((f) => f.needsPrescan);
  const allPagesLoaded = files.every((f) => f.pages !== null);
  const availableCredits = usage?.credits?.totalAvailable ?? 0;

  // Credit estimate for non-prescan files
  const nonPrescanCount = files.filter((f) => !f.needsPrescan).length;
  const estimatedCredits = nonPrescanCount * creditsPerDoc;

  // --- Render ---
  return (
    <ModalShell
      onClose={onClose}
      title="Upload Documents"
      headerBg={TEAL}
      maxWidth={560}
      bodyBg="#fff"
      bodyPadding="0"
      footer={phase === 'select' ? (
        <>
          <div style={{ flex: 1, fontSize: 12, color: TEXT_MUTED }}>
            {files.length > 0 && `${files.length} file${files.length !== 1 ? 's' : ''} · ${formatSize(totalSize)}`}
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            color={TEAL}
            disabled={files.length === 0 || !allPagesLoaded}
            onClick={handleUpload}
          >
            {anyPrescan ? 'Upload & Scan' : 'Upload'}
          </Button>
        </>
      ) : undefined}
    >
      {/* SELECT phase */}
      {phase === 'select' && (
        <div style={{ padding: '20px 24px' }}>
          {/* Drop zone for drag-and-drop */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? '#D97706' : BORDER}`,
              borderRadius: 12,
              padding: '20px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: dragOver ? '#FEF3C7' : '#fafafa',
              transition: 'all 0.15s',
            }}
          >
            <svg width={28} height={28} fill="none" stroke={dragOver ? '#D97706' : SLATE} viewBox="0 0 24 24" style={{ marginBottom: 8 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500, color: dragOver ? '#92400e' : '#374151' }}>
              Drag files here
            </span>
            <span style={{ fontSize: 11, color: TEXT_FAINT, marginTop: 2 }}>
              PDF, JPEG, PNG, TIFF · Max 200MB per file
            </span>
            {/* Browse button — opens native file picker on click */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              style={{
                marginTop: 12, padding: '6px 16px', fontSize: 13, fontWeight: 600,
                color: TEAL, background: '#fff', border: `1px solid ${TEAL}`,
                borderRadius: 6, cursor: 'pointer',
              }}
            >
              Browse Files
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* File list */}
          {files.length > 0 && (
            <div style={{ marginTop: 16, maxHeight: 200, overflowY: 'auto' }}>
              {files.slice(0, 50).map((entry, i) => (
                <div
                  key={`${entry.file.name}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: i < Math.min(files.length, 50) - 1 ? `1px solid ${BORDER}` : 'none',
                  }}
                >
                  <div style={{ flex: 1, overflow: 'hidden', marginRight: 8 }}>
                    <span style={{
                      fontSize: 13, color: '#374151', fontWeight: 500,
                      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.file.name}
                    </span>
                    <span style={{ fontSize: 11, color: TEXT_FAINT }}>
                      {entry.pages !== null ? (
                        isPdf(entry.file) ? `${entry.pages} pg, ${formatSize(entry.file.size)}` : formatSize(entry.file.size)
                      ) : (
                        <span style={{ color: SLATE }}>counting pages...</span>
                      )}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: TEXT_FAINT, fontSize: 16, padding: '2px 6px', lineHeight: 1,
                    }}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
              {files.length > 50 && (
                <div style={{ fontSize: 12, color: TEXT_MUTED, padding: '8px 0', fontStyle: 'italic' }}>
                  and {files.length - 50} more files
                </div>
              )}
            </div>
          )}

          {/* Credit info bar */}
          {files.length > 0 && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 8,
              background: '#f8fafc', border: `1px solid ${BORDER}`,
              fontSize: 13,
            }}>
              {anyPrescan ? (
                <>
                  <div style={{ fontWeight: 500, color: '#374151' }}>
                    Minimum credits: <strong>TBD</strong>
                    <span style={{ color: TEXT_MUTED, fontWeight: 400 }}> ({totalPages} pages detected)</span>
                  </div>
                  <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 2 }}>
                    Credits estimated after document detection
                  </div>
                </>
              ) : (
                <div style={{ fontWeight: 500, color: '#374151' }}>
                  Est. credits: <strong>{estimatedCredits}</strong>
                </div>
              )}
              {enhanced && (
                <div style={{ fontSize: 12, color: '#7c3aed', marginTop: 4 }}>
                  Enhanced extraction — 2 credits each
                </div>
              )}
              <div style={{
                fontSize: 12, marginTop: 4, fontWeight: 500,
                color: availableCredits >= estimatedCredits || anyPrescan ? GREEN : '#dc2626',
              }}>
                You have <strong>{availableCredits}</strong> credits available
              </div>
            </div>
          )}
        </div>
      )}

      {/* UPLOADING phase */}
      {phase === 'uploading' && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <Spinner size={32} />
          <div style={{ marginTop: 16, fontSize: 15, fontWeight: 600, color: '#374151' }}>
            {uploadProgress.total > 1
              ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}...`
              : 'Uploading...'
            }
          </div>
          {files.length === 1 && (
            <div style={{ marginTop: 4, fontSize: 13, color: TEXT_MUTED }}>
              {files[0].file.name}
              {files[0].pages ? ` · ${files[0].pages} pages` : ''}
            </div>
          )}
          {uploadProgress.total > 1 && (
            <div style={{
              marginTop: 12, height: 4, borderRadius: 2,
              background: '#e2e8f0', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2, background: TEAL,
                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                transition: 'width 0.3s',
              }} />
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Button variant="ghost" size="sm" onClick={resetToSelect}>Cancel</Button>
          </div>
        </div>
      )}

      {/* SCANNING phase */}
      {phase === 'scanning' && (
        <div style={{ padding: '24px' }}>
          <div style={{
            background: '#E0F2FE', border: '1px solid #7DD3FC',
            borderRadius: 12, padding: 24, textAlign: 'center',
          }}>
            {!scanTimedOut ? (
              <>
                <Spinner size={28} color="#0284C7" />
                <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: '#0C4A6E' }}>
                  Analyzing document structure...
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: '#0369A1' }}>
                  {scanFilename}{scanPages > 0 ? ` · ${scanPages} pages` : ''}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#0284C7' }}>
                  This may take 1–2 minutes for large documents
                </div>
              </>
            ) : (
              <>
                <svg width={28} height={28} fill="none" stroke="#0284C7" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: '#0C4A6E' }}>
                  Scanning is taking longer than expected
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: '#0369A1' }}>
                  You can continue waiting or process without document detection.
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <Button variant="primary" color="#0284C7" onClick={handleProcessAnyway}>
                    Process Anyway
                  </Button>
                  <Button variant="ghost" onClick={handleKeepWaiting}>
                    Keep Waiting
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CONFIRM phase */}
      {phase === 'confirm' && prescanData && (
        <div style={{ padding: '24px' }}>
          <div style={{
            background: '#F0FDF4', border: '1px solid #86EFAC',
            borderRadius: 12, padding: 24, textAlign: 'center',
          }}>
            {/* Green checkmark */}
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: '#22c55e',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
            }}>
              <svg width={20} height={20} fill="none" stroke="#fff" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div style={{ fontSize: 16, fontWeight: 600, color: '#14532D' }}>
              Found ~<strong>{prescanData.document_count}</strong> documents in <strong>{prescanData.page_count}</strong> pages
            </div>

            <div style={{ marginTop: 12, fontSize: 14, color: '#166534' }}>
              Estimated credits: <strong>
                {prescanData.estimated_credits * creditsPerDoc}–{Math.ceil(prescanData.estimated_credits * 1.5) * creditsPerDoc}
              </strong>
            </div>

            {/* Credit warning */}
            {(() => {
              const low = prescanData.estimated_credits * creditsPerDoc;
              const high = Math.ceil(prescanData.estimated_credits * 1.5) * creditsPerDoc;
              if (availableCredits < low) {
                return (
                  <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 6,
                    background: '#FEF2F2', border: '1px solid #FECACA',
                    fontSize: 13, color: '#991B1B',
                  }}>
                    Insufficient credits ({availableCredits} available)
                  </div>
                );
              }
              if (availableCredits < high) {
                return (
                  <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 6,
                    background: '#FFFBEB', border: '1px solid #FDE68A',
                    fontSize: 13, color: '#92400E',
                  }}>
                    You may not have enough credits if at the higher end ({availableCredits} available)
                  </div>
                );
              }
              return (
                <div style={{ marginTop: 8, fontSize: 13, color: GREEN, fontWeight: 500 }}>
                  You have <strong>{availableCredits}</strong> credits available
                </div>
              );
            })()}

            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Button
                variant="primary"
                color="#16a34a"
                onClick={handleConfirmProcessing}
                disabled={availableCredits < prescanData.estimated_credits * creditsPerDoc}
              >
                Process All
              </Button>
              <Button variant="ghost" onClick={() => {
                // Close modal — doc stays as prescan_complete in grid
                onUploadComplete?.();
                onClose();
              }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* DONE phase */}
      {phase === 'done' && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', background: '#dcfce7',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <svg width={24} height={24} fill="none" stroke="#16a34a" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>
            {doneCount} document{doneCount !== 1 ? 's' : ''} uploaded
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_MUTED }}>
            Processing will begin automatically
          </div>
          {failedFiles.length > 0 && (
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>
                Failed to upload:
              </div>
              {failedFiles.map((name) => (
                <div key={name} style={{ fontSize: 12, color: '#dc2626', padding: '2px 0' }}>
                  {name}
                </div>
              ))}
            </div>
          )}
          {failedFiles.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
      )}

      {/* ERROR phase */}
      {phase === 'error' && (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', background: '#FEE2E2',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <svg width={24} height={24} fill="none" stroke="#dc2626" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#991B1B', marginBottom: 4 }}>
            Upload Error
          </div>
          <div style={{ fontSize: 13, color: '#374151', maxWidth: 380, margin: '0 auto' }}>
            {errorMessage}
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
            {errorCanRetry ? (
              <Button variant="primary" color={TEAL} onClick={resetToSelect}>Try Again</Button>
            ) : (
              <Button variant="ghost" onClick={onClose}>Close</Button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
