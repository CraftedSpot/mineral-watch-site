// map-scripts.js — Generated 2026-03-09T03:03:15.821Z
// Do not edit directly. Rebuild with: node scripts/build-map-scripts.js

// ═══════════════════════════════════════════════
// Module: map-utils.txt
// ═══════════════════════════════════════════════
        // === Map Utilities ===
        // Extracted from shared modules for use by map-specific vanilla scripts.
        // These run inside the React app shell — auth, modals, and navigation
        // are handled by React. Only formatting/display helpers remain here.

        // Format Township-Range-Section to consistent padded format: "06N-24W-30"
        function formatTRS(twn, rng, sec) {
            const padDir = (val) => String(val || '').replace(/^(\d+)/, (_, n) => n.padStart(2, '0'));
            return `${padDir(twn)}-${padDir(rng)}-${String(sec || '').toString().padStart(2, '0')}`;
        }

        // Generic accordion toggle (content show/hide + arrow rotation)
        function toggleAccordion(contentId, arrowId) {
            const content = document.getElementById(contentId);
            const arrow = document.getElementById(arrowId);
            if (!content) return;
            const isOpen = content.style.display !== 'none';
            content.style.display = isOpen ? 'none' : 'block';
            if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
        }

        // Convert text to title case (handles all caps)
        function toTitleCase(str) {
            if (!str) return '';
            return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        }

        // Get user-friendly status label
        function getStatusLabel(status) {
            const statusMap = {
                'AC': 'Active',
                'PA': 'Plugged & Abandoned',
                'OR': 'Operator Released',
                'STFD': 'Shut-in Temporarily',
                'NE': 'New',
                'EX': 'Expired',
                'TM': 'Temporarily Abandoned',
                'TA': 'Temporarily Abandoned'
            };
            return statusMap[status] || status || 'Unknown';
        }

        // Match reason style helpers
        function getMatchReasonStyle(reason) {
            switch(reason) {
                case 'Surface Location': return 'background: #dbeafe; color: #1d4ed8;';
                case 'Bottom Hole': return 'background: #cffafe; color: #0e7490;';
                case 'Lateral Path': return 'background: #f3e8ff; color: #7c3aed;';
                case 'Adjacent Section': return 'background: #fef3c7; color: #92400e;';
                default: return 'background: #e5e7eb; color: #374151;';
            }
        }

        function getMatchReasonLabel(reason) {
            switch(reason) {
                case 'Surface Location': return 'Surface';
                case 'Bottom Hole': return 'Bottom Hole';
                case 'Lateral Path': return 'Lateral';
                case 'Adjacent Section': return 'Adjacent';
                default: return reason;
            }
        }

        // Show toast notification (top-right)
        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `
                <div style="padding: 12px 16px; background: ${type === 'success' ? '#10B981' : '#EF4444'}; color: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-size: 14px;">
                    ${message}
                </div>
            `;
            toast.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                z-index: 10000;
                animation: slideIn 0.3s ease;
            `;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }

        // Show toast notification (bottom-center, for map modals)
        function showMapToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 24px;
                border-radius: 8px;
                color: white;
                font-size: 14px;
                font-weight: 500;
                z-index: 1000002;
                animation: fadeIn 0.3s ease;
                ${type === 'success' ? 'background: #10b981;' : type === 'error' ? 'background: #ef4444;' : 'background: #3b82f6;'}
            `;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'fadeOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }


