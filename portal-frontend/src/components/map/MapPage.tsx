import { useEffect, useRef, useCallback } from 'react';
import { useMapBridge } from './useMapBridge';

// CDN resources for Leaflet + plugins
const CDN_CSS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.css',
];

const CDN_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js',
];

/** Load a <script> tag and resolve when loaded */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Skip if already loaded
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(el);
  });
}

/** Load a <link rel="stylesheet"> and resolve when loaded */
function loadCSS(href: string): HTMLLinkElement | null {
  if (document.querySelector(`link[href="${href}"]`)) return null;
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = href;
  document.head.appendChild(el);
  return el;
}

export function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptsLoaded = useRef(false);
  const cleanupRef = useRef<Array<() => void>>([]);

  // Bridge: when user tracks a well from the modal, refresh map markers
  const handleTrackWell = useCallback((apiNumber: string) => {
    // The vanilla map has loadTrackedWells() as a global function
    // After tracking, call it to refresh markers
    const win = window as Record<string, unknown>;
    if (typeof win.loadTrackedWells === 'function') {
      (win.loadTrackedWells as () => Promise<void>)();
    }
    console.log('[MapPage] Well tracked:', apiNumber);
  }, []);

  useMapBridge(handleTrackWell);

  useEffect(() => {
    if (scriptsLoaded.current) return;
    scriptsLoaded.current = true;

    // 1. Load map CSS (our extracted file + CDN)
    const mapCSSLink = loadCSS('/portal/map-assets/map.css');
    if (mapCSSLink) cleanupRef.current.push(() => mapCSSLink.remove());

    const cdnCSSLinks = CDN_CSS.map(loadCSS).filter(Boolean) as HTMLLinkElement[];
    cdnCSSLinks.forEach((el) => cleanupRef.current.push(() => el.remove()));

    // 2. Load CDN scripts sequentially (leaflet must load before plugins)
    async function loadAll() {
      try {
        for (const src of CDN_SCRIPTS) {
          await loadScript(src);
        }
        // 3. Load map-scripts.js (concatenated vanilla map modules)
        await loadScript('/portal/map-assets/map-scripts.js');

        // 4. The vanilla scripts use DOMContentLoaded — since it already fired,
        //    we need to trigger initialization manually if the init function exists
        const win = window as Record<string, unknown>;
        if (typeof win.initMap === 'function') {
          (win.initMap as () => void)();
        }
      } catch (err) {
        console.error('[MapPage] Failed to load map scripts:', err);
      }
    }

    loadAll();

    return () => {
      // Cleanup: remove Leaflet map instance
      const win = window as Record<string, unknown>;
      if (win.map && typeof (win.map as { remove: () => void }).remove === 'function') {
        try { (win.map as { remove: () => void }).remove(); } catch {}
      }

      // Nullify key vanilla globals to prevent stale references
      const globals = [
        'map', 'countyLayer', 'townshipLayer', 'countyLabelsLayer',
        'wellsLayer', 'nearbyWellsLayer', 'propertiesLayer',
        'userProperties', 'trackedWells', 'allNearbyWells',
        'wellMarkers', 'propertyMarkers',
      ];
      for (const g of globals) {
        try { delete win[g]; } catch {}
      }

      // Remove injected CSS
      for (const fn of cleanupRef.current) {
        try { fn(); } catch {}
      }
      cleanupRef.current = [];
      scriptsLoaded.current = false;
    };
  }, []);

  return (
    <div className="map-page" ref={containerRef}>
      <main>
        <div className="container">
          <div className="page-header">
            <h1 style={{ fontFamily: "'Merriweather', serif", fontSize: 28, margin: 0 }}>Map</h1>

            {/* Search Bar */}
            <div className="map-search-container">
              <input
                type="text"
                className="map-search-input"
                id="mapSearch"
                placeholder="Search wells, properties, or operators..."
                autoComplete="off"
              />
              <svg className="map-search-icon" width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
              <div className="map-search-results" id="searchResults"></div>
            </div>

            {/* Count Display */}
            <div className="map-count-display">
              <div className="count-item">
                <span className="count-value" id="propertyCount">0</span>
                <span className="count-label">Properties</span>
              </div>
              <div className="count-separator">&bull;</div>
              <div className="count-item">
                <span className="count-value" id="wellCount">0</span>
                <span className="count-label" title="Wells you're actively monitoring">Tracked Wells</span>
              </div>
              <div className="count-separator">&bull;</div>
              <div className="count-item">
                <span className="count-value" id="permitCount">0</span>
                <span className="count-label" title="New drilling permits within 90 days near your properties">Permits</span>
              </div>
              <div className="count-separator">&bull;</div>
              <div className="count-item">
                <span className="count-value" id="completionCount">0</span>
                <span className="count-label" title="Wells completed within 90 days near your properties">Completions</span>
              </div>
              <div className="count-separator" id="nearbyWellsSeparator" style={{ display: 'none' }}>&bull;</div>
              <div className="count-item" id="nearbyWellsCount" style={{ display: 'none', flexDirection: 'column' }}>
                <span className="count-value" id="nearbyWellCount">0</span>
                <span className="count-label" title="Wells near your properties">Nearby Wells</span>
              </div>
            </div>
          </div>

          <div className="map-container">
            <div id="map"></div>

            {/* Loading overlay */}
            <div className="map-loading" id="mapLoading" style={{ display: 'none' }}>
              <div className="loading-spinner"></div>
              <div className="loading-text">Loading map data...</div>
              <div className="loading-subtext"></div>
            </div>

            {/* Map Controls Bar */}
            <div className="map-controls-bar collapsed" id="mapControlsBar">
              <div className="controls-toggle" onClick={() => { document.getElementById('mapControlsBar')?.classList.remove('collapsed'); }}>
                <span className="controls-toggle-icon">&#9776;</span>
                <span>Layers</span>
              </div>
              <button className="collapse-x-btn" onClick={() => { document.getElementById('mapControlsBar')?.classList.add('collapsed'); }} title="Collapse">&times;</button>
              <div className="primary-toggles">
                <label className="toggle-btn active">
                  <input type="checkbox" id="toggle-wells" defaultChecked />
                  <span title="Wells you're actively monitoring">Tracked Wells</span>
                </label>
                <label className="toggle-btn" id="poolingRatesBtn">
                  <input type="checkbox" id="toggle-pooling-rates" />
                  <span title="Average pooling bonus rates by township (last 18 months)">Pooling Rates</span>
                </label>
                <select id="nearby-wells-select" className="layer-select" title="Explore wells near your properties" defaultValue="off">
                  <option value="off">Nearby Wells</option>
                  <option value="PRODUCING">Actively Producing</option>
                  <option value="AC">(AC) OCC Status</option>
                  <option value="ALL">All Wells</option>
                </select>
                <button id="colorByOperatorBtn" className="layer-select" title="Color wells by operator" style={{ display: 'none', cursor: 'pointer', textAlign: 'center', minWidth: 'auto', padding: '4px 10px', fontSize: 11 }}>
                  By Operator
                </button>
                <div className="heatmap-dropdown">
                  <button className="heatmap-btn" id="heatmapBtn" title="Statewide drilling activity within 90 days">
                    <span>Heat Map</span>
                  </button>
                  <div className="heatmap-menu" id="heatmapMenu">
                    <div className="heatmap-section-divider">Nearby Filings</div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-permits" />
                      <label htmlFor="toggle-permits">Permits</label>
                    </div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-completions" />
                      <label htmlFor="toggle-completions">Completions</label>
                    </div>
                    <div className="heatmap-section-divider">Statewide Heatmap</div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-permits" />
                      <label htmlFor="toggle-heatmap-permits">Permits</label>
                    </div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-completions" />
                      <label htmlFor="toggle-heatmap-completions">Completions</label>
                    </div>
                    <div className="heatmap-section-divider">OCC Applications</div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-pooling" />
                      <label htmlFor="toggle-heatmap-pooling">Pooling</label>
                    </div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-density" />
                      <label htmlFor="toggle-heatmap-density">Increased Density</label>
                    </div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-spacing" />
                      <label htmlFor="toggle-heatmap-spacing">Spacing Unit</label>
                    </div>
                    <div className="overlay-option">
                      <input type="checkbox" id="toggle-heatmap-horizontal" />
                      <label htmlFor="toggle-heatmap-horizontal">Horizontal Well</label>
                    </div>
                  </div>
                </div>
                <select id="production-select" className="layer-select" title="County production (trailing 12 months)" defaultValue="off">
                  <option value="off">Production</option>
                  <option value="oil">Oil</option>
                  <option value="gas">Gas</option>
                </select>
              </div>

              <div className="overlays-dropdown">
                <button className="overlays-btn" id="overlaysBtn">
                  <span>Overlays</span>
                </button>
                <div className="overlays-menu" id="overlaysMenu">
                  <div className="overlay-option all-option">
                    <input type="checkbox" id="toggle-all-overlays" />
                    <label htmlFor="toggle-all-overlays">All Overlays</label>
                  </div>
                  <div className="overlay-option">
                    <input type="checkbox" id="toggle-land-grid" defaultChecked />
                    <label htmlFor="toggle-land-grid">Land Grid</label>
                  </div>
                  <div className="overlay-option">
                    <input type="checkbox" id="toggle-section-numbers" defaultChecked />
                    <label htmlFor="toggle-section-numbers">Section Numbers</label>
                  </div>
                  <div className="overlay-option">
                    <input type="checkbox" id="toggle-county-labels" defaultChecked />
                    <label htmlFor="toggle-county-labels">County Names</label>
                  </div>
                </div>
              </div>
            </div>

            {/* Pooling Rates Legend */}
            <div id="poolingRatesLegend" className="pooling-legend" style={{ display: 'none' }}>
              <div className="pooling-legend-title">Pooling Bonus $/Acre</div>
              <div className="pooling-legend-items">
                <div className="pooling-legend-item"><span className="pooling-legend-swatch" style={{ background: '#166534' }}></span>$1,000+</div>
                <div className="pooling-legend-item"><span className="pooling-legend-swatch" style={{ background: '#22c55e' }}></span>$500–999</div>
                <div className="pooling-legend-item"><span className="pooling-legend-swatch" style={{ background: '#86efac' }}></span>$200–499</div>
                <div className="pooling-legend-item"><span className="pooling-legend-swatch" style={{ background: '#fef08a' }}></span>$50–199</div>
                <div className="pooling-legend-item"><span className="pooling-legend-swatch" style={{ background: '#fed7aa' }}></span>&lt;$50</div>
              </div>
              <div className="pooling-legend-note">Avg of highest bonus option per order (18 months)</div>
            </div>

            {/* Filter Toggle Button */}
            <button className="filter-toggle-btn" id="filterToggleBtn" style={{ display: 'none' }}>
              <span>Filter Wells</span>
            </button>

            {/* Wells Filter Panel */}
            <div className="wells-filter-panel" id="wellsFilterPanel" style={{ display: 'none' }}>
              <div className="filter-header">
                <h4>Filter D1 Wells</h4>
                <button className="filter-close" onClick={() => { const el = document.getElementById('wellsFilterPanel'); if (el) el.style.display = 'none'; }}>&times;</button>
              </div>
              <div className="filter-body">
                <div className="filter-section">
                  <label>Well Status</label>
                  <select id="filterWellStatus" className="filter-select" defaultValue="">
                    <option value="">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PA">Plugged &amp; Abandoned</option>
                    <option value="SI">Shut In</option>
                    <option value="TA">Temporarily Abandoned</option>
                    <option value="DRY">Dry Hole</option>
                  </select>
                </div>
                <div className="filter-section">
                  <label>Well Type</label>
                  <select id="filterWellType" className="filter-select" defaultValue="">
                    <option value="">All Types</option>
                    <option value="OIL">Oil</option>
                    <option value="GAS">Gas</option>
                    <option value="INJ">Injection</option>
                    <option value="SWD">Salt Water Disposal</option>
                  </select>
                </div>
                <div className="filter-section">
                  <label>Operator</label>
                  <input type="text" id="filterOperator" className="filter-input" placeholder="Enter operator name..." />
                </div>
                <div className="filter-section">
                  <label>County</label>
                  <input type="text" id="filterCounty" className="filter-input" placeholder="Enter county name..." />
                </div>
              </div>
              <div className="filter-actions">
                <button className="filter-btn filter-btn-primary" id="applyFilterBtn">Apply Filter</button>
                <button className="filter-btn filter-btn-secondary" id="clearFilterBtn">Clear</button>
              </div>
            </div>
          </div>

          {/* Legend Strip */}
          <div className="legend-strip" id="legendStrip">
            <div className="legend-group">
              <div className="legend-group-title">Monitoring</div>
              <div className="legend-items">
                <div className="legend-item">
                  <div className="legend-color" style={{ background: 'var(--your-property)', borderColor: 'var(--your-property-dark)' }}></div>
                  <span className="legend-text">My Property</span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', border: '2.5px solid #06B6D4', boxShadow: '0 0 6px 2px rgba(6,182,212,0.45)', flexShrink: 0 }}></div>
                  <span className="legend-text">Tracked Well</span>
                </div>
              </div>
            </div>

            <div className="legend-group">
              <div className="legend-group-title">Nearby Wells</div>
              <div className="legend-items">
                <div className="legend-item">
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 5px 2px rgba(34,197,94,0.5)', flexShrink: 0 }}></div>
                  <span className="legend-text">Oil <span className="legend-subtitle">(producing)</span></span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#EF4444', boxShadow: '0 0 5px 2px rgba(239,68,68,0.5)', flexShrink: 0 }}></div>
                  <span className="legend-text">Gas <span className="legend-subtitle">(producing)</span></span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#22C55E', opacity: 0.55, flexShrink: 0 }}></div>
                  <span className="legend-text">Active <span className="legend-subtitle">(no recent prod)</span></span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#3B82F6', boxShadow: '0 0 5px 2px rgba(59,130,246,0.45)', flexShrink: 0 }}></div>
                  <span className="legend-text">Injection/SWD</span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#6EE7B7', opacity: 0.45, flexShrink: 0 }}></div>
                  <span className="legend-text">Plugged</span>
                </div>
              </div>
            </div>

            <div className="legend-group">
              <div className="legend-group-title">Activity Type</div>
              <div className="legend-items">
                <div className="legend-item">
                  <svg width="20" height="20" viewBox="0 0 20 20" style={{ margin: '0 2px' }}>
                    <circle cx="10" cy="10" r="8" fill="var(--permit)" stroke="var(--permit-dark)" strokeWidth="2" opacity="0.7" />
                  </svg>
                  <span className="legend-text">New Drilling Permit
                    <span className="legend-subtitle">Near your properties &bull; Last 90 days</span>
                  </span>
                </div>
                <div className="legend-item">
                  <svg width="20" height="20" viewBox="0 0 20 20" style={{ margin: '0 2px' }}>
                    <circle cx="10" cy="10" r="8" fill="var(--completed)" stroke="var(--completed-dark)" strokeWidth="2" opacity="0.7" />
                  </svg>
                  <span className="legend-text">Recently Completed
                    <span className="legend-subtitle">Near your properties &bull; Last 90 days</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="legend-group">
              <div className="legend-group-title">Lateral Paths</div>
              <div className="legend-items">
                <div className="legend-item">
                  <div style={{ width: 28, height: 4, background: '#22C55E', borderRadius: 2, flexShrink: 0, position: 'relative' as const }}>
                    <div style={{ position: 'absolute' as const, top: 1, left: 4, width: 20, height: 2, borderTop: '2px dashed white' }}></div>
                  </div>
                  <span className="legend-text">Oil Well</span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 28, height: 4, background: '#EF4444', borderRadius: 2, flexShrink: 0, position: 'relative' as const }}>
                    <div style={{ position: 'absolute' as const, top: 1, left: 4, width: 20, height: 2, borderTop: '2px dashed white' }}></div>
                  </div>
                  <span className="legend-text">Gas Well</span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 28, height: 4, background: '#F59E0B', borderRadius: 2, flexShrink: 0, position: 'relative' as const }}>
                    <div style={{ position: 'absolute' as const, top: 1, left: 4, width: 20, height: 2, borderTop: '2px dashed white' }}></div>
                  </div>
                  <span className="legend-text">Permit <span className="legend-subtitle">(pending)</span></span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 28, height: 4, background: '#3B82F6', borderRadius: 2, flexShrink: 0, position: 'relative' as const }}>
                    <div style={{ position: 'absolute' as const, top: 1, left: 4, width: 20, height: 2, borderTop: '2px dashed white' }}></div>
                  </div>
                  <span className="legend-text">Completion <span className="legend-subtitle">(recent)</span></span>
                </div>
              </div>
            </div>

            <div className="legend-group">
              <div className="legend-group-title">Heat Map</div>
              <div className="legend-items">
                <div className="legend-item">
                  <div style={{ width: 40, height: 14, background: 'linear-gradient(to right, rgba(255, 255, 0, 0.4), rgba(245, 158, 11, 0.8), rgba(220, 38, 38, 1))', borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)' }}></div>
                  <span className="legend-text">Permits
                    <span className="legend-subtitle">Statewide &bull; Last 90 days</span>
                  </span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 40, height: 14, background: 'linear-gradient(to right, rgba(96, 165, 250, 0.4), rgba(59, 130, 246, 0.8), rgba(124, 58, 237, 1))', borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)' }}></div>
                  <span className="legend-text">Completions
                    <span className="legend-subtitle">Statewide &bull; Last 90 days</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="legend-group">
              <div className="legend-group-title">Production</div>
              <div className="legend-items">
                <div className="legend-item">
                  <div style={{ width: 40, height: 14, background: 'linear-gradient(to right, #ffffcc, #ffeda0, #feb24c, #f03b20, #bd0026)', borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)' }}></div>
                  <span className="legend-text">Oil (BBL)
                    <span className="legend-subtitle">By county &bull; Trailing 12 months</span>
                  </span>
                </div>
                <div className="legend-item">
                  <div style={{ width: 40, height: 14, background: 'linear-gradient(to right, #deebf7, #9ecae1, #4292c6, #2171b5, #084594)', borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)' }}></div>
                  <span className="legend-text">Gas (MCF)
                    <span className="legend-subtitle">By county &bull; Trailing 12 months</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Operator Modal — map-specific (scoped to nearby wells in viewport) */}
      <div className="well-modal-overlay" id="operatorModal" style={{ zIndex: 99999 }}>
        <div className="well-modal" style={{ maxWidth: 700 }}>
          <div className="well-modal-header" style={{ background: 'linear-gradient(135deg, #1E40AF 0%, #3B82F6 100%)' }}>
            <div style={{ flex: 1 }}>
              <h3 className="well-modal-title" id="operatorModalTitle">Operator</h3>
              <div className="well-modal-subtitle" id="operatorModalSubtitle">&mdash;</div>
            </div>
            {/* eslint-disable-next-line react/no-unknown-property */}
            <button className="well-modal-close" ref={(el) => {
              if (el) el.setAttribute('onclick', 'closeOperatorModal()');
            }}>&times;</button>
          </div>
          <div className="well-modal-body" id="operatorModalBody">
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading...</div>
          </div>
        </div>
      </div>
    </div>
  );
}
