// Colors (matching prototype + portal)
export const OIL_NAVY = '#1C2B36';
export const SLATE_BLUE = '#334E68';
export const ORANGE = '#C05621';
export const ORANGE_LIGHT = '#FEF3EC';
export const DARK = '#1a2332';
export const SLATE = '#64748b';
export const GAP_COLOR = '#e85d4a';
export const GAP_BG = '#fef2f2';
export const BORDER = '#e2e8f0';
export const GREEN = '#16a34a';
export const TEAL = '#1D6F5C'; // portal header/accent

// Backgrounds
export const BG_MUTED = '#f8fafc';   // table headers, info boxes, modal bodies
export const BG_FIELD = '#f9fafb';   // extracted data fields, form field backgrounds

// Text shades
export const TEXT_MUTED = '#6B7280'; // secondary labels, metadata
export const TEXT_FAINT = '#9CA3AF'; // disabled, tertiary text
export const TEXT_DARK = '#374151';  // strong body text

// Semantic
export const ORANGE_DARK = '#9C4215'; // PropertyModal gradient endpoint

// Layout dimensions
export const NODE_W = 250;
export const NODE_H = 80;
export const STACK_H = 92;
export const GAP_H = 68;
export const CURRENT_H = 90;
export const H_GAP = 32;
export const V_GAP = 100;
export const PAD = 80;
export const EXPANDED_CARD_H = 76;
export const EXPANDED_CARD_GAP = 8;

// Org gating
export const TITLE_CHAIN_ALLOWED_ORGS = ['rec9fYy8Xwl3jNAbf'];

// Dashboard colors
export const SUCCESS_GREEN = '#16a34a';
export const ERROR_RED = '#dc2626';
export const WARNING_AMBER = '#f59e0b';
export const INFO_BLUE = '#3b82f6';

// Modal system
export const MODAL_BASE_Z = 999999;
export const MODAL_Z_INCREMENT = 10;
export const MAX_MODAL_DEPTH = 4;

// Toast
export const TOAST_DEFAULT_DURATION = 3000;

// Table
export const TABLE_ROW_HEIGHT = 44;
export const VIRTUAL_THRESHOLD = 100;

// Well status colors
export const WELL_STATUS_COLORS: Record<string, string> = {
  AC: '#10b981', ACTIVE: '#10b981',
  PA: '#ef4444', PLUGGED: '#ef4444',
  IN: '#f59e0b', INACTIVE: '#f59e0b',
  SI: '#8b5cf6', 'SHUT-IN': '#8b5cf6',
  TA: '#6366f1', 'TEMP ABANDON': '#6366f1',
  NEW: '#3b82f6',
  NR: '#6b7280',
};

// Plan limits
export const PLAN_LIMITS: Record<string, { properties: number; wells: number }> = {
  'Free': { properties: 1, wells: 1 },
  'Starter': { properties: 10, wells: 10 },
  'Standard': { properties: 50, wells: 50 },
  'Professional': { properties: 250, wells: 250 },
  'Business': { properties: 500, wells: 500 },
  'Enterprise 1K': { properties: 1000, wells: 1000 },
};

// Modal type string constants
export const MODAL_TYPES = {
  PROPERTY: 'property',
  WELL: 'well',
  DOCUMENT_DETAIL: 'document-detail',
  DOCUMENT_VIEWER: 'document-viewer',
  UPLOAD_DOCUMENT: 'upload-document',
  CREDIT_PACK: 'credit-pack',
  OUT_OF_CREDITS: 'out-of-credits',
} as const;

// OCC filing status colors
export const FILING_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  heard: { bg: '#dcfce7', color: '#166534' },
  recommended: { bg: '#dcfce7', color: '#166534' },
  scheduled: { bg: '#dbeafe', color: '#1e40af' },
  continued: { bg: '#fef3c7', color: '#92400e' },
  dismissed: { bg: '#fee2e2', color: '#991b1b' },
  filed: { bg: '#f3f4f6', color: '#374151' },
};

// Document status colors
export const DOC_STATUS_COLORS: Record<string, string> = {
  complete: '#16a34a',
  failed: '#dc2626',
  manual_review: '#f59e0b',
  processing: '#3b82f6',
  queued: '#8b5cf6',
};