// ═══════════════════════════════════════════════
// Module: map-controls.txt
// ═══════════════════════════════════════════════
        // Toggle collapse/expand for map controls
        function toggleControls() {
            const controlsBar = document.getElementById('mapControlsBar');
            controlsBar.classList.toggle('collapsed');
        }
        
        // New Map Controls Logic
        
        // Primary toggle buttons
        document.querySelectorAll('.primary-toggles .toggle-btn').forEach(btn => {
            const checkbox = btn.querySelector('input');
            checkbox.addEventListener('change', function() {
                btn.classList.toggle('active', this.checked);
            });
        });
        
        // Overlays dropdown
        const overlaysBtn = document.getElementById('overlaysBtn');
        const overlaysMenu = document.getElementById('overlaysMenu');
        let overlaysOpen = false;
        
        overlaysBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            overlaysOpen = !overlaysOpen;
            overlaysMenu.classList.toggle('show', overlaysOpen);
            this.classList.toggle('active', overlaysOpen);
        });
        
        // Close overlays when clicking outside
        document.addEventListener('click', function(event) {
            if (overlaysOpen && !overlaysMenu.contains(event.target)) {
                overlaysOpen = false;
                overlaysMenu.classList.remove('show');
                overlaysBtn.classList.remove('active');
            }
        });
        
        // Update overlays button state
        function updateOverlaysButton() {
            const overlays = ['land-grid', 'section-numbers', 'county-labels'];
            const activeCount = overlays.filter(id =>
                document.getElementById(`toggle-${id}`).checked
            ).length;

            const btn = document.getElementById('overlaysBtn');
            const btnText = btn.querySelector('span');

            if (activeCount === 0) {
                btnText.textContent = 'Overlays';
                btn.classList.add('inactive');
                btn.classList.remove('active');
            } else {
                btnText.textContent = 'Overlays';
                btn.classList.remove('inactive');
                btn.classList.add('active');
            }

            // Update "All" checkbox
            const allCheckbox = document.getElementById('toggle-all-overlays');
            allCheckbox.checked = activeCount === overlays.length;
            allCheckbox.indeterminate = activeCount > 0 && activeCount < overlays.length;
        }
        
        // Handle overlay checkboxes
        document.querySelectorAll('.overlays-menu input[type="checkbox"]:not(#toggle-all-overlays)').forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                updateOverlaysButton();
            });
        });
        
        // Handle "All Overlays" checkbox
        document.getElementById('toggle-all-overlays').addEventListener('change', function() {
            const overlays = ['land-grid', 'section-numbers', 'county-labels'];
            const checked = this.checked;
            
            overlays.forEach(id => {
                const checkbox = document.getElementById(`toggle-${id}`);
                if (checkbox) {
                    checkbox.checked = checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            
            updateOverlaysButton();
        });
        
        // Initialize overlay button state
        updateOverlaysButton();


// ═══════════════════════════════════════════════
// Module: map-core.txt
// ═══════════════════════════════════════════════
        

        // Initialize map — if deep-link STR params present, start zoomed to township area
        // to avoid the "flash of Oklahoma" before the PLSS fetch completes
        const _initParams = new URLSearchParams(window.location.search);
        const _hasTRS = _initParams.get('section') && _initParams.get('township') && _initParams.get('range');
        const _hasWellOrProp = _initParams.get('well') || _initParams.get('property');
        const _initZoom = (_hasTRS || _hasWellOrProp) ? 12 : 7;
        const map = L.map('map').setView([35.5, -97.5], _initZoom);
        
        // Force popup pane to have high z-index
        // Leaflet uses 'popupPane' by default for popups
        setTimeout(() => {
            const popupPane = map.getPane('popupPane');
            if (popupPane) {
                popupPane.style.zIndex = '1500';
                popupPane.style.position = 'relative';
            }
        }, 100);
        
        // Basemap layers — light (default) and dark mode
        const lightBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19
        }).addTo(map);

        const lightRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            attribution: '',
            maxZoom: 19,
            opacity: 0.8
        }).addTo(map);

        const darkBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 20,
            subdomains: 'abcd'
        });

        let mapDarkMode = localStorage.getItem('mw_map_dark') !== '0';

        function toggleMapDarkMode() {
            mapDarkMode = !mapDarkMode;
            localStorage.setItem('mw_map_dark', mapDarkMode ? '1' : '0');
            applyMapDarkMode();
        }

        function applyMapDarkMode() {
            const btn = document.getElementById('darkModeBtn');
            if (mapDarkMode) {
                map.removeLayer(lightBase);
                map.removeLayer(lightRef);
                if (!map.hasLayer(darkBase)) darkBase.addTo(map);
                darkBase.bringToBack();
                document.getElementById('map').classList.add('map-dark');
                document.querySelector('.map-container').classList.add('map-dark');
                if (btn) btn.textContent = '🌙';
            } else {
                map.removeLayer(darkBase);
                if (!map.hasLayer(lightBase)) lightBase.addTo(map);
                if (!map.hasLayer(lightRef)) lightRef.addTo(map);
                lightBase.bringToBack();
                document.getElementById('map').classList.remove('map-dark');
                document.querySelector('.map-container').classList.remove('map-dark');
                if (btn) btn.textContent = '☀️';
            }
            // Restyle county boundaries for dark/light (guard: may not be loaded yet)
            try {
                if (typeof countyLayer !== 'undefined' && countyLayer) {
                    countyLayer.setStyle({
                        color: mapDarkMode ? 'rgba(255,255,255,0.6)' : '#1C2B36',
                        weight: mapDarkMode ? 1.5 : 3,
                        opacity: mapDarkMode ? 0.5 : 0.8,
                        fillOpacity: 0,
                        fillColor: 'transparent'
                    });
                }
                if (typeof createCountyLabels === 'function') {
                    createCountyLabels();
                }
            } catch (e) { /* counties not loaded yet — will pick up dark mode when they load */ }
            // Re-render section labels so they pick up dark/light colors
            try {
                if (typeof updateSectionLines === 'function') {
                    sectionBounds = null; // Force refresh
                    updateSectionLines();
                }
            } catch (e) { /* section lines not loaded yet */ }
            // Toggle legend dark mode
            const legend = document.getElementById('legendStrip');
            if (legend) {
                if (mapDarkMode) legend.classList.add('legend-dark');
                else legend.classList.remove('legend-dark');
            }
        }

        // Dark mode toggle — Leaflet control next to zoom buttons
        const DarkModeControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-control-darkmode leaflet-bar');
                const link = L.DomUtil.create('a', '', container);
                link.id = 'darkModeBtn';
                link.href = '#';
                link.title = 'Toggle dark mode';
                link.textContent = mapDarkMode ? '\uD83C\uDF19' : '\u2600\uFE0F';
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(link, 'click', function(e) {
                    L.DomEvent.preventDefault(e);
                    toggleMapDarkMode();
                });
                return container;
            }
        });
        map.addControl(new DarkModeControl());

        // Apply saved preference on load
        if (mapDarkMode) applyMapDarkMode();

        // Fullscreen toggle — Leaflet control next to zoom buttons
        let mapFullscreen = false;
        const FullscreenControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-control-fullscreen leaflet-bar');
                const link = L.DomUtil.create('a', '', container);
                link.id = 'fullscreenBtn';
                link.href = '#';
                link.title = 'Toggle fullscreen';
                link.textContent = '\u26F6';
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(link, 'click', function(e) {
                    L.DomEvent.preventDefault(e);
                    toggleMapFullscreen();
                });
                return container;
            }
        });
        map.addControl(new FullscreenControl());

        function toggleMapFullscreen() {
            const container = document.querySelector('.map-container');
            const btn = document.getElementById('fullscreenBtn');
            const searchBox = document.querySelector('.map-search-container');
            const pageHeader = document.querySelector('.page-header');
            if (!container) return;

            mapFullscreen = !mapFullscreen;
            if (mapFullscreen) {
                container.classList.add('map-fullscreen');
                if (btn) btn.textContent = '\u2715';
                document.body.style.overflow = 'hidden';
                // Move search into the map container
                if (searchBox) container.appendChild(searchBox);
            } else {
                container.classList.remove('map-fullscreen');
                if (btn) btn.textContent = '\u26F6';
                document.body.style.overflow = '';
                // Move search back to page header
                if (searchBox && pageHeader) {
                    const h1 = pageHeader.querySelector('h1');
                    if (h1) h1.after(searchBox);
                }
            }
            setTimeout(() => map.invalidateSize(), 50);
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && mapFullscreen) {
                toggleMapFullscreen();
            }
        });
        
        
        // Map click handler for location identification - DISABLED
        // (Was showing unreadable info in top-right corner)
        /*
        map.on('click', async function(e) {
            const lat = e.latlng.lat;
            const lon = e.latlng.lng;
            
            // Only identify if clicked within Oklahoma bounds (roughly)
            if (lat < 33.6 || lat > 37.0 || lon < -103.0 || lon > -94.4) {
                return; // Outside Oklahoma
            }
            
            try {
                updateStatus('Identifying location...');
                const location = await identifyLocation(lat, lon);
                
                if (location) {
                    createLocationInfoBox(
                        location.county, 
                        location.township, 
                        location.range, 
                        location.section,
                        location.meridian,
                        lat, 
                        lon
                    );
                    updateStatus('Map ready');
                } else {
                    updateStatus('Location not found');
                    setTimeout(() => updateStatus('Map ready'), 2000);
                }
            } catch (error) {
                console.error('Error identifying location:', error);
                updateStatus('Location identification failed');
                setTimeout(() => updateStatus('Map ready'), 2000);
            }
        });
        */
        
        // Add zoom/move handlers for section lines
        map.on('zoomend moveend', updateSectionLines);

        // Layer variables
        let countyLayer;
        let townshipLayer;
        let countyLabelsLayer = L.layerGroup();
        let propertiesLayer = L.featureGroup();
        let wellsLayer = null; // Will be initialized as MarkerClusterGroup in loadTrackedWells
        // Lateral paths are now integrated into well rendering
        let permitsLayer = L.featureGroup();
        let completionsLayer = L.featureGroup();
        let sectionLayer = L.featureGroup();
        let sectionLabelsLayer = L.layerGroup();  // For section number labels from OCC API
        let nearbyWellsLayer = null; // Initialize later after map is ready
        let nearbyLateralsLayer = L.featureGroup(); // Separate layer for nearby well laterals (zoom-gated)
        let lateralsLayer = L.featureGroup(); // Layer for horizontal well laterals
        let activityHeatmapLayer = null; // Will be created as heat layer
        let poolingRateLayer = null; // Choropleth: pooling bonus rates by township
        let poolingRateByTwp = {}; // Lookup: "09N-05W" -> { avg_bonus, order_count, ... }
        let permitHeatmapLayer = null; // Separate heat layer for permits
        let completionHeatmapLayer = null; // Separate heat layer for completions
        // OCC Application heatmap layers
        let poolingHeatmapLayer = null;
        let densityHeatmapLayer = null;
        let spacingHeatmapLayer = null;
        let horizontalHeatmapLayer = null;
        let countyProductionData = null; // Cached county production data for choropleth
        let currentProductionType = null; // 'oil' or 'gas'
        let showSectionNumbers = true;  // Default to showing section numbers
        let showActivityHeatmap = true; // Default to on for heatmap
        let locationInfoBox;
        
        // Define proximity radius for individual markers (in miles)
        const ACTIVITY_PROXIMITY_RADIUS = 5; // 5 miles around properties
        
        // Property loading state
        let userProperties = [];
        let geometryCache = {};
        let sectionCache = {};
        let sectionBounds = null;
        let wellsById = {};  // Lookup for wells by Airtable record ID
        
        // For search functionality
        let propertyMarkers = {};
        let wellMarkers = {};
        let trackedWells = [];
        
        // OCC API Configuration
        const OCC_API_BASE = 'https://gis.occ.ok.gov/server/rest/services/Hosted/STR/FeatureServer';
        const OCC_PROXY = '/api/occ-proxy';
        const SECTION_LAYER = 226; // OK_SEC layer
        
        // Property status colors
        const STATUS_COLORS = {
            active: '#22C55E',   // Green - permits nearby
            recent: '#F59E0B',   // Yellow - activity in last 30 days  
            quiet: '#3B82F6',    // Blue - no recent activity
            default: '#8B5CF6'   // Purple - default
        };
        
        // Well status colors
        const WELL_STATUS_COLORS = {
            'AC': '#22C55E',     // Active - Green
            'PA': '#6B7280',     // Plugged & Abandoned - Gray
            'ND': '#F97316',     // New Drill - Orange
            'SI': '#3B82F6',     // Shut In - Blue
            'TA': '#DC2626',     // Temp Abandoned - Red
            default: '#8B5CF6'   // Default - Purple
        };
        
        // Top operator colors
        const OPERATOR_COLORS = {
            'DEVON': '#1E40AF',              // Blue
            'CONTINENTAL': '#DC2626',        // Red
            'MEWBOURNE': '#059669',          // Green
            'MARATHON': '#7C3AED',           // Purple
            'EOG': '#F59E0B',               // Amber
            'OVINTIV': '#0891B2',           // Cyan
            'CIMAREX': '#EC4899',           // Pink
            'GULFPORT': '#84CC16',          // Lime
            'CITIZENS': '#F97316',          // Orange
            'CHESAPEAKE': '#06B6D4',        // Sky
            default: '#6B7280'              // Gray
        };
        
        // Authentication: checkAuth(), logout(), setupImpersonation(), loadImpersonationBanner()
        // are provided by shared-auth.txt (loaded before this module)

        // Update status
        function updateStatus(message) {
            // Log to console only - no UI updates
            console.log('Status:', message);
        }
        
        function showLoading(message = 'Loading map data...', subtext = '') {
            const loadingEl = document.getElementById('mapLoading');
            if (loadingEl) {
                loadingEl.style.display = 'flex';
                const textEl = loadingEl.querySelector('.loading-text');
                const subtextEl = loadingEl.querySelector('.loading-subtext');
                if (textEl) textEl.textContent = message;
                if (subtextEl) {
                    subtextEl.textContent = subtext;
                    subtextEl.style.display = subtext ? 'block' : 'none';
                }
            }
        }
        
        function hideLoading() {
            const loadingEl = document.getElementById('mapLoading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }


// ═══════════════════════════════════════════════
// Module: map-geo.txt
// ═══════════════════════════════════════════════
        
        function hasCachedBoundaries() {
            // Check if both counties and townships are cached
            const countiesCache = localStorage.getItem('counties_cache');
            const townshipsCache = localStorage.getItem('townships_cache');
            
            if (!countiesCache || !townshipsCache) return false;
            
            try {
                // Validate cache has data
                const counties = JSON.parse(countiesCache);
                const townships = JSON.parse(townshipsCache);
                return counties.data && counties.data.features && counties.data.features.length > 0 &&
                       townships.data && townships.data.features && townships.data.features.length > 0;
            } catch (e) {
                return false;
            }
        }
        
        // Location identification functions
        async function identifyLocation(lat, lon) {
            try {
                const url = `${OCC_API_BASE}/${SECTION_LAYER}/query?` + 
                    `geometry=${lon},${lat}&` +
                    `geometryType=esriGeometryPoint&` +
                    `inSR=4326&` +  // WGS84 input
                    `outSR=4326&` +  // WGS84 output
                    `spatialRel=esriSpatialRelIntersects&` +
                    `outFields=plssid,frstdivno,frstdivtxt&` +
                    `f=json`;
                
                const proxyUrl = `${OCC_PROXY}?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                
                if (!response.ok) {
                    console.error('Location query failed:', response.status);
                    return null;
                }
                
                const data = await response.json();
                
                if (data.features && data.features.length > 0) {
                    const attrs = data.features[0].attributes;
                    console.log('OCC response - PLSS ID:', attrs.plssid, 'Section:', attrs.frstdivno); // Debug log
                    
                    // Parse PLSS ID to extract township/range info
                    // Format is like "OK170210N0180W0" 
                    const plssId = attrs.plssid || '';
                    let township = 'Unknown';
                    let range = 'Unknown';
                    
                    if (plssId) {
                        console.log('Parsing PLSS ID:', plssId);
                        
                        // Try new format first: "OK170230N0080W0"
                        let plssMatch = plssId.match(/OK\d{2}(\d{3})([NS])(\d{3})([EW])/);
                        if (plssMatch) {
                            // Remove leading zeros and format properly
                            const twpNum = parseInt(plssMatch[1], 10);
                            const twpDir = plssMatch[2];
                            township = twpNum + twpDir;
                            
                            const rngNum = parseInt(plssMatch[3], 10);
                            const rngDir = plssMatch[4];
                            range = rngNum + rngDir;
                        } else {
                            // Try simpler format - look for patterns like "18N" and "14W"
                            // Handle cases where there might be leading zeros or different formatting
                            const parts = plssId.match(/(\d+)([NS])\D*(\d+)([EW])/);
                            if (parts) {
                                // Take last 2 digits if number is too large (e.g., 180 -> 18, 140 -> 14)
                                let twpNum = parseInt(parts[1]);
                                if (twpNum > 36) {
                                    twpNum = parseInt(parts[1].slice(-2));
                                }
                                township = twpNum + parts[2];
                                
                                let rngNum = parseInt(parts[3]);
                                if (rngNum > 36) {
                                    rngNum = parseInt(parts[3].slice(-2));
                                }
                                range = rngNum + parts[4];
                            }
                        }
                    }
                    
                    // Get county from PLSS ID lookup or fall back to method
                    const countyCode = plssId.substring(2, 4); // Extract county code from PLSS
                    const county = getCountyFromPlssCode(countyCode) || 'Unknown';
                    
                    // Determine meridian from PLSS state code
                    // OK11 = Cimarron Meridian (panhandle), OK17 = Indian Meridian (rest of state)
                    const stateCode = plssId.substring(0, 4);
                    const meridian = stateCode === 'OK11' ? 'CM' : 'IM';
                    
                    return {
                        county: county,
                        township: township,
                        range: range,
                        section: attrs.frstdivno || 'Unknown',
                        meridian: meridian
                    };
                }
                
                return null;
            } catch (error) {
                console.error('Error identifying location:', error);
                return null;
            }
        }
        
        function createLocationInfoBox(county, township, range, section, meridian, lat, lon) {
            // Remove existing info box
            if (locationInfoBox) {
                map.removeControl(locationInfoBox);
            }
            
            // Format location string to show section prominently: '21N 18W 12 • Woodward • IM'
            const locationText = section ? 
                `${township} ${range} ${section} • ${county} • ${meridian}` :
                `${township} ${range} • ${county} • ${meridian}`;
            
            // Create custom control for location info
            const LocationInfo = L.Control.extend({
                onAdd: function(map) {
                    const div = L.DomUtil.create('div', 'location-info');
                    div.innerHTML = `
                        <div style="background: rgba(255,255,255,0.95); padding: 8px 12px; border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-size: 13px; font-weight: 500; color: #1f2937; border-left: 4px solid #3b82f6;">
                            📍 ${locationText}
                            <span style="display: block; font-size: 11px; color: #6b7280; margin-top: 2px;">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>
                        </div>
                    `;
                    
                    // Prevent map interactions on the info box
                    L.DomEvent.disableClickPropagation(div);
                    L.DomEvent.disableScrollPropagation(div);
                    
                    return div;
                },
                
                onRemove: function(map) {
                    // Nothing to do here
                }
            });
            
            locationInfoBox = new LocationInfo({ position: 'topright' });
            locationInfoBox.addTo(map);
            
            // Auto-hide after 8 seconds
            setTimeout(() => {
                if (locationInfoBox) {
                    map.removeControl(locationInfoBox);
                    locationInfoBox = null;
                }
            }, 8000);
        }
        
        // County code to name mapping (from PLSS codes)
        function getCountyFromPlssCode(code) {
            const countyMap = {
                '01': 'Adair', '02': 'Alfalfa', '03': 'Atoka', '04': 'Beaver',
                '05': 'Beckham', '06': 'Blaine', '07': 'Bryan', '08': 'Caddo',
                '09': 'Canadian', '10': 'Carter', '11': 'Cherokee', '12': 'Choctaw',
                '13': 'Cimarron', '14': 'Cleveland', '15': 'Coal', '16': 'Comanche',
                '17': 'Cotton', '18': 'Craig', '19': 'Creek', '20': 'Custer',
                '21': 'Delaware', '22': 'Dewey', '23': 'Ellis', '24': 'Garfield',
                '25': 'Garvin', '26': 'Grady', '27': 'Grant', '28': 'Greer',
                '29': 'Harmon', '30': 'Harper', '31': 'Haskell', '32': 'Hughes',
                '33': 'Jackson', '34': 'Jefferson', '35': 'Johnston', '36': 'Kay',
                '37': 'Kingfisher', '38': 'Kiowa', '39': 'Latimer', '40': 'Le Flore',
                '41': 'Lincoln', '42': 'Logan', '43': 'Love', '44': 'McClain',
                '45': 'McCurtain', '46': 'McIntosh', '47': 'Major', '48': 'Marshall',
                '49': 'Mayes', '50': 'Murray', '51': 'Muskogee', '52': 'Noble',
                '53': 'Nowata', '54': 'Okfuskee', '55': 'Oklahoma', '56': 'Okmulgee',
                '57': 'Osage', '58': 'Ottawa', '59': 'Pawnee', '60': 'Payne',
                '61': 'Pittsburg', '62': 'Pontotoc', '63': 'Pottawatomie', '64': 'Pushmataha',
                '65': 'Roger Mills', '66': 'Rogers', '67': 'Seminole', '68': 'Sequoyah',
                '69': 'Stephens', '70': 'Texas', '71': 'Tillman', '72': 'Tulsa',
                '73': 'Wagoner', '74': 'Washington', '75': 'Washita', '76': 'Woods',
                '77': 'Woodward'
            };
            return countyMap[code];
        }
        
        // Section lines functionality
        async function loadSectionsInBounds(bounds) {
            const boundsKey = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
            
            // Check cache
            if (sectionCache[boundsKey]) {
                return sectionCache[boundsKey];
            }
            
            try {
                // Correct order: minX,minY,maxX,maxY
                const minX = bounds.getWest();
                const minY = bounds.getSouth();
                const maxX = bounds.getEast();
                const maxY = bounds.getNorth();
                const bbox = `${minX},${minY},${maxX},${maxY}`;
                
                // Use correct field names: frstdivno (section), plssid (township/range info)
                const url = `${OCC_API_BASE}/${SECTION_LAYER}/query?` +
                    `geometry=${bbox}&` +
                    `geometryType=esriGeometryEnvelope&` +
                    `inSR=4326&` +  // WGS84
                    `outSR=4326&` +  // WGS84
                    `spatialRel=esriSpatialRelIntersects&` +
                    `outFields=objectid,plssid,frstdivno,frstdivtyp,frstdivtxt&` +
                    `returnGeometry=true&` +
                    `f=geojson&` +
                    `resultRecordCount=2000`;  // Get more sections
                    
                const proxyUrl = `${OCC_PROXY}?url=${encodeURIComponent(url)}`;
                console.log('Fetching sections:', url);
                const response = await fetch(proxyUrl);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Section query error:', response.status, errorText);
                    throw new Error(`Section query failed: ${response.status}`);
                }
                
                const data = await response.json();
                sectionCache[boundsKey] = data;
                return data;
                
            } catch (error) {
                console.error('Error loading sections:', error);
                return null;
            }
        }
        
        function renderSectionLines(geojsonData) {
            if (!geojsonData || !geojsonData.features) return;

            // Clear existing section lines and labels
            sectionLayer.clearLayers();
            sectionLabelsLayer.clearLayers();

            const zoom = map.getZoom();

            geojsonData.features.forEach(feature => {
                // Add section boundary line
                const sectionLine = L.geoJSON(feature, {
                    style: {
                        color: '#F59E0B',        // Orange - distinct from townships
                        weight: 0.5,             // Very thin for sections
                        opacity: 0.6,
                        fillOpacity: 0,          // No fill - stroke only
                        fill: false,
                        dashArray: '1, 2'       // Tight dots for sections
                    },
                    onEachFeature: function(feature, layer) {
                        if (feature.properties) {
                            const props = feature.properties;
                            const sectionNum = props.frstdivno || '?';
                            const plssId = props.plssid || '';
                            
                            // Parse township and range from PLSS ID
                            let township = '', range = '', meridian = 'IM';
                            if (plssId) {
                                const townshipMatch = plssId.match(/(\d{2,3})([NS])/);
                                if (townshipMatch) {
                                    township = parseInt(townshipMatch[1]) + townshipMatch[2];
                                }
                                const rangeMatch = plssId.match(/(\d{2,3})([EW])/);
                                if (rangeMatch) {
                                    range = parseInt(rangeMatch[1]) + rangeMatch[2];
                                }
                                // Check meridian from state code
                                if (plssId.startsWith('OK11')) {
                                    meridian = 'CM';
                                }
                            }
                            
                            const sectionInfo = `${formatTRS(township, range, sectionNum)} • ${meridian}`;
                            layer.bindTooltip(sectionInfo, {
                                sticky: true,
                                opacity: 0.9
                            });
                        }
                    }
                });
                
                sectionLayer.addLayer(sectionLine);
                
                // Add section number label at centroid (only if checkbox is checked)
                if (showSectionNumbers && feature.properties && feature.properties.frstdivno) {
                    const sectionNum = feature.properties.frstdivno;
                    
                    // Calculate centroid of the section polygon
                    let centroid = null;
                    if (feature.geometry && feature.geometry.coordinates) {
                        try {
                            // Handle Polygon and MultiPolygon
                            let coords;
                            if (feature.geometry.type === 'Polygon') {
                                coords = feature.geometry.coordinates[0]; // outer ring
                            } else if (feature.geometry.type === 'MultiPolygon') {
                                coords = feature.geometry.coordinates[0][0]; // first polygon's outer ring
                            }
                            
                            if (coords && coords.length > 0) {
                                // Simple centroid calculation (average of coordinates)
                                let sumLat = 0, sumLng = 0;
                                coords.forEach(coord => {
                                    sumLng += coord[0];
                                    sumLat += coord[1];
                                });
                                centroid = {
                                    lat: sumLat / coords.length,
                                    lng: sumLng / coords.length
                                };
                            }
                        } catch (e) {
                            console.warn('Could not calculate centroid for section', sectionNum, e);
                        }
                    }
                    
                    if (centroid) {
                        // Scale font size based on zoom
                        const fontSize = zoom < 13 ? '10px' : zoom < 15 ? '12px' : '14px';
                        
                        const isDark = typeof mapDarkMode !== 'undefined' && mapDarkMode;
                        const lblColor = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(180, 83, 9, 0.95)';
                        const lblShadow = isDark
                            ? '-1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8)'
                            : '-1px -1px 0 rgba(255,255,255,0.9), 1px -1px 0 rgba(255,255,255,0.9), -1px 1px 0 rgba(255,255,255,0.9), 1px 1px 0 rgba(255,255,255,0.9)';
                        const sectionLabel = L.divIcon({
                            className: 'section-number-label',
                            html: `<div style="
                                color: ${lblColor};
                                font-family: 'Inter', sans-serif;
                                font-size: ${fontSize};
                                font-weight: 700;
                                text-align: center;
                                white-space: nowrap;
                                pointer-events: none;
                                text-shadow: ${lblShadow};
                            ">${sectionNum}</div>`,
                            iconSize: [24, 16],
                            iconAnchor: [12, 8]
                        });
                        
                        const marker = L.marker([centroid.lat, centroid.lng], { 
                            icon: sectionLabel,
                            interactive: false
                        });
                        
                        sectionLabelsLayer.addLayer(marker);
                    }
                }
            });
            
            // Add labels layer to map if it should be visible
            if (showSectionNumbers && !map.hasLayer(sectionLabelsLayer)) {
                map.addLayer(sectionLabelsLayer);
            }
        }
        
        async function updateSectionLines() {
            const zoom = map.getZoom();

            if (zoom >= 12) {
                const bounds = map.getBounds();

                // Only update if bounds changed significantly
                if (!sectionBounds || !sectionBounds.contains(bounds)) {
                    updateStatus('Loading section lines...');

                    const sectionsData = await loadSectionsInBounds(bounds);
                    if (sectionsData) {
                        renderSectionLines(sectionsData);

                        // Add section lines to map if not already added
                        if (!map.hasLayer(sectionLayer)) {
                            map.addLayer(sectionLayer);
                        }

                        sectionBounds = bounds.pad(0.5); // Pad for less frequent updates
                    }
                    updateStatus('Map ready');
                }
            } else {
                // Remove section lines and labels at zoom < 12
                if (map.hasLayer(sectionLayer)) {
                    map.removeLayer(sectionLayer);
                }
                if (map.hasLayer(sectionLabelsLayer)) {
                    map.removeLayer(sectionLabelsLayer);
                }
                sectionBounds = null;
            }
        }
        
        // Oklahoma Principal Meridians
        const OKLAHOMA_MERIDIANS = {
            'INDIAN': 'OK17',
            'CIMARRON': 'OK11' // Confirmed from OCC API data
        };
        
        // Determine meridian based on county location
        function getMeridianCode(twn, rng, county = '') {
            // Cimarron Meridian is only used in Oklahoma panhandle counties
            const panhandleCounties = ['BEAVER', 'CIMARRON', 'TEXAS'];
            
            // Extract county name from formats like "045-ELLIS" or "ELLIS County"
            let countyName = county.toUpperCase();
            if (countyName.includes('-')) {
                // Format: "045-ELLIS" -> "ELLIS"
                countyName = countyName.split('-')[1];
            }
            countyName = countyName.replace(' COUNTY', '').trim();
            
            if (panhandleCounties.includes(countyName)) {
                return 'OK11'; // Cimarron Meridian for panhandle
            }
            
            return 'OK17'; // Indian Meridian for all other Oklahoma counties
        }
        
        // PLSS ID formatter for OCC API with meridian detection
        function formatPlssId(twn, rng, county = '', meridianCode = null) {
            // Parse township: "22N" -> { num: 22, dir: 'N' }
            const twnMatch = twn.match(/(\d+)([NS])/i);
            if (!twnMatch) return null;
            const twnNum = twnMatch[1].padStart(3, '0');
            const twnDir = twnMatch[2].toUpperCase();
            
            // Parse range: "19W" or "08W" or "8W" -> { num: 19, dir: 'W' }
            const rngMatch = rng.match(/(\d+)([EW])/i);
            if (!rngMatch) return null;
            // Ensure range is exactly 3 digits (was incorrectly using 4 digits for RRRR)
            const rngNum = rngMatch[1].padStart(3, '0');
            const rngDir = rngMatch[2].toUpperCase();
            
            // Determine meridian if not provided
            if (!meridianCode) {
                meridianCode = getMeridianCode(twn, rng, county);
            }
            
            // Format: [MERIDIAN]TTT0DRRR0D0
            // Note: TTT is 3 digits for township, RRR is 3 digits for range
            const plssId = `${meridianCode}${twnNum}0${twnDir}${rngNum}0${rngDir}0`;
            
            // Log the formatted PLSS ID for debugging
            console.log(`Formatted PLSS ID: T${twn} R${rng} → ${plssId} (${meridianCode === 'OK11' ? 'Cimarron' : 'Indian'} Meridian)`);
            
            return plssId;
        }
        
        // Get PLSS ID for a location (single meridian based on county)
        function getPlssId(twn, rng, county = '') {
            const meridianCode = getMeridianCode(twn, rng, county);
            const plssId = formatPlssId(twn, rng, county, meridianCode);
            
            if (!plssId) {
                console.error('Invalid township/range format:', twn, rng);
                return null;
            }
            
            return {
                id: plssId,
                meridian: meridianCode === 'OK11' ? 'cimarron' : 'indian'
            };
        }
        
        // Fetch section geometry from D1 database with caching
        async function fetchSectionGeometry(section, twn, rng, county = '') {
            const cacheKey = `${section}-${twn}-${rng}`;

            // Check memory cache first
            if (geometryCache[cacheKey]) {
                return geometryCache[cacheKey];
            }

            // Check localStorage cache
            const stored = localStorage.getItem(`mw_section_${cacheKey}`);
            if (stored) {
                try {
                    const _raw = JSON.parse(stored);
                    const parsed = _raw && _raw.d !== undefined ? _raw.d : _raw;
                    geometryCache[cacheKey] = parsed;
                    return parsed;
                } catch (e) {
                    console.warn('Invalid cached data, removing:', cacheKey);
                    localStorage.removeItem(`mw_section_${cacheKey}`);
                }
            }

            // Try D1 database first (fast, local)
            try {
                const d1Url = `/api/plss-section?section=${encodeURIComponent(section)}&township=${encodeURIComponent(twn)}&range=${encodeURIComponent(rng)}`;
                const response = await fetch(d1Url, { credentials: 'include' });

                if (response.ok) {
                    const feature = await response.json();
                    if (feature && feature.geometry) {
                        console.log(`✅ Found geometry from D1 for Section ${section} T${twn} R${rng}`);
                        geometryCache[cacheKey] = feature;
                        localStorage.setItem(`mw_section_${cacheKey}`, JSON.stringify({t:Date.now(),d:feature}));
                        return feature;
                    }
                }
            } catch (err) {
                console.warn(`D1 fetch failed for ${cacheKey}:`, err.message);
            }

            // Fallback to OCC API for sections not in D1 (very new permits)
            const primaryPlss = getPlssId(twn, rng, county);
            if (primaryPlss) {
                const result = await tryFetchFromOcc(section, primaryPlss, cacheKey);
                if (result) return result;
            }

            // If primary fails, try the other meridian as fallback
            const fallbackMeridian = primaryPlss?.meridian === 'cimarron' ? 'OK17' : 'OK11';
            const fallbackPlss = formatPlssId(twn, rng, county, fallbackMeridian);
            if (fallbackPlss) {
                console.log(`Primary meridian failed, trying fallback: ${fallbackPlss}`);
                const fallbackData = {
                    id: fallbackPlss,
                    meridian: fallbackMeridian === 'OK11' ? 'cimarron' : 'indian'
                };
                const result = await tryFetchFromOcc(section, fallbackData, cacheKey);
                if (result) return result;
            }

            // Extract clean county name for error message
            let countyName = county;
            if (countyName.includes('-')) {
                countyName = countyName.split('-')[1];
            }
            countyName = countyName.replace(' County', '').trim();

            console.error(`❌ No geometry found for Section ${section} T${twn} R${rng} in ${countyName} County`);
            return null;
        }

        // Helper function to try fetching from OCC API (fallback)
        async function tryFetchFromOcc(section, plssData, cacheKey) {
            const { id: plssId, meridian } = plssData;
            console.log(`🔍 Fallback: fetching Section ${section} from OCC with PLSS ID: ${plssId}`);

            const paddedSection = section.toString().padStart(2, '0');

            const url = `${OCC_API_BASE}/${SECTION_LAYER}/query?` +
                `where=frstdivno='${paddedSection}' AND plssid='${plssId}'` +
                `&outFields=frstdivno,frstdivlab,gisacre,plssid,survtyptxt` +
                `&f=geojson` +
                `&outSR=4326`;

            try {
                const proxyUrl = `${OCC_PROXY}?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);

                if (!response.ok) {
                    return null;
                }

                const data = await response.json();

                if (data.features && data.features.length > 0) {
                    const feature = data.features[0];
                    console.log(`✅ Found geometry from OCC for Section ${section}`);
                    geometryCache[cacheKey] = feature;
                    localStorage.setItem(`mw_section_${cacheKey}`, JSON.stringify({t:Date.now(),d:feature}));
                    return feature;
                }
                return null;
            } catch (err) {
                console.warn(`OCC fetch failed for ${cacheKey}:`, err.message);
                return null;
            }
        }
        
        // Fetch user properties from API (V2 D1-first endpoint)
        async function fetchUserProperties() {
            try {
                console.log('[Properties] Fetching user properties...');
                const response = await fetch('/api/properties/v2', { credentials: 'include' });
                console.log('[Properties] Response status:', response.status, response.statusText);
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[Properties] Error response:', errorText);
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const data = await response.json();
                const properties = data.records || [];
                console.log(`[Properties] Loaded ${properties.length} properties:`, properties.slice(0, 2));
                return properties;
            } catch (error) {
                console.error('[Properties] Error fetching properties:', error);
                return [];
            }
        }
        
        // Parse coordinates from OCC Map Link URL
        function parseOccMapLink(occMapLink) {
            if (!occMapLink || occMapLink === '#') return null;
            
            // Pattern: marker=<lon>,<lat>
            const match = occMapLink.match(/marker=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (match) {
                return {
                    lon: parseFloat(match[1]),
                    lat: parseFloat(match[2])
                };
            }
            return null;
        }
        
        // Get approximate center coordinates for a section
        async function getSectionCenter(section, township, range, county = '') {
            if (!section || !township || !range) return null;
            
            const cacheKey = `${section}-${township}-${range}`;
            
            // Check cache
            if (geometryCache[cacheKey]) {
                console.log(`📍 Using cached geometry for ${cacheKey}`);
                const bounds = L.geoJSON(geometryCache[cacheKey]).getBounds();
                return bounds.getCenter();
            }
            
            // Check localStorage cache
            const stored = localStorage.getItem(`mw_section_${cacheKey}`);
            if (stored) {
                try {
                    const _raw = JSON.parse(stored);
                    const parsed = _raw && _raw.d !== undefined ? _raw.d : _raw;
                    console.log(`📍 Using localStorage cached geometry for ${cacheKey}`);
                    geometryCache[cacheKey] = parsed;
                    const bounds = L.geoJSON(parsed).getBounds();
                    return bounds.getCenter();
                } catch (e) {
                    console.warn('Invalid cached data, removing:', cacheKey);
                    localStorage.removeItem(`mw_section_${cacheKey}`);
                }
            }
            
            console.log(`🔎 Need to fetch geometry for ${cacheKey}`);
            // Try to fetch section geometry
            const geometry = await fetchSectionGeometry(section, township, range, county);
            if (geometry) {
                const bounds = L.geoJSON(geometry).getBounds();
                return bounds.getCenter();
            }
            
            // No fallback needed - the zero-padding fix should resolve most missing sections
            console.log(`❌ Could not find geometry for ${cacheKey} after trying both meridians`);
            return null;
        }
        
        // Draw lateral path from surface to bottom hole
        function drawLateralPath(surfaceCoords, bhCoords, wellData, pathType = 'tracked') {
            if (!surfaceCoords || !bhCoords) return null;
            
            const wellName = wellData.well_name || `API ${wellData.apiNumber || wellData.api_number}`;
            const operator = wellData.operator || 'Unknown';
            const status = wellData.well_status || wellData.well_status_code || 'Unknown';
            const formation = wellData.formation_name || '';
            
            // Determine color based on type
            let pathColor = '#6B7280'; // Default gray
            if (pathType === 'permit') {
                pathColor = '#F59E0B'; // Yellow for permits
            } else if (pathType === 'completion') {
                pathColor = '#3B82F6'; // Blue for completions
            } else if (pathType === 'nearby') {
                // For nearby wells, use green for oil, red for gas
                const wellType = wellData.well_type || '';
                if (wellType.toLowerCase().includes('gas')) {
                    pathColor = '#EF4444'; // Red for gas
                } else {
                    pathColor = '#22C55E'; // Green for oil (default)
                }
            } else if (status === 'AC') {
                pathColor = '#22C55E'; // Green for active tracked wells
            }
            
            // Create straight line path for clarity
            const pathCoords = [
                [surfaceCoords.lat, surfaceCoords.lon || surfaceCoords.lng],
                [bhCoords.lat, bhCoords.lng || bhCoords.lon]
            ];
            
            // Create the path with gradient style to show direction
            const path = L.polyline(pathCoords, {
                color: pathColor,
                weight: 5,  // Slightly thicker for better visibility
                opacity: 0.8,  // Slightly more opaque
                className: 'lateral-path'  // CSS class for potential styling
            });
            
            // Add a second line with dash pattern for direction
            const directionPath = L.polyline(pathCoords, {
                color: 'white',
                weight: 2,
                opacity: 0.9,  // More visible white dash
                dashArray: '10, 10',
                dashOffset: '5',
                className: 'lateral-path-direction'
            });
            
            // Create a group for both lines
            const pathGroup = L.layerGroup([path, directionPath]);
            
            // Calculate distance
            const distance = map.distance(
                [surfaceCoords.lat, surfaceCoords.lon || surfaceCoords.lng],
                [bhCoords.lat, bhCoords.lng || bhCoords.lon]
            );
            const distanceFt = Math.round(distance * 3.28084); // Convert meters to feet
            
            // Popup for the lateral path
            const lateralLength = wellData.lateral_length ? `${Number(wellData.lateral_length).toLocaleString()} ft` : `~${distanceFt.toLocaleString()} ft`;
            const popupContent = `
                <div class="popup-header">
                    <span class="popup-tag" style="background: ${pathColor}; color: white;">Horizontal Lateral</span>
                </div>
                <div style="font-weight: 600; margin-bottom: 8px;">${wellName}</div>
                <div style="font-size: 12px; color: #64748B;">
                    ${operator}<br>
                    ${formation ? `Formation: ${formation}<br>` : ''}
                    Lateral Length: ${lateralLength}<br>
                    ${pathType === 'tracked' ? `Status: ${status}` : `Type: ${pathType.charAt(0).toUpperCase() + pathType.slice(1)}`}
                </div>
            `;
            
            pathGroup.bindPopup(popupContent, {
                maxWidth: 300,
                className: 'high-z-popup'
            });
            
            return pathGroup;
        }
        
        // Get operator color with normalization
        function getOperatorColor(operator) {
            if (!operator) return OPERATOR_COLORS.default;
            
            // Normalize operator name for matching
            const normalized = operator.toUpperCase().trim();
            
            // Check for exact match first
            if (OPERATOR_COLORS[normalized]) {
                return OPERATOR_COLORS[normalized];
            }
            
            // Check if operator name contains any of our key operators
            for (const [key, color] of Object.entries(OPERATOR_COLORS)) {
                if (key !== 'default' && normalized.includes(key)) {
                    return color;
                }
            }
            
            return OPERATOR_COLORS.default;
        }
        
        // Fetch tracked wells from API
        async function fetchTrackedWells() {
            try {
                console.log('Fetching tracked wells...');
                const response = await fetch('/api/wells/v2', { credentials: 'include' });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const data = await response.json();
                const wells = data.records || data;
                console.log(`Loaded ${wells.length} wells`);
                return wells;
            } catch (error) {
                console.error('Error fetching wells:', error);
                return [];
            }
        }
        
        // Create individual tracked well marker
        function createTrackedWellMarker(well, coords) {
            const wellStatus = well.well_status || 'Unknown';
            const isPlugged = wellStatus === 'PA';

            // Tracked wells: white fill + cyan border/glow — distinct from type-colored nearby wells
            const dotSize = 12;
            const borderColor = isPlugged ? '#94A3B8' : '#06B6D4';
            const glow = isPlugged ? 'none' : '0 0 8px 3px rgba(6,182,212,0.55)';

            const icon = L.divIcon({
                className: 'tw-dot',
                html: `<div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:#fff;border:2.5px solid ${borderColor};box-shadow:${glow};opacity:${isPlugged ? 0.55 : 1};"></div>`,
                iconSize: [dotSize, dotSize],
                iconAnchor: [dotSize / 2, dotSize / 2],
                popupAnchor: [0, -dotSize / 2]
            });

            const marker = L.marker([coords.lat, coords.lon], { icon: icon });
            
            // Create popup content
            const wellName = toTitleCase(well.well_name || `API ${well.apiNumber}`);
            const operator = toTitleCase(well.operator || 'Unknown');
            const wellStatusLabel = getStatusLabel(wellStatus);
            const formation = toTitleCase(well.formation_name || '');

            const popupContent = `
                <div class="popup-header">
                    <span class="popup-tag tracked-well">Tracked Well</span>
                </div>
                <div class="popup-well-name">${wellName}</div>
                <div class="popup-details">
                    ${operator}<br>
                    ${well.section ? `${formatTRS(well.township, well.range, well.section)} • ` : ''}${well.county || 'Unknown'}<br>
                    Status: ${wellStatusLabel}${formation ? ` • ${formation}` : ''}
                </div>
                <div class="popup-actions">
                    <button class="popup-btn popup-btn-secondary" onclick="expandWellCard('${well.id}'); return false;">More →</button>
                </div>
            `;

            marker.bindPopup(popupContent, {
                maxWidth: 300,
                className: 'high-z-popup'
            });

            return marker;
        }

        // Create clustered marker for multiple wells at same location (with lateral paths) - LEGACY, keeping for reference
        function createClusteredWellMarker(wellsAtLocation) {
            const firstWell = wellsAtLocation[0];
            const coords = parseOccMapLink(firstWell.occMapLink);
            const count = wellsAtLocation.length;

            // Use the most prominent status for the main marker color
            const statusPriority = { 'AC': 4, 'ND': 3, 'SI': 2, 'PA': 1, 'TA': 1 };
            const dominantWell = wellsAtLocation.reduce((prev, curr) => {
                const prevStatus = prev.well_status || '';
                const currStatus = curr.well_status || '';
                return (statusPriority[currStatus] || 0) > (statusPriority[prevStatus] || 0) ? curr : prev;
            });

            const dominantStatus = dominantWell.well_status || 'Unknown';
            const statusColor = WELL_STATUS_COLORS[dominantStatus] || WELL_STATUS_COLORS.default;
            const operatorColor = getOperatorColor(dominantWell.operator || '');

            let marker;

            // Fixed-size pin marker (same as nearby wells; slightly larger for clusters)
            const markerSize = count === 1 ? 14 : 18;
            const markerH = markerSize * 1.4;

            // For clusters, show count as a badge - centered on the pin
            let badgeHtml = '';
            if (count > 1) {
                const badgeSize = count >= 10 ? 18 : 16;
                const fontSize = count >= 10 ? 10 : 11;
                badgeHtml = `
                    <circle cx="12" cy="12" r="${badgeSize/2 + 1}" fill="white" stroke-width="2"/>
                    <circle cx="12" cy="12" r="${badgeSize/2}" fill="${statusColor}"/>
                    <text x="12" y="12" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="${fontSize}" font-weight="bold">${count}</text>
                `;
            }

            // Only show inner dot for single wells
            const innerDot = count === 1 ? `<circle cx="12" cy="12" r="4.5" fill="${operatorColor}"/>` : '';

            const icon = L.divIcon({
                className: 'tracked-well-pin',
                html: `
                    <svg width="${markerSize}" height="${markerH}" viewBox="-1 -1 26 35" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 1C5.9 1 1 5.9 1 12c0 8.5 11 19 11 19s11-10.5 11-19c0-6.1-4.9-11-11-11z"
                              fill="${statusColor}" stroke="${operatorColor}" stroke-width="2"/>
                        ${innerDot}
                        ${badgeHtml}
                    </svg>
                `,
                iconSize: [markerSize, markerH],
                iconAnchor: [markerSize/2, markerH],
                popupAnchor: [0, -markerH]
            });
            marker = L.marker([coords.lat, coords.lon], { icon: icon });

            // Create popup content for clustered wells
            let popupContent;
            if (count === 1) {
                // Single well popup with enhanced styling
                const well = firstWell;
                const wellName = toTitleCase(well.well_name || `API ${well.apiNumber}`);
                const operator = toTitleCase(well.operator || 'Unknown');
                const wellStatus = (well.well_status || 'Unknown').toUpperCase();
                const formation = toTitleCase(well.formation_name || '');

                popupContent = `
                    <div class="popup-header">
                        <span class="popup-tag tracked-well">Tracked Well</span>
                    </div>
                    <div class="popup-well-name">${wellName}</div>
                    <div class="popup-details">
                        ${operator}<br>
                        ${well.section ? `${formatTRS(well.township, well.range, well.section)} • ` : ''}${well.county || 'Unknown'}<br>
                        Status: ${wellStatus}${formation ? ` • ${formation}` : ''}
                    </div>
                    <div class="popup-actions">
                        <button class="popup-btn popup-btn-secondary" onclick="expandWellCard('${well.id}'); return false;">More →</button>
                    </div>
                `;
            } else {
                // Multiple wells popup - show location context
                const locationStr = firstWell.section
                    ? formatTRS(firstWell.township, firstWell.range, firstWell.section)
                    : (firstWell.county || 'this location');
                
                popupContent = `
                    <div class="popup-header">
                        <span class="popup-tag tracked-well">${count} Wells</span>
                    </div>
                    <div class="popup-well-name" style="font-size: 14px; margin-bottom: 8px;">Wells in ${locationStr}</div>
                    <div class="popup-details" style="max-height: 220px; overflow-y: auto;" id="well-list-container">
                `;
                
                // Show first 4 wells, collapse the rest
                const showInitially = 4;
                const hasMore = count > showInitially;
                
                wellsAtLocation.forEach((well, index) => {
                    const wellName = well.well_name || `API ${well.apiNumber}`;
                    const operator = well.operator || 'Unknown';
                    const wellStatus = (well.well_status || 'Unknown').toUpperCase();
                    const statusColor = WELL_STATUS_COLORS[wellStatus] || WELL_STATUS_COLORS.default;
                    const isHidden = hasMore && index >= showInitially;
                    
                    popupContent += `
                        <div class="well-cluster-item" style="padding: 6px 0; border-bottom: 1px solid #eee; ${isHidden ? 'display: none;' : ''}" data-well-item="${isHidden ? 'hidden' : 'visible'}">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 10px; height: 10px; background: ${statusColor}; border-radius: 50%; flex-shrink: 0;"></div>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: 500; font-size: 13px; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${wellName}</div>
                                    <div style="font-size: 11px; color: #64748b;">${operator} • ${wellStatus}</div>
                                </div>
                                <button type="button" class="btn-link" onclick="expandWellCard('${well.id}')" style="color: #C05621; font-size: 12px; padding: 4px;">→</button>
                            </div>
                        </div>
                    `;
                });
                
                popupContent += '</div>';
                
                // Add "show more" link if needed
                if (hasMore) {
                    const remaining = count - showInitially;
                    popupContent += `
                        <div style="padding-top: 8px; border-top: 1px solid #e2e8f0; margin-top: 4px;">
                            <button type="button" class="btn-link" onclick="
                                document.querySelectorAll('[data-well-item=hidden]').forEach(el => el.style.display = 'block');
                                this.parentElement.style.display = 'none';
                            " style="color: #C05621; font-size: 12px;">
                                Show ${remaining} more well${remaining > 1 ? 's' : ''} ↓
                            </button>
                        </div>
                    `;
                }
            }
            
            marker.bindPopup(popupContent, { 
                maxWidth: 300,
                className: 'high-z-popup'
            });
            
            // Add hover effects
            marker.on('mouseover', function() {
                if (typeof this.setStyle === 'function') {
                    this.setStyle({ fillOpacity: 1, weight: 4 });
                }
            });
            
            marker.on('mouseout', function() {
                if (typeof this.setStyle === 'function') {
                    this.setStyle({ fillOpacity: 0.7, weight: 3 });
                }
            });
            
            // Simply return the marker - lateral paths will be handled separately
            return marker;
        }


