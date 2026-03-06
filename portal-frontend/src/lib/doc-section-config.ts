/**
 * Section grouping configuration — maps extracted fields to display sections.
 * Ported from vanilla dashboard-documents.txt groupFieldsBySection() for React parity.
 */
import { shouldDisplayField } from './doc-display-config';
import { isEmptyValue } from './format-doc-type';

// Field → section mapping. Fields can appear in multiple section definitions;
// first match in iteration order wins (JS object key order = insertion order).
const SECTION_FIELDS: Record<string, string[]> = {
  'Parties': [
    'grantors', 'grantees', 'grantor', 'grantee', 'grantor_name', 'grantee_name',
    'grantor_names', 'grantee_names', 'grantor_address', 'grantee_address',
    'grantor_marital_status', 'lessor_name', 'lessee_name', 'lessor_address', 'lessee_address',
    'lessor', 'lessee', 'lessors', 'lessees',
    'assignor', 'assignee', 'assignor_name', 'assignee_name', 'assignor_address', 'assignee_address',
    'assignors', 'assignees',
    'releasor', 'ratifying_party', 'original_party', 'principal_name', 'agent_name',
    'petitioner_name', 'respondent_name', 'decedent_name', 'executor_name', 'affiant_name',
    'decedent', 'affiant', 'heirs_summary', 'children_living', 'children_predeceased', 'spouses',
    'president', 'vice_president', 'secretary', 'assistant_secretary', 'treasurer', 'corporate_officer',
    'from', 'sender', 'to',
  ],
  'Operator & Well': [
    'operator_name', 'operator_address', 'operator_phone', 'operator_email',
    'return_instructions', 'property_name', 'property_number', 'billing_code',
  ],
  'Owner & Interest': [
    'owner_name', 'owner_address', 'trustee_name', 'owner_number',
    'owner_phone', 'owner_fax', 'owner_email',
    'working_interest', 'royalty_interest', 'overriding_royalty_interest',
    'net_revenue_interest', 'non_participating_royalty_interest',
  ],
  'Terms & Unit': [
    'effective_date', 'payment_minimum', 'product_type', 'unit_size_acres',
    'county', 'state', 'section', 'township', 'range',
    'is_multi_section_unit', 'unit_sections',
    'primary_term', 'royalty_rate', 'delay_rental', 'shut_in_royalty',
    'extension_provisions', 'lease_form', 'habendum_clause', 'pooling_provisions',
  ],
  'Payment Information': [
    'check_number', 'check_date', 'check_amount', 'statement_type',
    'interest_type', 'operator_number', 'operator_address', 'owner_number',
  ],
  'Well Revenue': ['wells'],
  'Check Summary': ['summary'],
  'Operating Expenses': ['operating_expenses'],
  'Tracts & Interest': [
    'tracts', 'interest_conveyed', 'interest_assigned', 'consideration',
    'consideration_amount', 'consideration_description', 'bonus_amount',
    'net_mineral_acres', 'minerals_covered', 'mineral_types_conveyed', 'royalty',
  ],
  'Recording & Execution': [
    'recording', 'recording_book', 'recording_page', 'document_number',
    'recording_date', 'recording_county', 'instrument_number',
    'execution_date', 'prepared_by', 'notary_date', 'notary_county', 'notary_state',
    'deed_type', 'notary_expiration', 'commission_expiration',
    'corporate_acknowledgment', 'acknowledgment_date', 'notarization', 'witnesses',
  ],
  'Legal Description': [
    'legal_description', 'quarter', 'quarter_section', 'lot_block',
    'acres', 'acreage', 'location',
  ],
  'Order Details': [
    'cd_number', 'order_number', 'cause_number', 'case_number', 'order_sub_type',
    'order_date', 'effective_date', 'hearing_date', 'reopen_date', 'reopen_purpose',
    'applicant', 'well_cost', 'unit_size_acres', 'unit_description', 'relief_granted',
    'unit_shape', 'formations', 'election_options', 'election_deadline_days',
    'additional_wells_authorized', 'existing_wells', 'expiration_date', 'expiration_period',
    'amends_order', 'engineering_data', 'allowable_type', 'allowable_notes',
    'unit_sections', 'total_unit_acres', 'total_completion_interval_feet',
    'allocation_method', 'well_type', 'target_reservoir', 'adjacent_common_source',
    'completion_interval', 'referenced_spacing_orders', 'referenced_pooling_orders',
    'companion_cases', 'special_provisions', 'cost_savings',
    'proposed_well_name', 'previous_operator', 'new_operator', 'transfer_date', 'affected_wells',
    'order_info',
  ],
  'Hearing Details': [
    'hearing_location', 'administrative_law_judge', 'applicant_attorney',
    'protestant', 'protestant_attorney', 'protest_status',
  ],
  'Lease Terms': [
    'primary_term', 'royalty_rate', 'delay_rental', 'shut_in_royalty',
    'extension_provisions', 'lease_form', 'habendum_clause', 'pooling_provisions',
    'shut_in_provisions', 'force_majeure', 'surface_use', 'assignment_status',
    'top_lease_provision', 'continuous_development_clause',
  ],
  'Lease Clauses': ['depth_clause', 'pugh_clause', 'deductions_clause', 'exhibit_a'],
  'Well Information': [
    'well_name', 'well_number', 'well_identification', 'api_number',
    'well_type', 'operator', 'purchaser', 'permit_type', 'permit_number',
    'issue_date', 'expiration_date',
  ],
  'Letter Details': ['subject', 're_line'],
  'Notes': ['extraction_notes', 'notes', 'additional_info'],
  'Title & Warranties': [
    'warranty_type', 'source_of_title', 'warranty_of_title',
    'warranty_scope', 'warranty_language', 'has_warranty',
  ],
  'Restrictions & Provisions': [
    'reservations', 'exceptions', 'subject_to', 'depth_limitations',
    'formation_limitations', 'mineral_types', 'pooling_authorization',
    'surface_restrictions', 'no_surface_clause', 'pugh_clause', 'vertical_pugh_clause',
  ],
  'Bottom Hole Location': ['bottom_hole_location'],
  'Target Formation': ['target_formation', 'target_depth_top', 'target_depth_bottom'],
  'Unit Details': ['unit_size_acres', 'spacing_order', 'lateral_direction', 'lateral_length_ft'],
  'Multi-Unit Sections': ['multi_unit_sections', 'section_crossings'],
  'Reservation': ['reservation'],
  'Prior Instruments': ['prior_instruments'],
  'Target Formations': ['target_formations'],
  'Existing Wells': ['existing_wells'],
  'Recoverable Reserves': ['recoverable_reserves'],
  'Expiration': ['expiration'],
  'Related Orders': ['related_orders'],
  'Spacing Units': ['units'],
  'Companion Causes': ['companion_causes'],
  'Election Options': ['election_options'],
  'Operator Information': ['operator'],
  'Applicant Information': [
    'applicant', 'attorney_information',
    'attorney_name', 'attorney_bar_number', 'attorney_oba_number', 'oba_number',
    'attorney_firm', 'attorney_address', 'attorney_phone', 'attorney_fax',
  ],
  'Formations': ['formations'],
  'Important Deadlines': ['deadlines'],
  'Subsequent Wells': [
    'subsequent_wells', 'subsequent_wells_provisions_election_period',
    'subsequent_wells_provisions_payment_deadline',
    'subsequent_wells_provisions_bonus_payment_deadline',
    'subsequent_wells_provisions_operator_commencement',
    'subsequent_wells_provisions_participation_options',
  ],
  'Additional Parties': [
    'additional_parties', 'respondents_with_known_addresses',
    'respondents_with_unknown_addresses', 'respondents_dismissed',
  ],
  'Pooling Order Details': ['order_info', 'commissioners'],
  'Well Details': ['well_info', 'well_orientation'],
  'Unit Information': ['unit_info'],
  'Officials': ['officials'],
  'Document References': [
    'related_documents', 'exhibits', 'prior_instruments',
    'original_lease_reference', 'original_document_reference',
    'original_lease_date', 'original_document_date',
  ],
  // Trust Funding
  'Assignment Flags': ['is_blanket_assignment', 'includes_future_acquired', 'includes_mineral_interests'],
  'Property Coverage': ['property_categories', 'mineral_interests', 'specific_properties'],
  'Trustee Acceptance': ['acceptance'],
  // Limited Partnership
  'Entity Information': ['entity_info'],
  'Partnership Term': ['term'],
  'Principal Office': ['principal_office'],
  'General Partners': ['general_partners'],
  'Limited Partners': ['limited_partners'],
  'Business Purpose': ['business_purpose'],
  'Capital Provisions': ['contribution_provisions', 'distribution_provisions'],
  'Management & Governance': ['management_provisions', 'voting_provisions', 'liability_provisions'],
  'Succession & Assignment': ['succession_provisions', 'assignment_provisions'],
  'Dissolution': ['dissolution_provisions'],
  // Assignment of Lease
  'Assignors': ['assignors'],
  'Assignees': ['assignees'],
  'Interest Assigned': ['interest_assigned'],
  'Retained Interests': ['retained_interests'],
  'Subject To': ['subject_to'],
  'Proportionate Reduction': ['proportionate_reduction'],
  'Underlying Lease': ['underlying_lease'],
  'Warranties': ['warranties'],
  // Quit Claim Deed
  'Deed Classification': ['deed_classification'],
  'Granting Clause': ['granting_clause'],
  'Reservations & Exceptions': ['reservations_exceptions'],
  'Return To': ['return_to'],
  'Chain of Title Links': ['chain_of_title_links'],
  'Annotations': ['annotations'],
  // Change of Operator
  'Former Operator': ['former_operator'],
  'New Operator': ['new_operator'],
  'Affected Wells': ['affected_wells'],
  'Modified Orders': ['modified_orders'],
  // Location Exception
  'Order Information': ['order_info'],
  'Exception Details': ['exception_details'],
  'Lateral Path': ['lateral_path'],
  'Vertical Well Location': ['vertical_well_location'],
  'Allowable': ['allowable'],
  'Offset Impact': ['offset_impact'],
  'Conditions': ['conditions'],
  // Death Certificate
  'Certificate Information': ['certificate_info'],
  'Decedent': ['decedent'],
  'Death Location': ['death_location'],
  'Residence at Death': ['residence_at_death'],
  'Marital Status': ['marital_status'],
  'Parents': ['parents'],
  'Family Members': ['family_members'],
  'Cause of Death': ['cause_of_death'],
  'Disposition': ['disposition'],
  'Certification': ['certification'],
  'Consular Information': ['consular_info'],
  'Chain of Title': ['chain_of_title'],
  'Related Documents': ['related_documents'],
  // Multi-Unit Horizontal
  'Well Authorization': ['well_authorization'],
  'Well Location': ['well_location'],
  'Allocation Factors': ['allocation_factors'],
  'Relief Granted': ['relief_granted'],
  'Special Provisions': ['special_provisions'],
  // Lease Production
  'Lease & Well': ['lease_name', 'producing_unit_no', 'data_source'],
  'Oil Production': ['oil_production'],
  'Gas Production': ['gas_production'],
  'Condensate Production': ['condensate_production'],
  // Completion Report
  'Key Dates': ['dates'],
  'Lateral Details': ['lateral_details'],
  'Perforated Intervals': ['perforated_intervals', 'total_perforated_length_ft'],
  'Initial Production': ['initial_production'],
  'First Sales': ['first_sales'],
  'Stimulation': ['stimulation'],
  'Formation Zones': ['formation_zones'],
  'Formation Tops': ['formation_tops'],
  // Well Transfer
  'Transfer Information': ['transfer_info'],
  'Wells Transferred': ['wells'],
  'Transfer Summary': ['summary'],
  // Unitization
  'Unit Summary': ['unit_info'],
  'Unit Order Details': ['order_info', 'commissioners'],
  'Allocation Formula': ['allocation_formula'],
  'Unit Boundaries': ['location'],
  'Authorized Operations': ['authorized_operations'],
  'Superseded Orders': ['related_orders'],
  'Termination Provisions': ['termination_provisions'],
  'Ratification': ['ratification'],
  'Exhibits': ['exhibits'],
  'Reference Well': ['reference_well'],
  'Unit Parties': ['parties'],
  // JOA
  'JOA Parties': ['parties'],
  'JOA Terms': [
    'model_form', 'contract_area_name', 'non_consent_penalty_pct',
    'consent_threshold_pct', 'subsequent_operations_notice_days',
    'preferential_right_to_purchase', 'take_in_kind_allowed', 'commingling_allowed',
  ],
  'Accounting Procedure': ['accounting_procedure'],
};

