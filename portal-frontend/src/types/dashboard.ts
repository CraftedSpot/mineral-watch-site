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
  well_name: string;
  apiNumber: string;
  operator: string;
  county: string;
  section: string;
  township: string;
  range: string;
  occ_well_status: string;
  occ_well_type: string;
  formation: string;
  is_horizontal: boolean;
  ri_nri: number | null;
  wi_nri: number | null;
  orri_nri: number | null;
  notes: string;
  created_at: string;
  otc_last_prod_month: string | null;
  user_well_code: string | null;
  _linkCounts?: {
    properties: number;
    documents: number;
    filings: number;
  };
}

/** Document record from /api/documents */
export interface DocumentRecord {
  id: string;
  file_name: string;
  document_type: string;
  status: string;
  created_at: string;
  property_id: string | null;
  well_id: string | null;
  credits_used: number;
  [key: string]: unknown;
}

/** Activity record from /api/activity */
export interface ActivityRecord {
  id: string;
  activity_type: string;
  alert_level: string;
  api_number: string;
  well_name: string;
  notes: string;
  created_at: string;
  email_sent: boolean;
  [key: string]: unknown;
}

/** Dashboard summary counts */
export interface DashboardCounts {
  properties: number;
  wells: number;
  documents: number;
  activities: number;
}