// ═══════════════════════════════════════════════
// Module: map-wells-tracked.txt
// ═══════════════════════════════════════════════
        
        // Load and display tracked wells with clustering
        async function loadTrackedWells() {
            try {
                updateStatus('Loading tracked wells...');
                
                const wells = await fetchTrackedWells();
                
                if (wells.length === 0) {
                    console.log('No wells to display');
                    return;
                }
                
                // Store wells globally for search
                trackedWells = wells;
                
                const totalWells = wells.length;
                let processedWells = 0;
                
                // Store wells by ID for lookup (used by modal)
                wellsById = {};
                wells.forEach(well => {
                    wellsById[well.id] = well;
                });
                
                // Clear existing wells layer and create new cluster group
                if (wellsLayer) {
                    map.removeLayer(wellsLayer);
                }
                
                // Initialize cluster group for tracked wells
                wellsLayer = L.markerClusterGroup({
                    disableClusteringAtZoom: 7,   // Expand at zoom 7 for tracked wells (was 9)
                    maxClusterRadius: 50,          // Smaller radius for tighter clusters
                    spiderfyOnMaxZoom: true,
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: true,
                    // Custom cluster icon with tracked well colors
                    iconCreateFunction: function(cluster) {
                        const count = cluster.getChildCount();
                        let size = 'small';
                        let className = 'tracked-well-cluster-small';
                        
                        if (count > 50) {
                            size = 'large';
                            className = 'tracked-well-cluster-large';
                        } else if (count > 10) {
                            size = 'medium';  
                            className = 'tracked-well-cluster-medium';
                        }
                        
                        return new L.DivIcon({
                            html: '<div><span>' + count + '</span></div>',
                            className: 'tracked-well-cluster ' + className,
                            iconSize: new L.Point(40, 40)
                        });
                    }
                });
                
                let addedWells = 0;
                
                for (const well of wells) {
                    // Parse coordinates from OCC Map Link
                    const coords = parseOccMapLink(well.occMapLink);
                    if (!coords) {
                        console.warn(`No coordinates found for well ${well.apiNumber}`);
                        continue;
                    }
                    
                    // Create individual marker for each well (clustering will group them automatically)
                    const marker = createTrackedWellMarker(well, coords);
                    if (marker) {
                        wellsLayer.addLayer(marker);
                        wellMarkers[well.id] = marker;
                        addedWells++;
                    }
                    
                    processedWells++;
                    // Update status every 10 wells or on the last well
                    if (processedWells % 10 === 0 || processedWells === totalWells) {
                        updateStatus(`Loading ${processedWells} of ${totalWells} wells...`);
                    }
                }
                
                // Add wells layer to map
                if (wellsLayer.getLayers().length > 0) {
                    map.addLayer(wellsLayer);
                    // Ensure proper layer ordering - properties should be on top
                    ensureLayerOrder();
                    // Show well legend when wells are loaded
                    // Well legend removed - will be added back later
                    // document.getElementById('wellLegend').style.display = 'block';
                }
                
                // Pre-fetch BH section geometries for wells that need them
                const bhToFetch = new Map(); // cacheKey → { section, township, range }
                for (const well of wells) {
                    if (well.bh_section && well.bh_township && well.bh_range) {
                        const bhCacheKey = `${well.bh_section}-${well.bh_township}-${well.bh_range}`;
                        // Check memory cache
                        if (geometryCache[bhCacheKey]) continue;
                        // Check localStorage cache
                        const stored = localStorage.getItem(`mw_section_${bhCacheKey}`);
                        if (stored) {
                            try {
                                const _raw = JSON.parse(stored);
                                geometryCache[bhCacheKey] = _raw && _raw.d !== undefined ? _raw.d : _raw;
                                continue;
                            } catch (e) { localStorage.removeItem(`mw_section_${bhCacheKey}`); }
                        }
                        if (!bhToFetch.has(bhCacheKey)) {
                            bhToFetch.set(bhCacheKey, { section: well.bh_section, township: well.bh_township, range: well.bh_range });
                        }
                    }
                }

                // Batch fetch missing BH geometries via /api/plss-sections/batch
                if (bhToFetch.size > 0) {
                    console.log(`Batch-fetching ${bhToFetch.size} BH section geometries...`);
                    const bhArray = [...bhToFetch.values()];
                    // Chunk into batches of 500 (D1 batch limit)
                    for (let i = 0; i < bhArray.length; i += 500) {
                        const chunk = bhArray.slice(i, i + 500);
                        try {
                            const res = await fetch('/api/plss-sections/batch', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sections: chunk })
                            });
                            if (res.ok) {
                                const batchResults = await res.json();
                                let found = 0;
                                for (const [cacheKey, feature] of Object.entries(batchResults)) {
                                    geometryCache[cacheKey] = feature;
                                    localStorage.setItem(`mw_section_${cacheKey}`, JSON.stringify({t:Date.now(),d:feature}));
                                    found++;
                                }
                                console.log(`D1 BH batch ${Math.floor(i/500)+1}: ${found}/${chunk.length} found`);
                            } else {
                                console.warn('BH batch failed:', res.status);
                            }
                        } catch (err) {
                            console.warn('BH batch error:', err);
                        }
                    }
                    console.log(`BH pre-fetch done. Cache now has ${Object.keys(geometryCache).length} geometries`);
                }
                
                // Fetch D1 lateral data for tracked wells
                console.log('Fetching D1 lateral data for tracked wells...');
                const apiNumbers = wells
                    .map(w => w.apiNumber)
                    .filter(api => api && api.length >= 10);
                
                let d1LateralData = {};
                if (apiNumbers.length > 0) {
                    try {
                        // Fetch all enrichment data in a single request - D1 can handle it
                        console.log(`Fetching enrichment data for ${apiNumbers.length} tracked wells in a single request`);
                        const startTime = Date.now();
                        
                        const response = await fetch('/api/well-enrichment/bulk', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ apiNumbers })
                        });
                        
                        if (response.ok) {
                            const result = await response.json();
                            const enrichmentData = result.data || {};
                            
                            // Extract wells with lateral data
                            for (const [apiNumber, data] of Object.entries(enrichmentData)) {
                                if (data.bottom_hole_location && data.bottom_hole_location.latitude) {
                                    d1LateralData[apiNumber] = data;
                                }
                            }
                            
                            const queryTime = Date.now() - startTime;
                            console.log(`Found D1 lateral data for ${Object.keys(d1LateralData).length} tracked wells in ${queryTime}ms`);
                        } else {
                            console.error('Failed to fetch bulk enrichment data:', response.status);
                        }
                    } catch (error) {
                        console.error('Error fetching D1 lateral data:', error);
                    }
                }
                
                // Create lateral paths in the dedicated lateralsLayer (not the cluster group)
                lateralsLayer.clearLayers();
                let lateralPathCount = 0;

                for (const well of wells) {
                    const apiNumber = well.apiNumber;
                    const coords = parseOccMapLink(well.occMapLink);
                    if (!coords) continue;

                    const d1Data = d1LateralData[apiNumber];
                    if (d1Data && d1Data.has_lateral && d1Data.bottom_hole_location) {
                        const bhLat = d1Data.bottom_hole_location.latitude;
                        const bhLng = d1Data.bottom_hole_location.longitude;

                        const latDiff = Math.abs(bhLat - coords.lat);
                        const lngDiff = Math.abs(bhLng - coords.lon);
                        if ((latDiff + lngDiff) * 69 < 3) {
                            const lateralPath = drawLateralPath(coords, { lat: bhLat, lng: bhLng }, well, 'tracked');
                            if (lateralPath) {
                                lateralsLayer.addLayer(lateralPath);
                                lateralPathCount++;
                            }
                        }
                    } else if (well.bh_section && well.bh_township && well.bh_range) {
                        const bhCacheKey = `${well.bh_section}-${well.bh_township}-${well.bh_range}`;
                        const bhGeometry = geometryCache[bhCacheKey];

                        if (bhGeometry && bhGeometry.geometry) {
                            const bounds = L.geoJSON(bhGeometry).getBounds();
                            const bhCenter = bounds.getCenter();
                            const lateralPath = drawLateralPath(coords, { lat: bhCenter.lat, lng: bhCenter.lng }, well, 'tracked');
                            if (lateralPath) {
                                lateralsLayer.addLayer(lateralPath);
                                lateralPathCount++;
                            }
                        }
                    }
                }

                // Show tracked laterals only when zoomed in
                const TRACKED_LATERAL_ZOOM = 10;
                function updateTrackedLateralVisibility() {
                    if (map.getZoom() >= TRACKED_LATERAL_ZOOM && lateralsLayer.getLayers().length > 0) {
                        if (!map.hasLayer(lateralsLayer)) map.addLayer(lateralsLayer);
                    } else {
                        if (map.hasLayer(lateralsLayer)) map.removeLayer(lateralsLayer);
                    }
                }
                if (window._trackedLateralZoomHandler) {
                    map.off('zoomend', window._trackedLateralZoomHandler);
                }
                window._trackedLateralZoomHandler = updateTrackedLateralVisibility;
                map.on('zoomend', updateTrackedLateralVisibility);
                updateTrackedLateralVisibility();

                if (lateralPathCount > 0) {
                    console.log(`${lateralPathCount} tracked lateral paths (zoom >= ${TRACKED_LATERAL_ZOOM})`);
                }
                
                console.log(`Added ${addedWells} wells to cluster layer`);
                updateStatus(`${addedWells} wells loaded`);
                // Update well count display
                document.getElementById('wellCount').textContent = addedWells;
                
            } catch (error) {
                console.error('Error loading wells:', error);
                updateStatus('Error loading wells');
            }
        }
        
        
        // Open well detail via React modal bridge
        function expandWellCard(wellId, isTracked = true) {
            const well = wellsById[wellId];
            if (!well) {
                console.warn('Well not found:', wellId);
                return;
            }
            if (!window.__mw) {
                console.error('[Map] React bridge not ready');
                return;
            }
            window.__mw.openWell({
                apiNumber: well.apiNumber,
                wellId: well.id,
                wellName: well.well_name,
                operator: well.operator,
                county: well.county,
                status: well.well_status,
                onTrack: !isTracked
            });
        }


// ═══════════════════════════════════════════════
// Module: map-occ.txt
// ═══════════════════════════════════════════════
        // ============================================
        // OCC Filings / Well Records — handled by React WellModal
        // These stub functions exist for backward compat with any
        // remaining onclick attributes in vanilla popup HTML.
        // ============================================

        function toggleMapOccFilings() {}
        function toggleMapLinkedProperties() {}
        function toggleMapLinkedDocs() {}
        function toggleMapWellRecords() {}
        function toggleMapDrillingPermits() {}
        function loadMapOccFilings() {}
        function loadMapCompletionReports() {}
        function loadMapDrillingPermits() {}
        function loadMapOTCProduction() {}
        function trackWellFromModal() {
            // Use React bridge instead
            const apiNumber = document.getElementById('wellModalApiNumber')?.value;
            if (apiNumber && window.__mw) {
                window.__mw.openWell({ apiNumber, onTrack: true });
            }
        }


// ═══════════════════════════════════════════════
// Module: map-documents.txt
// ═══════════════════════════════════════════════
        // ============================================
        // Document Detail — delegates to React via bridge
        // ============================================

        function openMapDocumentDetail(docId, displayName) {
            if (!window.__mw) { console.error('[Map] React bridge not ready'); return; }
            window.__mw.openDocument({ docId: docId });
        }

        function closeMapDocumentDetail() { /* React modal handles its own close */ }
        function viewMapDocumentPDF() { /* React modal handles document viewing */ }
        function closeMapDocumentViewer() { /* React modal handles its own close */ }


