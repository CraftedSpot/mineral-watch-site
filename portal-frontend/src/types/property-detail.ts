export interface LinkedWell {
  wellId: string;
  apiNumber: string;
  wellName: string;
  operator: string;
  county: string;
  linkStatus: string;
  linkId: string;
  wiNri: number | null;
  riNri: number | null;
  orriNri: number | null;
  matchReason: string;
  wellStatus: string;
  sectionAllocation?: number | null;
}

export interface LinkedDocument {
  id: string;
  displayName: string;
  docType: string;
  uploadDate: string;
}

export interface PropertySavePayload {
  notes: string;
  riAcres: number | string;
  wiAcres: number | string;
  riDecimal: string | null;
  wiDecimal: string | null;
  orriAcres: string | null;
  orriDecimal: string | null;
  miAcres: string | null;
  miDecimal: string | null;
}
