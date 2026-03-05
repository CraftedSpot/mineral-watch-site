const DOC_TYPE_MAP: Record<string, string> = {
  pooling_order: 'Pooling Order',
  spacing_order: 'Spacing Order',
  increased_density: 'Increased Density Order',
  location_exception: 'Location Exception',
  multiunit_horizontal: 'Multi-Unit Horizontal Order',
  well_proposal: 'Well Proposal',
  oil_gas_lease: 'Oil & Gas Lease',
  multi_document: 'Multi-Document PDF',
  lease_production: 'Lease Production Report',
  production_record: 'Production Record',
  production_summary: 'Production Summary',
  division_order: 'Division Order',
  deed: 'Deed',
  assignment: 'Assignment',
  other: 'Other Document',
};

export function formatDocType(type: string | null | undefined): string {
  if (!type) return 'Document';
  return DOC_TYPE_MAP[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatFieldName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '\u2014';
    return value.map((v) => formatFieldValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Handle legal description objects
    if (obj.section || obj.township || obj.range) {
      const parts: string[] = [];
      if (obj.section) parts.push(`S${obj.section}`);
      if (obj.township) parts.push(`T${obj.township}`);
      if (obj.range) parts.push(`R${obj.range}`);
      if (obj.quarter_call) parts.push(String(obj.quarter_call));
      if (obj.county) parts.push(String(obj.county));
      return parts.join(' \u2013 ');
    }
    // Flatten simple objects into readable key: value pairs (recursive — no JSON.stringify)
    const entries = Object.entries(obj).filter(([, v]) => v != null && v !== '');
    if (entries.length === 0) return '\u2014';
    return entries.map(([k, v]) => {
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `${label}: ${formatFieldValue(v)}`;
    }).join('; ');
  }
  return String(value);
}

/** Check if a value is "empty" (null, empty string, empty array, all-null object) */
export function isEmptyValue(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null && v !== '');
    return entries.length === 0;
  }
  return false;
}