// Build reverse map: fieldName → sectionName (first match wins)
const FIELD_TO_SECTION: Record<string, string> = {};
for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
  for (const field of fields) {
    if (!(field in FIELD_TO_SECTION)) {
      FIELD_TO_SECTION[field] = section;
    }
  }
}

// Prefix-based pattern matching for fields not in the flat map
function getSectionByPrefix(fieldName: string): string | null {
  const lower = fieldName.toLowerCase();
  if (lower.startsWith('legal_representation') || lower.startsWith('legal representation')) {
    return 'Applicant Information';
  }
  if (lower.startsWith('order_execution') || lower.startsWith('order execution')) {
    return 'Pooling Order Details';
  }
  if (lower.startsWith('additional_provisions_subsequent_wells') ||
      lower.startsWith('additional provisions subsequent wells') ||
      lower.startsWith('additional_provisions_bonus_payment') ||
      lower.startsWith('additional provisions bonus payment') ||
      lower.startsWith('additional_provisions_replacement_wells') ||
      lower.startsWith('additional provisions replacement wells')) {
    return 'Subsequent Wells';
  }
  if (lower.startsWith('exhibit_a_respondents') || lower.startsWith('exhibit a respondents')) {
    return 'Additional Parties';
  }
  if (lower.startsWith('additional_provisions_operator_lien') ||
      lower.startsWith('additional provisions operator lien')) {
    return 'Notes';
  }
  return null;
}