// ═══════════════════════════════════════════════
// Module: map-properties.txt
// ═══════════════════════════════════════════════

        // Format location for modal display (10N-07W-06 dashed format)
        function formatLocationForModal(location) {
            if (!location) return '';
            const match = location.match(/S?(\d+)\s+T?(\d+[NS])\s+R?(\d+[EW])/i);
            if (match) return formatTRS(match[2], match[3], match[1]);
            return location;
        }

        // Expand activity card - open React WellModal via bridge
        function expandActivityCard(activityType, fields) {
            if (!window.__mw) { console.error('[Map] React bridge not ready'); return; }
            window.__mw.openWell({
                apiNumber: fields['API Number'],
                wellName: fields['Well Name'],
                operator: fields.Operator,
                county: fields.County,
                status: fields.Status,
                onTrack: true
            });
        }

        // Expand nearby well card - open React WellModal via bridge
        function expandNearbyWellCard(wellData) {
            if (!wellData) { console.warn('No well data provided'); return; }
            if (!window.__mw) { console.error('[Map] React bridge not ready'); return; }
            window.__mw.openWell({
                apiNumber: wellData.api_number,
                wellName: wellData.well_name,
                operator: wellData.operator,
                county: wellData.county,
                status: wellData.well_status,
                onTrack: true
            });
        }

        // Track a well (delegates to React WellModal track button now)
        async function trackWell(apiNumber, wellName) {
            if (!window.__mw) { console.error('[Map] React bridge not ready'); return; }
            window.__mw.openWell({
                apiNumber: apiNumber,
                wellName: wellName,
                onTrack: true
            });
        }

        // Add property section to map with styling
        function addPropertyToMap(property, geometry) {
            if (!geometry) return;

            const fields = property.fields || property;

            // Use section polygon styling (blue, solid borders)
            const layer = L.geoJSON(geometry, {
                style: {
                    color: '#2563EB',        // Blue border
                    weight: 2,
                    fillColor: '#93C5FD',   // Light blue fill
                    fillOpacity: 0.2,       // Subtle fill
                    opacity: 0.7            // Solid borders for properties
                }
            });

            // Store bounds for proximity checking
            property.bounds = layer.getBounds();

            // Build ownership details
            const riAcres = parseFloat(fields['RI Acres']) || 0;
            const wiAcres = parseFloat(fields['WI Acres']) || 0;
            const totalUserAcres = riAcres + wiAcres;
            const sectionTotalAcres = geometry.properties?.gisacre ? Math.round(geometry.properties.gisacre) : 640;

            let ownershipText = '';
            if (totalUserAcres > 0) {
                const parts = [];
                if (riAcres > 0) parts.push(`${riAcres} RI`);
                if (wiAcres > 0) parts.push(`${wiAcres} WI`);
                ownershipText = `Your ${parts.join(' + ')} acres (of ${sectionTotalAcres} total)`;
            } else {
                ownershipText = `${sectionTotalAcres} acres total`;
            }

            // Create popup content with dual-tag system
            const twp = fields.TWN || fields.Township || '';
            const rng = fields.RNG || fields.Range || '';
            const poolingBtn = (typeof poolingRateLayer !== 'undefined' && poolingRateLayer && map.hasLayer(poolingRateLayer))
                ? `<div style="margin-top:8px;"><button class="popup-btn popup-btn-secondary" onclick="openTownshipPoolingModal('${twp}','${rng}'); return false;">View Pooling Orders \u2192</button></div>`
                : '';
            const popupContent = `
                <div class="popup-header">
                    <span class="popup-tag your-property">Your Property</span>
                </div>
                <div class="popup-well-name">${toTitleCase(fields.COUNTY || fields.County || 'Unknown')} County</div>
                <div class="popup-details">
                    <strong>${formatTRS(twp, rng, fields.SEC || fields.Section)}</strong><br>
                    ${ownershipText}<br>
                    ${(riAcres > 0 || wiAcres > 0) ? `<em>Your ownership: ${riAcres > 0 ? riAcres + ' RI' : ''}${(riAcres > 0 && wiAcres > 0) ? ' + ' : ''}${wiAcres > 0 ? wiAcres + ' WI' : ''} acres</em><br>` : ''}
                    ${fields.Notes ? `<em>"${fields.Notes}"</em><br>` : ''}
                </div>
                ${poolingBtn}
            `;

            layer.bindPopup(popupContent, {
                maxWidth: 300,
                className: 'high-z-popup'
            });

            // Add hover effects
            layer.on('mouseover', function() {
                this.setStyle({ fillOpacity: 0.4, weight: 3 });
            });

            layer.on('mouseout', function() {
                this.setStyle({ fillOpacity: 0.2, weight: 2 });
            });

            propertiesLayer.addLayer(layer);

            // Store marker reference for search
            propertyMarkers[property.id] = layer;
        }

        // Batch fetch geometries — D1 first (instant), OCC fallback for misses
        async function batchFetchGeometries(propertyBatch) {
            const results = [];

            document.querySelector('.loading-text').textContent =
                `Loading ${propertyBatch.length} property boundaries...`;

            // Step 1: Try D1 batch endpoint (all sections in 1 request, up to 500)
            const sectionsPayload = propertyBatch.map(p => ({
                section: p.section,
                township: p.township,
                range: p.range
            }));

            const d1Misses = [];
            try {
                const res = await fetch('/api/plss-sections/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sections: sectionsPayload })
                });

                if (res.ok) {
                    const d1Results = await res.json();

                    for (const prop of propertyBatch) {
                        const cacheKey = `${prop.section}-${prop.township}-${prop.range}`;
                        if (d1Results[cacheKey]) {
                            results.push({ property: prop.property, geometry: d1Results[cacheKey] });
                            geometryCache[cacheKey] = d1Results[cacheKey];
                            localStorage.setItem(`mw_section_${cacheKey}`, JSON.stringify({t:Date.now(),d:d1Results[cacheKey]}));
                        } else {
                            d1Misses.push(prop);
                        }
                    }
                    console.log(`D1 batch: ${propertyBatch.length - d1Misses.length} found, ${d1Misses.length} misses`);
                } else {
                    // D1 batch failed — fall back to OCC for all
                    console.warn('D1 batch failed, falling back to OCC:', res.status);
                    d1Misses.push(...propertyBatch);
                }
            } catch (err) {
                console.warn('D1 batch error, falling back to OCC:', err);
                d1Misses.push(...propertyBatch);
            }

            // Step 2: Fall back to OCC API for any D1 misses (batched by PLSS ID)
            if (d1Misses.length > 0) {
                document.querySelector('.loading-text').textContent =
                    `Fetching ${d1Misses.length} remaining boundaries from OCC...`;

                const plssGroups = {};
                d1Misses.forEach(prop => {
                    const { plssId } = prop;
                    if (!plssGroups[plssId]) plssGroups[plssId] = [];
                    plssGroups[plssId].push(prop);
                });

                for (const [plssId, props] of Object.entries(plssGroups)) {
                    const sections = props.map(p => p.section).join("','");
                    const url = `${OCC_API_BASE}/${SECTION_LAYER}/query?` +
                        `where=plssid='${plssId}' AND frstdivno IN ('${sections}')` +
                        `&outFields=frstdivno,frstdivlab,gisacre,plssid,survtyptxt` +
                        `&f=geojson` +
                        `&outSR=4326`;

                    try {
                        const proxyUrl = `${OCC_PROXY}?url=${encodeURIComponent(url)}`;
                        const response = await fetch(proxyUrl);
                        if (response.ok) {
                            const data = await response.json();
                            data.features?.forEach(feature => {
                                const sectionNum = feature.properties.frstdivno;
                                const matchingProp = props.find(p => p.section === sectionNum);
                                if (matchingProp) {
                                    results.push({ property: matchingProp.property, geometry: feature });
                                    const cacheKey = `${sectionNum}-${matchingProp.township}-${matchingProp.range}`;
                                    geometryCache[cacheKey] = feature;
                                    localStorage.setItem(`mw_section_${cacheKey}`, JSON.stringify({t:Date.now(),d:feature}));
                                }
                            });
                        }
                    } catch (error) {
                        console.warn(`OCC fallback error for ${plssId}:`, error);
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            return results;
        }

        // Load and display user properties with batch optimization
        async function loadUserProperties() {
            try {
                updateStatus('Loading properties...');

                // Fetch properties from API
                userProperties = await fetchUserProperties();

                if (userProperties.length === 0) {
                    console.log('No properties found');
                    updateStatus('No properties to display');
                    hideLoading();
                    return;
                }

                const total = userProperties.length;
                console.log(`Loading ${total} properties with batch optimization`);

                // Normalize and prepare all properties
                const normalizedProperties = [];
                const propertiesNeedingGeometry = [];

                for (const property of userProperties) {
                    const fields = property.fields || property;

                    // Extract section, township, range - handle various field name formats
                    let section = (fields.SEC || fields.Section || '').toString().trim();
                    let township = (fields.TWN || fields.Township || '').toString().trim();
                    let range = (fields.RNG || fields.Range || '').toString().trim();

                    // Remove common prefixes and normalize
                    section = section.replace(/^(S|SEC|SECTION)\s*/i, '').trim();
                    township = township.replace(/^(T|TOWN|TOWNSHIP)\s*/i, '').replace(/\s+/g, '').toUpperCase();
                    range = range.replace(/^(R|RANGE)\s*/i, '').replace(/\s+/g, '').toUpperCase();

                    // Validate normalized formats
                    if (!section || !/^\d+$/.test(section) || !township || !/^\d+[NS]$/.test(township) || !range || !/^\d+[EW]$/.test(range)) {
                        console.warn('Invalid property format:', { section, township, range });
                        continue;
                    }

                    const county = fields.COUNTY || fields.County || '';
                    const cacheKey = `${section}-${township}-${range}`;

                    // Check if already cached (includes "not found" markers with d:null)
                    const lsEntry = localStorage.getItem(`mw_section_${cacheKey}`);
                    if (geometryCache[cacheKey] || lsEntry) {
                        let geometry = geometryCache[cacheKey];
                        if (!geometry && lsEntry) {
                            try { const _r = JSON.parse(lsEntry); geometry = _r && _r.d !== undefined ? _r.d : _r; } catch(e) {}
                        }
                        if (geometry) addPropertyToMap(property, geometry);
                        // Either way, skip re-fetching (cached null = section not found)
                    } else {
                        // Add to batch fetch list
                        const plssData = getPlssId(township, range, county);
                        if (plssData) {
                            propertiesNeedingGeometry.push({
                                property,
                                section,
                                township,
                                range,
                                county,
                                plssId: plssData.id
                            });
                        }
                    }
                }

                updateStatus(`${propertiesNeedingGeometry.length} properties need geometry fetch`);

                // Batch fetch remaining geometries (only show loading if needed)
                if (propertiesNeedingGeometry.length > 0) {
                    showLoading(`Loading ${propertiesNeedingGeometry.length} property boundaries...`,
                        'Fetching section geometries');

                    const geometryResults = await batchFetchGeometries(propertiesNeedingGeometry);

                    // Cache "not found" for properties that got no result — prevents retrying every load
                    const foundKeys = new Set(geometryResults.map(r => {
                        const f = r.property.fields || r.property;
                        let s = (f.SEC || f.Section || '').toString().trim().replace(/^(S|SEC|SECTION)\s*/i, '').trim();
                        let t = (f.TWN || f.Township || '').toString().trim().replace(/^(T|TOWN|TOWNSHIP)\s*/i, '').replace(/\s+/g, '').toUpperCase();
                        let rr = (f.RNG || f.Range || '').toString().trim().replace(/^(R|RANGE)\s*/i, '').replace(/\s+/g, '').toUpperCase();
                        return `${s}-${t}-${rr}`;
                    }));
                    for (const prop of propertiesNeedingGeometry) {
                        const ck = `${prop.section}-${prop.township}-${prop.range}`;
                        if (!foundKeys.has(ck) && !localStorage.getItem(`mw_section_${ck}`)) {
                            localStorage.setItem(`mw_section_${ck}`, JSON.stringify({t:Date.now(),d:null}));
                        }
                    }

                    // Add batch results to map
                    geometryResults.forEach(({ property, geometry }) => {
                        addPropertyToMap(property, geometry);
                    });

                    console.log(`Batch loaded ${geometryResults.length} geometries, ${propertiesNeedingGeometry.length - geometryResults.length} not found (cached)`);
                    hideLoading();
                }

                // Add properties layer to map
                if (propertiesLayer.getLayers().length > 0) {
                    map.addLayer(propertiesLayer);
                    // Ensure properties are on top for clicking
                    propertiesLayer.bringToFront();
                    // Fit map to show properties and counties
                    const allLayers = L.featureGroup([propertiesLayer, countyLayer]);
                    if (allLayers.getLayers().length > 0) {
                        map.fitBounds(allLayers.getBounds(), { padding: [50, 50] });
                    }
                }

                updateStatus(`${total} properties loaded`);
                // Update property count display
                document.getElementById('propertyCount').textContent = total;
                hideLoading();

            } catch (error) {
                console.error('Error loading properties:', error);
                updateStatus('Error loading properties');
                hideLoading();
            }
        }



// ═══════════════════════════════════════════════
// Module: map-layers.txt
// ═══════════════════════════════════════════════
        // Versioned localStorage cache helper — checks /api/map-data/version, returns cached data or fetches fresh
        async function fetchWithVersionCache(cacheKey, versionField, fetchUrl, label) {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { version, data } = JSON.parse(cached);
                    const vRes = await fetch('/api/map-data/version');
                    if (vRes.ok) {
                        const current = await vRes.json();
                        if (version === current[versionField]) {
                            console.log(`${label} loaded from cache`);
                            return data;
                        }
                    }
                } catch (e) {
                    console.warn(`${label} cache read error:`, e);
                }
            }
            // Cache miss or version mismatch — fetch fresh
            const response = await fetch(fetchUrl, { credentials: 'include' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            try {
                const vRes = await fetch('/api/map-data/version');
                if (vRes.ok) {
                    const ver = await vRes.json();
                    localStorage.setItem(cacheKey, JSON.stringify({ version: ver[versionField], data }));
                    console.log(`${label} cached`);
                }
            } catch (e) {
                console.warn(`${label} cache write error:`, e);
            }
            return data;
        }

        // Function to load county data with caching
        async function loadCountyData() {
            try {
                console.log('Loading county boundaries...');
                updateStatus('Loading counties...');

                let countyData = await fetchWithVersionCache('counties_cache', 'counties_version', '/api/map/counties', 'Counties');

                // Check if we have data
                if (!countyData.features || countyData.features.length === 0) {
                    console.warn('No county data returned from API');
                    // Fall back to static file if D1 is empty
                    console.log('Falling back to static county data...');
                    const fallbackResponse = await fetch('/assets/County_Boundaries_2423125635378062927.geojson');
                    if (fallbackResponse.ok) {
                        const fallbackData = await fallbackResponse.json();
                        console.log('Static county data loaded:', fallbackData.features.length, 'counties');
                        countyData.features = fallbackData.features;
                    }
                }

                console.log('County data loaded:', countyData.features.length, 'counties');

                // Load missing counties (ATOKA and BRYAN) from fallback file
                try {
                    const missingResponse = await fetch('/assets/missing-counties-fallback.geojson');
                    if (missingResponse.ok) {
                        const missingData = await missingResponse.json();
                        console.log('Loading', missingData.features.length, 'missing counties from fallback');
                        // Add missing counties to the main data
                        countyData.features = countyData.features.concat(missingData.features);
                        console.log('Total counties after adding missing:', countyData.features.length);
                    }
                } catch (error) {
                    console.warn('Could not load missing counties fallback:', error);
                }

                // Create county layer with enhanced visibility
                countyLayer = L.geoJSON(countyData, {
                    style: {
                        color: '#1C2B36',        // Brand navy blue from navigation
                        weight: 3,               // Thicker for counties
                        fillOpacity: 0,          // No fill at all
                        fillColor: 'transparent',
                        opacity: 0.8            // Higher opacity for counties
                    },
                    onEachFeature: function(feature, layer) {
                        const countyName = feature.properties.COUNTY_NAME || 'Unknown County';

                        // No popup for county boundaries to avoid interference

                        layer.on('mouseover', function() {
                            this.setStyle({ weight: 3, fillOpacity: 0.3 });
                        });

                        layer.on('mouseout', function() {
                            this.setStyle({ weight: 2, fillOpacity: 0.1 });
                        });
                    }
                }).addTo(map);

                console.log('County layers created and added to map');
                map.fitBounds(countyLayer.getBounds(), {padding: [20, 20]});
                updateStatus(`${countyData.features.length} counties loaded`);

                // Apply dark mode styling if already active
                if (typeof mapDarkMode !== 'undefined' && mapDarkMode) {
                    countyLayer.setStyle({
                        color: 'rgba(255,255,255,0.6)',
                        weight: 1.5,
                        opacity: 0.5,
                        fillOpacity: 0,
                        fillColor: 'transparent'
                    });
                }

            } catch (error) {
                console.error('Error loading county data:', error);
                updateStatus('Using sample county data');
                console.log('Using fallback county data - real data will be loaded later');
                createFallbackCountyData();
            }
        }

        // Function to load real PLSS township boundaries with caching
        async function loadTownshipData() {
            try {
                console.log('Loading PLSS township boundaries...');
                updateStatus('Loading townships...');

                let townshipData = await fetchWithVersionCache('townships_cache', 'townships_version', '/api/map/townships', 'Townships');

                // Check if we have data
                if (!townshipData.features || townshipData.features.length === 0) {
                    console.warn('No township data returned from API');
                    // Fall back to static file if D1 is empty
                    console.log('Falling back to static township data...');
                    const fallbackResponse = await fetch('/assets/PLSS_Township_simplified.geojson');
                    if (fallbackResponse.ok) {
                        const fallbackData = await fallbackResponse.json();
                        console.log('Static township data loaded:', fallbackData.features.length, 'townships');
                        townshipData.features = fallbackData.features;
                    }
                }

                console.log('PLSS township data loaded:', townshipData.features.length, 'townships');

                // Remove any existing mathematical grid
                if (townshipLayer && map.hasLayer(townshipLayer)) {
                    map.removeLayer(townshipLayer);
                }

                // Create township layer with real boundaries
                townshipLayer = L.geoJSON(townshipData, {
                    style: {
                        color: '#64748B',        // Slate-500 - more visible
                        weight: 1.5,             // Slightly thicker
                        fillOpacity: 0,
                        opacity: 0.6,            // More visible
                        dashArray: '4, 4'        // Even dashes
                    },
                    onEachFeature: function(feature, layer) {
                        const townshipLabel = feature.properties.TWNSHPLAB || 'Unknown';
                        const meridianFull = feature.properties.PRINMER || 'Indian Meridian';
                        // Abbreviate meridian: IM = Indian Meridian, CM = Cimarron Meridian
                        const meridian = meridianFull.includes('Cimarron') ? 'CM' : 'IM';

                        // Use tooltip on hover instead of popup (cleaner, doesn't persist)
                        layer.bindTooltip(`${townshipLabel} • ${meridian}`, {
                            sticky: true,
                            opacity: 0.9,
                            className: 'township-tooltip'
                        });

                        layer.on('mouseover', function() {
                            this.setStyle({ weight: 2.5, opacity: 0.9 });
                        });

                        layer.on('mouseout', function() {
                            this.setStyle({ weight: 1.5, opacity: 0.6 });
                        });

                        // Click uses the existing identifyLocation system
                        // which shows section info in the corner box
                    }
                });

                // Don't add to map yet - let toggle control it
                updateStatus('Townships ready');

            } catch (error) {
                console.error('Could not load PLSS data:', error);
                updateStatus('Using sample township grid');
                console.log('Using mathematical township grid - real data will be loaded later');
                createFallbackTownshipGrid();
            }
        }

        // Pooling rate color scale (green = high bonus, yellow/orange = low)
        function getPoolingRateColor(avgBonus) {
            if (avgBonus >= 1000) return '#166534';  // Dark green — premium
            if (avgBonus >= 500) return '#22c55e';   // Green
            if (avgBonus >= 200) return '#86efac';   // Light green
            if (avgBonus >= 50) return '#fef08a';    // Yellow
            return '#fed7aa';                         // Light orange
        }

        // Load pooling rates choropleth layer
        async function loadPoolingRates() {
            try {
                updateStatus('Loading pooling rates...');
                const res = await fetch('/api/map/pooling-rates', { credentials: 'include' });
                if (!res.ok) throw new Error('Failed to fetch pooling rates');
                const data = await res.json();

                if (!data.features || data.features.length === 0) {
                    updateStatus('No pooling rate data available');
                    return;
                }

                // Build lookup for property tooltip enrichment
                poolingRateByTwp = {};
                data.features.forEach(f => {
                    const key = f.properties.township + '-' + f.properties.range;
                    poolingRateByTwp[key] = f.properties;
                });

                poolingRateLayer = L.geoJSON(data, {
                    style: function(feature) {
                        return {
                            color: '#334155',
                            weight: 1.5,
                            fillColor: getPoolingRateColor(feature.properties.avg_bonus),
                            fillOpacity: 0.5,
                            opacity: 0.7
                        };
                    },
                    onEachFeature: function(feature, layer) {
                        const p = feature.properties;
                        const counties = (p.counties || '').split(',').join(', ');
                        const operators = p.operators || 'N/A';
                        const range = p.min_bonus !== p.max_bonus
                            ? ' ($' + p.min_bonus.toLocaleString() + '–$' + p.max_bonus.toLocaleString() + ')'
                            : '';
                        const tooltip = '<div style="font-size:12px;line-height:1.5">'
                            + '<strong>' + p.TWNSHPLAB + '</strong> — ' + counties + '<br>'
                            + 'Avg Bonus: <strong>$' + p.avg_bonus.toLocaleString() + '/acre</strong>' + range + '<br>'
                            + p.order_count + ' order' + (p.order_count !== 1 ? 's' : '') + ' (last 18 months)<br>'
                            + '<span style="color:#64748b">Top operators: ' + operators + '</span>'
                            + '</div>';
                        layer.bindTooltip(tooltip, { sticky: true, direction: 'top', opacity: 0.95 });

                        layer.on('mouseover', function() {
                            this.setStyle({ weight: 3, fillOpacity: 0.7 });
                        });
                        layer.on('mouseout', function() {
                            poolingRateLayer.resetStyle(this);
                        });
                        layer.on('click', function(e) {
                            L.DomEvent.stopPropagation(e);
                            openTownshipPoolingModal(p.township, p.range);
                        });
                    }
                });

                // Add to map and show legend
                const checkbox = document.getElementById('toggle-pooling-rates');
                if (checkbox && checkbox.checked) {
                    map.addLayer(poolingRateLayer);
                    ensureLayerOrder();
                    const legend = document.getElementById('poolingRatesLegend');
                    if (legend) legend.style.display = '';
                }

                // Enrich property tooltips with pooling rate context
                enrichPropertyTooltips(true);

                updateStatus('Pooling rates loaded (' + data.features.length + ' townships)');
                setTimeout(() => updateStatus('Map ready'), 2000);

            } catch (error) {
                console.error('Failed to load pooling rates:', error);
                updateStatus('Map ready');
            }
        }

        // Township Pooling Modal
        async function openTownshipPoolingModal(township, range) {
            const modal = document.getElementById('poolingTownshipModal');
            const titleEl = document.getElementById('poolingModalTitle');
            const subtitleEl = document.getElementById('poolingModalSubtitle');
            const bodyEl = document.getElementById('poolingModalBody');
            if (!modal) return;

            titleEl.textContent = 'Pooling Orders';
            subtitleEl.textContent = formatTRS(township, range, '').replace(/-$/, '');
            bodyEl.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;">Loading pooling orders...</div>';
            modal.classList.add('active');

            try {
                const res = await fetch('/api/map/pooling-orders?township=' + encodeURIComponent(township) + '&range=' + encodeURIComponent(range), { credentials: 'include' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();

                if (!data.success || !data.orders || data.orders.length === 0) {
                    bodyEl.innerHTML = '<div class="pm-no-orders">No pooling orders found for this township.</div>';
                    return;
                }

                titleEl.textContent = data.orderCount + ' Pooling Order' + (data.orderCount !== 1 ? 's' : '');
                renderPoolingModalBody(data, bodyEl);
            } catch (err) {
                console.error('Error loading pooling orders:', err);
                bodyEl.innerHTML = '<div class="pm-no-orders">Failed to load pooling orders.</div>';
            }
        }

        function closePoolingTownshipModal() {
            const modal = document.getElementById('poolingTownshipModal');
            if (modal) modal.classList.remove('active');
        }

        function renderPoolingModalBody(data, container) {
            const bonusRange = data.minBonus !== data.maxBonus
                ? '$' + data.minBonus.toLocaleString() + ' – $' + data.maxBonus.toLocaleString()
                : '$' + data.avgBonus.toLocaleString();

            let html = '<div class="pooling-modal-stats">'
                + '<div class="pooling-modal-stat"><div class="pooling-modal-stat-value">' + data.orderCount + '</div><div class="pooling-modal-stat-label">Orders</div></div>'
                + '<div class="pooling-modal-stat"><div class="pooling-modal-stat-value">$' + data.avgBonus.toLocaleString() + '</div><div class="pooling-modal-stat-label">Avg Bonus/Acre</div></div>'
                + '<div class="pooling-modal-stat"><div class="pooling-modal-stat-value">' + bonusRange + '</div><div class="pooling-modal-stat-label">Bonus Range</div></div>'
                + '<div class="pooling-modal-stat"><div class="pooling-modal-stat-value">' + (data.topOperators.slice(0, 3).join(', ') || '—') + '</div><div class="pooling-modal-stat-label">Top Operators</div></div>'
                + '</div>';

            html += '<table class="pooling-modal-table"><thead><tr>'
                + '<th></th><th>Date</th><th>Operator / Well</th><th>Formation</th><th>TRS</th><th>Best Bonus</th><th>Top Royalty</th>'
                + '</tr></thead><tbody>';

            data.orders.forEach(function(order, idx) {
                const rowId = 'pm-row-' + idx;
                const bestBonus = order.electionOptions.reduce(function(max, o) { return (o.bonusPerAcre || 0) > max ? (o.bonusPerAcre || 0) : max; }, 0);
                const bestRoyalty = order.electionOptions.reduce(function(best, o) {
                    const dec = o.royaltyDecimal || 0;
                    return dec > (best.royaltyDecimal || 0) ? o : best;
                }, {});
                const royaltyStr = bestRoyalty.royaltyFraction || (bestRoyalty.royaltyDecimal ? (bestRoyalty.royaltyDecimal * 100).toFixed(2) + '%' : '—');
                const formations = (order.formations || []).map(function(f) {
                    return '<span class="pm-formation-tag">' + (f.name || f) + '</span>';
                }).join('') || '—';
                const date = order.orderDate || '—';
                const operatorCell = order.operator || order.applicant || '—';
                const wellLine = order.wellName ? '<div style="font-size:11px;color:#78716C;margin-top:2px;">' + order.wellName + '</div>' : '';
                const trsStr = order.section ? formatTRS(order.township, order.range, order.section) : '—';

                html += '<tr class="pm-order-row" id="pm-hdr-' + idx + '" onclick="togglePmRow(\'' + rowId + '\',' + idx + ')">'
                    + '<td><span class="pm-chevron">&#9654;</span></td>'
                    + '<td>' + date + '</td>'
                    + '<td>' + operatorCell + wellLine + '</td>'
                    + '<td>' + formations + '</td>'
                    + '<td style="white-space:nowrap;">' + trsStr + '</td>'
                    + '<td class="pm-bonus">' + (bestBonus > 0 ? '$' + bestBonus.toLocaleString() : '—') + '</td>'
                    + '<td>' + royaltyStr + '</td>'
                    + '</tr>';

                // Expandable detail row
                html += '<tr class="pm-expand-row" id="' + rowId + '"><td colspan="7">';
                html += '<div class="pm-meta">';
                if (order.caseNumber) html += '<div class="pm-meta-item"><strong>Case:</strong> ' + order.caseNumber + '</div>';
                if (order.orderNumber) html += '<div class="pm-meta-item"><strong>Order:</strong> ' + order.orderNumber + '</div>';
                if (order.county) html += '<div class="pm-meta-item"><strong>County:</strong> ' + order.county + '</div>';
                if (order.unitSizeAcres) html += '<div class="pm-meta-item"><strong>Unit:</strong> ' + order.unitSizeAcres + ' acres</div>';
                if (order.responseDeadline) html += '<div class="pm-meta-item"><strong>Deadline:</strong> ' + order.responseDeadline + '</div>';
                html += '</div>';

                if (order.electionOptions && order.electionOptions.length > 0) {
                    html += '<table class="pm-options-table"><thead><tr><th>#</th><th>Type</th><th>Bonus/Acre</th><th>Royalty</th></tr></thead><tbody>';
                    order.electionOptions.forEach(function(opt) {
                        const typeName = (opt.optionType || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                        html += '<tr>'
                            + '<td>' + (opt.optionNumber || '') + '</td>'
                            + '<td>' + typeName + '</td>'
                            + '<td class="pm-bonus">' + (opt.bonusPerAcre ? '$' + opt.bonusPerAcre.toLocaleString() : '—') + '</td>'
                            + '<td>' + (opt.royaltyFraction || (opt.royaltyDecimal ? (opt.royaltyDecimal * 100).toFixed(2) + '%' : '—')) + '</td>'
                            + '</tr>';
                    });
                    html += '</tbody></table>';
                } else {
                    html += '<div style="color:#94A3B8;font-size:12px;">No election options extracted.</div>';
                }
                html += '</td></tr>';
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        }

        function togglePmRow(rowId, idx) {
            const row = document.getElementById(rowId);
            const hdr = document.getElementById('pm-hdr-' + idx);
            if (row) row.classList.toggle('open');
            if (hdr) hdr.classList.toggle('expanded');
        }

        // Enrich/revert property tooltips with pooling rate context
        function enrichPropertyTooltips(enrich) {
            if (!propertiesLayer || !propertiesLayer.getLayers) return;
            propertiesLayer.getLayers().forEach(function(layer) {
                if (!layer.feature || !layer.feature.properties) return;
                const props = layer.feature.properties;
                const twp = props.TWN || props.township;
                const rng = props.RNG || props.range;
                if (!twp || !rng) return;
                const key = twp + '-' + rng;
                const rate = poolingRateByTwp[key];

                // Store original tooltip if not already stored
                if (!layer._originalTooltip && layer.getTooltip()) {
                    layer._originalTooltip = layer.getTooltip().getContent();
                }

                if (enrich && rate) {
                    const base = layer._originalTooltip || (props.PROPERTY_NAME || props.name || 'Property');
                    const enriched = base + '<br><span style="color:#166534;font-weight:600">Pooling Avg: $'
                        + rate.avg_bonus.toLocaleString() + '/acre</span>'
                        + ' <span style="color:#64748b">(' + rate.order_count + ' orders)</span>';
                    layer.unbindTooltip();
                    layer.bindTooltip(enriched, { sticky: true, direction: 'top' });
                } else if (!enrich && layer._originalTooltip) {
                    layer.unbindTooltip();
                    layer.bindTooltip(layer._originalTooltip, { sticky: true, direction: 'top' });
                }
            });
        }

        // Fallback county data for testing - enhanced with more Oklahoma counties
        function createFallbackCountyData() {
            const fallbackData = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": { "COUNTY_NAME": "OKLAHOMA", "COUNTY_NO": 55, "COUNTY_FIPS_NO": 109 },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-97.7, 35.7], [-97.3, 35.7], [-97.3, 35.3], [-97.7, 35.3], [-97.7, 35.7]]]
                        }
                    },
                    {
                        "type": "Feature",
                        "properties": { "COUNTY_NAME": "CLEVELAND", "COUNTY_NO": 14, "COUNTY_FIPS_NO": 27 },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-97.7, 35.3], [-97.3, 35.3], [-97.3, 34.9], [-97.7, 34.9], [-97.7, 35.3]]]
                        }
                    },
                    {
                        "type": "Feature",
                        "properties": { "COUNTY_NAME": "CANADIAN", "COUNTY_NO": 12, "COUNTY_FIPS_NO": 17 },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-98.1, 35.7], [-97.7, 35.7], [-97.7, 35.3], [-98.1, 35.3], [-98.1, 35.7]]]
                        }
                    },
                    {
                        "type": "Feature",
                        "properties": { "COUNTY_NAME": "TULSA", "COUNTY_NO": 72, "COUNTY_FIPS_NO": 143 },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-96.3, 36.4], [-95.9, 36.4], [-95.9, 36.0], [-96.3, 36.0], [-96.3, 36.4]]]
                        }
                    },
                    {
                        "type": "Feature",
                        "properties": { "COUNTY_NAME": "COMANCHE", "COUNTY_NO": 16, "COUNTY_FIPS_NO": 31 },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[-98.9, 34.9], [-98.5, 34.9], [-98.5, 34.5], [-98.9, 34.5], [-98.9, 34.9]]]
                        }
                    }
                ]
            };

            countyLayer = L.geoJSON(fallbackData, {
                style: { color: '#2980b9', weight: 2, fillOpacity: 0.1, fillColor: '#3498db' },
                onEachFeature: function(feature, layer) {
                    const countyName = feature.properties.COUNTY_NAME;
                    layer.bindPopup(`<div class="popup-title">${countyName} County (Sample)</div>`, {
                        className: 'high-z-popup'
                    });
                }
            }).addTo(map);

            map.fitBounds(countyLayer.getBounds(), {padding: [50, 50]});
        }

        // Fallback mathematical grid
        function createFallbackTownshipGrid() {
            const INDIAN_MERIDIAN = -97.916667;
            const INDIAN_BASE_LINE = 35.233333;
            const MILES_PER_TOWNSHIP = 6;
            const LAT_MILES_RATIO = 1 / 69;
            const LNG_MILES_RATIO = 1 / 54.6;

            const gridLines = [];

            // Generate horizontal lines
            for (let t = -10; t <= 10; t++) {
                const lat = INDIAN_BASE_LINE + (t * MILES_PER_TOWNSHIP * LAT_MILES_RATIO);
                if (lat >= 34.0 && lat <= 37.0) {
                    gridLines.push({
                        coordinates: [[lat, -99.0], [lat, -94.0]],
                        label: `T${Math.abs(t)}${t >= 0 ? 'N' : 'S'}`
                    });
                }
            }

            // Generate vertical lines
            for (let r = -15; r <= 15; r++) {
                const lng = INDIAN_MERIDIAN + (r * MILES_PER_TOWNSHIP * LNG_MILES_RATIO);
                if (lng >= -99.0 && lng <= -94.0) {
                    gridLines.push({
                        coordinates: [[34.0, lng], [37.0, lng]],
                        label: `R${Math.abs(r)}${r >= 0 ? 'E' : 'W'}`
                    });
                }
            }

            townshipLayer = L.layerGroup();

            gridLines.forEach(line => {
                const polyline = L.polyline(line.coordinates, {
                    color: '#64748B',        // Blue-gray (not red)
                    weight: 1.5,
                    opacity: 0.6,
                    dashArray: '5, 5'       // Keep dashed for townships
                });

                polyline.bindPopup(`<div class="popup-title">PLSS Grid Line</div><div class="popup-detail">${line.label}</div>`, {
                    className: 'high-z-popup'
                });
                townshipLayer.addLayer(polyline);
            });
        }

        // Create county labels layer - calculates centroids from actual GeoJSON data
        function createCountyLabels() {
            countyLabelsLayer.clearLayers();

            // If county layer isn't loaded yet, wait
            if (!countyLayer) {
                console.log('County layer not loaded yet, cannot create labels');
                return;
            }

            const zoom = map.getZoom();
            const fontSize = zoom < 7 ? '9px' : zoom < 9 ? '11px' : zoom < 11 ? '13px' : '15px';

            // Iterate through county features and calculate centroids
            countyLayer.eachLayer(function(layer) {
                const feature = layer.feature;
                if (!feature || !feature.properties) return;

                const countyName = feature.properties.COUNTY_NAME || feature.properties.NAME || 'Unknown';

                // Calculate centroid from geometry
                let centroid = null;
                try {
                    if (feature.geometry) {
                        const bounds = layer.getBounds();
                        centroid = bounds.getCenter();
                    }
                } catch (e) {
                    console.warn('Could not calculate centroid for', countyName);
                    return;
                }

                if (!centroid) return;

                const isDark = typeof mapDarkMode !== 'undefined' && mapDarkMode;
                const labelColor = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(28, 43, 54, 0.85)';
                const labelShadow = isDark
                    ? '-1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.6)'
                    : '-1px -1px 0 rgba(255,255,255,0.95), 1px -1px 0 rgba(255,255,255,0.95), -1px 1px 0 rgba(255,255,255,0.95), 1px 1px 0 rgba(255,255,255,0.95), 0 0 4px rgba(255,255,255,0.9)';

                const label = L.divIcon({
                    className: 'county-label',
                    html: `<div style="
                        color: ${labelColor};
                        font-family: 'Inter', sans-serif;
                        font-size: ${fontSize};
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                        text-align: center;
                        white-space: nowrap;
                        pointer-events: none;
                        text-shadow: ${labelShadow};
                    ">${countyName}</div>`,
                    iconSize: [120, 20],
                    iconAnchor: [60, 10]
                });

                const marker = L.marker([centroid.lat, centroid.lng], {
                    icon: label,
                    interactive: false
                });

                countyLabelsLayer.addLayer(marker);
            });

            console.log(`Created ${countyLabelsLayer.getLayers().length} county labels`);
        }

        // Helper function to ensure proper layer ordering (properties should be clickable)
        // Layer z-order: bottom → top. 'back' = remove+re-add (for LayerGroups), 'front' = bringToFront
        const LAYER_ORDER = [
            { get: () => activityHeatmapLayer, action: 'back' },   // background heatmap
            { get: () => poolingRateLayer,     action: 'front' },  // choropleth
            { get: () => wellsLayer,           action: 'front' },  // tracked wells
            { get: () => nearbyWellsLayer,     action: 'front' },  // nearby wells
            { get: () => propertiesLayer,      action: 'front' },  // user properties (most clickable)
            { get: () => sectionLayer,         action: 'front' },  // section lines on top
        ];

        function ensureLayerOrder() {
            for (const { get, action } of LAYER_ORDER) {
                const layer = get();
                if (!layer || !map.hasLayer(layer)) continue;
                if (action === 'back') { map.removeLayer(layer); map.addLayer(layer); }
                else { layer.bringToFront(); }
            }
        }



