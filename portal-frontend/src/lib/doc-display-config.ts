/**
 * Display configuration — controls which extracted fields are shown per doc type.
 * Ported from vanilla shared-display-config.txt for React parity.
 */

// Fields always hidden regardless of doc type
const GLOBAL_HIDE: string[] = [
  'api_number_normalized', 'api_normalized',
  'field_scores', 'document_confidence', '_schema_validation',
  'skip_extraction', 'raw_response', 'error',
  'doc_type', 'category',
  // Analysis fields rendered separately
  'key_takeaway', 'ai_observations', 'detailed_analysis', 'observations',
  // Page metadata
  'start_page', 'end_page', 'page_count', 'page_number', 'split_metadata',
];

// Per-doc-type additional hide lists
const HIDE_BY_DOC_TYPE: Record<string, string[]> = {
  check_stub: [
    'wells', 'summary', 'operating_expenses',
    'section', 'township', 'range', 'county', 'state',
  ],
  pooling_order: [
    'officials', 'legal_description', 'additional_terms', 'special_findings',
    'mailing_requirement', 'reasons_for_relief', 'order_date',
    'administrative_law_judge_dates', 'attorney_info',
  ],
  increased_density_order: [
    'officials', 'legal_description', 'recoverable_reserves', 'companion_causes',
  ],
  location_exception_order: [
    'officials', 'legal_description', 'offset_wells', 'unit_name',
    'vertical_well_location', 'conditions', 'related_orders',
    'allowable', 'offset_impact',
  ],
  drilling_spacing_order: ['officials', 'legal_description'],
  drilling_and_spacing_order: ['officials', 'legal_description'],
  change_of_operator_order: ['officials', 'legal_description'],
  multi_unit_horizontal_order: ['officials', 'legal_description', 'companion_causes'],
  unitization_order: ['officials', 'legal_description'],
  drilling_permit: ['bottom_hole_location', 'surface_location'],
  completion_report: ['bottom_hole_location', 'lateral_details', 'formation_tops', 'first_sales'],
  division_order: ['well_number'],
};

// Pattern-based hiding
const HIDE_PATTERNS = [/^_/, /_confidence$/, /_normalized$/];

// Interest fields: hide when value is 0
const INTEREST_FIELDS = new Set([
  'working_interest', 'royalty_interest', 'overriding_royalty_interest',
  'net_revenue_interest', 'non_participating_royalty_interest',
]);

/**
 * Check if a field should be displayed in the document detail modal.
 */
export function shouldDisplayField(
  fieldName: string,
  value: unknown,
  docType?: string,
): boolean {
  // Global hide list
  if (GLOBAL_HIDE.includes(fieldName)) return false;

  // Per-doc-type hide list
  if (docType) {
    const typeHide = HIDE_BY_DOC_TYPE[docType];
    if (typeHide && typeHide.includes(fieldName)) return false;
  }

  // Pattern-based hiding
  for (const pattern of HIDE_PATTERNS) {
    if (pattern.test(fieldName)) return false;
  }

  // Interest fields with zero value
  if (INTEREST_FIELDS.has(fieldName) && (value === 0 || value === '0')) {
    return false;
  }

  return true;
}