// Section display order
const SECTION_ORDER: string[] = [
  'Parties', 'Tracts & Interest', 'Reservation', 'Recording & Execution', 'Prior Instruments',
  'Spacing Units', 'Companion Causes',
  'Order Details', 'Officials', 'Operator Information', 'Applicant Information', 'Legal Description',
  'Former Operator', 'New Operator', 'Affected Wells', 'Subsequent Wells',
  'Target Formations', 'Order Information', 'Modified Orders', 'Unit Information',
  'Existing Wells', 'Recoverable Reserves', 'Expiration', 'Related Orders',
  'Election Options', 'Well Details', 'Formations', 'Important Deadlines', 'Default Election',
  'Pooling Order Details', 'Notes', 'Additional Parties',
  'Operator & Well', 'Owner & Interest', 'Terms & Unit',
  'Lease & Well', 'Oil Production', 'Gas Production', 'Condensate Production',
  'Payment Information', 'Well Revenue', 'Check Summary', 'Operating Expenses',
  'Title & Warranties', 'Restrictions & Provisions', 'Lease Terms', 'Lease Clauses',
  'Well Information', 'Hearing Details', 'Document References',
  'Permit Information', 'Well Identification', 'Surface Location',
  'Bottom Hole Location', 'Target Formation', 'Unit Details', 'Multi-Unit Sections',
  'Assignment Flags', 'Property Coverage', 'Trustee Acceptance',
  'Entity Information', 'Partnership Term', 'Principal Office',
  'General Partners', 'Limited Partners', 'Business Purpose',
  'Capital Provisions', 'Management & Governance', 'Succession & Assignment', 'Dissolution',
  'Assignors', 'Assignees', 'Interest Assigned', 'Retained Interests',
  'Subject To', 'Proportionate Reduction', 'Underlying Lease', 'Warranties',
  'Deed Classification', 'Granting Clause', 'Reservations & Exceptions',
  'Return To', 'Chain of Title Links', 'Annotations',
  'Exception Details', 'Lateral Path', 'Vertical Well Location', 'Allowable', 'Offset Impact', 'Conditions',
  'Certificate Information', 'Decedent', 'Death Location', 'Residence at Death',
  'Marital Status', 'Parents', 'Family Members', 'Cause of Death',
  'Disposition', 'Certification', 'Consular Information', 'Chain of Title', 'Related Documents',
  'Well Authorization', 'Well Location', 'Allocation Factors', 'Relief Granted', 'Special Provisions',
  'Key Dates', 'Lateral Details', 'Perforated Intervals', 'Initial Production',
  'First Sales', 'Stimulation', 'Formation Tops',
  'Transfer Information', 'Wells Transferred', 'Transfer Summary',
  'Unit Summary', 'Unit Order Details', 'Allocation Formula',
  'Reference Well', 'Unit Boundaries', 'Authorized Operations',
  'Superseded Orders', 'Termination Provisions', 'Ratification', 'Exhibits', 'Unit Parties',
  'Letter Details',
  'JOA Parties', 'JOA Terms', 'Accounting Procedure',
  'Other Information',
];

