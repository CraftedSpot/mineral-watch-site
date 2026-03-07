/** Property record from /api/properties/v2 (Airtable-shaped) */
export interface PropertyRecord {
  id: string;
  createdTime: string;
  fields: {
    COUNTY?: string;
    SEC?: string;
    TWN?: string;
    RNG?: string;
    Meridian?: string;
    'RI Acres'?: number;
    'WI Acres'?: number;
    Notes?: string;
    entity_name?: string;
    property_code?: string;
    [key: string]: unknown;
  };
  _linkCounts?: {
    wells: number;
    documents: number;
    filings: number;
  };
}

/** Well record from /api/wells/v2 (flat shape) */
export interface WellRecord {
  id: string;
  createdTime: string;
  well_name: string;
  well_number: string;
  apiNumber: string;
  operator: string;
  county: string;
  section: string;
  township: string;
  range: string;
  meridian: string;
  well_type: string;
  well_status: string;
  latitude: number | null;
  longitude: number | null;
  notes: string;
  userStatus: string;

  // Formation & depth
  formation_name: string | null;
  formation_canonical: string | null;
  formation_group: string | null;
  formation_depth: number | null;
  measured_total_depth: number | null;
  true_vertical_depth: number | null;
  lateral_length: number | null;

  // Dates
  spud_date: string | null;
  completion_date: string | null;
  first_production_date: string | null;
  created_at: string;

  // Initial production
  ip_oil_bbl: number | null;
  ip_gas_mcf: number | null;
  ip_water_bbl: number | null;

  // Bottom hole (horizontal)
  bh_latitude: number | null;
  bh_longitude: number | null;
  bh_section: string | null;
  bh_township: string | null;
  bh_range: string | null;

  // Operator contact
  operator_phone: string | null;
  operator_contact: string | null;

  // OTC production
  otc_total_oil: number | null;
  otc_total_gas: number | null;
  otc_last_prod_month: string | null;
  otc_is_stale: number | null;

  // Interests
  ri_nri: number | null;
  wi_nri: number | null;
  orri_nri: number | null;
  // NRI component fields (RI-scoped)
  net_mineral_acres: number | null;
  unit_acres: number | null;
  lease_royalty_rate: number | null;
  lease_royalty_fraction: string | null;
  tract_participation: number | null;

  // Enterprise
  user_well_code: string | null;
  tracking_source: string;
  occMapLink: string;
  hasD1Data: boolean;

  // Risk
  risk_profile_name: string | null;
  half_cycle_breakeven: number | null;
  is_gas_flag: number;

  _linkCounts?: {
    properties: number;
    documents: number;
    filings: number;
  };
}

/** Document record from /api/documents (documents-worker D1 shape) */
export interface DocumentRecord {
  id: string;
  filename: string;
  display_name: string | null;
  doc_type: string | null;
  status: string;
  upload_date: string;
  county: string | null;
  section: string | null;
  township: string | null;
  range: string | null;
  confidence: string | null;
  page_count: number | null;
  file_size: number | null;
  content_type: string | null;
  category: string | null;
  enhanced_extraction: number | null;
  parent_document_id: string | null;
  extracted_data: string | Record<string, unknown> | null;
  user_notes: string | null;
  [key: string]: unknown;
}

/** Activity record from /api/activity (Airtable-shaped: { id, fields }) */
export interface ActivityRecord {
  id: string | number;
  fields: {
    'Well Name'?: string;
    'API Number'?: string;
    'Activity Type'?: string;
    'Alert Level'?: string;
    'Operator'?: string;
    'Previous Operator'?: string;
    'County'?: string;
    'Section-Township-Range'?: string;
    'Formation'?: string;
    'OCC Link'?: string;
    'OCC Map Link'?: string;
    'Map Link'?: string;
    'Previous Value'?: string;
    'New Value'?: string;
    'Detected At'?: string;
    'Notes'?: string;
    'Case Number'?: string;
    trackWellUrl?: string;
    [key: string]: unknown;
  };
}

/** Dashboard summary counts */
export interface DashboardCounts {
  properties: number;
  wells: number;
  documents: number;
  activities: number;
}
