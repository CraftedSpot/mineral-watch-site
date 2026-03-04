import { useRef, useEffect, useCallback, useState } from 'react';
import { DARK, SLATE, BORDER } from '../../lib/constants';

interface TreeCanvasProps {
  children: React.ReactNode;
  zoom: number;
  pan: { x: number; y: number };
  onZoomChange: (z: number) => void;
  onPanChange: (p: { x: number; y: number }) => void;
}

export function TreeCanvas({ children, zoom, pan, onZoomChange, onPanChange }: TreeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    onZoomChange(Math.max(0.3, Math.min(2, zoom + (e.deltaY > 0 ? -0.08 : 0.08))));
  }, [zoom, onZoomChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('[data-pinned]')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      onPanChange({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };
  const handleMouseUp = () => setIsPanning(false);

  return (
    <div style={{ padding: isFullscreen ? '0' : '0 24px 24px' }}>
      <div
        ref={canvasWrapperRef}
        style={{
          background: '#fff', borderRadius: isFullscreen ? 0 : 12,
          border: isFullscreen ? 'none' : `1px solid ${BORDER}`,
          position: 'relative', overflow: 'hidden',
          height: isFullscreen ? '100vh' : 'calc(100vh - 320px)', minHeight: 450,
        }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', position: 'relative' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { handleMouseUp(); }}
        >
          {/* Zoom controls */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 4, flexDirection: 'column' }}>
            {[
              { label: '+', fn: () => onZoomChange(Math.min(2, zoom + 0.15)) },
              { label: '\u2212', fn: () => onZoomChange(Math.max(0.3, zoom - 0.15)) },
              { label: 'FIT', fn: () => { onZoomChange(0.82); onPanChange({ x: 40, y: 0 }); } },
            ].map(({ label, fn }) => (
              <button key={label} onClick={fn}
                style={{
                  width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`,
                  background: '#fff', cursor: 'pointer',
                  fontSize: label === 'FIT' ? 9 : 16, fontWeight: 700,
                  color: label === 'FIT' ? SLATE : DARK,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'DM Sans', sans-serif",
                }}>
                {label}
              </button>
            ))}
            <button onClick={toggleFullscreen}
              style={{
                width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`,
                background: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={DARK} strokeWidth="1.5">
                  <polyline points="9,1 9,5 13,5" /><polyline points="5,13 5,9 1,9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={DARK} strokeWidth="1.5">
                  <polyline points="9,1 13,1 13,5" /><polyline points="5,13 1,13 1,9" />
                </svg>
              )}
            </button>
            <div style={{ textAlign: 'center', fontSize: 9, color: SLATE,
              fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* SVG + overlays */}
          <svg width="100%" height="100%" style={{ cursor: isPanning ? 'grabbing' : 'grab' }}>
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {children}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Expose ref getter for parent components to compute pin positions */
export function useCanvasRef() {
  return useRef<HTMLDivElement>(null);
}
