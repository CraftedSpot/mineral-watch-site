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
    return value.map((v) => formatFieldValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    // Handle legal description objects
    const obj = value as Record<string, unknown>;
    if (obj.section || obj.township || obj.range) {
      const parts: string[] = [];
      if (obj.section) parts.push(`S${obj.section}`);
      if (obj.township) parts.push(`T${obj.township}`);
      if (obj.range) parts.push(`R${obj.range}`);
      return parts.join('-');
    }
    return JSON.stringify(value);
  }
  return String(value);
}
