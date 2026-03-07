import { BORDER } from './constants';

/** Color styles for human-readable match reasons (PropertyModal, WellModal) */
export const MATCH_STYLES: Record<string, { bg: string; color: string }> = {
  'Surface Location': { bg: '#dbeafe', color: '#1d4ed8' },
  'Bottom Hole': { bg: '#cffafe', color: '#0e7490' },
  'Lateral Path': { bg: '#f3e8ff', color: '#7c3aed' },
  'Adjacent Section': { bg: '#fef3c7', color: '#92400e' },
};

export function getMatchStyle(reason: string) {
  return MATCH_STYLES[reason] || { bg: BORDER, color: '#374151' };
}

/** Color styles for snake_case match methods (DiscoverWellsModal) */
export const METHOD_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  surface_section: { label: 'Surface', bg: '#dcfce7', color: '#166534' },
  lateral_path: { label: 'Lateral', bg: '#dbeafe', color: '#1e40af' },
  bottom_hole: { label: 'Bottom Hole', bg: '#ede9fe', color: '#5b21b6' },
  adjacent_bh: { label: 'Adjacent', bg: '#f1f5f9', color: '#475569' },
  adjacent_surface: { label: 'Adjacent', bg: '#f1f5f9', color: '#475569' },
};

export function getMethodLabel(method: string) {
  return METHOD_LABELS[method] || { label: method, bg: '#f1f5f9', color: '#475569' };
}
