/** Normalize activity type for display (matches vanilla) */
export function normalizeActivityType(type: string | undefined): string {
  if (type === 'New Permit') return 'New Drilling Permit';
  return type || 'Status Change';
}

/** Get filter category for grouping (matches vanilla getFilterCategory) */
export function getFilterCategory(activityType: string): string {
  if (activityType.includes('Permit')) return 'Permits';
  if (activityType.includes('Completed')) return 'Completions';
  if (activityType.includes('Transfer') || activityType === 'Operator Change' || activityType === 'Well Transfer') return 'Transfers';
  if (activityType.includes('Application') || activityType.includes('Exception') ||
      activityType === 'OCC Filing' || activityType === 'Order Modification') return 'OCC Filings';
  if (activityType.includes('Abandoned') || activityType.includes('Plugged')) return 'Plugged/Abandoned';
  return 'Other';
}

/** Get emoji icon for activity type (matches vanilla) */
export function getActivityIcon(activityType: string): string {
  if (activityType.includes('Permit')) return '📋';
  if (activityType.includes('Drilling')) return '🔨';
  if (activityType.includes('Completed')) return '✅';
  if (activityType.includes('Transfer')) return '🔄';
  if (activityType.includes('Abandoned') || activityType.includes('Plugged')) return '⛔';
  if (activityType.includes('Application') || activityType.includes('Exception') ||
      activityType === 'OCC Filing' || activityType === 'Order Modification' ||
      activityType === 'Operator Change' || activityType === 'Well Transfer') return '⚖️';
  return '📋';
}

/** Alert level styling (matches vanilla .activity-level CSS) */
export function getAlertLevelStyle(level: string): { bg: string; color: string; label: string } {
  const normalized = (level || '').toUpperCase().replace(/_/g, ' ');
  if (normalized.includes('ADJACENT')) return { bg: '#FEF3C7', color: '#92400E', label: 'ADJACENT' };
  if (normalized.includes('TRACKED')) return { bg: '#CCFBF1', color: '#115E59', label: 'TRACKED' };
  if (normalized.includes('BOTTOM')) return { bg: '#FFF7ED', color: '#9A3412', label: 'BOTTOM HOLE' };
  if (normalized.includes('LATERAL')) return { bg: '#F5F3FF', color: '#5B21B6', label: 'LATERAL PATH' };
  // Default: YOUR PROPERTY
  return { bg: '#FEE2E2', color: '#991B1B', label: 'YOUR PROPERTY' };
}

/** Ordered filter categories for chips */
export const ACTIVITY_FILTER_CATEGORIES = [
  'Permits', 'Completions', 'Transfers', 'OCC Filings', 'Plugged/Abandoned', 'Other',
] as const;