// Fields to skip in "Other Information" catch-all (internal metadata, handled elsewhere)
const SKIP_IN_OTHER = new Set([
  'key_takeaway', 'ai_observations', 'detailed_analysis', 'observations',
  'doc_type', 'field_scores', 'document_confidence', 'fields_needing_review', 'notes',
  '_schema_validation', '_review_flags', '_validation_issues', '_flag_details',
  'start_page', 'end_page', 'page_count', 'page_number', 'split_metadata',
  'adopted_stepchildren', 'grandchildren_of_predeceased',
  'recording_info', 'notary', 'property_acquisition', 'will_and_probate',
  'unpaid_debts', 'inheritance_tax_status',
]);

/**
 * Group extracted document data into display sections.
 * Returns an ordered Map of sectionName → array of [fieldName, value] entries.
 */
export function groupFieldsBySection(
  data: Record<string, unknown>,
  docType?: string,
): Map<string, Array<[string, unknown]>> {
  const grouped = new Map<string, Array<[string, unknown]>>();
  const processed = new Set<string>();

  // First pass: assign fields to their designated sections
  for (const [field, value] of Object.entries(data)) {
    if (isEmptyValue(value)) { processed.add(field); continue; }

    // Skip confidence fields
    const lower = field.toLowerCase();
    if (lower.endsWith('_confidence') || lower.includes('confidence_')) {
      processed.add(field);
      continue;
    }

    // Check display config (per-doc-type hiding, pattern hiding, interest zero-value)
    if (!shouldDisplayField(field, value, docType)) {
      processed.add(field);
      continue;
    }

    // Find section: exact match → prefix match
    let section = FIELD_TO_SECTION[field] || FIELD_TO_SECTION[lower];
    if (!section) section = getSectionByPrefix(field);

    if (section) {
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section)!.push([field, value]);
      processed.add(field);
    }
  }

  // Second pass: remaining fields → "Other Information"
  for (const [field, value] of Object.entries(data)) {
    if (processed.has(field)) continue;
    if (isEmptyValue(value)) continue;

    const lower = field.toLowerCase().replace(/\s+/g, '_');
    if (SKIP_IN_OTHER.has(lower) || SKIP_IN_OTHER.has(field)) continue;
    if (lower.endsWith('_confidence') || lower.includes('confidence_')) continue;
    if (lower.startsWith('chain_of_title') || lower.startsWith('reservation_')) continue;
    if (/^_/.test(field) || /_normalized$/.test(field)) continue;

    // Skip string values that are essentially empty
    if (typeof value === 'string') {
      const t = value.trim().toLowerCase();
      if (t === '' || t === 'none' || t === 'n/a' || t === 'null' || t === 'undefined') continue;
    }

    if (!grouped.has('Other Information')) grouped.set('Other Information', []);
    grouped.get('Other Information')!.push([field, value]);
  }

  // Sort by section order
  const ordered = new Map<string, Array<[string, unknown]>>();
  for (const section of SECTION_ORDER) {
    if (grouped.has(section)) {
      ordered.set(section, grouped.get(section)!);
    }
  }
  // Add any sections not in the order list
  for (const [section, fields] of grouped) {
    if (!ordered.has(section)) {
      ordered.set(section, fields);
    }
  }

  return ordered;
}
