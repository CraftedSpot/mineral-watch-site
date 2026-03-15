import { GenericField } from './GenericField';
import { PartiesRenderer } from './renderers/parties';
import {
  ElectionOptionsRenderer,
  FormationsChips,
  TargetFormationsRenderer,
  ExistingWellsRenderer,
} from './renderers/occ-orders';
import {
  TractsRenderer,
  InterestConveyedRenderer,
  ReservationRenderer,
  PriorInstrumentsRenderer,
} from './renderers/deeds';
import {
  CheckStubWellRevenue,
  CheckStubSummary,
  OperatingExpensesRenderer,
} from './renderers/check-stubs';
import {
  UnitSectionsRenderer,
  AllocFactorsRenderer,
  WellsTableRenderer,
  LegalDescriptionRenderer,
} from './renderers/wells-units';
import {
  HeirsSummaryRenderer,
  ChildrenSpousesRenderer,
  DecedentRenderer,
} from './renderers/heirship';
import {
  DatesRenderer,
  WellTypeRenderer,
  WellIdentificationRenderer,
  InitialProductionRenderer,
  SurfaceLocationRenderer,
  BottomHoleLocationRenderer,
  LateralDetailsRenderer,
  FirstSalesRenderer,
  StimulationRenderer,
  PerforatedIntervalsRenderer,
  FormationTopsRenderer,
  FormationZonesRenderer,
  AffectedSectionsRenderer,
  ObjectSubfieldsRenderer,
} from './renderers/completion-reports';
import {
  PrimaryTermRenderer,
  ConsiderationRenderer,
  RoyaltyRenderer,
  DepthClauseRenderer,
  PughClauseRenderer,
  DeductionsClauseRenderer,
  ShutInProvisionsRenderer,
  ExhibitARenderer,
  PoolingProvisionsRenderer,
  ProhibitedDeductionsRenderer,
  ProvisionsRenderer,
} from './renderers/leases';

import type { PartyCorrection } from './renderers/parties';

interface Props {
  fieldName: string;
  value: unknown;
  docType?: string;
  partyCorrections?: Map<string, PartyCorrection>;
}

// Map field names to specialized renderers
type RendererFn = React.ComponentType<{ value: unknown; docType?: string; fieldName?: string; partyCorrections?: Map<string, PartyCorrection> }>;

const RENDERER_MAP: Record<string, RendererFn> = {
  // Parties
  grantors: PartiesRenderer,
  grantees: PartiesRenderer,
  lessors: PartiesRenderer,
  lessees: PartiesRenderer,
  lessor: PartiesRenderer,
  lessee: PartiesRenderer,
  assignors: PartiesRenderer,
  assignees: PartiesRenderer,
  assignor: PartiesRenderer,
  assignee: PartiesRenderer,
  // OCC Orders
  election_options: ElectionOptionsRenderer,
  formations: FormationsChips,
  target_formations: TargetFormationsRenderer,
  existing_wells: ExistingWellsRenderer,
  // Deeds
  tracts: TractsRenderer,
  interest_conveyed: InterestConveyedRenderer,
  reservation: ReservationRenderer,
  prior_instruments: PriorInstrumentsRenderer,
  // Check Stubs
  wells: CheckStubWellRevenue,
  summary: CheckStubSummary,
  operating_expenses: OperatingExpensesRenderer,
  // Wells & Units
  unit_sections: UnitSectionsRenderer,
  allocation_factors: AllocFactorsRenderer,
  legal_description: LegalDescriptionRenderer,
  // Heirship
  heirs_summary: HeirsSummaryRenderer,
  children_living: ChildrenSpousesRenderer,
  children_predeceased: ChildrenSpousesRenderer,
  spouses: ChildrenSpousesRenderer,
  decedent: DecedentRenderer,
  // Completion Reports
  dates: DatesRenderer,
  well_type: WellTypeRenderer,
  well_identification: WellIdentificationRenderer,
  initial_production: InitialProductionRenderer,
  surface_location: SurfaceLocationRenderer,
  bottom_hole_location: BottomHoleLocationRenderer,
  lateral_details: LateralDetailsRenderer,
  first_sales: FirstSalesRenderer,
  stimulation: StimulationRenderer,
  perforated_intervals: PerforatedIntervalsRenderer,
  formation_tops: FormationTopsRenderer,
  formation_zones: FormationZonesRenderer,
  affected_sections: AffectedSectionsRenderer,
  // Leases
  primary_term: PrimaryTermRenderer,
  consideration: ConsiderationRenderer,
  royalty: RoyaltyRenderer,
  depth_clause: DepthClauseRenderer,
  pugh_clause: PughClauseRenderer,
  deductions_clause: DeductionsClauseRenderer,
  shut_in_provisions: ShutInProvisionsRenderer,
  exhibit_a: ExhibitARenderer,
  pooling_provisions: PoolingProvisionsRenderer,
  prohibited_deductions: ProhibitedDeductionsRenderer,
  provisions: ProvisionsRenderer,
};

// Fields that dispatch differently based on doc type
function getRenderer(fieldName: string, value: unknown, docType?: string): RendererFn | null {
  // 'wells' field: CheckStubWellRevenue for check stubs, WellsTableRenderer for transfers
  if (fieldName === 'wells') {
    const isCheckStub = docType?.includes('check_stub') || docType?.includes('royalty_statement');
    if (isCheckStub) return CheckStubWellRevenue;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      return WellsTableRenderer;
    }
    return null;
  }

  // 'summary' field: only for check stubs
  if (fieldName === 'summary') {
    const isCheckStub = docType?.includes('check_stub') || docType?.includes('royalty_statement');
    return isCheckStub ? CheckStubSummary : null;
  }

  // Check the static map first
  if (RENDERER_MAP[fieldName]) return RENDERER_MAP[fieldName];

  // For unrecognized objects, use the sub-fields renderer (vanilla fallback)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return ObjectSubfieldsRenderer;
  }

  return null;
}

export function FieldRenderer({ fieldName, value, docType, partyCorrections }: Props) {
  const Renderer = getRenderer(fieldName, value, docType);

  if (Renderer) {
    return <Renderer value={value} docType={docType} fieldName={fieldName} partyCorrections={partyCorrections} />;
  }

  return <GenericField fieldName={fieldName} value={value} />;
}
