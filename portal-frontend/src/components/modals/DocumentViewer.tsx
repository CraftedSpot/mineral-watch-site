import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { fetchDocumentBlob } from '../../api/documents';
import { Spinner } from '../ui/Spinner';

interface Props {
  onClose: () => void;
  modalId: string;
  docId: string;
  filename: string;
  contentType: string;
  rotation?: number;
}

interface ViewerState {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
}

type ViewerAction =
  | { type: 'ZOOM_IN' }
  | { type: 'ZOOM_OUT' }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'RESET' }
  | { type: 'ROTATE'; degrees: number }
  | { type: 'PAN'; dx: number; dy: number }
  | { type: 'SET_PAN'; x: number; y: number };

function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'ZOOM_IN': return { ...state, zoom: Math.min(state.zoom * 1.25, 5) };
    case 'ZOOM_OUT': return { ...state, zoom: Math.max(state.zoom / 1.25, 0.25) };
    case 'SET_ZOOM': return { ...state, zoom: Math.min(Math.max(action.zoom, 0.25), 5) };
    case 'RESET': return { ...state, zoom: 1, panX: 0, panY: 0 };
    case 'ROTATE': return { ...state, rotation: (state.rotation + action.degrees) % 360 };
    case 'PAN': return { ...state, panX: state.panX + action.dx, panY: state.panY + action.dy };
    case 'SET_PAN': return { ...state, panX: action.x, panY: action.y };
    default: return state;
  }
}

export function DocumentViewer({ onClose, docId, filename, contentType, rotation = 0 }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actualType, setActualType] = useState(contentType);
  const [state, dispatch] = useReducer(viewerReducer, { zoom: 1, panX: 0, panY: 0, rotation });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 });
  const touchRef = useRef({ lastDist: 0 });

  // Fetch document blob
  useEffect(() => {
    let revoke: string | null = null;
    setLoading(true);
    setError(null);
    fetchDocumentBlob(docId)
      .then(({ blob, contentType: ct }) => {
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
        setActualType(ct);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message === 'FILE_TOO_LARGE' ? 'File too large to preview. Please download instead.' : err.message);
        setLoading(false);
      });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [docId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (isPdf) return; // Only image viewer shortcuts
      switch (e.key) {
        case '+': case '=': dispatch({ type: 'ZOOM_IN' }); break;
        case '-': dispatch({ type: 'ZOOM_OUT' }); break;
        case '0': dispatch({ type: 'RESET' }); break;
        case 'r': dispatch({ type: 'ROTATE', degrees: 90 }); break;
        case 'R': dispatch({ type: 'ROTATE', degrees: -90 }); break;
        case 'ArrowUp': if (state.zoom > 1) dispatch({ type: 'PAN', dx: 0, dy: 30 }); break;
        case 'ArrowDown': if (state.zoom > 1) dispatch({ type: 'PAN', dx: 0, dy: -30 }); break;
        case 'ArrowLeft': if (state.zoom > 1) dispatch({ type: 'PAN', dx: 30, dy: 0 }); break;
        case 'ArrowRight': if (state.zoom > 1) dispatch({ type: 'PAN', dx: -30, dy: 0 }); break;
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, state.zoom]);

  const isPdf = actualType.includes('pdf');
  const isImage = actualType.includes('image/jpeg') || actualType.includes('image/png');
  const isTiff = actualType.includes('tiff');

  // Mouse drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (state.zoom <= 1) return;
    e.preventDefault();
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: state.panX, startPanY: state.panY };
  }, [state.zoom, state.panX, state.panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    dispatch({ type: 'SET_PAN', x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  // Scroll wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    dispatch({ type: 'SET_ZOOM', zoom: state.zoom * factor });
  }, [state.zoom]);

  // Touch pinch zoom
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      touchRef.current.lastDist = dist;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (touchRef.current.lastDist > 0) {
        const factor = dist / touchRef.current.lastDist;
        dispatch({ type: 'SET_ZOOM', zoom: state.zoom * factor });
      }
      touchRef.current.lastDist = dist;
    }
  }, [state.zoom]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
      display: 'flex', flexDirection: 'column', fontFamily: "'Inter', 'DM Sans', sans-serif",
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: 'rgba(255,255,255,0.1)',
      }}>
        <div style={{ color: '#fff', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isImage && (
            <>
              <ToolbarBtn onClick={() => dispatch({ type: 'ZOOM_OUT' })} label="-" />
              <span style={{ color: '#fff', fontSize: 11, minWidth: 40, textAlign: 'center' }}>
                {Math.round(state.zoom * 100)}%
              </span>
              <ToolbarBtn onClick={() => dispatch({ type: 'ZOOM_IN' })} label="+" />
              <ToolbarBtn onClick={() => dispatch({ type: 'RESET' })} label="Fit" />
              <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }} />
              <ToolbarBtn onClick={() => dispatch({ type: 'ROTATE', degrees: -90 })} label="&#8634;" />
              <ToolbarBtn onClick={() => dispatch({ type: 'ROTATE', degrees: 90 })} label="&#8635;" />
            </>
          )}
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }} />
          <ToolbarBtn onClick={onClose} label="&times;" large />
        </div>
      </div>

      {/* Content */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading && <Spinner size={32} color="#fff" />}
        {error && (
          <div style={{ color: '#fca5a5', textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 14, marginBottom: 12 }}>{error}</div>
            <button
              onClick={() => window.open(`/api/documents/${docId}/download`, '_blank')}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}
            >
              Download File
            </button>
          </div>
        )}
        {blobUrl && isPdf && (
          <iframe src={blobUrl} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Viewer" />
        )}
        {blobUrl && isImage && (
          <div
            style={{ width: '100%', height: '100%', overflow: 'hidden', cursor: state.zoom > 1 ? 'grab' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
          >
            <img
              src={blobUrl}
              alt={filename}
              draggable={false}
              style={{
                maxWidth: '100%', maxHeight: '100%',
                transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom}) rotate(${state.rotation}deg)`,
                transformOrigin: 'center center',
                transition: dragRef.current.dragging ? 'none' : 'transform 0.15s ease',
                display: 'block', margin: 'auto',
              }}
            />
          </div>
        )}
        {blobUrl && isTiff && (
          <div style={{ color: '#fca5a5', textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 14, marginBottom: 12 }}>TIFF files cannot be previewed in the browser.</div>
            <button
              onClick={() => window.open(`/api/documents/${docId}/download`, '_blank')}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}
            >
              Download File
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarBtn({ onClick, label, large }: { onClick: () => void; label: string; large?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 4,
        color: '#fff', cursor: 'pointer', fontSize: large ? 20 : 14,
        width: large ? 32 : 28, height: large ? 32 : 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}
