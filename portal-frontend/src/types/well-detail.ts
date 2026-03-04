export interface WellEnrichment {
  section: string;
  township: string;
  range: string;
  county: string;
  formation_name: string;
  formation_canonical: string;
  formation_group: string;
  well_status: string;
  well_type: string;
  operator: string;
  well_name: string;
  measured_total_depth: string;
  ip_oil_bbl: number | null;
  ip_gas_mcf: number | null;
  operator_phone: string;
  operator_contact: string;
  clientWellId?: string;
  is_horizontal?: boolean;
}

export interface LinkedProperty {
  propertyId: string;
  location: string;
  group: string;
  nma: number | null;
  county: string;
  acres: number | null;
  matchReason: string;
  linkStatus: string;
}

export interface ProductionSummary {
  hasPun: boolean;
  pun: string | null;
  production: {
    lastMonth: { formatted: string; oil: number; gas: number } | null;
    last12Mo: { oil: number; gas: number } | null;
    lifetime: { oil: number; gas: number } | null;
    monthsProduced: number;
  } | null;
  status: 'active' | 'recently_idle' | 'extended_idle' | 'no_recent_production' | null;
  trend: {
    direction: 'up' | 'down' | 'flat';
    yoyChange: number;
  } | null;
  sparkline: number[];
  sparklineMonths: string[];
  sparklineBOE: number;
}

export interface CompletionReport {
  entryId: string;
  formType: '1002A' | '1002C';
  effectiveDate: string;
  status: string;
  wellName: string;
  location: string;
  county: string;
  pun: string;
  documentId: string | null;
  errorMessage: string | null;
}

export interface DrillingPermit {
  entryId: string;
  effectiveDate: string;
  status: string;
  wellName: string;
  location: string;
  county: string;
  documentId: string | null;
  errorMessage: string | null;
}

export interface DocketEntry {
  caseNumber: string;
  orderNumber: string;
  reliefTypeDisplay: string;
  applicant: string;
  status: string;
  statusDisplay: string;
  hearingDate: string;
  docketDate: string;
  section: string;
  township: string;
  range: string;
}

export interface OccProcessResult {
  success: boolean;
  alreadyProcessed: boolean;
  document?: { id: string; status: string; display_name: string };
  creditsRemaining?: number;
  error?: string;
}