// ═══════════════════════════════════════════════
// Module: map-activity.txt
// ═══════════════════════════════════════════════
        // Toggle functions
        function toggleLandGrid() {
            const checkbox = document.getElementById('toggle-land-grid');
            if (checkbox.checked) {
                if (countyLayer && !map.hasLayer(countyLayer)) map.addLayer(countyLayer);
                if (townshipLayer && !map.hasLayer(townshipLayer)) map.addLayer(townshipLayer);
            } else {
                if (countyLayer && map.hasLayer(countyLayer)) map.removeLayer(countyLayer);
                if (townshipLayer && map.hasLayer(townshipLayer)) map.removeLayer(townshipLayer);
            }
            ensureLayerOrder();
        }

        function togglePoolingRates() {
            const checkbox = document.getElementById('toggle-pooling-rates');
            const legend = document.getElementById('poolingRatesLegend');
            const btn = document.getElementById('poolingRatesBtn');
            if (checkbox.checked) {
                if (!poolingRateLayer) {
                    loadPoolingRates(); // Lazy load on first enable
                } else {
                    if (!map.hasLayer(poolingRateLayer)) map.addLayer(poolingRateLayer);
                    enrichPropertyTooltips(true);
                }
                if (legend) legend.style.display = '';
                if (btn) btn.classList.add('active');
            } else {
                if (poolingRateLayer && map.hasLayer(poolingRateLayer)) {
                    map.removeLayer(poolingRateLayer);
                }
                enrichPropertyTooltips(false);
                if (legend) legend.style.display = 'none';
                if (btn) btn.classList.remove('active');
            }
            ensureLayerOrder();
        }

        function toggleProperties() {
            const checkbox = document.getElementById('toggle-properties');
            if (checkbox.checked && propertiesLayer) {
                if (!map.hasLayer(propertiesLayer)) {
                    map.addLayer(propertiesLayer);
                    // Ensure properties stay on top for clicking
                    propertiesLayer.bringToFront();
                }
            } else if (propertiesLayer) {
                if (map.hasLayer(propertiesLayer)) map.removeLayer(propertiesLayer);
            }
            ensureLayerOrder();
        }

        function toggleWells() {
            const checkbox = document.getElementById('toggle-wells');
            // Legend elements removed - will be added back later

            if (checkbox.checked && wellsLayer) {
                if (!map.hasLayer(wellsLayer)) map.addLayer(wellsLayer);
            } else if (wellsLayer) {
                if (map.hasLayer(wellsLayer)) map.removeLayer(wellsLayer);
            }
            ensureLayerOrder();
        }

        function togglePermits() {
            const checkbox = document.getElementById('toggle-permits');
            if (checkbox.checked && permitsLayer) {
                if (!map.hasLayer(permitsLayer)) map.addLayer(permitsLayer);
            } else if (permitsLayer) {
                if (map.hasLayer(permitsLayer)) map.removeLayer(permitsLayer);
            }
            ensureLayerOrder();
        }

        function toggleCompletions() {
            const checkbox = document.getElementById('toggle-completions');
            if (checkbox.checked && completionsLayer) {
                if (!map.hasLayer(completionsLayer)) map.addLayer(completionsLayer);
            } else if (completionsLayer) {
                if (map.hasLayer(completionsLayer)) map.removeLayer(completionsLayer);
            }
            ensureLayerOrder();
        }

        function toggleCountyLabels() {
            const checkbox = document.getElementById('toggle-county-labels');
            if (checkbox.checked) {
                if (!map.hasLayer(countyLabelsLayer)) {
                    createCountyLabels();
                    map.addLayer(countyLabelsLayer);
                }
            } else {
                if (map.hasLayer(countyLabelsLayer)) {
                    map.removeLayer(countyLabelsLayer);
                }
            }
        }


        // Smooth fade effects based on zoom level
        function updateLayerVisibility() {
            const zoom = map.getZoom();

            // County labels: hide completely when zoomed out, fade in at medium zoom
            if (map.hasLayer(countyLabelsLayer)) {
                if (zoom < 8) {
                    // Hide county labels when viewing whole state
                    map.removeLayer(countyLabelsLayer);
                } else {
                    // Show and adjust opacity for readable zoom levels
                    if (!map.hasLayer(countyLabelsLayer)) {
                        map.addLayer(countyLabelsLayer);
                    }
                    const labelOpacity = zoom < 10 ? 0.7 : zoom < 12 ? 0.9 : 1;
                    const labelSize = zoom < 10 ? '12px' : zoom < 12 ? '14px' : '16px';

                    document.querySelectorAll('.county-label div').forEach(label => {
                        label.style.opacity = labelOpacity;
                        label.style.fontSize = labelSize;
                        label.style.transition = 'opacity 0.3s ease, font-size 0.3s ease';
                    });
                }
            } else if (zoom >= 8 && document.getElementById('toggle-county-labels').checked) {
                // Re-add labels if zoom level is now appropriate and checkbox is checked
                if (countyLabelsLayer.getLayers().length > 0) {
                    map.addLayer(countyLabelsLayer);
                }
            }

            // Township lines: fade slightly at high zoom when sections are visible
            if (townshipLayer && map.hasLayer(townshipLayer)) {
                const townshipOpacity = zoom < 10 ? 0.6 : zoom < 12 ? 0.5 : 0.4;
                // Check if it's a GeoJSON layer (has setStyle) or a LayerGroup (fallback)
                if (typeof townshipLayer.setStyle === 'function') {
                    townshipLayer.setStyle({
                        opacity: townshipOpacity
                    });
                } else {
                    // For LayerGroup fallback, iterate through layers
                    townshipLayer.eachLayer(function(layer) {
                        if (layer.setStyle) {
                            layer.setStyle({
                                opacity: townshipOpacity
                            });
                        }
                    });
                }
            }

            // County boundaries: consistent but slightly fade at very high zoom
            if (countyLayer && map.hasLayer(countyLayer)) {
                const countyOpacity = zoom < 12 ? 0.8 : 0.6;
                // Check if it's a GeoJSON layer (has setStyle) or a LayerGroup (fallback)
                if (typeof countyLayer.setStyle === 'function') {
                    countyLayer.setStyle({
                        opacity: countyOpacity
                    });
                } else {
                    // For LayerGroup fallback, iterate through layers
                    countyLayer.eachLayer(function(layer) {
                        if (layer.setStyle) {
                            layer.setStyle({
                                opacity: countyOpacity
                            });
                        }
                    });
                }
            }
        }

        // Section Number Toggle - uses real OCC API data
        function toggleSectionNumbers() {
            const checkbox = document.getElementById('toggle-section-numbers');
            showSectionNumbers = checkbox.checked;

            if (showSectionNumbers) {
                const zoom = map.getZoom();
                if (zoom >= 12) {
                    // Re-render sections to include labels
                    sectionBounds = null; // Force refresh
                    updateSectionLines();
                } else {
                    updateStatus('Zoom in to see section numbers (zoom 12+)');
                    setTimeout(() => updateStatus('Map ready'), 2000);
                }
            } else {
                // Hide labels
                if (map.hasLayer(sectionLabelsLayer)) {
                    map.removeLayer(sectionLabelsLayer);
                }
            }
        }

        // Update section labels when map moves (if enabled)
        function updateSectionLabelsOnMove() {
            if (showSectionNumbers && map.getZoom() >= 12) {
                // Labels are recreated when sections are loaded via updateSectionLines
                // This just ensures they stay in sync
            }
        }

        // Apply fade effects on zoom
        map.on('zoomend', function() {
            updateLayerVisibility();
            // Section labels are updated via updateSectionLines
        });
        map.on('zoom', updateLayerVisibility);  // Smooth during zoom

        // Helper function to parse TRS from activity location string
        function parseTRSFromActivity(locationStr) {
            if (!locationStr) return null;

            // Try different formats
            // Format 1: "S15 T22N R19W"
            let match = locationStr.match(/S(\d+)\s+T(\d+[NS])\s+R(\d+[EW])/i);

            // Format 2: "15-22N-19W"
            if (!match) {
                match = locationStr.match(/(\d+)-(\d+[NS])-(\d+[EW])/i);
            }

            // Format 3: More flexible with optional spaces
            if (!match) {
                match = locationStr.match(/S?\s*(\d+)\s*[-T]\s*(\d+[NS])\s*[-R]\s*(\d+[EW])/i);
            }

            if (!match) {
                return null;
            }

            return {
                section: match[1],
                township: match[2],
                range: match[3]
            };
        }

        // Check if a location is within radius of any user property
        function isNearUserProperty(lat, lng) {
            if (!userProperties || userProperties.length === 0) return false;

            const activityPoint = L.latLng(lat, lng);
            const radiusMeters = ACTIVITY_PROXIMITY_RADIUS * 1609.34; // Convert miles to meters

            // Check if any property is within radius
            return userProperties.some(property => {
                const propBounds = property.bounds;
                if (!propBounds) return false;

                // Get center of property bounds
                const propCenter = propBounds.getCenter();
                const distance = activityPoint.distanceTo(propCenter);

                return distance <= radiusMeters;
            });
        }

        // Load recent activity data (permits and completions)
        const ACTIVITY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

        async function loadActivityData() {
            try {
                updateStatus('Loading recent activity...');

                // Check localStorage cache first (30-min TTL)
                let activities;
                const cached = localStorage.getItem('mw_activity_cache');
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (parsed.t && (Date.now() - parsed.t) < ACTIVITY_CACHE_TTL && parsed.data) {
                            activities = parsed.data;
                            console.log(`Loaded ${activities.length} activities from cache`);
                        }
                    } catch (e) { localStorage.removeItem('mw_activity_cache'); }
                }

                // Fetch from API if no cache hit
                if (!activities) {
                    const response = await fetch('/api/activity/statewide?days=90');
                    if (!response.ok) {
                        throw new Error('Failed to load activity data');
                    }
                    activities = await response.json();
                    console.log(`Loaded ${activities.length} activities from API`);
                    // Cache for next visit
                    try { localStorage.setItem('mw_activity_cache', JSON.stringify({ t: Date.now(), data: activities })); } catch (e) {}
                }

                // Clear existing layers
                permitsLayer.clearLayers();
                completionsLayer.clearLayers();

                // Collect points for heatmaps
                const permitPoints = [];
                const completionPoints = [];

                let processedCount = 0;
                const totalActivities = activities.length;

                // Process each activity
                for (const activity of activities) {
                    const fields = activity.fields || {};

                    // First priority: Use stored Latitude/Longitude if available
                    let lat, lng;
                    if (fields.Latitude && fields.Longitude) {
                        lat = parseFloat(fields.Latitude);
                        lng = parseFloat(fields.Longitude);
                    } else {
                        // Fallback: Try to parse TRS and use section geometry
                        const trs = parseTRSFromActivity(fields['Section-Township-Range']);
                        if (!trs) {
                            console.warn(`Could not parse TRS for activity ${fields['API Number']}, location string: "${fields['Section-Township-Range']}"`);
                            // Skip this activity if we can't determine location
                            continue;
                        }

                        // We'll fetch the section geometry to place the marker
                        const cacheKey = `${trs.section}-${trs.township}-${trs.range}`;
                        let sectionGeometry = null;

                        // Check if we already have this section geometry cached
                        if (geometryCache[cacheKey]) {
                            sectionGeometry = geometryCache[cacheKey];
                        } else {
                            // Try to fetch it using the county from the activity
                            const county = fields.County;
                            if (county) {
                                try {
                                    sectionGeometry = await fetchSectionGeometry(trs.section, trs.township, trs.range, county);
                                    if (sectionGeometry) {
                                        console.log(`Fetched geometry for activity in ${cacheKey}`);
                                    }
                                } catch (err) {
                                    console.warn(`Failed to fetch section geometry for ${cacheKey}:`, err);
                                }
                            }
                        }

                        // If we have section geometry, calculate the center point
                        if (sectionGeometry && sectionGeometry.geometry) {
                            // Calculate the centroid of the section
                            const bounds = L.geoJSON(sectionGeometry).getBounds();
                            const center = bounds.getCenter();
                            lat = center.lat;
                            lng = center.lng;
                            console.log(`Placing activity at section center: ${lat}, ${lng}`);
                        } else {
                            // Last resort: try to parse coordinates from Map Link
                            const coords = parseOccMapLink(fields['OCC Map Link']);
                            if (coords) {
                                lat = coords.lat;
                                lng = coords.lon;
                            } else {
                                console.warn(`Cannot determine location for activity ${fields['API Number']}`);
                                continue;
                            }
                        }
                    }

                    // Collect points for heatmap
                    const isPermit = fields['Activity Type'] === 'New Permit';
                    if (isPermit) {
                        permitPoints.push([lat, lng, 1]); // lat, lng, intensity
                    } else {
                        completionPoints.push([lat, lng, 1]);
                    }

                    // Only show individual markers for user's activities that are near their properties
                    const isUserActivity = fields.isUserActivity;
                    const showIndividualMarker = isUserActivity && isNearUserProperty(lat, lng);

                    // Determine which layer to add to
                    if (fields['Activity Type'] === 'New Permit' && showIndividualMarker) {
                        // Create yellow circle marker for permits near properties
                        const marker = L.circleMarker([lat, lng], {
                            radius: 12,  // Pixel radius (doesn't change with zoom)
                            fillColor: '#FDE047',  // Yellow
                            color: '#F59E0B',  // Darker yellow border
                            weight: 2.5,
                            opacity: 1,
                            fillOpacity: 0.7
                        });

                        // Add enhanced popup with Track Well button
                        const apiNumber = fields['API Number'] || '';
                        const popupContent = `
                                    <div class="popup-header">
                                        <span class="popup-tag permit">Drilling Permit</span>
                                    </div>
                                    <div class="popup-well-name">${toTitleCase(fields['Well Name'] || 'Unknown Well')}</div>
                                    <div class="popup-details">
                                        ${toTitleCase(fields.Operator || 'Unknown Operator')}<br>
                                        ${fields['Section-Township-Range'] || ''} • ${fields.County || 'Unknown'}<br>
                                        Filed: ${new Date(fields['Detected At']).toLocaleDateString()}
                                    </div>
                                    <div class="popup-actions">
                                        <button class="popup-btn popup-btn-secondary" onclick="expandActivityCard('permit', ${JSON.stringify(fields).replace(/"/g, '&quot;')}); return false;">More →</button>
                                    </div>
                        `;
                        marker.bindPopup(popupContent, { maxWidth: 350, className: 'high-z-popup' });

                        permitsLayer.addLayer(marker);

                        if ((fields['Drill Type'] === 'HH' || fields['Drill Type'] === 'DH') &&
                            (fields['BH Latitude'] && fields['BH Longitude'] || fields['PBH Section'])) {

                            // Use BH coords from API when available (no geometry fetch needed)
                            let bhLat = parseFloat(fields['BH Latitude']);
                            let bhLng = parseFloat(fields['BH Longitude']);

                            // Fallback: fetch section geometry if no BH coords
                            if (!bhLat || !bhLng) {
                                const bhCacheKey = `${fields['PBH Section']}-${fields['PBH Township']}-${fields['PBH Range']}`;
                                let bhGeometry = geometryCache[bhCacheKey];
                                if (!bhGeometry && fields.County && fields['PBH Section'] && fields['PBH Township'] && fields['PBH Range']) {
                                    try {
                                        bhGeometry = await fetchSectionGeometry(fields['PBH Section'], fields['PBH Township'], fields['PBH Range'], fields.County);
                                        if (bhGeometry) geometryCache[bhCacheKey] = bhGeometry;
                                    } catch (err) {}
                                }
                                if (bhGeometry && bhGeometry.geometry) {
                                    const c = L.geoJSON(bhGeometry).getBounds().getCenter();
                                    bhLat = c.lat;
                                    bhLng = c.lng;
                                }
                            }

                            if (bhLat && bhLng) {
                                const path = drawLateralPath(
                                    { lat, lng },
                                    { lat: bhLat, lng: bhLng },
                                    { fields },
                                    'permit'
                                );
                                if (path) {
                                    permitsLayer.addLayer(path);
                                }
                            }
                        }

                    } else if (fields['Activity Type'] === 'Well Completed' && showIndividualMarker) {
                        // Create blue circle marker for completions near properties
                        const marker = L.circleMarker([lat, lng], {
                            radius: 12,  // Pixel radius (doesn't change with zoom)
                            fillColor: '#3B82F6',  // Blue
                            color: '#1D4ED8',  // Darker blue border
                            weight: 2.5,
                            opacity: 1,
                            fillOpacity: 0.7
                        });

                        // Add enhanced popup
                        const apiNumber = fields['API Number'] || '';
                        const popupContent = `
                                    <div class="popup-header">
                                        <span class="popup-tag completed">Well Completed</span>
                                    </div>
                                    <div class="popup-well-name">${toTitleCase(fields['Well Name'] || 'Unknown Well')}</div>
                                    <div class="popup-details">
                                        ${toTitleCase(fields.Operator || 'Unknown Operator')}<br>
                                        ${fields.Formation || fields['Formation Name'] ? `${toTitleCase(fields.Formation || fields['Formation Name'])}<br>` : ''}
                                        ${fields['Section-Township-Range'] || ''} • ${fields.County || 'Unknown'}<br>
                                        Completed: ${new Date(fields['Detected At']).toLocaleDateString()}
                                    </div>
                                    <div class="popup-actions">
                                        <button class="popup-btn popup-btn-secondary" onclick="expandActivityCard('completion', ${JSON.stringify(fields).replace(/"/g, '&quot;')}); return false;">More →</button>
                                    </div>
                        `;
                        marker.bindPopup(popupContent, { maxWidth: 350, className: 'high-z-popup' });

                        completionsLayer.addLayer(marker);

                        const isHorizontal = fields['Drill Type'] === 'HORIZONTAL HOLE' ||
                                           fields['Drill Type'] === 'HH' ||
                                           fields['Location Type Sub'] === 'HH';

                        if (isHorizontal && (fields['BH Latitude'] && fields['BH Longitude'] || fields['BH Section'])) {
                            // Use BH coords from API when available (no geometry fetch needed)
                            let bhLat = parseFloat(fields['BH Latitude']);
                            let bhLng = parseFloat(fields['BH Longitude']);

                            // Fallback: fetch section geometry if no BH coords
                            if (!bhLat || !bhLng) {
                                const bhCacheKey = `${fields['BH Section']}-${fields['BH Township']}-${fields['BH Range']}`;
                                let bhGeometry = geometryCache[bhCacheKey];
                                if (!bhGeometry && fields.County && fields['BH Section'] && fields['BH Township'] && fields['BH Range']) {
                                    try {
                                        bhGeometry = await fetchSectionGeometry(fields['BH Section'], fields['BH Township'], fields['BH Range'], fields.County);
                                        if (bhGeometry) geometryCache[bhCacheKey] = bhGeometry;
                                    } catch (err) {}
                                }
                                if (bhGeometry && bhGeometry.geometry) {
                                    const c = L.geoJSON(bhGeometry).getBounds().getCenter();
                                    bhLat = c.lat;
                                    bhLng = c.lng;
                                }
                            }

                            if (bhLat && bhLng) {
                                const path = drawLateralPath(
                                    { lat, lng },
                                    { lat: bhLat, lng: bhLng },
                                    { fields },
                                    'completion'
                                );
                                if (path) {
                                    completionsLayer.addLayer(path);
                                }
                            }
                        }
                    }

                    processedCount++;
                }

                // Create heat layers with collected points BEFORE checking toggles
                console.log('🔥 Heatmap data collected:', {
                    permitPoints: permitPoints.length,
                    completionPoints: completionPoints.length,
                    samplePermits: permitPoints.slice(0, 3),
                    sampleCompletions: completionPoints.slice(0, 3)
                });

                // Store points globally for debugging
                window.debugPermitData = {
                    permitPoints: permitPoints,
                    completionPoints: completionPoints
                };

                if ((permitPoints.length > 0 || completionPoints.length > 0) && typeof L.heatLayer === 'function') {
                    try {
                        // Create combined heatmap with different gradients for permits vs completions
                        // Yellow gradient for permits
                        if (permitPoints.length > 0) {
                            permitHeatmapLayer = L.heatLayer(permitPoints, {
                                radius: 40,   // Optimized radius
                                blur: 20,     // Blur ≤ half of radius to prevent edge artifacts
                                max: 0.3,     // Adjusted max intensity
                                minOpacity: 0.3,
                                gradient: {
                                    0.0: 'rgba(255, 255, 0, 0)',
                                    0.1: 'rgba(255, 255, 0, 0.4)',
                                    0.2: 'rgba(253, 224, 71, 0.6)',
                                    0.4: 'rgba(245, 158, 11, 0.8)',
                                    0.6: 'rgba(234, 88, 12, 0.9)',
                                    1.0: 'rgba(220, 38, 38, 1)'
                                }
                            });
                            console.log('✅ Created permit heatmap layer with', permitPoints.length, 'points');
                        }

                        // Blue gradient for completions
                        if (completionPoints.length > 0) {
                            completionHeatmapLayer = L.heatLayer(completionPoints, {
                                radius: 40,   // Matching radius for consistency
                                blur: 20,     // Blur ≤ half of radius to prevent edge artifacts
                                max: 0.3,     // Matching max intensity
                                minOpacity: 0.3,
                                gradient: {
                                    0.0: 'rgba(59, 130, 246, 0)',
                                    0.1: 'rgba(59, 130, 246, 0.4)',
                                    0.2: 'rgba(96, 165, 250, 0.6)',
                                    0.4: 'rgba(59, 130, 246, 0.8)',
                                    0.6: 'rgba(29, 78, 216, 0.9)',
                                    1.0: 'rgba(124, 58, 237, 1)'
                                }
                            });
                            console.log('✅ Created completion heatmap layer with', completionPoints.length, 'points');
                        }

                        // Create combined layer group
                        const layers = [];
                        if (permitHeatmapLayer) layers.push(permitHeatmapLayer);
                        if (completionHeatmapLayer) layers.push(completionHeatmapLayer);

                        if (layers.length > 0) {
                            activityHeatmapLayer = L.layerGroup(layers);
                            console.log('🔥 Activity heatmap layer created with', layers.length, 'sublayers');

                            // Check checkbox states and add appropriate layers
                            const showPermits = document.getElementById('toggle-heatmap-permits').checked;
                            const showCompletions = document.getElementById('toggle-heatmap-completions').checked;
                            if (showPermits && permitHeatmapLayer) {
                                map.addLayer(permitHeatmapLayer);
                            }
                            if (showCompletions && completionHeatmapLayer) {
                                map.addLayer(completionHeatmapLayer);
                            }
                            if (showPermits || showCompletions) {
                                console.log('📍 Heatmap added to map automatically');
                                ensureLayerOrder();
                            }
                        }
                    } catch (e) {
                        console.warn('Heatmap plugin not available, falling back to markers');
                        // Fallback: create simple circle markers
                        activityHeatmapLayer = L.featureGroup();

                        // Add permit markers
                        permitPoints.forEach(([lat, lng]) => {
                            const marker = L.circleMarker([lat, lng], {
                                radius: 4,
                                fillColor: '#FDE047',
                                color: '#F59E0B',
                                weight: 1,
                                opacity: 0.6,
                                fillOpacity: 0.3
                            });
                            activityHeatmapLayer.addLayer(marker);
                        });

                        // Add completion markers
                        completionPoints.forEach(([lat, lng]) => {
                            const marker = L.circleMarker([lat, lng], {
                                radius: 4,
                                fillColor: '#3B82F6',
                                color: '#1D4ED8',
                                weight: 1,
                                opacity: 0.6,
                                fillOpacity: 0.3
                            });
                            activityHeatmapLayer.addLayer(marker);
                        });
                    }
                } else if (permitPoints.length > 0 || completionPoints.length > 0) {
                    console.warn('Heatmap plugin not loaded, using fallback markers');
                    // Same fallback code as above
                    activityHeatmapLayer = L.featureGroup();

                    permitPoints.forEach(([lat, lng]) => {
                        const marker = L.circleMarker([lat, lng], {
                            radius: 4,
                            fillColor: '#FDE047',
                            color: '#F59E0B',
                            weight: 1,
                            opacity: 0.6,
                            fillOpacity: 0.3
                        });
                        activityHeatmapLayer.addLayer(marker);
                    });

                    completionPoints.forEach(([lat, lng]) => {
                        const marker = L.circleMarker([lat, lng], {
                            radius: 4,
                            fillColor: '#3B82F6',
                            color: '#1D4ED8',
                            weight: 1,
                            opacity: 0.6,
                            fillOpacity: 0.3
                        });
                        activityHeatmapLayer.addLayer(marker);
                    });
                }

                // Add layers to map if toggles are checked
                if (document.getElementById('toggle-permits').checked && !map.hasLayer(permitsLayer)) {
                    map.addLayer(permitsLayer);
                }
                if (document.getElementById('toggle-completions').checked && !map.hasLayer(completionsLayer)) {
                    map.addLayer(completionsLayer);
                }
                // Check if heatmap is enabled and add appropriate layers based on checkboxes
                const showPermits = document.getElementById('toggle-heatmap-permits').checked;
                const showCompletions = document.getElementById('toggle-heatmap-completions').checked;
                if (showPermits && permitHeatmapLayer && !map.hasLayer(permitHeatmapLayer)) {
                    map.addLayer(permitHeatmapLayer);
                }
                if (showCompletions && completionHeatmapLayer && !map.hasLayer(completionHeatmapLayer)) {
                    map.addLayer(completionHeatmapLayer);
                }
                if (showPermits || showCompletions) {
                    console.log('✅ Added heatmap layers to map');
                }
                // Ensure properties remain on top
                ensureLayerOrder();

                // Load OCC Application heatmap data (non-blocking)
                loadOccDocketHeatmap();

                // Count only user's activities for the counters
                const userActivities = activities.filter(a => a.fields.isUserActivity);
                const permitCount = userActivities.filter(a => a.fields['Activity Type'] === 'New Permit').length;
                const completionCount = userActivities.filter(a => a.fields['Activity Type'] === 'Well Completed').length;

                // Count total activities for heatmap
                const totalPermits = activities.filter(a => a.fields['Activity Type'] === 'New Permit').length;
                const totalCompletions = activities.filter(a => a.fields['Activity Type'] === 'Well Completed').length;

                updateStatus(`Loaded ${totalPermits} statewide permits, ${totalCompletions} completions (${permitCount} + ${completionCount} yours)`);

                // Update count displays with user's counts only
                document.getElementById('permitCount').textContent = permitCount;
                document.getElementById('completionCount').textContent = completionCount;

                // Clear the status after 3 seconds
                setTimeout(() => updateStatus('Map ready'), 3000);

            } catch (error) {
                console.error('Error loading activity data:', error);
                updateStatus('Failed to load activity data');
            }
        }

        // Load OCC docket entries for heatmap (runs independently, non-blocking)
        async function loadOccDocketHeatmap() {
            try {
                console.log('Loading OCC docket heatmap data...');

                // Check localStorage cache first (30-min TTL)
                let docketData;
                const cached = localStorage.getItem('mw_docket_cache');
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached);
                        if (parsed.t && (Date.now() - parsed.t) < ACTIVITY_CACHE_TTL && parsed.data) {
                            docketData = parsed.data;
                            console.log(`Loaded ${docketData.count} docket entries from cache`);
                        }
                    } catch (e) { localStorage.removeItem('mw_docket_cache'); }
                }

                if (!docketData) {
                    const docketResponse = await fetch('/api/docket-heatmap?days=90');
                    if (!docketResponse.ok) {
                        console.warn('Failed to fetch OCC docket data:', docketResponse.status);
                        return;
                    }
                    docketData = await docketResponse.json();
                    try { localStorage.setItem('mw_docket_cache', JSON.stringify({ t: Date.now(), data: docketData })); } catch (e) {}
                }
                console.log(`📋 Loaded ${docketData.count} OCC docket entries for heatmap`);

                if (!docketData.entries || docketData.entries.length === 0) {
                    console.log('📋 No OCC docket entries found');
                    return;
                }

                const poolingPoints = [];
                const densityPoints = [];
                const spacingPoints = [];
                const horizontalPoints = [];

                // Server now returns lat/lng centroids — no per-entry geometry fetches needed
                for (const entry of docketData.entries) {
                    if (!entry.latitude || !entry.longitude) continue;

                    const point = [entry.latitude, entry.longitude, 1];
                    switch (entry.relief_type) {
                        case 'POOLING': poolingPoints.push(point); break;
                        case 'INCREASED_DENSITY': densityPoints.push(point); break;
                        case 'SPACING': spacingPoints.push(point); break;
                        case 'HORIZONTAL_WELL': horizontalPoints.push(point); break;
                    }
                }

                console.log('📋 OCC Application points:', {
                    pooling: poolingPoints.length,
                    density: densityPoints.length,
                    spacing: spacingPoints.length,
                    horizontal: horizontalPoints.length
                });

                // Create heatmap layers if we have L.heatLayer
                if (typeof L.heatLayer !== 'function') {
                    console.warn('Heatmap plugin not available for OCC layers');
                    return;
                }

                // Purple gradient for Pooling
                if (poolingPoints.length > 0) {
                    poolingHeatmapLayer = L.heatLayer(poolingPoints, {
                        radius: 40, blur: 20, max: 0.3, minOpacity: 0.3,
                        gradient: {
                            0.0: 'rgba(147, 51, 234, 0)',
                            0.3: 'rgba(147, 51, 234, 0.5)',
                            0.6: 'rgba(126, 34, 206, 0.8)',
                            1.0: 'rgba(88, 28, 135, 1)'
                        }
                    });
                    console.log('✅ Created pooling heatmap layer with', poolingPoints.length, 'points');
                }

                // Green gradient for Increased Density
                if (densityPoints.length > 0) {
                    densityHeatmapLayer = L.heatLayer(densityPoints, {
                        radius: 40, blur: 20, max: 0.3, minOpacity: 0.3,
                        gradient: {
                            0.0: 'rgba(34, 197, 94, 0)',
                            0.3: 'rgba(34, 197, 94, 0.5)',
                            0.6: 'rgba(22, 163, 74, 0.8)',
                            1.0: 'rgba(15, 118, 51, 1)'
                        }
                    });
                    console.log('✅ Created density heatmap layer with', densityPoints.length, 'points');
                }

                // Magenta gradient for Spacing Unit
                if (spacingPoints.length > 0) {
                    spacingHeatmapLayer = L.heatLayer(spacingPoints, {
                        radius: 40, blur: 20, max: 0.3, minOpacity: 0.3,
                        gradient: {
                            0.0: 'rgba(236, 72, 153, 0)',
                            0.3: 'rgba(236, 72, 153, 0.5)',
                            0.6: 'rgba(219, 39, 119, 0.8)',
                            1.0: 'rgba(190, 24, 93, 1)'
                        }
                    });
                    console.log('✅ Created spacing heatmap layer with', spacingPoints.length, 'points');
                }

                // Orange gradient for Horizontal Well
                if (horizontalPoints.length > 0) {
                    horizontalHeatmapLayer = L.heatLayer(horizontalPoints, {
                        radius: 40, blur: 20, max: 0.3, minOpacity: 0.3,
                        gradient: {
                            0.0: 'rgba(249, 115, 22, 0)',
                            0.3: 'rgba(249, 115, 22, 0.5)',
                            0.6: 'rgba(234, 88, 12, 0.8)',
                            1.0: 'rgba(194, 65, 12, 1)'
                        }
                    });
                    console.log('✅ Created horizontal heatmap layer with', horizontalPoints.length, 'points');
                }

                // Add layers based on checkbox states
                if (document.getElementById('toggle-heatmap-pooling')?.checked && poolingHeatmapLayer) {
                    map.addLayer(poolingHeatmapLayer);
                }
                if (document.getElementById('toggle-heatmap-density')?.checked && densityHeatmapLayer) {
                    map.addLayer(densityHeatmapLayer);
                }
                if (document.getElementById('toggle-heatmap-spacing')?.checked && spacingHeatmapLayer) {
                    map.addLayer(spacingHeatmapLayer);
                }
                if (document.getElementById('toggle-heatmap-horizontal')?.checked && horizontalHeatmapLayer) {
                    map.addLayer(horizontalHeatmapLayer);
                }

                ensureLayerOrder();
                console.log('📋 OCC docket heatmap layers ready');

            } catch (error) {
                console.warn('Error loading OCC docket heatmap data:', error);
            }
        }

        // Toggle activity heatmap based on checkbox states
        function updateHeatmapLayers() {
            const showPermits = document.getElementById('toggle-heatmap-permits').checked;
            const showCompletions = document.getElementById('toggle-heatmap-completions').checked;
            const showPooling = document.getElementById('toggle-heatmap-pooling')?.checked;
            const showDensity = document.getElementById('toggle-heatmap-density')?.checked;
            const showSpacing = document.getElementById('toggle-heatmap-spacing')?.checked;
            const showHorizontal = document.getElementById('toggle-heatmap-horizontal')?.checked;

            // Update permit heatmap layer
            if (showPermits && permitHeatmapLayer) {
                if (!map.hasLayer(permitHeatmapLayer)) {
                    map.addLayer(permitHeatmapLayer);
                    console.log('🔥 Showing permit heatmap');
                }
            } else if (permitHeatmapLayer && map.hasLayer(permitHeatmapLayer)) {
                map.removeLayer(permitHeatmapLayer);
            }

            // Update completion heatmap layer
            if (showCompletions && completionHeatmapLayer) {
                if (!map.hasLayer(completionHeatmapLayer)) {
                    map.addLayer(completionHeatmapLayer);
                    console.log('🔥 Showing completion heatmap');
                }
            } else if (completionHeatmapLayer && map.hasLayer(completionHeatmapLayer)) {
                map.removeLayer(completionHeatmapLayer);
            }

            // Update OCC Application heatmap layers
            // Pooling layer (purple)
            if (showPooling && poolingHeatmapLayer) {
                if (!map.hasLayer(poolingHeatmapLayer)) {
                    map.addLayer(poolingHeatmapLayer);
                    console.log('📋 Showing pooling heatmap');
                }
            } else if (poolingHeatmapLayer && map.hasLayer(poolingHeatmapLayer)) {
                map.removeLayer(poolingHeatmapLayer);
            }

            // Density layer (green)
            if (showDensity && densityHeatmapLayer) {
                if (!map.hasLayer(densityHeatmapLayer)) {
                    map.addLayer(densityHeatmapLayer);
                    console.log('📋 Showing density heatmap');
                }
            } else if (densityHeatmapLayer && map.hasLayer(densityHeatmapLayer)) {
                map.removeLayer(densityHeatmapLayer);
            }

            // Spacing layer (magenta)
            if (showSpacing && spacingHeatmapLayer) {
                if (!map.hasLayer(spacingHeatmapLayer)) {
                    map.addLayer(spacingHeatmapLayer);
                    console.log('📋 Showing spacing heatmap');
                }
            } else if (spacingHeatmapLayer && map.hasLayer(spacingHeatmapLayer)) {
                map.removeLayer(spacingHeatmapLayer);
            }

            // Horizontal layer (orange)
            if (showHorizontal && horizontalHeatmapLayer) {
                if (!map.hasLayer(horizontalHeatmapLayer)) {
                    map.addLayer(horizontalHeatmapLayer);
                    console.log('📋 Showing horizontal heatmap');
                }
            } else if (horizontalHeatmapLayer && map.hasLayer(horizontalHeatmapLayer)) {
                map.removeLayer(horizontalHeatmapLayer);
            }

            // Update button state - active if any heatmap or filing marker is shown
            const showFilingPermits = document.getElementById('toggle-permits')?.checked;
            const showFilingCompletions = document.getElementById('toggle-completions')?.checked;
            const anyHeatmapActive = showPermits || showCompletions || showPooling || showDensity || showSpacing || showHorizontal || showFilingPermits || showFilingCompletions;
            const heatmapBtn = document.getElementById('heatmapBtn');
            if (anyHeatmapActive) {
                heatmapBtn.classList.add('active');
                heatmapBtn.classList.remove('inactive');
            } else {
                heatmapBtn.classList.remove('active');
                heatmapBtn.classList.add('inactive');
            }

            if (anyHeatmapActive) {
                ensureLayerOrder();
            }

            showActivityHeatmap = anyHeatmapActive;
        }

        // Toggle production choropleth
        function toggleProductionChoropleth() {
            const select = document.getElementById('production-select');
            const value = select.value;

            // Update active state
            if (value !== 'off') {
                select.classList.add('active');
            } else {
                select.classList.remove('active');
            }

            // Reset or apply choropleth
            if (value === 'off') {
                resetCountyChoropleth();
                currentProductionType = null;
            } else {
                loadCountyProductionChoropleth(value);
            }
        }

        // Reset county layer to default styling
        function resetCountyChoropleth() {
            if (!countyLayer) return;

            const isDark = typeof mapDarkMode !== 'undefined' && mapDarkMode;
            countyLayer.eachLayer(function(layer) {
                layer.setStyle({
                    fillColor: 'transparent',
                    fillOpacity: 0,
                    color: isDark ? 'rgba(255,255,255,0.6)' : '#1C2B36',
                    weight: isDark ? 1.5 : 3,
                    opacity: isDark ? 0.5 : 0.8
                });
                // Remove any production popup
                layer.unbindPopup();
            });
            console.log('🗺️ Reset county choropleth styling');
        }

        // Load and apply county production choropleth
        async function loadCountyProductionChoropleth(productType) {
            if (!countyLayer) {
                console.warn('County layer not loaded yet');
                return;
            }

            console.log(`🗺️ Loading ${productType} production choropleth`);

            try {
                // Fetch production data
                const response = await fetch(`/api/map/county-production?product=${productType}`);
                const data = await response.json();

                if (!data.success || !data.data) {
                    console.error('Failed to load production data:', data);
                    return;
                }

                countyProductionData = data.data;
                currentProductionType = productType;

                // Define color scale (logarithmic)
                const maxVolume = data.maxVolume || 1;
                const getColor = (volume) => {
                    if (!volume || volume <= 0) return '#f0f0f0'; // No data - light gray

                    // Logarithmic scale for better distribution
                    const logMax = Math.log10(maxVolume);
                    const logVal = Math.log10(volume);
                    const ratio = logVal / logMax;

                    // Color gradient: light yellow -> orange -> red -> dark red
                    if (productType === 'oil') {
                        // Oil: Yellow -> Orange -> Red
                        if (ratio < 0.25) return '#ffffcc';
                        if (ratio < 0.50) return '#ffeda0';
                        if (ratio < 0.65) return '#feb24c';
                        if (ratio < 0.80) return '#f03b20';
                        return '#bd0026';
                    } else {
                        // Gas: Light blue -> Blue -> Purple
                        if (ratio < 0.25) return '#deebf7';
                        if (ratio < 0.50) return '#9ecae1';
                        if (ratio < 0.65) return '#4292c6';
                        if (ratio < 0.80) return '#2171b5';
                        return '#084594';
                    }
                };

                // Apply styling to county layer
                countyLayer.eachLayer(function(layer) {
                    const feature = layer.feature;
                    if (!feature || !feature.properties) return;

                    // Get county FIPS code for matching production data (production API uses FIPS codes as keys)
                    const countyNo = feature.properties.fips_code || feature.properties.COUNTY_FIPS_NO || feature.properties.COUNTY_NO || feature.properties.id;
                    const countyName = feature.properties.COUNTY_NAME || feature.properties.name || 'Unknown';
                    const prodData = countyProductionData[countyNo];

                    const volume = prodData ? prodData.volume : 0;
                    const fillColor = getColor(volume);

                    const isDark = typeof mapDarkMode !== 'undefined' && mapDarkMode;
                    layer.setStyle({
                        fillColor: fillColor,
                        fillOpacity: 0.7,
                        color: isDark ? 'rgba(255,255,255,0.6)' : '#1C2B36',
                        weight: 2
                    });

                    // Add popup with production info
                    const volumeFormatted = volume ? volume.toLocaleString() : '0';
                    const valueFormatted = prodData && prodData.value ? '$' + prodData.value.toLocaleString(undefined, {maximumFractionDigits: 0}) : '$0';
                    const unit = productType === 'oil' ? 'BBL' : 'MCF';

                    layer.bindPopup(`
                        <div class="popup-title">${countyName} County</div>
                        <div style="padding: 8px 0;">
                            <strong>${productType === 'oil' ? 'Oil' : 'Gas'} Production (12 mo)</strong><br>
                            Volume: ${volumeFormatted} ${unit}<br>
                            Value: ${valueFormatted}
                        </div>
                    `, { className: 'high-z-popup' });
                });

                console.log(`🗺️ Applied ${productType} choropleth to ${Object.keys(countyProductionData).length} counties`);

            } catch (error) {
                console.error('Error loading county production:', error);
            }
        }



