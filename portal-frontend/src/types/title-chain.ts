// ─── API Response Types ─────────────────────────────────────────

/** Property with chain-of-title documents */
export interface ChainProperty {
  id: string;
  airtableRecordId: string;
  county: string;
  section: string;
  township: string;
  range: string;
  chainDocCount: number;
}

/** Single document in the chain response */
export interface ChainDocument {
  id: string;
  displayName: string;
  docType: string | null;
  category: string | null;
  date: string | null;
  dateSource: string | null;
  parties: Array<{ name: string; role: string }>;
  interestConveyed: string | null;
  summary: string | null;
  r2Key: string | null;
}

/** Tree node from assembleTree() in portal-worker */
export interface TreeNode {
  id: string;
  docType: string | null;
  category: string | null;
  date: string | null;
  displayName: string;
  fromNames: string[];
  toNames: string[];
  interestConveyed: string | null;
  recording: { book: string | null; page: string | null } | null;
  edgeType: string | null;
  matchType: string | null;
  matchConfidence: number | null;
  stackedDocs: string[];
  children: TreeNode[];
}

/** Current owner from chain_current_owners */
export interface ChainOwnerRow {
  owner_name: string;
  owner_name_normalized: string;
  acquired_via_doc_id: string | null;
  acquired_date: string | null;
  interest_text: string | null;
  interest_decimal: number | null;
  interest_type: string | null;
}

/** Gap in chain (missing link) */
export interface ChainGap {
  partyName: string;
  lastSeenAs: string;
  lastSeenDocId: string;
  lastSeenDate: string | null;
}

/** Full tree structure from API */
export interface TitleTree {
  roots: TreeNode[];
  gaps: ChainGap[];
  currentOwners: ChainOwnerRow[];
  orphanDocIds: string[];
  stats: {
    totalDocs: number;
    linkedDocs: number;
    stackedGroups: number;
    gapCount: number;
    ownerCount: number;
  };
}

/** Property detail in API response */
export interface PropertyDetail {
  id: string;
  airtableRecordId: string;
  county: string;
  section: string;
  township: string;
  range: string;
  legal: string;
}

/** GET /api/property/:id/title-chain?include_tree=1 response */
export interface TitleChainResponse {
  success: boolean;
  property: PropertyDetail;
  documents: ChainDocument[];
  partyDataGaps: number;
  unlinkedDocuments: ChainDocument[];
  pendingDuplicates: any[];
  pendingDuplicateCount: number;
  tree?: TitleTree;
  queryTime: number;
}

/** GET /api/title-chain/properties response */
export interface TitleChainPropertiesResponse {
  success: boolean;
  properties: ChainProperty[];
  unlinkedCount: number;
  queryTime: number;
}

// ─── Flat Node Types (for layout engine) ────────────────────────

/** Flat node for the layout engine (transformed from API TreeNode) */
export interface FlatNode {
  id: string;
  type: 'document' | 'stack' | 'gap' | 'current';
  docType?: string;
  date?: string | null;
  grantor?: string;
  grantee?: string;
  interestConveyed?: string | null;
  children: string[];
  // Stack-specific
  docs?: FlatStackDoc[];
  label?: string;
  // Gap-specific
  dateRange?: string;
  description?: string;
  suggestion?: string;
  // Current owner-specific
  owner?: string;
  interest?: string;
  interestDecimal?: number | null;
  interestType?: string | null;
  acquiredDate?: string | null;
  acquiredViaDocId?: string | null;
  // Source tree node reference
  _treeNode?: TreeNode;
}

/** Document within a stack */
export interface FlatStackDoc {
  id: string;
  docType: string;
  date: string | null;
  grantor: string;
  grantee: string;
  interestConveyed?: string | null;
  _treeNode?: TreeNode;
}

/** Layout computation result */
export interface LayoutResult {
  positions: Record<string, NodePosition>;
  expandedCardPositions: Record<string, ExpandedCardPosition>;
  edges: LayoutEdge[];
  width: number;
  height: number;
  nodeMap: Record<string, FlatNode>;
  maxLevel: number;
}

export interface NodePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExpandedCardPosition extends NodePosition {
  parentStackId: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
  isGap: boolean;
}
