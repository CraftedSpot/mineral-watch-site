import { useEffect, useCallback, useRef } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { MODAL_TYPES } from '../../lib/constants';

interface WellOpts {
  apiNumber?: string;
  wellId?: string;
  wellName?: string;
  operator?: string;
  county?: string;
  status?: string;
  onTrack?: boolean;
}

interface PropertyOpts {
  propertyId: string;
}

interface DocumentOpts {
  docId: string;
}

interface OperatorOpts {
  operatorName: string;
  operatorNumber?: string;
}

interface MapBridge {
  ready: boolean;
  openWell: (opts: WellOpts) => void;
  openProperty: (opts: PropertyOpts) => void;
  openDocument: (opts: DocumentOpts) => void;
  openOperator: (opts: OperatorOpts) => void;
  onReady: (callback: () => void) => void;
}

declare global {
  interface Window {
    __mw?: MapBridge;
  }
}

/**
 * Bridge between vanilla Leaflet map code and React modal system.
 * Exposes window.__mw so vanilla onclick handlers can open React modals.
 *
 * @param onTrackWell - Called when user tracks a well from the map modal.
 *   The map should refresh its markers after this.
 */
export function useMapBridge(onTrackWell?: (apiNumber: string) => void) {
  const modal = useModal();
  const readyCallbacks = useRef<Array<() => void>>([]);
  const onTrackRef = useRef(onTrackWell);
  onTrackRef.current = onTrackWell;

  const openWell = useCallback((opts: WellOpts) => {
    // Close any Leaflet popups before opening React modal
    const mapEl = document.querySelector('.leaflet-container') as HTMLElement & { _leaflet_map?: { closePopup: () => void } };
    if (mapEl?._leaflet_map) mapEl._leaflet_map.closePopup();

    const props: Record<string, unknown> = {
      apiNumber: opts.apiNumber,
      wellId: opts.wellId,
      wellName: opts.wellName,
      operator: opts.operator,
      county: opts.county,
      status: opts.status,
    };
    // If onTrack requested and we have a track callback, wire it up
    if (opts.onTrack && onTrackRef.current) {
      props.onTrack = onTrackRef.current;
    }
    modal.open(MODAL_TYPES.WELL, props);
  }, [modal]);

  const openProperty = useCallback((opts: PropertyOpts) => {
    modal.open(MODAL_TYPES.PROPERTY, { propertyId: opts.propertyId });
  }, [modal]);

  const openDocument = useCallback((opts: DocumentOpts) => {
    modal.open(MODAL_TYPES.DOCUMENT_DETAIL, { docId: opts.docId });
  }, [modal]);

  const openOperator = useCallback((opts: OperatorOpts) => {
    // OperatorLink component handles the lazy-loaded OperatorModal.
    // For the bridge, we open a well modal filtered by operator — but actually
    // the map's activity cards just show operator as text. If we want a clickable
    // operator from vanilla, we'd need OperatorModal in MODAL_REGISTRY.
    // For now, this is a placeholder — the vanilla map doesn't call openOperator.
    console.log('[MapBridge] openOperator:', opts.operatorName);
  }, []);

  useEffect(() => {
    const bridge: MapBridge = {
      ready: true,
      openWell,
      openProperty,
      openDocument,
      openOperator,
      onReady(callback) {
        if (bridge.ready) {
          callback();
        } else {
          readyCallbacks.current.push(callback);
        }
      },
    };

    window.__mw = bridge;

    // Fire any queued callbacks from vanilla scripts that loaded before React
    for (const cb of readyCallbacks.current) {
      try { cb(); } catch (e) { console.error('[MapBridge] onReady callback error:', e); }
    }
    readyCallbacks.current = [];

    return () => {
      // Cleanup: remove bridge on unmount
      if (window.__mw === bridge) {
        window.__mw = undefined;
      }
    };
  }, [openWell, openProperty, openDocument, openOperator]);
}
