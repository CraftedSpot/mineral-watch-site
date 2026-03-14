/** Document categories — matches vanilla DOCUMENT_CATEGORIES */
export const DOCUMENT_CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'affidavit_of_heirship', label: 'Affidavit of Heirship' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'change_of_operator', label: 'Change of Operator' },
  { value: 'check_stubs', label: 'Check Stubs / Royalty Statements' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'death_certificate', label: 'Death Certificates' },
  { value: 'divorce_decree', label: 'Divorce Decrees' },
  { value: 'division_orders', label: 'Division Orders' },
  { value: 'estate_tax_release', label: 'Estate Tax Releases' },
  { value: 'drilling_and_spacing', label: 'Drilling & Spacing Orders (Vertical)' },
  { value: 'drilling_permits', label: 'Drilling Permits' },
  { value: 'horizontal_drilling_and_spacing', label: 'Horizontal Drilling & Spacing Orders' },
  { value: 'increased_density', label: 'Increased Density Orders' },
  { value: 'joa', label: 'Joint Operating Agreements' },
  { value: 'leases', label: 'Leases' },
  { value: 'lease_amendment', label: 'Lease Amendments' },
  { value: 'lease_extension', label: 'Lease Extensions' },
  { value: 'legal_documents', label: 'Legal Documents' },
  { value: 'location_exception', label: 'Location Exception Orders' },
  { value: 'maps_plats', label: 'Maps / Plats' },
  { value: 'mineral_deeds', label: 'Mineral Deeds' },
  { value: 'multi_document', label: 'Multi-Document PDFs' },
  { value: 'multi_unit_horizontal', label: 'Multi-Unit Horizontal Orders' },
  { value: 'pooling_orders', label: 'Pooling Orders' },
  { value: 'power_of_attorney', label: 'Power of Attorney' },
  { value: 'probate', label: 'Probate Documents' },
  { value: 'production_reports', label: 'Production Reports' },
  { value: 'ratification', label: 'Ratifications' },
  { value: 'release_of_lease', label: 'Release of Lease' },
  { value: 'right_of_way', label: 'Right of Way' },
  { value: 'royalty_deed', label: 'Royalty Deeds' },
  { value: 'suspense_notices', label: 'Suspense Notices' },
  { value: 'tax_records', label: 'Tax Records' },
  { value: 'title_opinions', label: 'Title Opinions' },
  { value: 'trust', label: 'Trust Documents' },
  { value: 'unitization_orders', label: 'Unitization Orders' },
  { value: 'well_completion_reports', label: 'Well Completion Reports' },
  { value: 'other', label: 'Other' },
] as const;

export interface SortOption {
  value: string;
  label: string;
}

/** Base sort options (always available) */
export const BASE_SORT_OPTIONS: SortOption[] = [
  { value: 'date-desc', label: 'Upload Date (Newest)' },
  { value: 'date-asc', label: 'Upload Date (Oldest)' },
];

/** Category-specific sort options — matches vanilla categoryOptions */
export const CATEGORY_SORT_OPTIONS: Record<string, SortOption[]> = {
  mineral_deeds: [
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'execution-date', label: 'Execution Date' },
    { value: 'recording-date', label: 'Recording Date' },
    { value: 'grantor', label: 'Grantor Name' },
    { value: 'grantee', label: 'Grantee Name' },
  ],
  royalty_deed: [
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'execution-date', label: 'Execution Date' },
    { value: 'grantor', label: 'Grantor Name' },
    { value: 'grantee', label: 'Grantee Name' },
  ],
  assignment: [
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'execution-date', label: 'Execution Date' },
    { value: 'assignor', label: 'Assignor Name' },
    { value: 'assignee', label: 'Assignee Name' },
  ],
  leases: [
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'lease-date', label: 'Lease Date' },
    { value: 'lessor', label: 'Lessor Name' },
    { value: 'lessee', label: 'Lessee Name' },
  ],
  pooling_orders: [
    { value: 'cause-number', label: 'Cause Number' },
    { value: 'county', label: 'County' },
    { value: 'order-date', label: 'Order Date' },
    { value: 'operator', label: 'Operator' },
    { value: 'formation', label: 'Formation' },
  ],
  drilling_and_spacing: [
    { value: 'cause-number', label: 'Cause Number' },
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'order-date', label: 'Order Date' },
    { value: 'unit-size', label: 'Unit Size (Acres)' },
    { value: 'formation', label: 'Formation' },
  ],
  horizontal_drilling_and_spacing: [
    { value: 'cause-number', label: 'Cause Number' },
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'order-date', label: 'Order Date' },
    { value: 'unit-size', label: 'Unit Size (Acres)' },
    { value: 'formation', label: 'Formation' },
    { value: 'operator', label: 'Operator' },
  ],
  check_stubs: [
    { value: 'payment-date', label: 'Payment Date' },
    { value: 'amount', label: 'Payment Amount' },
    { value: 'well', label: 'Well Name' },
  ],
  division_orders: [
    { value: 'effective-date', label: 'Effective Date' },
    { value: 'operator', label: 'Operator' },
    { value: 'interest-decimal', label: 'Interest Decimal' },
  ],
  title_opinions: [
    { value: 'county-trs', label: 'County & TRS' },
    { value: 'opinion-date', label: 'Opinion Date' },
    { value: 'attorney', label: 'Attorney/Firm' },
  ],
  correspondence: [
    { value: 'letter-date', label: 'Letter Date' },
    { value: 'sender', label: 'From' },
    { value: 'recipient', label: 'To' },
  ],
};