// ═══════════════════════════════════════════════
// Module: map-nearby.txt
// ═══════════════════════════════════════════════
        // Color by operator state
        let colorByOperator = false;
        let operatorColorMap = {};

        // Generate a distinct color for any operator using hash
        function hashOperatorColor(name) {
            let hash = 0;
            for (let i = 0; i < name.length; i++) {
                hash = name.charCodeAt(i) + ((hash << 5) - hash);
            }
            // Use golden ratio to spread hues evenly
            const hue = ((hash & 0xFFFFFF) * 137.508) % 360;
            return `hsl(${Math.round(hue)}, 70%, 50%)`;
        }

        // Build operator color map from well data
        function buildOperatorColorMap(wells) {
            const counts = {};
            wells.forEach(w => {
                const op = (w.operator || 'Unknown').toUpperCase().trim();
                counts[op] = (counts[op] || 0) + 1;
            });
            // Sort by count descending
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const map = {};
            // Top operators get manually-assigned vibrant colors for best distinction
            const palette = [
                '#1E40AF', '#DC2626', '#059669', '#7C3AED', '#F59E0B',
                '#0891B2', '#EC4899', '#84CC16', '#F97316', '#06B6D4',
                '#8B5CF6', '#10B981', '#EF4444', '#6366F1', '#14B8A6',
                '#F43F5E', '#A855F7', '#22C55E', '#E11D48', '#0EA5E9'
            ];
            sorted.forEach(([op, count], i) => {
                map[op] = i < palette.length ? palette[i] : hashOperatorColor(op);
            });
            return map;
        }

        function toggleColorByOperator() {
            colorByOperator = !colorByOperator;
            const btn = document.getElementById('colorByOperatorBtn');
            if (btn) {
                if (colorByOperator) btn.classList.add('active');
                else btn.classList.remove('active');
            }
            // Re-render with existing data
            if (allNearbyWells && allNearbyWells.length > 0) {
                const filteredWells = filterWellsData(allNearbyWells);
                displayFilteredWells(filteredWells);
            }
        }

        // Toggle nearby wells from D1 database
        function toggleNearbyWells() {
            console.log('toggleNearbyWells called');
            const select = document.getElementById('nearby-wells-select');
            const value = select.value;
            const countDiv = document.getElementById('nearbyWellsCount');
            const separatorDiv = document.getElementById('nearbyWellsSeparator');

            console.log('Nearby wells select value:', value);
            console.log('User properties count:', userProperties.length);

            const opBtn = document.getElementById('colorByOperatorBtn');

            // Update active state based on selection
            if (value !== 'off') {
                select.classList.add('active');
                if (countDiv) countDiv.style.display = 'flex';
                if (separatorDiv) separatorDiv.style.display = 'block';
                if (opBtn) opBtn.style.display = '';
                console.log('Calling loadNearbyWells...');
                loadNearbyWells();
            } else {
                select.classList.remove('active');
                if (nearbyWellsLayer && map.hasLayer(nearbyWellsLayer)) {
                    map.removeLayer(nearbyWellsLayer);
                }
                if (nearbyLateralsLayer && map.hasLayer(nearbyLateralsLayer)) {
                    map.removeLayer(nearbyLateralsLayer);
                }
                if (countDiv) countDiv.style.display = 'none';
                if (separatorDiv) separatorDiv.style.display = 'none';
                if (opBtn) opBtn.style.display = 'none';
                // Remove operator legend
                removeOperatorLegend();
                const filterPanel = document.getElementById('wellsFilterPanel');
                if (filterPanel) filterPanel.style.display = 'none';
                const wellCount = document.getElementById('nearbyWellCount');
                if (wellCount) wellCount.textContent = '0';
                // Remove nearby wells from search index
                updateSearchIndex();
            }
        }


        // Helper function to generate cache key
        function getWellsCacheKey(status) {
            // Include a hash of property IDs to invalidate when properties change
            const propertyIds = userProperties.map(p => p.id).sort().join(',');
            const propertyHash = btoa(propertyIds).substring(0, 8); // Short hash
            // Add version number to invalidate old caches
            const CACHE_VERSION = 'v9'; // Fixed nearby-wells to query one TRS at a time
            return `mw_nearby_wells_${status}_${propertyHash}_${CACHE_VERSION}`;
        }

        // Helper function to clear all nearby wells caches
        function clearNearbyWellsCache() {
            const keys = Object.keys(localStorage).filter(k => k.includes('mw_nearby_wells'));
            keys.forEach(k => localStorage.removeItem(k));
            console.log(`Cleared ${keys.length} nearby wells cache entries`);
        }

        // Make it available globally for debugging
        window.clearNearbyWellsCache = clearNearbyWellsCache;

        // Helper function to show loading overlay on map
        function showMapLoadingOverlay(message = 'Loading...') {
            // Show a lightweight loading indicator for nearby wells select
            const select = document.getElementById('nearby-wells-select');
            if (select) {
                select.classList.add('loading');
                select.classList.add('active'); // Keep orange styling
                // Store original option text and change to Loading...
                const selectedOption = select.options[select.selectedIndex];
                select.setAttribute('data-original-text', selectedOption.text);
                selectedOption.text = 'Loading...';
            }
        }

        function hideMapLoadingOverlay() {
            // Remove loading state from nearby wells select
            const select = document.getElementById('nearby-wells-select');
            if (select) {
                select.classList.remove('loading');
                // Restore original option text
                const originalText = select.getAttribute('data-original-text');
                if (originalText) {
                    select.options[select.selectedIndex].text = originalText;
                    select.removeAttribute('data-original-text');
                }
            }
        }

        // Load wells from D1 database based on user properties (3x3 sections)
        async function loadNearbyWells() {
            console.log('loadNearbyWells started');
            console.log('userProperties:', userProperties);

            // Ensure we have user properties
            if (!userProperties || userProperties.length === 0) {
                console.error('No user properties loaded yet');
                updateStatus('No properties found - please refresh the page');
                return;
            }

            try {
                // Get status filter from the dropdown
                const statusFilter = document.getElementById('nearby-wells-select').value;
                console.log('Status filter value:', statusFilter);
                if (statusFilter === 'off') {
                    console.log('Nearby wells is off, not loading');
                    return;
                }
                // PRODUCING uses AC on the API side, then filters client-side
                const apiStatus = statusFilter === 'PRODUCING' ? 'AC' : statusFilter;
                const statusText = statusFilter === 'AC' ? 'active' : statusFilter === 'PRODUCING' ? 'producing' : 'all';
                const cacheKey = getWellsCacheKey(statusFilter);

                // Check cache first
                const cachedData = localStorage.getItem(cacheKey);
                if (cachedData) {
                    try {
                        const cached = JSON.parse(cachedData);
                        const cacheAge = Date.now() - cached.timestamp;
                        const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

                        // Don't use cache if it's empty or too old
                        if (cacheAge < MAX_CACHE_AGE && cached.wells && cached.wells.length > 0) {
                            console.log(`Using cached ${statusText} wells data (${Math.round(cacheAge / 1000 / 60)} minutes old)`);
                            allNearbyWells = cached.wells;
                            const filteredWells = filterWellsData(cached.wells);
                            displayFilteredWells(filteredWells);
                            updateStatus(`Displayed ${cached.wells.length} ${statusText} wells (from cache)`);
                            return;
                        } else if (cached.wells && cached.wells.length === 0) {
                            console.log('Cache contains 0 wells, invalidating and fetching fresh data');
                            localStorage.removeItem(cacheKey);
                        }
                    } catch (e) {
                        console.error('Failed to parse cached data:', e);
                        localStorage.removeItem(cacheKey);
                    }
                }

                // Show loading overlay
                showMapLoadingOverlay(`Loading ${statusText} wells...`);
                updateStatus('Loading nearby wells...');

                // Get TRS sections for all user properties — 3x3 core + 5x5 extended in one pass
                const propertySections = await getPropertyNearbySections();

                if (propertySections.length === 0) {
                    hideMapLoadingOverlay();
                    updateStatus('No properties found');
                    return;
                }

                // Build combined TRS set: 3x3 core + 5x5 outer ring (for long laterals)
                const coreSections = new Set(propertySections);
                const extendedOnlySections = new Set();

                for (const property of userProperties) {
                    const fields = property.fields || property;
                    const section = parseInt(fields.SEC || fields.Section);
                    let township = (fields.TWN || fields.Township || '').replace(/\s+/g, '').toUpperCase();
                    let range = (fields.RNG || fields.Range || '').replace(/\s+/g, '').toUpperCase();
                    township = township.replace(/^T/, '');
                    range = range.replace(/^R/, '');
                    const meridian = fields.MERIDIAN || 'IM';

                    if (section && township && range) {
                        const extendedNearbySections = get5x5Sections(section, township, range, meridian);
                        extendedNearbySections.forEach(trs => {
                            if (!coreSections.has(trs)) {
                                extendedOnlySections.add(trs);
                            }
                        });
                    }
                }

                // Single API call with all sections (core + extended)
                const allSections = [...propertySections, ...extendedOnlySections];
                console.log(`Loading ${statusText} wells: ${propertySections.length} core + ${extendedOnlySections.size} extended = ${allSections.length} sections`);

                const response = await fetch('/api/nearby-wells', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        trs: allSections,
                        status: apiStatus.toLowerCase(),
                        limit: 25000
                    })
                });

                if (!response.ok) {
                    hideMapLoadingOverlay();
                    console.error('Failed to load wells:', response.status);
                    updateStatus('Failed to load wells');
                    return;
                }

                const result = await response.json();
                const allWells = result.data?.wells || [];
                console.log(`Received ${allWells.length} wells in ${result.data?.query?.executionTime}ms`);

                // Tag wells from extended-only sections as extended laterals
                // (only keep them if they have long laterals > 1 mile with BH coords)
                const filteredAllWells = allWells.filter(well => {
                    const trs = `${well.section}-${well.township}-${well.range}-${well.meridian}`;
                    if (extendedOnlySections.has(trs)) {
                        if (well.lateral_length && well.lateral_length > 5280 &&
                            well.bh_latitude && well.bh_longitude) {
                            well.isExtendedLateral = true;
                            return true;
                        }
                        return false; // Drop non-lateral wells from extended ring
                    }
                    return true; // Keep all core wells
                });

                // Remove duplicates
                let uniqueWells = Array.from(
                    new Map(filteredAllWells.map(w => [w.api_number, w])).values()
                );
                // If "Producing" filter, remove wells without recent production
                if (statusFilter === 'PRODUCING') {
                    // Compute cutoff from data in this batch
                    const prodMonths = uniqueWells.map(w => w.last_prod_month).filter(Boolean).sort();
                    if (prodMonths.length > 0) {
                        let horizon = prodMonths[prodMonths.length - 1];
                        const mc = {};
                        prodMonths.forEach(m => { mc[m] = (mc[m] || 0) + 1; });
                        const sorted = Object.entries(mc).sort((a, b) => b[0].localeCompare(a[0]));
                        for (const [month, count] of sorted) {
                            if (count >= 10) { horizon = month; break; }
                        }
                        let cy = parseInt(horizon.substring(0, 4));
                        let cm = parseInt(horizon.substring(4, 6)) - 3;
                        if (cm <= 0) { cm += 12; cy -= 1; }
                        const cutoff = '' + cy + String(cm).padStart(2, '0');
                        const before = uniqueWells.length;
                        uniqueWells = uniqueWells.filter(w => w.last_prod_month && w.last_prod_month >= cutoff);
                        console.log(`Producing filter: ${before} → ${uniqueWells.length} (cutoff ${cutoff})`);
                    }
                }

                console.log(`${uniqueWells.length} unique wells after filtering`);

                // Cache the results
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        wells: uniqueWells,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    // Clear old cache if storage is full
                    try {
                        Object.keys(localStorage).filter(k => k.startsWith('mw_nearby_wells_')).forEach(k => {
                            localStorage.removeItem(k);
                        });
                    } catch (clearError) { /* ignore */ }
                }

                // Store wells for filtering
                allNearbyWells = uniqueWells;

                // Display wells (respecting any active filters)
                const filteredWells = filterWellsData(uniqueWells);
                console.log(`After filtering: ${filteredWells.length} wells to display`);
                displayFilteredWells(filteredWells);

                // Hide loading indicator after wells are displayed
                hideMapLoadingOverlay();

                // Update status
                if (filteredWells.length < uniqueWells.length) {
                    const filterCount = Object.values(wellsFilterState).filter(v => v).length;
                    updateStatus(`Loaded ${uniqueWells.length} wells, showing ${filteredWells.length} (${filterCount} filters active)`);
                } else {
                    updateStatus(`Loaded ${uniqueWells.length} wells from D1 database`);
                }

                // Clear status after delay
                setTimeout(() => updateStatus('Map ready'), 3000);

            } catch (error) {
                console.error('Error loading nearby wells:', error);
                hideMapLoadingOverlay();
                updateStatus('Failed to load wells');
                setTimeout(() => updateStatus('Map ready'), 3000);
            }
        }

        // Get 3x3 sections around user properties
        async function getPropertyNearbySections() {
            const sectionsSet = new Set();

            // For each property, get its section and 3x3 neighbors
            for (const property of userProperties) {
                const fields = property.fields || property;

                // Get property TRS
                const section = parseInt(fields.SEC || fields.Section);
                let township = (fields.TWN || fields.Township || '').replace(/\s+/g, '').toUpperCase();
                let range = (fields.RNG || fields.Range || '').replace(/\s+/g, '').toUpperCase();

                // Remove S/T/R prefixes if present
                township = township.replace(/^T/, '');
                range = range.replace(/^R/, '');

                // Get meridian - default to IM unless property has CM
                const meridian = fields.MERIDIAN || 'IM';

                // Log raw values for debugging
                console.log(`Property ${property.id}: Raw TWN="${fields.TWN || fields.Township}", RNG="${fields.RNG || fields.Range}", MERIDIAN="${meridian}"`);
                console.log(`Property ${property.id}: Parsed section=${section}, township=${township}, range=${range}, meridian=${meridian}`);

                if (!section || !township || !range) {
                    console.warn(`Property ${property.id} skipped - missing TRS data`);
                    continue;
                }

                // Get 3x3 sections around this property with proper meridian
                const nearbySections = get3x3Sections(section, township, range, meridian);
                nearbySections.forEach(trs => sectionsSet.add(trs));
            }

            return Array.from(sectionsSet);
        }

        // Get 3x3 grid of sections centered on given section
        function get3x3Sections(centerSection, township, range, meridian = 'IM') {
            const sections = [];

            // Standard 6x6 section layout
            const sectionGrid = [
                [6,  5,  4,  3,  2,  1],
                [7,  8,  9,  10, 11, 12],
                [18, 17, 16, 15, 14, 13],
                [19, 20, 21, 22, 23, 24],
                [30, 29, 28, 27, 26, 25],
                [31, 32, 33, 34, 35, 36]
            ];

            // Find center section position
            let centerRow = -1, centerCol = -1;
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    if (sectionGrid[row][col] === centerSection) {
                        centerRow = row;
                        centerCol = col;
                        break;
                    }
                }
            }

            if (centerRow === -1) return [`${centerSection}-${township}-${range}-${meridian}`];

            // Get 3x3 grid (1 section in each direction)
            for (let row = Math.max(0, centerRow - 1); row <= Math.min(5, centerRow + 1); row++) {
                for (let col = Math.max(0, centerCol - 1); col <= Math.min(5, centerCol + 1); col++) {
                    const section = sectionGrid[row][col];
                    sections.push(`${section}-${township}-${range}-${meridian}`);
                }
            }

            return sections;
        }

        // Get 5x5 grid of sections centered on given section (for extended lateral search)
        function get5x5Sections(centerSection, township, range, meridian = 'IM') {
            const sections = [];

            // Standard 6x6 section layout
            const sectionGrid = [
                [6,  5,  4,  3,  2,  1],
                [7,  8,  9,  10, 11, 12],
                [18, 17, 16, 15, 14, 13],
                [19, 20, 21, 22, 23, 24],
                [30, 29, 28, 27, 26, 25],
                [31, 32, 33, 34, 35, 36]
            ];

            // Find center section position
            let centerRow = -1, centerCol = -1;
            for (let row = 0; row < 6; row++) {
                for (let col = 0; col < 6; col++) {
                    if (sectionGrid[row][col] === centerSection) {
                        centerRow = row;
                        centerCol = col;
                        break;
                    }
                }
            }

            if (centerRow === -1) return [`${centerSection}-${township}-${range}-${meridian}`];

            // Get 5x5 grid (2 sections in each direction)
            for (let row = Math.max(0, centerRow - 2); row <= Math.min(5, centerRow + 2); row++) {
                for (let col = Math.max(0, centerCol - 2); col <= Math.min(5, centerCol + 2); col++) {
                    const section = sectionGrid[row][col];
                    sections.push(`${section}-${township}-${range}-${meridian}`);
                }
            }

            return sections;
        }

        // Parse PLSS ID to extract township/range
        function parsePlssId(plssId) {
            if (!plssId) return null;

            // Format: "OK170230N0080W0"
            const match = plssId.match(/OK\d{2}(\d{3})([NS])(\d{3})([EW])/);
            if (match) {
                const twpNum = parseInt(match[1], 10);
                const twpDir = match[2];
                const rngNum = parseInt(match[3], 10);
                const rngDir = match[4];

                return {
                    township: `${twpNum}${twpDir}`,
                    range: `${rngNum}${rngDir}`
                };
            }

            return null;
        }

        // No automatic refresh on map move - wells are loaded based on properties only

        // Wells filter state
        let wellsFilterState = {
            status: '',
            type: '',
            operator: '',
            county: ''
        };

        // All wells data (before filtering)
        let allNearbyWells = [];

        // Filter wells data based on current filter state
        function filterWellsData(wells) {
            return wells.filter(well => {
                // Status filter
                if (wellsFilterState.status && well.well_status !== wellsFilterState.status) {
                    return false;
                }

                // Type filter
                if (wellsFilterState.type && well.well_type !== wellsFilterState.type) {
                    return false;
                }

                // Operator filter (partial match)
                if (wellsFilterState.operator && !well.operator?.toLowerCase().includes(wellsFilterState.operator)) {
                    return false;
                }

                // County filter (partial match)
                if (wellsFilterState.county && !well.county?.toLowerCase().includes(wellsFilterState.county)) {
                    return false;
                }

                return true;
            });
        }

        // Toggle wells filter panel
        function toggleWellsFilter() {
            const panel = document.getElementById('wellsFilterPanel');
            const button = document.getElementById('filterToggleBtn');

            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                button.classList.add('active');
            } else {
                panel.style.display = 'none';
                button.classList.remove('active');
            }
        }

        // Apply wells filter
        function applyWellsFilter() {
            // Get filter values
            wellsFilterState.status = document.getElementById('filterWellStatus').value;
            wellsFilterState.type = document.getElementById('filterWellType').value;
            wellsFilterState.operator = document.getElementById('filterOperator').value.toLowerCase();
            wellsFilterState.county = document.getElementById('filterCounty').value.toLowerCase();

            // Filter wells
            const filteredWells = allNearbyWells.filter(well => {
                // Status filter
                if (wellsFilterState.status && well.well_status !== wellsFilterState.status) {
                    return false;
                }

                // Type filter
                if (wellsFilterState.type && well.well_type !== wellsFilterState.type) {
                    return false;
                }

                // Operator filter (partial match)
                if (wellsFilterState.operator && !well.operator?.toLowerCase().includes(wellsFilterState.operator)) {
                    return false;
                }

                // County filter (partial match)
                if (wellsFilterState.county && !well.county?.toLowerCase().includes(wellsFilterState.county)) {
                    return false;
                }

                return true;
            });

            // Update map
            displayFilteredWells(filteredWells);

            // Update status
            const filterCount = Object.values(wellsFilterState).filter(v => v).length;
            if (filterCount > 0) {
                updateStatus(`Showing ${filteredWells.length} of ${allNearbyWells.length} wells (${filterCount} filters active)`);
                document.getElementById('filterToggleBtn').innerHTML = '<span>🔍 Filter Wells (' + filterCount + ')</span>';
            } else {
                updateStatus(`Showing all ${allNearbyWells.length} wells`);
                document.getElementById('filterToggleBtn').innerHTML = '<span>🔍 Filter Wells</span>';
            }

            // Close panel
            toggleWellsFilter();
        }

        // Clear wells filter
        function clearWellsFilter() {
            // Reset form
            document.getElementById('filterWellStatus').value = '';
            document.getElementById('filterWellType').value = '';
            document.getElementById('filterOperator').value = '';
            document.getElementById('filterCounty').value = '';

            // Reset state
            wellsFilterState = {
                status: '',
                type: '',
                operator: '',
                county: ''
            };

            // Show all wells
            displayFilteredWells(allNearbyWells);
            updateStatus(`Showing all ${allNearbyWells.length} wells`);
            document.getElementById('filterToggleBtn').innerHTML = '<span>🔍 Filter Wells</span>';

            // Close panel
            toggleWellsFilter();
        }

        // Display filtered wells on map
        function displayFilteredWells(wells) {
            // Initialize cluster group if not already done
            if (!nearbyWellsLayer) {
                nearbyWellsLayer = L.markerClusterGroup({
                    disableClusteringAtZoom: 13,  // Keep clustering until township-level zoom
                    maxClusterRadius: 80,
                    spiderfyOnMaxZoom: true,
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: true,
                    chunkedLoading: true,          // Non-blocking — prevents UI freeze with thousands of markers
                    chunkInterval: 100,
                    chunkDelay: 10,
                    iconCreateFunction: function(cluster) {
                        const count = cluster.getChildCount();
                        let className = 'marker-cluster-small';

                        if (count > 100) {
                            className = 'marker-cluster-large';
                        } else if (count > 25) {
                            className = 'marker-cluster-medium';
                        }

                        return new L.DivIcon({
                            html: '<div><span>' + count + '</span></div>',
                            className: 'marker-cluster ' + className,
                            iconSize: new L.Point(40, 40)
                        });
                    }
                });
            }

            // Clear existing wells
            nearbyWellsLayer.clearLayers();

            // Build set of tracked well API numbers for fast lookup
            const trackedAPIs = new Set();
            if (trackedWells && trackedWells.length > 0) {
                trackedWells.forEach(well => {
                    if (well.apiNumber) {
                        trackedAPIs.add(well.apiNumber);
                    }
                });
                console.log(`Filtering out ${trackedAPIs.size} tracked wells from nearby wells display`);
            }

            // Filter out tracked wells
            const untracked = wells.filter(well => {
                return !trackedAPIs.has(well.api_number);
            });

            console.log(`Displaying ${untracked.length} untracked wells (filtered ${wells.length - untracked.length} tracked wells)`);
            wells = untracked;

            // Update nearby wells count
            document.getElementById('nearbyWellCount').textContent = wells.length;

            // Build operator color map if in operator mode
            if (colorByOperator) {
                operatorColorMap = buildOperatorColorMap(wells);
                renderOperatorLegend();
                // Attach viewport handler so legend updates on pan/zoom
                if (!window._operatorLegendHandler) {
                    window._operatorLegendHandler = function() {
                        cachedFilingCounts = null; // Invalidate on viewport change
                        renderOperatorLegend();
                        if (legendMode === 'filings') fetchAreaFilings();
                    };
                    map.on('moveend zoomend', window._operatorLegendHandler);
                }
            } else {
                removeOperatorLegend();
            }

            // Store wells data globally for popup access
            window.nearbyWellsData = {};

            // Collect lateral data separately — drawn only when zoomed in
            const lateralData = [];

            // Compute production data horizon from nearby wells (same logic as dashboard)
            let nearbyProdHorizon = null;
            const allProdMonths = wells.map(w => w.last_prod_month).filter(Boolean).sort();
            if (allProdMonths.length > 0) {
                // Use the most recent month with substantial data
                const monthCounts = {};
                allProdMonths.forEach(m => { monthCounts[m] = (monthCounts[m] || 0) + 1; });
                const sorted = Object.entries(monthCounts).sort((a, b) => b[0].localeCompare(a[0]));
                // Pick the first month with at least 10 wells (or just the latest)
                nearbyProdHorizon = sorted[0][0];
                for (const [month, count] of sorted) {
                    if (count >= 10) { nearbyProdHorizon = month; break; }
                }
            }
            // 3 months before horizon
            let nearbyProdCutoff = null;
            if (nearbyProdHorizon) {
                let y = parseInt(nearbyProdHorizon.substring(0, 4));
                let m = parseInt(nearbyProdHorizon.substring(4, 6)) - 3;
                if (m <= 0) { m += 12; y -= 1; }
                nearbyProdCutoff = '' + y + String(m).padStart(2, '0');
            }

            // Check if a well is actively producing
            function isProducing(well) {
                if (!well.last_prod_month || !nearbyProdCutoff) return false;
                return well.last_prod_month >= nearbyProdCutoff;
            }

            // Determine marker color + glow based on well type, status, and production
            function nearbyMarkerStyle(well) {
                const isPlugged = well.well_status === 'PA';
                const producing = !isPlugged && isProducing(well);

                // Color by operator mode
                if (colorByOperator) {
                    const op = (well.operator || 'Unknown').toUpperCase().trim();
                    const color = operatorColorMap[op] || '#6B7280';
                    const glow = isPlugged ? 'none' : `0 0 6px 2px ${color}66`;
                    return { color, glow, opacity: isPlugged ? 0.4 : 1, producing };
                }

                const wt = (well.well_type || '').toLowerCase();
                let color, glow;
                if (wt.includes('gas')) {
                    color = isPlugged ? '#F87171' : '#EF4444';
                    glow = isPlugged ? 'none' : '0 0 6px 2px rgba(239,68,68,0.5)';
                } else if (wt.includes('injection') || wt.includes('swd')) {
                    color = isPlugged ? '#93C5FD' : '#3B82F6';
                    glow = isPlugged ? 'none' : '0 0 6px 2px rgba(59,130,246,0.45)';
                } else {
                    // Oil + default = green
                    color = isPlugged ? '#6EE7B7' : '#22C55E';
                    glow = isPlugged ? 'none' : '0 0 6px 2px rgba(34,197,94,0.5)';
                }
                // Non-producing active wells: dimmer, no glow
                if (!isPlugged && !producing && well.well_status === 'AC') {
                    glow = 'none';
                    return { color, glow, opacity: 0.55, producing: false };
                }
                return { color, glow, opacity: isPlugged ? 0.45 : 1, producing };
            }

            // Add filtered wells to map — glowing circle dots
            wells.forEach(well => {
                if (well.api_number) {
                    window.nearbyWellsData[well.api_number] = well;
                }
                if (!well.latitude || !well.longitude) return;

                const isExtendedLateral = well.isExtendedLateral;
                const style = isExtendedLateral
                    ? { color: '#F59E0B', glow: '0 0 6px 2px rgba(245,158,11,0.5)', opacity: 1 }
                    : nearbyMarkerStyle(well);
                const dotSize = 12;

                const marker = L.marker([well.latitude, well.longitude], {
                    icon: L.divIcon({
                        className: 'nw-dot',
                        html: `<div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${style.color};border:1px solid rgba(0,0,0,0.15);box-shadow:${style.glow};opacity:${style.opacity};"></div>`,
                        iconSize: [dotSize, dotSize],
                        iconAnchor: [dotSize / 2, dotSize / 2],
                        popupAnchor: [0, -dotSize / 2]
                    })
                });

                const wellBaseName = well.well_name || 'Unnamed Well';
                const wellNumber = well.well_number || '';
                const wellName = toTitleCase(wellNumber ? `${wellBaseName} ${wellNumber}` : wellBaseName);
                const operator = toTitleCase(well.operator || 'Unknown');
                const wellStatus = getStatusLabel(well.well_status);
                const formation = well.formation_name ? toTitleCase(well.formation_name) : '';
                const producing = style.producing;

                marker.wellData = well;

                const prodBadge = (well.well_status === 'AC' && !isExtendedLateral)
                    ? (producing
                        ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#DCFCE7;color:#166534;">Producing</span>'
                        : '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#FEF3C7;color:#92400E;">No Recent Prod</span>')
                    : '';

                const popupContent = `
                    <div class="popup-header">
                        <span class="popup-tag" style="background: ${isExtendedLateral ? '#FEF3C7' : '#E5E7EB'}; color: ${isExtendedLateral ? '#92400E' : '#374151'};">
                            ${isExtendedLateral ? 'Extended Lateral' : 'Nearby Well'}
                        </span>${prodBadge}
                    </div>
                    <div class="popup-well-name">${wellName}</div>
                    <div class="popup-details">
                        ${operator}<br>
                        ${formatTRS(well.township, well.range, well.section)} • ${toTitleCase(well.county || 'Unknown')}<br>
                        Status: ${wellStatus}${formation ? ' \u2022 ' + formation : ''}
                        ${isExtendedLateral && well.lateral_length ? '<br>Lateral: ' + (well.lateral_length / 5280).toFixed(1) + ' miles' : ''}
                    </div>
                    <div class="popup-actions">
                        <button class="popup-btn popup-btn-secondary" data-api="${well.api_number}" onclick="expandNearbyWellCard(nearbyWellsData['${well.api_number}']); return false;">More \u2192</button>
                    </div>
                `;

                marker.bindPopup(popupContent, { maxWidth: 350, className: 'high-z-popup' });
                nearbyWellsLayer.addLayer(marker);

                // Collect lateral data (don't draw yet — zoom-gated)
                if (well.bh_latitude && well.bh_longitude &&
                    (well.bh_latitude !== well.latitude || well.bh_longitude !== well.longitude)) {
                    const latDiff = Math.abs(well.bh_latitude - well.latitude);
                    const lngDiff = Math.abs(well.bh_longitude - well.longitude);
                    if ((latDiff + lngDiff) * 69 < 3) {
                        lateralData.push(well);
                    }
                }
            });

            // Ensure marker layer is on map
            if (!map.hasLayer(nearbyWellsLayer) && nearbyWellsLayer.getLayers().length > 0) {
                map.addLayer(nearbyWellsLayer);
            }

            // Build lateral lines in a separate layer (shown only at zoom >= 12)
            nearbyLateralsLayer.clearLayers();
            function buildNearbyLaterals() {
                nearbyLateralsLayer.clearLayers();
                lateralData.forEach(well => {
                    const wt = (well.well_type || '').toLowerCase();
                    const pathColor = wt.includes('gas') ? '#EF4444' : '#22C55E';
                    const line = L.polyline(
                        [[well.latitude, well.longitude], [well.bh_latitude, well.bh_longitude]],
                        { color: pathColor, weight: 3, opacity: 0.7 }
                    );
                    const lateralLength = well.lateral_length
                        ? Number(well.lateral_length).toLocaleString() + ' ft'
                        : '~' + Math.round(map.distance([well.latitude, well.longitude], [well.bh_latitude, well.bh_longitude]) * 3.28084).toLocaleString() + ' ft';
                    line.bindPopup(`
                        <div style="font-weight:600;margin-bottom:4px;">${toTitleCase(well.well_name || 'Unknown')}</div>
                        <div style="font-size:12px;color:#64748B;">${toTitleCase(well.operator || 'Unknown')}<br>Lateral: ${lateralLength}</div>
                    `, { maxWidth: 250, className: 'high-z-popup' });
                    nearbyLateralsLayer.addLayer(line);
                });
            }

            // Show laterals only when zoomed in enough to see them
            const LATERAL_MIN_ZOOM = 12;
            function updateLateralVisibility() {
                const zoom = map.getZoom();
                if (zoom >= LATERAL_MIN_ZOOM && lateralData.length > 0) {
                    if (nearbyLateralsLayer.getLayers().length === 0) {
                        buildNearbyLaterals();
                    }
                    if (!map.hasLayer(nearbyLateralsLayer)) {
                        map.addLayer(nearbyLateralsLayer);
                    }
                } else {
                    if (map.hasLayer(nearbyLateralsLayer)) {
                        map.removeLayer(nearbyLateralsLayer);
                    }
                }
            }

            // Remove previous zoom handler if any, then add new one
            if (window._nearbyZoomHandler) {
                map.off('zoomend', window._nearbyZoomHandler);
            }
            window._nearbyZoomHandler = updateLateralVisibility;
            map.on('zoomend', updateLateralVisibility);
            updateLateralVisibility(); // Apply immediately

            console.log(`${wells.length} nearby wells rendered, ${lateralData.length} laterals (zoom >= ${LATERAL_MIN_ZOOM})`);

            ensureLayerOrder();
            updateSearchIndex();
        }

        // Legend mode: 'wells' or 'filings'
        let legendMode = 'wells';
        let cachedFilingCounts = null;

        // Render operator legend inside map container (viewport-aware)
        function renderOperatorLegend() {
            if (!colorByOperator || !allNearbyWells || !allNearbyWells.length) {
                removeOperatorLegend();
                return;
            }

            // Filter to wells visible in current viewport
            const bounds = map.getBounds();
            const visibleWells = allNearbyWells.filter(w =>
                w.latitude && w.longitude && bounds.contains([w.latitude, w.longitude])
            );

            // Count wells per operator in viewport
            const wellCounts = {};
            visibleWells.forEach(w => {
                const op = (w.operator || 'Unknown').toUpperCase().trim();
                wellCounts[op] = (wellCounts[op] || 0) + 1;
            });

            // Reuse existing element or create new one
            let el = document.getElementById('operatorLegendPanel');
            if (!el) {
                el = document.createElement('div');
                el.className = 'operator-legend';
                el.id = 'operatorLegendPanel';
                document.querySelector('.map-container').appendChild(el);
                L.DomEvent.disableClickPropagation(el);
                L.DomEvent.disableScrollPropagation(el);
                el.addEventListener('click', function(e) {
                    const item = e.target.closest('.operator-legend-item[data-operator]');
                    if (item) {
                        e.stopPropagation();
                        openOperatorModal(item.getAttribute('data-operator'));
                    }
                    const toggle = e.target.closest('.legend-mode-toggle');
                    if (toggle) {
                        e.stopPropagation();
                        const newMode = toggle.getAttribute('data-mode');
                        if (newMode && newMode !== legendMode) {
                            toggleLegendMode();
                        }
                    }
                });
            }

            // Zoom gate: filings toggle only at zoom >= 10
            const FILINGS_MIN_ZOOM = 10;
            const zoomedEnough = map.getZoom() >= FILINGS_MIN_ZOOM;

            // Auto-switch back to wells if zoomed out
            if (!zoomedEnough && legendMode === 'filings') {
                legendMode = 'wells';
                cachedFilingCounts = null;
            }

            // Use filing counts if in filings mode and cached
            const useCounts = legendMode === 'filings' && cachedFilingCounts ? cachedFilingCounts : wellCounts;
            const sorted = Object.entries(useCounts).sort((a, b) => b[1] - a[1]);
            const topN = sorted.slice(0, 15);
            const otherCount = sorted.slice(15).reduce((sum, e) => sum + e[1], 0);
            const totalCount = legendMode === 'filings' && cachedFilingCounts
                ? Object.values(cachedFilingCounts).reduce((a, b) => a + b, 0)
                : visibleWells.length;

            const wellsActive = legendMode === 'wells' ? 'font-weight:700;color:#E2E8F0;' : 'font-weight:400;color:#64748B;cursor:pointer;';
            const filingsActive = legendMode === 'filings' ? 'font-weight:700;color:#E2E8F0;' : 'font-weight:400;color:#64748B;cursor:pointer;';

            const filingsToggle = zoomedEnough
                ? `<span style="margin-left:auto;font-size:10px;">
                    <span class="legend-mode-toggle" data-mode="wells" style="${wellsActive}">Wells</span>
                    <span style="color:#475569;"> | </span>
                    <span class="legend-mode-toggle" data-mode="filings" style="${filingsActive}">Filings</span>
                </span>`
                : '';

            let html = `<div class="operator-legend-title" style="display:flex;align-items:center;gap:6px;">
                <span>Operators</span>
                <span style="font-weight:400;color:#94A3B8;">(${totalCount})</span>
                ${filingsToggle}
            </div>`;

            if (legendMode === 'filings' && !cachedFilingCounts) {
                html += '<div style="color:#94A3B8;font-size:12px;padding:8px 0;">Loading filings...</div>';
            } else {
                topN.forEach(([op, count]) => {
                    const color = operatorColorMap[op] || '#6B7280';
                    const display = toTitleCase(op);
                    html += `<div class="operator-legend-item" data-operator="${op.replace(/"/g, '&quot;')}">
                        <div class="operator-legend-dot" style="background:${color};"></div>
                        <div class="operator-legend-name">${display}</div>
                        <div class="operator-legend-count">${count}</div>
                    </div>`;
                });
                if (otherCount > 0) {
                    html += `<div class="operator-legend-item" style="cursor:default;">
                        <div class="operator-legend-dot" style="background:#6B7280;"></div>
                        <div class="operator-legend-name" style="color:#94A3B8;">Others</div>
                        <div class="operator-legend-count">${otherCount}</div>
                    </div>`;
                }
            }
            el.innerHTML = html;
        }

        function toggleLegendMode() {
            legendMode = legendMode === 'wells' ? 'filings' : 'wells';
            if (legendMode === 'filings') {
                cachedFilingCounts = null; // Invalidate on toggle
                renderOperatorLegend(); // Show loading state
                fetchAreaFilings();
            } else {
                renderOperatorLegend();
            }
        }

        async function fetchAreaFilings() {
            try {
                const bounds = map.getBounds();
                const resp = await fetch(`/api/map/area-filings?south=${bounds.getSouth()}&north=${bounds.getNorth()}&west=${bounds.getWest()}&east=${bounds.getEast()}`, {
                    credentials: 'include'
                });
                if (!resp.ok) throw new Error('Failed');
                const data = await resp.json();
                cachedFilingCounts = data.filings || {};
                renderOperatorLegend();
            } catch (err) {
                console.error('Failed to fetch area filings:', err);
                cachedFilingCounts = {};
                renderOperatorLegend();
            }
        }

        function removeOperatorLegend() {
            const el = document.getElementById('operatorLegendPanel');
            if (el) el.remove();
            legendMode = 'wells';
            cachedFilingCounts = null;
            // Remove map move handler
            if (window._operatorLegendHandler) {
                map.off('moveend zoomend', window._operatorLegendHandler);
                window._operatorLegendHandler = null;
            }
        }

        // Operator detail modal (scoped to visible wells when in operator color mode)
        function openOperatorModal(operatorName) {
            const overlay = document.getElementById('operatorModal');
            if (!overlay) return;

            const opKey = operatorName.toUpperCase().trim();
            let wells;
            let subtitle;
            if (colorByOperator) {
                // Scope to current viewport
                const bounds = map.getBounds();
                wells = (allNearbyWells || []).filter(w =>
                    (w.operator || 'Unknown').toUpperCase().trim() === opKey &&
                    w.latitude && w.longitude && bounds.contains([w.latitude, w.longitude])
                );
                subtitle = wells.length + ' wells in view';
            } else {
                wells = (allNearbyWells || []).filter(w =>
                    (w.operator || 'Unknown').toUpperCase().trim() === opKey
                );
                subtitle = wells.length + ' wells nearby';
            }

            const display = toTitleCase(operatorName);
            document.getElementById('operatorModalTitle').textContent = display;
            document.getElementById('operatorModalSubtitle').textContent = subtitle;

            // Contact info (from operators table via nearby-wells join)
            const sampleWell = wells.find(w => w.phone || w.contact_name) || {};
            const phone = sampleWell.phone || '';
            const contactName = sampleWell.contact_name ? toTitleCase(sampleWell.contact_name) : '';

            // Stats
            const producing = wells.filter(w => w.well_status === 'AC' && w.last_prod_month).length;
            const active = wells.filter(w => w.well_status === 'AC').length;
            const plugged = wells.filter(w => w.well_status === 'PA').length;
            const horizontal = wells.filter(w => w.bh_latitude && w.bh_longitude &&
                (Math.abs(w.bh_latitude - w.latitude) + Math.abs(w.bh_longitude - w.longitude)) * 69 > 0.3).length;

            // Formation breakdown
            const formCounts = {};
            wells.forEach(w => {
                const f = w.formation_name ? toTitleCase(w.formation_name) : 'Unknown';
                formCounts[f] = (formCounts[f] || 0) + 1;
            });
            const topFormations = Object.entries(formCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

            // County breakdown
            const countyCounts = {};
            wells.forEach(w => {
                const c = w.county ? toTitleCase(w.county) : 'Unknown';
                countyCounts[c] = (countyCounts[c] || 0) + 1;
            });
            const topCounties = Object.entries(countyCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

            let body = '';

            // Contact info
            if (phone || contactName) {
                body += `<div class="op-section" style="margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;">
                        <div style="font-size:18px;">&#128222;</div>
                        <div style="flex:1;">
                            ${contactName ? `<div style="font-weight:600;color:#1E293B;font-size:14px;">${contactName}</div>` : ''}
                            ${phone ? `<a href="tel:${phone.replace(/\\D/g, '')}" style="color:#1E40AF;font-size:13px;text-decoration:none;">${phone}</a>` : ''}
                        </div>
                    </div>
                </div>`;
            }

            body += `<div class="op-stats">
                <div class="op-stat"><div class="op-stat-value">${active}</div><div class="op-stat-label">Active</div></div>
                <div class="op-stat"><div class="op-stat-value">${producing}</div><div class="op-stat-label">Producing</div></div>
                <div class="op-stat"><div class="op-stat-value">${plugged}</div><div class="op-stat-label">Plugged</div></div>
                <div class="op-stat"><div class="op-stat-value">${horizontal}</div><div class="op-stat-label">Horizontal</div></div>
            </div>`;

            // Formations section
            if (topFormations.length > 0) {
                body += `<div class="op-section"><div class="op-section-title">Formations</div><div style="display:flex;gap:6px;flex-wrap:wrap;">`;
                topFormations.forEach(([f, c]) => {
                    body += `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:#EFF6FF;color:#1E40AF;border:1px solid #BFDBFE;">${f} <span style="font-weight:600;">${c}</span></span>`;
                });
                body += `</div></div>`;
            }

            // Counties section
            if (topCounties.length > 0) {
                body += `<div class="op-section"><div class="op-section-title">Counties</div><div style="display:flex;gap:6px;flex-wrap:wrap;">`;
                topCounties.forEach(([c, count]) => {
                    body += `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;background:#F1F5F9;color:#334155;border:1px solid #CBD5E1;">${c} <span style="font-weight:600;">${count}</span></span>`;
                });
                body += `</div></div>`;
            }

            // Wells table (collapsible, starts closed)
            const sortedWells = [...wells].sort((a, b) => {
                if (a.well_status === 'AC' && b.well_status !== 'AC') return -1;
                if (a.well_status !== 'AC' && b.well_status === 'AC') return 1;
                return (a.well_name || '').localeCompare(b.well_name || '');
            });
            const showWells = sortedWells.slice(0, 50);

            body += `<div class="occ-filings-section" style="margin-top:16px;">
                <div class="occ-filings-header" onclick="toggleOpSection('opWells')">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span id="opWellsArrow" style="transition:transform 0.2s;">&#9654;</span>
                        <span style="font-weight:500;">Wells</span>
                        <span style="background:#e5e7eb;padding:2px 8px;border-radius:12px;font-size:12px;">${wells.length}</span>
                    </div>
                </div>
                <div id="opWellsContent" style="display:none;padding:0 16px 16px;">
                    <table class="op-wells-table">
                        <thead><tr><th>Well Name</th><th>Status</th><th>Formation</th><th>TRS</th></tr></thead>
                        <tbody>`;
            showWells.forEach(w => {
                const name = toTitleCase(w.well_name || 'Unknown');
                const num = w.well_number || '';
                const fullName = num ? `${name} ${num}` : name;
                const status = getStatusLabel(w.well_status);
                const formation = w.formation_name ? toTitleCase(w.formation_name) : '';
                const trs = formatTRS(w.township, w.range, w.section);
                body += `<tr>
                    <td class="clickable" onclick="if(nearbyWellsData['${w.api_number}']){expandNearbyWellCard(nearbyWellsData['${w.api_number}']);}">${fullName}</td>
                    <td>${status}</td>
                    <td>${formation}</td>
                    <td style="white-space:nowrap;">${trs}</td>
                </tr>`;
            });
            body += `</tbody></table>`;
            if (wells.length > 50) {
                body += `<div style="text-align:center;font-size:12px;color:#94A3B8;margin-top:6px;">Showing top 50 of ${wells.length}</div>`;
            }
            body += `</div></div>`;

            // OCC Activity section (collapsible, starts closed, loaded async)
            body += `<div class="occ-filings-section" style="margin-top:16px;">
                <div class="occ-filings-header" onclick="toggleOpSection('opActivity')">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span id="opActivityArrow" style="transition:transform 0.2s;">&#9654;</span>
                        <span style="font-weight:500;">OCC Activity</span>
                        <span id="opActivityCount" style="background:#e5e7eb;padding:2px 8px;border-radius:12px;font-size:12px;">...</span>
                    </div>
                </div>
                <div id="opActivityContent" style="display:none;padding:0 16px 16px;color:#94A3B8;font-size:13px;">Loading filings...</div>
            </div>`;

            document.getElementById('operatorModalBody').innerHTML = body;

            // Fetch OCC activity async
            loadOperatorActivity(operatorName);
            overlay.classList.add('active');
        }

        function closeOperatorModal() {
            const overlay = document.getElementById('operatorModal');
            if (overlay) overlay.classList.remove('active');
        }

        function toggleOpSection(id) {
            const content = document.getElementById(id + 'Content');
            const arrow = document.getElementById(id + 'Arrow');
            if (!content) return;
            if (content.style.display === 'none') {
                content.style.display = 'block';
                if (arrow) arrow.style.transform = 'rotate(90deg)';
            } else {
                content.style.display = 'none';
                if (arrow) arrow.style.transform = '';
            }
        }

        // Relief type display labels
        const RELIEF_LABELS = {
            'POOLING': 'Pooling',
            'INCREASED_DENSITY': 'Increased Density',
            'SPACING': 'Spacing',
            'HORIZONTAL_WELL': 'Horizontal Well',
            'LOCATION_EXCEPTION': 'Location Exception',
            'OPERATOR_CHANGE': 'Operator Change',
            'WELL_TRANSFER': 'Well Transfer',
            'ORDER_MODIFICATION': 'Order Modification',
            'MULTI_UNIT_HORIZONTAL': 'Multi-Unit Horizontal',
            'VACUUM': 'Vacuum',
            'OTHER': 'Other'
        };

        const RELIEF_COLORS = {
            'POOLING': '#F59E0B',
            'INCREASED_DENSITY': '#8B5CF6',
            'SPACING': '#3B82F6',
            'HORIZONTAL_WELL': '#22C55E',
            'LOCATION_EXCEPTION': '#EC4899',
            'OPERATOR_CHANGE': '#6B7280',
            'WELL_TRANSFER': '#6B7280',
            'ORDER_MODIFICATION': '#6B7280'
        };

        async function loadOperatorActivity(operatorName) {
            const el = document.getElementById('opActivityContent');
            if (!el) return;

            try {
                const bounds = map.getBounds();
                const boundsParams = `&south=${bounds.getSouth()}&north=${bounds.getNorth()}&west=${bounds.getWest()}&east=${bounds.getEast()}`;
                const resp = await fetch(`/api/map/operator-activity?operator=${encodeURIComponent(operatorName)}${boundsParams}`, {
                    credentials: 'include'
                });
                if (!resp.ok) {
                    const errBody = await resp.text();
                    console.error('Operator activity API error:', resp.status, errBody);
                    throw new Error('Failed to load');
                }
                const data = await resp.json();

                // Update count badge
                const totalActivity = data.totalFilings + data.poolingCount;
                const countBadge = document.getElementById('opActivityCount');
                if (countBadge) countBadge.textContent = totalActivity;

                if (totalActivity === 0) {
                    el.innerHTML = '<div style="color:#94A3B8;font-style:italic;">No OCC filings found in this area</div>';
                    return;
                }

                let html = '';

                // Type summary tags
                if (data.typeSummary && data.typeSummary.length > 0) {
                    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
                    data.typeSummary.forEach(t => {
                        const label = RELIEF_LABELS[t.type] || t.type;
                        const color = RELIEF_COLORS[t.type] || '#6B7280';
                        html += `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:12px;background:${color}18;color:${color};border:1px solid ${color}40;font-weight:500;">
                            ${label} <span style="font-weight:700;">${t.count}</span>
                        </span>`;
                    });
                    html += '</div>';
                }

                // Recent filings table
                if (data.recentFilings && data.recentFilings.length > 0) {
                    html += `<table class="op-wells-table" style="margin-top:4px;">
                        <thead><tr><th>Type</th><th>Case</th><th>Location</th><th>Date</th><th>Status</th></tr></thead>
                        <tbody>`;
                    data.recentFilings.forEach(f => {
                        const label = RELIEF_LABELS[f.reliefType] || f.reliefType;
                        const color = RELIEF_COLORS[f.reliefType] || '#6B7280';
                        const trs = f.township && f.range && f.section
                            ? formatTRS(f.township, f.range, f.section)
                            : '';
                        const date = f.docketDate || f.hearingDate || '';
                        const shortDate = date ? date.substring(0, 10) : '';
                        const statusColor = f.status === 'SCHEDULED' ? '#F59E0B' : f.status === 'HEARD' ? '#22C55E' : '#94A3B8';
                        html += `<tr>
                            <td><span style="color:${color};font-weight:500;">${label}</span></td>
                            <td style="font-size:12px;">${f.caseNumber || ''}</td>
                            <td style="white-space:nowrap;">${trs}</td>
                            <td style="white-space:nowrap;font-size:12px;">${shortDate}</td>
                            <td><span style="color:${statusColor};font-size:12px;">${f.status || ''}</span></td>
                        </tr>`;
                    });
                    html += '</tbody></table>';
                    if (data.totalFilings > 20) {
                        html += `<div style="text-align:center;font-size:12px;color:#94A3B8;margin-top:6px;">Showing 20 of ${data.totalFilings} filings</div>`;
                    }
                }

                // Pooling orders summary
                if (data.poolingOrders && data.poolingOrders.length > 0) {
                    html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #E5E7EB;">
                        <div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:8px;">Pooling Orders (${data.poolingCount})</div>
                        <table class="op-wells-table">
                            <thead><tr><th>Well Name</th><th>Location</th><th>Date</th><th>Max Bonus</th></tr></thead>
                            <tbody>`;
                    data.poolingOrders.slice(0, 15).forEach(po => {
                        const trs = po.township && po.range && po.section
                            ? formatTRS(po.township, po.range, po.section)
                            : '';
                        const bonus = po.maxBonus ? `$${Math.round(po.maxBonus).toLocaleString()}` : '';
                        html += `<tr>
                            <td>${po.wellName ? toTitleCase(po.wellName) : po.caseNumber || ''}</td>
                            <td style="white-space:nowrap;">${trs}</td>
                            <td style="white-space:nowrap;font-size:12px;">${po.orderDate || ''}</td>
                            <td style="color:#059669;font-weight:600;">${bonus}</td>
                        </tr>`;
                    });
                    html += '</tbody></table></div>';
                }

                el.innerHTML = html;

            } catch (err) {
                console.error('Failed to load operator activity:', err);
                const errBadge = document.getElementById('opActivityCount');
                if (errBadge) errBadge.textContent = '—';
                el.innerHTML = '<div style="color:#94A3B8;font-style:italic;">Could not load OCC activity</div>';
            }
        }



// ═══════════════════════════════════════════════
// Module: map-init.txt
// ═══════════════════════════════════════════════
        // Event listeners
        document.getElementById('toggle-land-grid').addEventListener('change', toggleLandGrid);
        document.getElementById('toggle-county-labels').addEventListener('change', toggleCountyLabels);
        document.getElementById('toggle-section-numbers').addEventListener('change', toggleSectionNumbers);
        document.getElementById('toggle-pooling-rates').addEventListener('change', togglePoolingRates);
        document.getElementById('toggle-wells').addEventListener('change', toggleWells);
        document.getElementById('nearby-wells-select').addEventListener('change', toggleNearbyWells);

        // Nearby filings checkbox handlers (now inside heatmap dropdown)
        document.getElementById('toggle-permits').addEventListener('change', function() {
            togglePermits();
            updateHeatmapLayers(); // Update button active state
        });
        document.getElementById('toggle-completions').addEventListener('change', function() {
            toggleCompletions();
            updateHeatmapLayers(); // Update button active state
        });

        // Heatmap button dropdown (similar to Overlays)
        const heatmapBtn = document.getElementById('heatmapBtn');
        const heatmapMenu = document.getElementById('heatmapMenu');
        let heatmapMenuOpen = false;

        heatmapBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            heatmapMenuOpen = !heatmapMenuOpen;
            heatmapMenu.classList.toggle('show', heatmapMenuOpen);
        });

        // Close heatmap menu when clicking outside
        document.addEventListener('click', function(event) {
            if (heatmapMenuOpen && !heatmapMenu.contains(event.target) && event.target !== heatmapBtn) {
                heatmapMenuOpen = false;
                heatmapMenu.classList.remove('show');
            }
        });

        // Heatmap checkbox handlers
        document.getElementById('toggle-heatmap-permits').addEventListener('change', updateHeatmapLayers);
        document.getElementById('toggle-heatmap-completions').addEventListener('change', updateHeatmapLayers);
        // OCC Application heatmap checkbox handlers
        document.getElementById('toggle-heatmap-pooling')?.addEventListener('change', updateHeatmapLayers);
        document.getElementById('toggle-heatmap-density')?.addEventListener('change', updateHeatmapLayers);
        document.getElementById('toggle-heatmap-spacing')?.addEventListener('change', updateHeatmapLayers);
        document.getElementById('toggle-heatmap-horizontal')?.addEventListener('change', updateHeatmapLayers);

        // Production choropleth dropdown
        document.getElementById('production-select').addEventListener('change', toggleProductionChoropleth);

        // Initialize map — called by React MapPage after scripts load
        // (DOMContentLoaded has already fired by then, so we use a direct call)
        async function initMap() {

            // Deep-link params (read early for immediate loading feedback)
            const urlParams = new URLSearchParams(window.location.search);
            const propertyId = urlParams.get('property');
            const wellId = urlParams.get('well');
            const sectionParam = urlParams.get('section');
            const townshipParam = urlParams.get('township');
            const rangeParam = urlParams.get('range');
            const isDeepLink = propertyId || wellId || (sectionParam && townshipParam && rangeParam);

            // Show feedback immediately so user knows map is navigating
            if (isDeepLink) {
                const target = propertyId ? 'property' : wellId ? 'well' : `${townshipParam}-${rangeParam}-${sectionParam}`;
                showLoading(`Navigating to ${target}...`);
            }

            try {
                // Only show loading screen if boundaries aren't cached (and not already showing deep-link message)
                const hasCache = hasCachedBoundaries();
                if (!hasCache && !isDeepLink) {
                    showLoading('Loading map data...', 'Loading county and township boundaries');
                }

                // Load boundary data
                await Promise.all([
                    loadCountyData(),
                    loadTownshipData()
                ]);

                // Hide loading if we showed it (but not if deep-link is still pending)
                if (!hasCache && !isDeepLink) {
                    hideLoading();
                }

                // Add layers that are checked by default (land grid combines counties + townships)
                if (document.getElementById('toggle-land-grid').checked) {
                    if (countyLayer) map.addLayer(countyLayer);
                    if (townshipLayer) map.addLayer(townshipLayer);
                }

                // Add county labels if checked by default
                if (document.getElementById('toggle-county-labels').checked) {
                    createCountyLabels();
                    if (countyLabelsLayer.getLayers().length > 0) {
                        map.addLayer(countyLabelsLayer);
                    }
                }

                // Note: Properties and wells layers are added automatically when loaded
                // Section numbers will be added when sections are loaded (zoom 12+)

                // Load user data (no artificial delay — deep-link zoom runs as soon as data is ready)
                try {
                    // Start PLSS section fetch early if we have STR params (don't wait for user data)
                    const plssFetch = (sectionParam && townshipParam && rangeParam)
                        ? fetch(`/api/plss-section?section=${sectionParam}&township=${townshipParam}&range=${rangeParam}`)
                        : null;

                    // Load all data in parallel
                    const [propertiesResult, wellsResult, activityResult] = await Promise.allSettled([
                        loadUserProperties(),
                        loadTrackedWells(),
                        loadActivityData()
                    ]);

                    // Log any failures but don't stop the map from working
                    if (propertiesResult.status === 'rejected') {
                        console.error('Failed to load properties:', propertiesResult.reason);
                    }
                    if (wellsResult.status === 'rejected') {
                        console.error('Failed to load wells:', wellsResult.reason);
                    }
                    if (activityResult.status === 'rejected') {
                        console.error('Failed to load activity data:', activityResult.reason);
                    }

                    if (propertyId && propertiesResult.status === 'fulfilled') {
                        const property = userProperties.find(p => p.id === propertyId);
                        if (property && propertyMarkers[propertyId]) {
                            const marker = propertyMarkers[propertyId];
                            map.fitBounds(marker.getBounds(), { maxZoom: 15, padding: [50, 50] });
                            setTimeout(() => marker.openPopup(), 300);
                        }
                        hideLoading();
                    }

                    // Deep-link: center on a specific tracked well
                    else if (wellId && wellsResult.status === 'fulfilled') {
                        let retryCount = 0;
                        const tryZoomToWell = () => {
                            const well = trackedWells.find(w => w.id === wellId);
                            if (well && wellMarkers[wellId]) {
                                const latlng = wellMarkers[wellId].getLatLng();
                                map.setView(latlng, 15);
                                setTimeout(() => wellMarkers[wellId].openPopup(), 300);
                                hideLoading();
                            } else if (retryCount++ < 10) {
                                setTimeout(tryZoomToWell, 100);
                            } else {
                                hideLoading(); // Give up retrying
                            }
                        };
                        tryZoomToWell();
                    }

                    // Deep-link: highlight section from STR params (Activity tab "MW Map")
                    else if (plssFetch) {
                        try {
                            const res = await plssFetch;
                            if (res.ok) {
                                const geojson = await res.json();
                                const highlightLayer = L.geoJSON(geojson, {
                                    style: { color: '#D97706', weight: 3, fillColor: '#FEF3C7', fillOpacity: 0.3 }
                                });
                                highlightLayer.addTo(map);
                                map.fitBounds(highlightLayer.getBounds(), { maxZoom: 14, padding: [50, 50] });

                                const countyParam = urlParams.get('county');
                                highlightLayer.bindPopup(
                                    `<b>${formatTRS(townshipParam, rangeParam, sectionParam)}</b>` +
                                    (countyParam ? `<br>${countyParam} County` : '')
                                ).openPopup();
                            }
                        } catch (err) {
                            console.error('Error loading section for deep link:', err);
                        }
                        hideLoading();
                    }

                } catch (error) {
                    console.error('Error loading map data:', error);
                    hideLoading();
                }

            } catch (error) {
                console.error('Error initializing map:', error);
                hideLoading();
                updateStatus('Map loaded with limited data');
            }
        }

        // Search functionality
        let searchTimeout;
        let allSearchableItems = [];

        // Build searchable index when data is loaded
        function updateSearchIndex() {
            allSearchableItems = [];

            // Add properties
            if (userProperties) {
                userProperties.forEach(prop => {
                    const trs = formatTRS(prop.fields.TWN, prop.fields.RNG, prop.fields.SEC);
                    allSearchableItems.push({
                        type: 'property',
                        name: trs,
                        details: `${prop.fields.COUNTY || ''} County${prop.fields.Notes ? ' • ' + prop.fields.Notes : ''}`,
                        data: prop,
                        searchText: `${prop.fields.SEC} ${prop.fields.TWN} ${prop.fields.RNG} ${trs} ${prop.fields.COUNTY || ''} ${prop.fields.Notes || ''}`.toLowerCase()
                    });
                });
            }

            // Add tracked wells
            if (trackedWells) {
                trackedWells.forEach(well => {
                    allSearchableItems.push({
                        type: 'well',
                        name: well.well_name || `API ${well.apiNumber}`,
                        details: `${well.operator || 'Unknown'} • ${well.well_status || 'Unknown'}`,
                        data: well,
                        searchText: `${well.well_name || ''} ${well.apiNumber || ''} ${well.operator || ''} ${well.formation_name || ''}`.toLowerCase()
                    });
                });
            }

            // Add nearby wells when layer is active
            if (allNearbyWells && allNearbyWells.length > 0 && nearbyWellsLayer && map.hasLayer(nearbyWellsLayer)) {
                allNearbyWells.forEach(well => {
                    if (!well.latitude || !well.longitude) return;
                    const wellName = well.well_name ? (well.well_number ? `${well.well_name} ${well.well_number}` : well.well_name) : '';
                    const nearbyTrs = formatTRS(well.township || '?', well.range || '?', well.section || '?');
                    allSearchableItems.push({
                        type: 'nearby',
                        name: wellName || `API ${well.api_number || 'Unknown'}`,
                        details: `${well.operator || 'Unknown'} • ${nearbyTrs}`,
                        data: { id: well.api_number, lat: well.latitude, lng: well.longitude },
                        searchText: `${wellName} ${well.api_number || ''} ${well.operator || ''} ${well.formation_name || ''} ${well.county || ''} ${well.section || ''} ${well.township || ''} ${well.range || ''} ${nearbyTrs}`.toLowerCase()
                    });
                });
            }

            console.log(`Search index updated with ${allSearchableItems.length} items`);
        }

        // Perform search
        function performSearch(query) {
            if (!query || query.length < 2) {
                document.getElementById('searchResults').innerHTML = '';
                document.getElementById('searchResults').classList.remove('active');
                return;
            }

            const searchTerm = query.toLowerCase();
            const results = allSearchableItems.filter(item =>
                item.searchText.includes(searchTerm)
            ).slice(0, 10); // Limit to 10 results

            displaySearchResults(results);
        }

        // Display search results
        function displaySearchResults(results) {
            const container = document.getElementById('searchResults');

            if (results.length === 0) {
                container.innerHTML = '<div class="search-no-results">No results found</div>';
            } else {
                const typeLabels = { property: 'Property', well: 'Tracked', nearby: 'Nearby' };
                container.innerHTML = results.map(item => `
                    <div class="search-result-item" data-type="${item.type}" data-id="${item.data.id}" ${item.data.lat ? `data-lat="${item.data.lat}" data-lng="${item.data.lng}"` : ''}>
                        <div class="search-result-type type-${item.type}">${typeLabels[item.type] || item.type}</div>
                        <div class="search-result-name">${item.name}</div>
                        <div class="search-result-details">${item.details}</div>
                    </div>
                `).join('');
            }

            container.classList.add('active');
        }

        // Handle search input
        document.getElementById('mapSearch').addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                performSearch(e.target.value);
            }, 300);
        });

        // Handle clicking on search results
        document.getElementById('searchResults').addEventListener('click', (e) => {
            const resultItem = e.target.closest('.search-result-item');
            if (!resultItem) return;

            const type = resultItem.dataset.type;
            const id = resultItem.dataset.id;

            // Clear search
            document.getElementById('mapSearch').value = '';
            document.getElementById('searchResults').classList.remove('active');

            // Find and zoom to the item
            if (type === 'property') {
                const property = userProperties.find(p => p.id === id);
                if (property && propertyMarkers[id]) {
                    const marker = propertyMarkers[id];
                    // For properties we have polygons, get the bounds center
                    const bounds = marker.getBounds();
                    map.fitBounds(bounds, { maxZoom: 14 });
                    marker.openPopup();
                }
            } else if (type === 'well') {
                const well = trackedWells.find(w => w.id === id);
                if (well && wellMarkers[id]) {
                    const marker = wellMarkers[id];
                    map.setView(marker.getLatLng(), 14);
                    marker.openPopup();
                }
            } else if (type === 'nearby') {
                const lat = parseFloat(resultItem.dataset.lat);
                const lng = parseFloat(resultItem.dataset.lng);
                if (lat && lng) {
                    map.setView([lat, lng], 14);
                    // Find and open the nearby well's popup
                    if (nearbyWellsLayer) {
                        nearbyWellsLayer.eachLayer(layer => {
                            const pos = layer.getLatLng();
                            if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
                                setTimeout(() => layer.openPopup(), 300);
                            }
                        });
                    }
                }
            }
        });

        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.map-search-container')) {
                document.getElementById('searchResults').classList.remove('active');
            }
        });

        // Update search index when properties are loaded
        const originalLoadUserProperties = loadUserProperties;
        loadUserProperties = async function() {
            await originalLoadUserProperties();
            updateSearchIndex();
        };

        // Update search index when wells are loaded
        const originalLoadTrackedWells = loadTrackedWells;
        loadTrackedWells = async function() {
            await originalLoadTrackedWells();
            updateSearchIndex();
        };

        console.log('🗺️ Oklahoma Land Survey Map initialized');


