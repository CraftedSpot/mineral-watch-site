/**
 * Extraction Prompts for County Records
 *
 * Ported from processor/mineral-watch-processor/src/extractor.py
 * Same battle-tested prompts used for user-uploaded documents.
 *
 * Two-pass extraction architecture:
 * - Pass 1: classifyDocument() determines doc_type from content (Sonnet classification)
 * - Pass 2: getExtractionPrompt(doc_type) selects focused prompt for full extraction
 *
 * 15 focused prompts covering all major Oklahoma mineral document types.
 * GENERIC prompt as fallback for unrecognized types.
 */

// =============================================================================
// Doc type arrays — match processor's routing sets exactly
// =============================================================================

export const LEASE_DOC_TYPES = ['oil_gas_lease', 'oil_and_gas_lease', 'lease', 'lease_amendment',
  'lease_extension', 'lease_ratification', 'memorandum_of_lease'];

export const DEED_DOC_TYPES = ['mineral_deed', 'royalty_deed', 'warranty_deed', 'quitclaim_deed',
  'quit_claim_deed', 'gift_deed', 'assignment', 'trust_funding', 'assignment_of_lease'];

export const POOLING_DOC_TYPES = ['pooling_order', 'force_pooling_order'];

export const DIVISION_ORDER_DOC_TYPES = ['division_order'];

export const CHECK_STUB_DOC_TYPES = ['check_stub', 'check'];

export const JIB_DOC_TYPES = ['joint_interest_billing'];

export const SPACING_DOC_TYPES = ['spacing_order', 'drilling_and_spacing_order',
  'horizontal_drilling_and_spacing_order', 'increased_density_order'];

export const LOCATION_EXCEPTION_DOC_TYPES = ['location_exception_order'];

export const PERMIT_DOC_TYPES = ['completion_report', 'drilling_permit', 'well_transfer'];

export const CORRESPONDENCE_DOC_TYPES = ['correspondence', 'letter', 'email', 'notice', 'transmittal'];

export const JOA_DOC_TYPES = ['joa', 'joint_operating_agreement'];

export const TITLE_OPINION_DOC_TYPES = ['title_opinion'];

export const HEIRSHIP_DOC_TYPES = ['affidavit_of_heirship', 'death_certificate', 'probate'];

export const LEASE_PRODUCTION_DOC_TYPES = ['lease_production', 'production_record', 'production_summary'];

// Chain-of-title doc types — single source of truth.
// Documents with these types get chain_of_title = 1 and appear on the title page.
export const CHAIN_OF_TITLE_TYPES = new Set([
  'title_opinion', 'oil_gas_lease', 'lease', 'mineral_deed', 'royalty_deed',
  'gift_deed', 'quit_claim_deed', 'assignment', 'assignment_of_lease',
  'lease_assignment', 'assignment_and_bill_of_sale', 'subordination_agreement',
  'memorandum_of_lease', 'lease_amendment', 'death_certificate',
  'affidavit_of_heirship', 'trust_funding', 'probate', 'well_transfer',
  'divorce_decree', 'estate_tax_release', 'tax_release',
]);

// =============================================================================
// Primary router — routes by classified doc_type (from Pass 1 classification)
// =============================================================================

export function getExtractionPrompt(docType?: string): string {
  if (!docType) return GENERIC_EXTRACTION_PROMPT;
  const t = docType.toLowerCase().trim();

  if (LEASE_DOC_TYPES.includes(t)) return LEASE_EXTRACTION_PROMPT;
  if (DEED_DOC_TYPES.includes(t)) return DEED_EXTRACTION_PROMPT;
  if (POOLING_DOC_TYPES.includes(t)) return POOLING_EXTRACTION_PROMPT;
  if (DIVISION_ORDER_DOC_TYPES.includes(t)) return DIVISION_ORDER_EXTRACTION_PROMPT;
  if (CHECK_STUB_DOC_TYPES.includes(t)) return CHECK_STUB_EXTRACTION_PROMPT;
  if (JIB_DOC_TYPES.includes(t)) return JIB_EXTRACTION_PROMPT;
  if (SPACING_DOC_TYPES.includes(t)) return SPACING_EXTRACTION_PROMPT;
  if (LOCATION_EXCEPTION_DOC_TYPES.includes(t)) return LOCATION_EXCEPTION_EXTRACTION_PROMPT;
  if (PERMIT_DOC_TYPES.includes(t)) return PERMIT_EXTRACTION_PROMPT;
  if (CORRESPONDENCE_DOC_TYPES.includes(t)) return CORRESPONDENCE_EXTRACTION_PROMPT;
  if (JOA_DOC_TYPES.includes(t)) return JOA_EXTRACTION_PROMPT;
  if (TITLE_OPINION_DOC_TYPES.includes(t)) return TITLE_OPINION_EXTRACTION_PROMPT;
  if (HEIRSHIP_DOC_TYPES.includes(t)) return HEIRSHIP_EXTRACTION_PROMPT;
  if (LEASE_PRODUCTION_DOC_TYPES.includes(t)) return LEASE_PRODUCTION_EXTRACTION_PROMPT;

  return GENERIC_EXTRACTION_PROMPT;
}

// =============================================================================
// Fallback router — routes by OKCR instrumentType keyword matching
// Used when Pass 1 classification fails or is skipped
// =============================================================================

export function getExtractionPromptByInstrumentType(instrumentType?: string): string {
  if (!instrumentType) return GENERIC_EXTRACTION_PROMPT;

  const normalized = instrumentType.toLowerCase().trim();

  if (
    normalized.includes('lease') ||
    normalized.includes('memorandum') ||
    normalized.includes('ratification')
  ) {
    return LEASE_EXTRACTION_PROMPT;
  }

  if (
    normalized.includes('deed') ||
    normalized.includes('assignment') ||
    normalized.includes('trust') ||
    normalized.includes('quit claim') ||
    normalized.includes('quitclaim') ||
    normalized.includes('conveyance')
  ) {
    return DEED_EXTRACTION_PROMPT;
  }

  if (
    normalized.includes('pooling') ||
    normalized.includes('force pool')
  ) {
    return POOLING_EXTRACTION_PROMPT;
  }

  if (
    normalized.includes('spacing') ||
    normalized.includes('density')
  ) {
    return SPACING_EXTRACTION_PROMPT;
  }

  if (normalized.includes('location exception')) {
    return LOCATION_EXCEPTION_EXTRACTION_PROMPT;
  }

  if (
    normalized.includes('division order') ||
    normalized.includes('do ')
  ) {
    return DIVISION_ORDER_EXTRACTION_PROMPT;
  }

  if (
    normalized.includes('permit') ||
    normalized.includes('completion') ||
    normalized.includes('well transfer')
  ) {
    return PERMIT_EXTRACTION_PROMPT;
  }

  return GENERIC_EXTRACTION_PROMPT;
}

/**
 * Inject current date into prompt.
 * The prompts use {current_date} as a placeholder for date-aware analysis.
 */
export function preparePrompt(prompt: string): string {
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0];
  return prompt.replace(/\{current_date\}/g, currentDate);
}

// =============================================================================
// LEASE EXTRACTION PROMPT
// Source: extractor.py lines 7244-7623 (LEASE_EXTRACTION_PROMPT_TEMPLATE)
// =============================================================================

const LEASE_EXTRACTION_PROMPT = `You are an experienced mineral rights attorney specializing in oil & gas lease review.
Your task is to extract comprehensive lease terms and identify protective clauses that affect mineral owner rights.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Calculate expiration dates based on primary term + commencement date
- Note if primary term has already expired as of CURRENT DATE

EXPIRATION DATE CALCULATION - CRITICAL FOR MINERAL OWNERS:
1. Identify the PRIMARY TERM START DATE:
   - Usually the execution_date
   - Sometimes a separate "effective_date" is specified - use that if present
   - Look for language like "for a term of X years from [date]"
2. Add the primary term duration (years/months) to get expiration_date
3. If CURRENT DATE is past expiration_date, check for:
   - HELD BY PRODUCTION (HBP): "as long thereafter as oil or gas is produced"
   - Note in detailed_analysis: "Primary term expired [date]. Lease may be HBP if production exists."
4. Look for EXTENSION or RENEWAL clauses that could modify expiration

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - State lessor, lessee, acreage, county, royalty rate
   - Note key protective clauses present OR ABSENT
   - Flag if primary term has expired

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights attorney
   - Explain implications of each major clause for the mineral owner
   - EXPLICITLY NOTE ABSENT CLAUSES - this is critical for mineral owners
   - Discuss current status if primary term has expired
   - Note any anti-Pugh language that could defeat Pugh clause benefits

For EACH field you extract:
1. Provide the value (or null if not found)

HANDWRITTEN DOCUMENT RULES:
- If you cannot clearly read handwritten characters, use null
- NEVER hallucinate plausible-sounding values for illegible handwritten text
- It is BETTER to return null than to guess incorrectly

BOOLEAN FLAGS FOR ABSENT CLAUSES - CRITICAL:
For protective clause fields (depth_clause, pugh_clause, deductions_clause):
- If you search the ENTIRE document and find NO such clause: set has_X_clause: FALSE with HIGH CONFIDENCE
- Do NOT leave these as null - mineral owners need to know when protection is ABSENT
- Example: If no Pugh clause exists anywhere in the document, set:
  "pugh_clause": { "has_pugh_clause": false }

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)
- QUARTERS: Read from smallest to largest (e.g., "NE/4 SW/4" = NE quarter of the SW quarter)

COMMON MISTAKE TO AVOID:
- If you extract a township like "25N" or "36N", STOP - you likely confused section number with township
- Township numbers are typically 1-30. Section numbers are 1-36.

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPES FOR THIS PROMPT: oil_gas_lease, lease_amendment, lease_extension
=============================================================================

For OIL AND GAS LEASES:
Extract comprehensive lease terms. Pay special attention to Exhibit A or Addendum which may override printed form.

DOCUMENT IDENTIFICATION:
- Title contains "OIL AND GAS LEASE", "LEASE AGREEMENT", "PAID-UP OIL AND GAS LEASE"
- May reference a printed form: "Hefner Form", "AAPL Form 675", "Producer's 88"
- Has LESSOR (mineral owner) and LESSEE (oil company) parties
- Contains legal description, primary term, royalty provisions
- May have Exhibit A or Addendum with additional terms

LEASE SUBTYPES:
- "oil_gas_lease": Standard new lease
- "lease_amendment": Modifies specific clauses of existing lease (references original by recording info)
- "lease_extension": Extends primary term of existing lease
- "lease_ratification": Confirms/ratifies existing lease (often for title curative)
- "memorandum_of_lease": Short-form recording notice (extract what's stated, note limited info)

CRITICAL INSTRUCTIONS:
1. CHECK FOR EXHIBIT A - Many leases have an Exhibit A that modifies the printed form. Look for:
   - "See Exhibit A attached hereto"
   - Separate page titled "Exhibit A" or "Addendum"
   - Depth Clause, Pugh Clause, Shut-In Limitation, No Deductions Clause
2. EXTRACT ALL TRACTS - Missing tracts break property linking
3. CALCULATE EXPIRATION DATE - Add primary term years to commencement date
4. NOTE ABSENT CLAUSES - Set has_X_clause: false when clause is NOT present (don't leave null)

ROYALTY EXTRACTION - PROVIDE BOTH FORMATS:
Extract royalty as BOTH fraction (original document language) AND decimal (for computation):
| Fraction | Decimal |
|----------|---------|
| 1/8 | 0.125 |
| 1/6 | 0.166667 |
| 3/16 | 0.1875 |
| 1/5 | 0.20 |
| 1/4 | 0.25 |
| 1/3 | 0.333333 |

IMPORTANT: The example below uses FICTIONAL names and addresses for illustration only.
NEVER use any names, addresses, or values from the example in your extraction.
Extract ONLY what appears in the actual document.

EXAMPLE EXTRACTION:
{
  "doc_type": "oil_gas_lease",
  "lease_form": "Hefner Form or AAPL Form 675 or omit if unknown",

  "lessor": {
    "name": "REQUIRED - Redrock Minerals, Ltd.",
    "address": "4200 N. Western Avenue",
    "city": "Tulsa",
    "state": "OK",
    "zip": "74127",
    "capacity": "Mineral Owner|Trustee|Personal Representative|Guardian|Attorney-in-Fact|Manager|President",
    "signatory": "Thomas R. Harmon - person who signed if different from entity",
    "signatory_title": "Manager - title if signing in representative capacity"
  },

  "lessee": {
    "name": "REQUIRED - Plainview Energy, LLC",
    "address": "900 S. Broadway Avenue",
    "city": "Edmond",
    "state": "OK",
    "zip": "73013"
  },

  "execution_date": "REQUIRED - 2016-08-09",
  "effective_date": "omit if same as execution_date",

  "recording_info": {
    "book": "L-350",
    "page": "125",
    "instrument_number": "2016-12345",
    "recording_date": "2016-08-15",
    "county": "REQUIRED - Blaine",
    "state": "Oklahoma"
  },

  "section": "REQUIRED - integer from first tract, e.g. 20",
  "township": "REQUIRED - string with direction from first tract, e.g. 16N",
  "range": "REQUIRED - string with direction from first tract, e.g. 13W",
  "county": "REQUIRED - from first tract or recording_info, e.g. Blaine",
  "state": "Oklahoma",

  "tracts": [
    {
      "tract_number": 1,
      "legal_description": {
        "section": 20,
        "township": "16N",
        "range": "13W",
        "meridian": "IM",
        "county": "Blaine",
        "state": "Oklahoma",
        "quarters": "SW/4 SE/4"
      },
      "acres": 40.0,
      "acres_qualifier": "more or less",
      "depths_limited": false,
      "formations_limited": null,
      "mineral_interest_fraction": "1/2 - only if lessor owns partial minerals"
    }
  ],

  "primary_term": {
    "years": 3,
    "months": 0,
    "commencement_date": "REQUIRED - 2016-08-09",
    "expiration_date": "REQUIRED - 2019-08-09",
    "held_by_production": false,
    "extension_provisions": null
  },

  "consideration": {
    "bonus_stated": "REQUIRED - $10.00 and other good and valuable consideration",
    "bonus_per_acre": 500.00,
    "total_bonus": 20000.00,
    "is_paid_up": true,
    "delay_rental": "REQUIRED if is_paid_up is false",
    "delay_rental_per_acre": 10.00,
    "delay_rental_due_date": "anniversary of lease"
  },

  "royalty": {
    "oil": {
      "fraction": "REQUIRED - 1/4",
      "decimal": 0.25
    },
    "gas": {
      "fraction": "REQUIRED - 1/4",
      "decimal": 0.25
    },
    "other_minerals": {
      "fraction": "1/10",
      "decimal": 0.10,
      "note": "sulphur $1.00 per long ton"
    }
  },

  "pooling_provisions": {
    "lessee_has_pooling_rights": true,
    "pooling_type": "lessee option|requires lessor consent|OCC only",
    "vertical_oil_well": {
      "max_acres": 80,
      "tolerance": "10%"
    },
    "gas_or_horizontal_well": {
      "max_acres": 640,
      "tolerance": "10%"
    },
    "governmental_override": true,
    "allocation_method": "surface acres|net mineral acres",
    "pugh_clause_limits_pooling": true,
    "anti_pugh_language": false,
    "anti_pugh_text": "quote the language if present"
  },

  "habendum_clause": {
    "cessation_period_days": 180,
    "continuous_operations": true,
    "operations_definition": "drilling, reworking, or production"
  },

  "shut_in_provisions": {
    "shut_in_royalty": "$1.00 per acre",
    "shut_in_royalty_per_acre": 1.00,
    "trigger_period_days": 90,
    "payment_frequency": "annual",
    "limitation": {
      "has_limitation": true,
      "max_consecutive_years": 2,
      "source": "Exhibit A"
    }
  },

  "depth_clause": {
    "has_depth_clause": true,
    "trigger": "extended solely by commercial production beyond primary term",
    "depth_retained": "100 feet below stratigraphic equivalent of base of deepest penetrated formation",
    "depth_feet": null,
    "reference_point": "deepest penetrated formation",
    "source": "Exhibit A"
  },

  "pugh_clause": {
    "has_pugh_clause": true,
    "type": "Corporation Commission unit|production unit|voluntary pooling",
    "trigger": "expiration of primary term",
    "releases": "portions not in OCC unit and not producing or drilling",
    "horizontal_pugh": true,
    "vertical_pugh": false,
    "unit_change_provision": "90 days to develop or release if unit boundaries change",
    "source": "Exhibit A"
  },

  "deductions_clause": {
    "has_no_deductions_clause": true,
    "scope": "all post-production costs",
    "prohibited_deductions": ["producing", "gathering", "storing", "separating", "treating", "dehydrating", "compressing", "processing", "transporting", "marketing"],
    "exception": "value-enhancing costs if reasonable and based on actual cost",
    "source": "Exhibit A"
  },

  "continuous_development_clause": {
    "has_continuous_development": false,
    "period_between_wells_days": null,
    "wells_required": null,
    "penalty_for_breach": null,
    "applies_after": null
  },

  "top_lease_provision": {
    "has_top_lease_rofr": true,
    "response_period_days": 15,
    "trigger": "bona fide offer during primary term",
    "matching_required": true,
    "notice_requirements": null
  },

  "force_majeure": {
    "has_force_majeure": true,
    "extension_period": "first anniversary 90+ days after removal of delay",
    "excluded_causes": ["financial"],
    "included_causes": ["war", "strikes", "regulations", "acts of God"]
  },

  "surface_use": {
    "water_use_free_of_royalty": true,
    "setback_from_house_feet": 200,
    "setback_from_barn_feet": 200,
    "no_surface_operations": false,
    "surface_use_limited_to_acres": null,
    "designated_drill_site": null,
    "surface_damage_payment": {
      "required": true,
      "amount": null,
      "basis": "damages to growing crops and timber"
    },
    "restoration_required": true
  },

  "assignment_status": {
    "original_lessee": "Plainview Energy, LLC",
    "current_holder": null,
    "has_been_assigned": false,
    "assignment_noted_on_document": false,
    "note": null
  },

  "exhibit_a": {
    "has_exhibit_a": true,
    "provisions": ["Depth Clause", "Pugh Clause", "Shut-In Royalty Limitation (2 years)", "No Deductions Clause"],
    "controls_over_printed_form": true,
    "additional_terms": null
  },

  "underlying_lease": {
    "note": "FOR AMENDMENTS/EXTENSIONS ONLY - reference to original lease",
    "original_lessor": null,
    "original_lessee": null,
    "original_date": null,
    "recording_book": null,
    "recording_page": null,
    "instrument_number": null
  },

  "notarization": {
    "notary_name": "Jane Doe",
    "notary_date": "2016-08-09",
    "commission_number": "12345678",
    "commission_expires": "2020-03-15"
  },

  "notes": "any additional information not captured elsewhere",

  "key_takeaway": "REQUIRED - One sentence: 3-year paid-up lease from [Lessor] to [Lessee] covering [acres] acres in [quarters] of Section [S]-[T]-[R], [County] County, with [royalty] royalty and [key provisions or 'standard form with no protective clauses'].",

  "detailed_analysis": "REQUIRED - 3-5 paragraphs covering: (1) parties, date, legal description; (2) primary term and consideration; (3) royalty and economic terms; (4) protective clauses PRESENT and ABSENT - explicitly note if Pugh, depth, no-deductions clauses are missing; (5) current status if primary term has expired."
}

=============================================================================
EXTRACTION NOTES FOR OIL AND GAS LEASES:
=============================================================================

IMPORTANT FOR LEASES WITHOUT PROTECTIVE CLAUSES:
If no Exhibit A or addendum exists, set these with HIGH CONFIDENCE (not null):
- depth_clause.has_depth_clause: false
- pugh_clause.has_pugh_clause: false
- deductions_clause.has_no_deductions_clause: false
- exhibit_a.has_exhibit_a: false

ANTI-PUGH LANGUAGE DETECTION:
Check pooling clauses for language that defeats Pugh clause benefits:
- "Production from a pooled unit shall maintain this lease as to all lands covered hereby"
- "Pooling shall extend this lease as to all lands"
- "Unitization shall have the effect of maintaining this lease in its entirety"
If found, set pooling_provisions.anti_pugh_language: true and quote in anti_pugh_text.

DETAILED_ANALYSIS REQUIREMENTS:
For leases WITHOUT protective clauses, detailed_analysis MUST note:
"This lease uses a standard printed form with NO Exhibit A. Notably absent are: a Pugh clause (non-pooled acreage is NOT automatically released), a depth clause (lessee retains all depths), and a no-deductions clause (post-production costs may be deducted from royalty)."

FOR LEASE AMENDMENTS/EXTENSIONS:
- Set doc_type to "lease_amendment" or "lease_extension" as appropriate
- Extract the underlying_lease reference (original recording info)
- Focus on what's being CHANGED, not restating the entire original lease
- Note which clauses are modified

TOP-LEVEL TRS FIELDS:
Always include top-level section, township, range, county fields from the FIRST tract.
These are REQUIRED for property linking - the dashboard uses these to match documents to properties.`;

// =============================================================================
// DEED EXTRACTION PROMPT
// Source: extractor.py lines 8764-9039 (DEED_EXTRACTION_PROMPT_TEMPLATE)
// =============================================================================

const DEED_EXTRACTION_PROMPT = `You are a specialized document processor for Oklahoma mineral rights deeds and conveyances.
Your task is to extract key information from the document. Return raw values directly - do NOT wrap values in confidence objects.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Only comment on dates if they conflict with OTHER dates in the SAME document

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Lead with actions needed, if any
   - Answer: what does this mean for the mineral owner?
   - ALWAYS identify the parties by name
   - Mention county when relevant for geographic context

   DETAILED ANALYSIS:
   - Write as an experienced title attorney providing insight
   - Focus on what's genuinely significant for chain of title
   - Only reference information explicitly stated in the document
   - DO NOT list specific data already extracted - focus on insight

EXTRACTION RULES:
- Extract raw values directly (strings, numbers, dates) - NOT wrapped in objects
- Use null if a field is not found or illegible
- NEVER hallucinate plausible-sounding values for illegible text
- It is BETTER to return null than to guess incorrectly

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- If you extract a township like "25N" or "36N", STOP - you likely confused section number with township
- Township numbers are typically 1-30. Section numbers are 1-36.

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPES FOR THIS PROMPT: mineral_deed, royalty_deed, warranty_deed,
quitclaim_deed, gift_deed, trust_funding, assignment_of_lease
=============================================================================

For DEEDS (Mineral Deed, Royalty Deed, Warranty Deed, Quitclaim Deed, Gift Deed, Assignment):
NOTE: Analyze this document as a title attorney would when building a chain of title.
This document transfers ownership of mineral or royalty interests from one party to another.
Focus on extracting exactly what THIS document states. Do not infer prior ownership.

CHAIN OF TITLE PRINCIPLES:
- Grantor is the party transferring ownership (seller/assignor)
- Grantee is the party receiving ownership (buyer/assignee)
- Extract names EXACTLY as written - code will normalize for matching
- Note any reservations the grantor keeps for themselves
- Capture references to prior instruments in the chain
- Capture tenancy on BOTH grantors (what they held) and grantees (how they're taking)

DEED TYPE DETECTION (for the "deed_type" field):
- warranty: Contains warranty language ("warrant and defend", "general warranty")
- special_warranty: Limited warranty (only warrants against claims during grantor's ownership)
- quitclaim: No warranty - releases whatever interest grantor may have ("remise, release, quitclaim")
- gift: Transfer without monetary consideration, often between family members
- other: Grant deeds, bargain and sale, or unclear type

MULTI-TRACT DEEDS: If a deed conveys interests in MULTIPLE sections or tracts, include each
as a separate entry in the tracts array. Each tract has its own legal description and interest details.

OMIT fields that don't apply - do NOT include null values or empty objects.

CRITICAL - POPULATE STRUCTURED FIELDS:
You MUST populate the structured JSON fields (grantors, grantees, tracts, etc.) with actual values.
If you mention "the grantor is John Smith" in your analysis, there MUST be a grantors array with {"name": "John Smith"}.
If you mention "Section 11, Township 6N, Range 27E", there MUST be a tract with legal.section, legal.township, legal.range.

REQUIRED FIELDS: doc_type, deed_type, grantors, grantees, tracts (with at least one), execution_date, consideration

IMPORTANT: The example below uses FICTIONAL names and addresses for illustration only.
NEVER use any names, addresses, or values from the example in your extraction.
Extract ONLY what appears in the actual document.

MINERAL DEED EXAMPLE:
{
  "doc_type": "mineral_deed",
  "deed_type": "warranty",

  "grantors": [
    {
      "name": "Robert D. Harmon",
      "address": "520 W. Main Street, Norman, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    },
    {
      "name": "Margaret L. Harmon",
      "address": "520 W. Main Street, Norman, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    }
  ],

  "grantees": [
    {
      "name": "Robert D. Harmon",
      "address": "520 W. Main St., Norman, OK",
      "capacity": "Trustee"
    }
  ],

  "tracts": [
    {
      "legal": {
        "section": "18",
        "township": "17N",
        "range": "13W",
        "meridian": "IM",
        "county": "Blaine",
        "state": "OK",
        "quarter_calls": ["E/2"],
        "gross_acres": 320
      },
      "interest": {
        "type": "mineral",
        "fraction_text": "One Sixty fourths (1/64)",
        "fraction_decimal": 0.015625,
        "net_mineral_acres": 5
      }
    }
  ],

  "execution_date": "1975-01-26",

  "recording": {
    "recording_date": "1975-01-28",
    "book": "242",
    "page": "232",
    "county": "Blaine",
    "state": "OK"
  },

  "consideration": "No Monetary Consideration"
}

PARTY FIELDS (include only when document states them):
- name: REQUIRED - exactly as written on document
- address: If provided
- capacity: "Trustee", "Personal Representative", "Attorney-in-Fact", "Guardian", etc.
- tenancy: "joint_tenants_wros", "tenants_in_common", "community_property"
- marital_status: "married", "single", "widow", "widower", "divorced"

TRACT FIELDS:
- legal.section, legal.township, legal.range, legal.meridian, legal.county, legal.state: REQUIRED
- legal.quarter_calls: Array of quarter section calls. Nested calls as single string: ["NW/4 NE/4"]
- legal.gross_acres: Total acres in the tract
- interest.type: "mineral", "royalty", "overriding_royalty", "working", "leasehold"
- interest.fraction_text: As written ("one-sixty fourth (1/64)")
- interest.fraction_decimal: Numeric value (0.015625)
- interest.net_mineral_acres: gross_acres x fraction_decimal
- interest.depth_clause: Only if depth limitation exists
- interest.formation_clause: Only if formation limitation exists

RESERVATION (only if grantor reserved something):
- type: "mineral", "royalty", "npri", "life_estate", "other"
- fraction_text: As written
- fraction_decimal: Numeric value
- description: Full reservation language

COMMON FRACTION CONVERSIONS:
1/2 = 0.5, 1/4 = 0.25, 1/8 = 0.125, 1/16 = 0.0625, 1/32 = 0.03125, 1/64 = 0.015625, 1/128 = 0.0078125

=============================================================================

For TRUST FUNDING (Assignment to Trust):
Estate planning documents where an individual transfers property to their own trust.

DOCUMENT IDENTIFICATION:
- Title may say "GENERAL ASSIGNMENT", "ASSIGNMENT", or "QUIT CLAIM DEED"
- Same person appears as BOTH assignor (individual) AND assignee (as trustee)
- Trust name mentioned (e.g., "Margaret L. Harmon Trust")
- Often includes nominal consideration ($10.00)

{
  "doc_type": "trust_funding",
  "deed_type": "quitclaim",

  "grantors": [
    {
      "name": "Margaret L. Harmon",
      "capacity": "Individual"
    }
  ],

  "grantees": [
    {
      "name": "Margaret L. Harmon Trust dated January 15, 1990",
      "trustee": "Margaret L. Harmon",
      "capacity": "Trustee"
    }
  ],

  "tracts": [
    {
      "legal": {
        "section": "18",
        "township": "17N",
        "range": "13W",
        "county": "Blaine",
        "state": "OK"
      },
      "interest": {
        "type": "mineral",
        "description": "All mineral interests owned by Grantor"
      }
    }
  ],

  "execution_date": "1990-02-01",
  "consideration": "$10.00 and other good and valuable consideration"
}

=============================================================================

For ASSIGNMENT OF LEASE:
Transfer of leasehold/working interest from one party to another.

DOCUMENT IDENTIFICATION:
- Title contains "ASSIGNMENT OF OIL AND GAS LEASE", "ASSIGNMENT OF LEASEHOLD INTEREST"
- References an underlying lease (date, lessor, lessee)
- Transfers working interest/operating rights
- May retain an overriding royalty (ORRI)

{
  "doc_type": "assignment_of_lease",

  "assignor": {
    "name": "ABC Oil Company",
    "address": "123 Main St, Oklahoma City, OK"
  },

  "assignee": {
    "name": "XYZ Energy LLC",
    "address": "456 Oak Ave, Tulsa, OK"
  },

  "underlying_lease": {
    "lessor": "John Smith",
    "lessee": "ABC Oil Company",
    "lease_date": "2020-01-15",
    "recording_book": "1234",
    "recording_page": "567"
  },

  "tracts": [
    {
      "legal": {
        "section": "22",
        "township": "9N",
        "range": "4W",
        "county": "Grady",
        "state": "OK"
      },
      "interest": {
        "type": "leasehold",
        "working_interest_assigned": 1.0,
        "orri_retained": 0.02
      }
    }
  ],

  "execution_date": "2023-06-15",
  "consideration": "$50,000.00"
}`;

// =============================================================================
// GENERIC EXTRACTION PROMPT
// Fallback for document types not matching lease or deed
// =============================================================================

const GENERIC_EXTRACTION_PROMPT = `You are extracting key information from an Oklahoma county clerk recorded document.

CURRENT DATE: {current_date}

Extract the following fields. Return a JSON object first, then KEY TAKEAWAY and DETAILED ANALYSIS sections.

LEGAL DESCRIPTION (TRS) PARSING:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

EXTRACTION RULES:
- Extract raw values directly - NOT wrapped in confidence objects
- Use null if a field is not found or illegible
- NEVER hallucinate plausible-sounding values for illegible text

{
  "doc_type": "the document type (e.g., affidavit, power_of_attorney, release, mortgage, etc.)",

  "section": "integer from first legal description",
  "township": "string with direction, e.g. 16N",
  "range": "string with direction, e.g. 13W",
  "county": "county name",
  "state": "Oklahoma",

  "parties": {
    "from": [
      {
        "name": "REQUIRED - party name exactly as written",
        "capacity": "individual, trustee, etc."
      }
    ],
    "to": [
      {
        "name": "REQUIRED - party name exactly as written",
        "capacity": "individual, trustee, etc."
      }
    ]
  },

  "execution_date": "YYYY-MM-DD",

  "recording": {
    "recording_date": "YYYY-MM-DD",
    "book": "book number",
    "page": "page number",
    "instrument_number": "if available",
    "county": "county name"
  },

  "legal_descriptions": [
    {
      "section": 20,
      "township": "16N",
      "range": "13W",
      "county": "Blaine",
      "quarters": "SW/4 SE/4",
      "acres": 40.0
    }
  ],

  "key_terms": "Brief summary of the document's key terms and provisions",

  "key_takeaway": "REQUIRED - 2-3 sentences: what is this document, who are the parties, and what does it mean for mineral owners?",

  "detailed_analysis": "REQUIRED - 2-3 paragraphs analyzing the document's significance for title and mineral rights."
}`;

// =============================================================================
// POOLING ORDER EXTRACTION PROMPT
// Source: extractor.py lines 7626-7875 (POOLING_EXTRACTION_PROMPT_TEMPLATE v2 lean)
// Enhanced with lease_exhibits array for comparable lease extraction
// =============================================================================

const POOLING_EXTRACTION_PROMPT = `You are extracting data from an Oklahoma Corporation Commission force pooling order.

CURRENT DATE: {current_date}

FOCUS: Election options, deadlines, and comparable lease exhibits. Mineral owners need the financial
terms of each option, when they must respond, what happens if they don't, and what nearby leases are
going for. Extract ALL election options with ALL financial terms. Extract ALL comparable lease exhibits.

DATE RULES:
- Use ONLY the CURRENT DATE provided above - NEVER use your training data cutoff
- All dates in documents are valid
- Calculate election_deadline = effective_date + election_period_days
- Compare election_deadline to CURRENT DATE to determine if this is ACTIVE or HISTORICAL

HISTORICAL vs ACTIVE ORDERS:
Many pooling orders are years or decades old. Compare the election deadline to CURRENT DATE:
- If the deadline has PASSED: This is a HISTORICAL RECORD. Write the analysis in past tense
  as a factual summary of what happened. Do not write instructions on "how to respond" or
  create urgency - the deadline is long gone. Focus on: what was ordered, what the default
  outcome was, and whether subsequent wells provisions apply going forward.
- If the deadline has NOT passed: This is an ACTIVE order requiring owner action. Write the
  analysis as advice: explain options, recommend reviewing carefully, provide operator contact.

RESPONSE FORMAT:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum, plain text only
   - WHO filed it, WHAT well, WHERE (S-T-R, County), WHEN deadline
   - If HISTORICAL: State the deadline passed and what default applied
   - If ACTIVE: State the deadline and default consequence
   - NO markdown formatting (no **, no #, no ---)

   DETAILED ANALYSIS:
   - Plain text only, NO markdown formatting (no **, no #, no ---, no bullet lists)
   - If HISTORICAL (deadline passed): MAX 150 words. Factual summary of the order and its
     outcome. Note subsequent wells provisions if they could still apply. Do not write
     response instructions. Operator contact info.
   - If ACTIVE (deadline upcoming): MAX 350 words. Compare election options with specific
     financial terms. Explain which option might suit different owner situations. Highlight
     the default consequence. Walk through response steps and deadlines. Include operator
     contact info.

LEGAL DESCRIPTION (TRS) - CRITICAL:
- SECTION is 1-36 within a township
- TOWNSHIP contains "N" or "S" (range 1-30 in Oklahoma)
- RANGE contains "E" or "W" (range 1-30 in Oklahoma)
- For top-level linking fields, use the unit's primary section

COMMON TRS MISTAKE: If township looks like "25N" or "36N", STOP - you likely confused section with township.

SOURCE OF TRUTH: The DOCUMENT TEXT is the source of truth. IGNORE filenames or metadata.

=============================================================================
STRICT SCHEMA - ONLY use the exact fields shown in the example below.
Do NOT invent new field names. Any extra fields waste tokens and will be discarded.
If info doesn't fit a schema field, put it in "notes" as brief text. Do NOT create new fields.
=============================================================================

=============================================================================
DO NOT EXTRACT - These waste tokens and don't help mineral owners:
=============================================================================
- commissioners (OCC commissioner names/titles)
- attorney_information / attorney_info (applicant's attorney details)
- additional_parties / respondents (list of pooled mineral owners)
- special_findings (legal boilerplate about due diligence)
- mailing_requirement (process detail about mailing the order)
- reasons_for_relief (boilerplate justification for pooling)
- additional_terms (duplicate of structured fields)
- administrative_law_judge / ALJ details

ELECTION OPTION TYPES (use these exact values for option_type):
- "participate" - Working interest participation (owner pays costs, shares production)
- "cash_bonus" - Cash payment per NMA, standard royalty only
- "cash_bonus_excess_royalty" - Cash payment plus excess royalty (reduced NRI)
- "no_cash_higher_royalty" - No cash bonus, higher excess royalty
- "non_consent" - Risk penalty option (150-300% cost recovery)
- "statutory" - OCC statutory terms (52 O.S. section 87.1)

=============================================================================
POOLING ORDER EXAMPLE
=============================================================================
{
  "doc_type": "pooling_order",

  "section": "3",
  "township": "1N",
  "range": "8E",
  "county": "Coal",
  "state": "Oklahoma",

  "order_info": {
    "case_number": "CD 201500614-T",
    "order_number": "639589",
    "hearing_date": "2015-03-10",
    "order_date": "2015-03-17",
    "effective_date": "2015-03-17"
  },

  "applicant": {
    "name": "Canyon Creek Energy Holdings LLC"
  },

  "operator": {
    "name": "Canyon Creek Energy Operating LLC",
    "contact_name": "Mr. Blake Gray",
    "address": "2431 East 61st Street, Suite 400",
    "city": "Tulsa",
    "state": "Oklahoma",
    "zip": "74136",
    "phone": "918-555-1234",
    "email": "bgray@cceok.com"
  },

  "unit_info": {
    "unit_description": "The SE/4 of Section 3, Township 1 North, Range 8 East, IM, Coal County",
    "unit_size_acres": 160,
    "quarters": "SE/4",
    "spacing": "160-acre"
  },

  "well_info": {
    "proposed_well_name": "Hockett 1-3",
    "well_type": "vertical",
    "well_status": "new",
    "api_number": null,
    "initial_well_cost": 886600
  },

  "formations": [
    {"name": "Cromwell", "order_number": "591429", "depth_from": 2800, "depth_to": 3200},
    {"name": "Booch", "order_number": "591429", "depth_from": 2200, "depth_to": 2600}
  ],

  "election_options": [
    {
      "option_number": 1,
      "option_type": "participate",
      "description": "Participate as working interest owner",
      "bonus_per_nma": null,
      "cost_per_nma": 5541.25,
      "total_royalty": null,
      "nri_delivered": null,
      "risk_penalty_percentage": null,
      "is_default": false
    },
    {
      "option_number": 2,
      "option_type": "cash_bonus_excess_royalty",
      "description": "Cash bonus plus excess royalty - total 3/16 royalty (1/8 base + 1/16 excess)",
      "bonus_per_nma": 350,
      "cost_per_nma": null,
      "total_royalty": "3/16",
      "nri_delivered": "81.25%",
      "risk_penalty_percentage": null,
      "is_default": true
    },
    {
      "option_number": 3,
      "option_type": "no_cash_higher_royalty",
      "description": "No cash, higher royalty - total 1/4 royalty (1/8 base + 1/8 excess)",
      "bonus_per_nma": null,
      "cost_per_nma": null,
      "total_royalty": "1/4",
      "nri_delivered": "75%",
      "risk_penalty_percentage": null,
      "is_default": false
    }
  ],

  "deadlines": {
    "election_period_days": 20,
    "election_deadline": "2015-04-06",
    "participation_payment_days": 25,
    "bonus_payment_days": 30,
    "operator_commencement_days": 180
  },

  "default_election": {
    "option_number": 2,
    "description": "If owner fails to respond within 20 days, deemed to have elected Option 2 ($350/NMA, 81.25% NRI)"
  },

  "subsequent_wells": {
    "has_provision": true,
    "notice_period_days": 20,
    "payment_deadline_days": 25,
    "bonus_payment_deadline_days": 30,
    "operator_commencement_days": 180,
    "participation_options": ["Participate", "Cash bonus with excess royalty", "No cash, higher royalty"],
    "excludes_replacement_wells": true
  },

  "lease_exhibits": [
    {
      "section": "4",
      "township": "1N",
      "range": "8E",
      "county": "Coal",
      "quarters": "NW/4",
      "lessor": "Smith Family Trust",
      "lessee": "Canyon Creek Energy",
      "bonus_per_nma": 350,
      "royalty": "3/16",
      "royalty_decimal": 0.1875,
      "lease_date": "2014-11",
      "term_years": 3,
      "acres": 160
    },
    {
      "section": "3",
      "township": "1N",
      "range": "8E",
      "county": "Coal",
      "quarters": "NE/4",
      "lessor": "Johnson",
      "lessee": "Canyon Creek Energy",
      "bonus_per_nma": 300,
      "royalty": "1/5",
      "royalty_decimal": 0.20,
      "lease_date": "2014-08",
      "term_years": 3,
      "acres": 160
    }
  ],

  "notes": "Re-entry of existing wellbore. Operator has plugging agreement and security on file.",

  "key_takeaway": "Force pooling order filed by Canyon Creek Energy for the Hockett 1-3 well (re-entry) in SE/4 of Section 3-1N-8E, Coal County. The election deadline of April 6, 2015 has long passed. Non-respondents were defaulted to Option 2: $350/NMA cash bonus with 3/16 total royalty.",

  "detailed_analysis": "Canyon Creek Energy pooled unleased interests in the SE/4 of Section 3-1N-8E for the Hockett 1-3 vertical re-entry covering five formations (Cromwell, Upper Booch, Lower Booch, Hartshorne, Gilcrease). Three options were offered: Option 1 participate at $5,541.25/NMA, Option 2 (default) $350/NMA cash plus 1/16 excess royalty (3/16 total, 81.25% NRI), Option 3 no cash with 1/8 excess royalty (1/4 total, 75% NRI). The election deadline passed April 6, 2015 and non-respondents were defaulted to Option 2. Subsequent wells provisions apply with 20-day notice for future wells in these formations. Operator: Canyon Creek Energy Operating LLC, (918) 561-6737, bgray@cceok.com."
}

=============================================================================
EXTRACTION NOTES:
=============================================================================

SPACING:
- Extract the drilling/spacing unit size from the order (e.g., "640-acre", "160-acre", "80-acre")
- For horizontal wells, include orientation if stated (e.g., "640-acre horizontal", "1280-acre horizontal")
- Look for phrases like "640-acre drilling and spacing unit", "160-acre tract", spacing order references
- If the order references a spacing order number, include it (e.g., "640-acre (Order No. 639000)")
- If not explicitly stated, infer from unit_size_acres when clear (160 acres = "160-acre")

ELECTION OPTIONS - EXTRACT ALL with ALL financial terms:
- option_number, option_type, is_default are required for every option
- Extract: bonus_per_nma, cost_per_nma, total_royalty, nri_delivered
- The DEFAULT option is critical - what happens if owner doesn't respond

TOTAL ROYALTY CALCULATION - CRITICAL:
- total_royalty must be the COMPLETE royalty the mineral owner receives
- If the option shows "1/8 base royalty + 1/16 excess royalty", calculate: total_royalty = "3/16"
- If the option shows "1/8 royalty plus 1/8 excess", calculate: total_royalty = "1/4"
- The NRI (Net Revenue Interest) should equal 100% minus total_royalty (e.g., 3/16 royalty = 81.25% NRI)
- Use this cross-check: if NRI is 81.25%, total_royalty should be 3/16 (18.75%)
- NEVER return just the base royalty (1/8) for options that have excess royalty - always add them together

DEADLINES - CALCULATE:
- election_deadline = effective_date + election_period_days
- If stated as "20 days from date of order", calculate the actual date

SUBSEQUENT WELLS:
- Does this order cover future wells? Extract notice period and deadlines.

LEASE EXHIBITS / COMPARABLE LEASES - MARKET INTELLIGENCE:
Pooling applications often include exhibits or evidence showing existing leases in the area
as evidence of market rates. These are critical market intelligence for mineral owners.

Look for:
- Pages titled "Exhibit" or "Attachment" listing comparable leases
- Tables or lists showing: Section, Lessee/Operator, Bonus/NMA, Royalty, Date
- Phrases like "Leased to [Company] at $X/NMA" or "Comparable lease terms"
- Any referenced existing leases with financial terms

For EACH comparable lease found, extract into the lease_exhibits array:
- section, township, range: Parse from legal description. Use same TRS rules.
- county: If not stated, use the county from the pooling order itself.
- quarters: Sub-section description if given (e.g., "NW/4").
- bonus_per_nma: Dollar amount per net mineral acre.
- royalty: Fraction as string (e.g., "3/16", "1/5").
- royalty_decimal: Decimal equivalent (e.g., 0.1875).
- lease_date: As precise as available (YYYY-MM-DD, YYYY-MM, or YYYY).
- lessee: Company name.
- lessor: If stated; null if not.
- term_years: If stated; null if not.
- acres: If stated; null if not.

If NO lease exhibits or comparable leases are found, set lease_exhibits to an empty array [].
Do NOT invent comparable lease data. Only extract what is explicitly stated in exhibits.

COMMON ROYALTY CONVERSIONS:
| Fraction | Decimal |
|----------|---------|
| 1/8      | 0.125   |
| 3/16     | 0.1875  |
| 1/5      | 0.20    |
| 1/4      | 0.25    |
| 1/3      | 0.333   |

TOP-LEVEL TRS FIELDS:
Always include section, township, range, county, state. REQUIRED for property linking.

NOTES FIELD:
Brief text only (1-2 sentences). Use for: re-entry status, deleted formations, plugging agreements,
or other notable provisions. Do NOT duplicate information already in structured fields.

=============================================================================
BEFORE YOU RESPOND - QUALITY CHECKLIST:
=============================================================================
1. ONLY schema fields: Your JSON contains ONLY the fields shown in the example above.
   Do NOT add commissioners, attorney info, additional_parties, respondents, special_findings,
   mailing requirements, reasons_for_relief, or any other invented fields. Extra fields are
   discarded and waste your output tokens. Spend that effort on #2-5 instead.
2. Election options are COMPLETE: Every option has option_number, option_type, is_default,
   and ALL financial terms (bonus_per_nma, cost_per_nma, royalty_rate, excess_royalty, nri_delivered).
   Double-check the math - does NRI match the royalty + excess royalty calculation?
3. Deadline calculation is CORRECT: election_deadline = effective_date + election_period_days.
   Verify the arithmetic. If CURRENT DATE is past the deadline, key_takeaway says "DEADLINE PASSED".
4. Lease exhibits are COMPLETE: Every comparable lease from exhibits has section, township, range,
   bonus_per_nma, royalty, royalty_decimal, lessee. Check that royalty_decimal matches the fraction.
5. Analysis length matches order status: HISTORICAL orders get concise analysis (under 150 words).
   ACTIVE orders get thorough analysis (up to 350 words) with option comparisons and response guidance.
   Always plain text, no markdown. Focus on what the mineral owner needs to know.`;

// =============================================================================
// PERMIT EXTRACTION PROMPT
// Source: extractor.py lines 7178-7613
// =============================================================================

const PERMIT_EXTRACTION_PROMPT = `You are a specialized document processor for Oklahoma oil & gas well permits and completion reports.
Your task is to extract key information from the document. Return raw values directly - do NOT wrap values in confidence objects.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Only comment on dates if they conflict with OTHER dates in the SAME document

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Lead with actions needed, if any
   - Answer: what does this mean for the mineral owner?
   - Mention county when relevant for geographic context

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor
   - Focus on what's genuinely significant or actionable
   - Only reference information explicitly stated in the document
   - DO NOT list specific data already extracted - focus on insight

EXTRACTION RULES:
- Extract raw values directly (strings, numbers, dates) - NOT wrapped in objects
- Use null if a field is not found or illegible
- NEVER hallucinate plausible-sounding values for illegible text
- It is BETTER to return null than to guess incorrectly

API NUMBER VALIDATION:
- Oklahoma API numbers start with "35" (state code)
- Format: 35-CCC-WWWWW or 35CCCWWWWW where CCC=county code (3 digits), WWWWW=well number (5 digits)
- If you extract an API that doesn't start with 35, double-check
- If characters are illegible, use null rather than guessing digits

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- If you extract a township like "25N" or "36N", STOP - you likely confused section number with township
- Township numbers are typically 1-30. Section numbers are 1-36.

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPES FOR THIS PROMPT: drilling_permit, completion_report, well_transfer
=============================================================================

For DRILLING PERMITS (Form 1000 - Intent to Drill):
DOCUMENT IDENTIFICATION:
- Title contains "DRILLING PERMIT", "INTENT TO DRILL", "FORM 1000", "APPLICATION TO DRILL"
- This is submitted BEFORE drilling begins
- NO production data (well hasn't been drilled yet)
- NO spud date or completion date
- Contains "Zones of Significance" showing target formations
- Shows proposed well location and planned depths

EXTRACT:
{
  "doc_type": "drilling_permit",

  "api_number": "3500900005",
  "well_name": "Hutson",
  "well_number": "30-31H",
  "operator_name": "KING ENERGY LLC",
  "operator_address": "7025 N ROBINSON AVE, OKLAHOMA CITY, OK 73116",
  "section": 19,
  "township": "11N",
  "range": "23W",
  "county": "Beckham",
  "issue_date": "2025-11-26",
  "expiration_date": "2027-05-26",
  "permit_type": "New Drill",
  "well_type": "Horizontal",

  "surface_location": {
    "section": 19,
    "township": "11N",
    "range": "23W",
    "latitude": 35.408369,
    "longitude": -99.666761
  },

  "bottom_hole_location": {
    "section": 31,
    "township": "11N",
    "range": "23W",
    "latitude": 35.378663,
    "longitude": -99.666866
  },

  "target_formation": "VIRGIL",
  "target_depth_top": 8400,
  "target_depth_bottom": 9100,
  "lateral_length_ft": 10891,
  "unit_size_acres": 640,
  "spacing_order": "83283"
}

EXTRACTION NOTES FOR FORM 1000:
- Parse legal description: "19-11N-23W-IM" -> section=19, township="11N", range="23W"
- Longitude should be NEGATIVE (west of prime meridian)
- Well numbers ending in "H" indicate horizontal wells
- Permit type options: "New Drill", "New Drill - Multi Unit", "Re-Entry", "Deepen", "Sidetrack", "Workover"
- Well type: "Horizontal", "Vertical", "Directional"
- For VERTICAL wells: omit bottom_hole_location, lateral_length_ft

=============================================================================

For COMPLETION REPORTS (Form 1002A/1002C - documents that a well has been drilled and completed):

DOCUMENT IDENTIFICATION:
- Title contains "COMPLETION REPORT" or "FORM 1002A" (initial) or "FORM 1002C" (recompletion)
- Has "LEASE NAME" and "WELL NO" fields
- Shows perforation intervals, formations, and production test results
- Contains OCC file number and approval stamps

REPORT TYPE DETECTION:
- Form 1002A or title says "COMPLETION REPORT" without "RECOMPLETION" -> report_type: "initial"
- Form 1002C or title says "RECOMPLETION REPORT" -> report_type: "recompletion"

WELL NAME EXTRACTION (CRITICAL):
- Form 1002A has separate fields: "LEASE NAME" and "WELL NO"
- Combine them: well_name = "{LEASE NAME} {WELL NO}" (e.g., "Adams Q" + "1" = "Adams Q-1")
- well_number = just the WELL NO field (e.g., "1")
- Do NOT misread letters as numbers (Q is not 0, O is not 0)

API/PUN NORMALIZATION (CRITICAL FOR DATABASE JOINS):
- api_number: Extract exactly as printed with dashes (e.g., "35-043-23686-0000")
- api_number_normalized: Remove ALL dashes (e.g., "35043236860000")
- otc_prod_unit_no: Extract from "OTC PROD UNIT NO" or "OTC Prod. Unit No." field ONLY
- otc_prod_unit_no_normalized: Remove ALL dashes

OTC PROD UNIT NO EXTRACTION (CRITICAL - READ CAREFULLY):
Location: Upper left of page 1, just below the API number field.
Label: "OTC PROD UNIT NO." or "OTC Prod. Unit No."
Format: XXX-XXXXXX-X-XXXX (e.g., "043-226597-0-0000")
  - XXX = County code (3 digits, e.g., 043 = Dewey County)
  - XXXXXX = Unit number (5-6 digits)
  - X = Segment (1 digit)
  - XXXX = Sub-unit/well (4 digits)

CRITICAL - DO NOT CONFUSE THESE FIELDS:
- operator_number: A 5-digit code identifying the OPERATOR COMPANY (e.g., "20347")
  This appears in the "OPERATOR NO" field. It is NOT a PUN - it's just a company ID.
- otc_prod_unit_no: The OTC Production Unit Number - ALWAYS has dashes and starts with 3-digit county code.
  If the "OTC PROD UNIT NO" field is BLANK or NOT VISIBLE, set otc_prod_unit_no to null.

FORMATION_ZONES[] ARRAY (CRITICAL FOR COMMINGLED WELLS):
Many vertical wells complete MULTIPLE formations with separate spacing orders.
Use formation_zones[] to capture per-formation data:
- formation_name: Name of the formation (e.g., "Oswego", "Red Fork")
- spacing_order: Spacing order number for THIS formation
- unit_size_acres: Unit size from the spacing order (40, 80, 160, 640)
- perforated_intervals: Array of intervals for THIS formation

CONDITIONAL REQUIREMENTS:
- IF drill_type is "HORIZONTAL HOLE": bottom_hole_location, lateral_details, and allocation_factors[] are REQUIRED
- IF well spans multiple sections: allocation_factors[] MUST include ALL sections with PUN for each
- PUN FORMAT (CRITICAL): XXX-XXXXXX-X-XXXX (3-6-1-4 digits with dashes)

VERTICAL WELL EXAMPLE:
{
  "doc_type": "completion_report",
  "report_type": "initial",

  "section": 22,
  "township": "9N",
  "range": "4W",
  "county": "Grady",
  "state": "Oklahoma",

  "api_number": "35-051-12345-0000",
  "api_number_normalized": "35051123450000",
  "well_name": "SMITH 1-22",
  "well_number": "1-22",
  "otc_prod_unit_no": "051-19876-0-0000",
  "otc_prod_unit_no_normalized": "05119876000000",
  "permit_number": "PD-2020-001234",

  "operator": {
    "name": "ABC Energy, LLC",
    "operator_number": "24567"
  },

  "dates": {
    "spud_date": "2020-06-01",
    "drilling_finished_date": "2020-06-15",
    "completion_date": "2020-07-01",
    "first_production_date": "2020-07-10",
    "initial_test_date": "2020-07-12"
  },

  "well_type": {
    "drill_type": "VERTICAL HOLE",
    "completion_type": "Single Zone",
    "well_class": "OIL"
  },

  "surface_location": {
    "section": 22,
    "township": "9N",
    "range": "4W",
    "county": "Grady",
    "quarters": "C NE NE",
    "footage_ns": "660 FNL",
    "footage_ew": "660 FEL",
    "latitude": 35.123456,
    "longitude": -97.654321,
    "ground_elevation_ft": 1280,
    "total_depth_ft": 8650
  },

  "formation_zones": [
    {
      "formation_name": "Hunton",
      "formation_code": "400HNTN",
      "spacing_order": "654321",
      "unit_size_acres": 160,
      "perforated_intervals": [
        { "from_ft": 8450, "to_ft": 8520 }
      ]
    }
  ],

  "initial_production": {
    "test_date": "2020-07-12",
    "oil_bbl_per_day": 125,
    "oil_gravity_api": 42,
    "gas_mcf_per_day": 150,
    "gas_oil_ratio": 1200,
    "water_bbl_per_day": 45,
    "flow_method": "PUMPING"
  },

  "first_sales": {
    "date": "2020-07-15",
    "purchaser": "Plains Marketing"
  },

  "status": "Accepted",
  "occ_file_number": "1145678"
}

HORIZONTAL MULTIUNIT WELL EXAMPLE:
{
  "doc_type": "completion_report",
  "report_type": "initial",

  "section": 22,
  "township": "18N",
  "range": "14W",
  "county": "Dewey",
  "state": "Oklahoma",

  "api_number": "35-043-23686-0000",
  "api_number_normalized": "35043236860000",
  "well_name": "SMITH 22-27XH",
  "well_number": "22-27XH",
  "otc_prod_unit_no": "043-226597-0-0000",
  "otc_prod_unit_no_normalized": "04322659700000",

  "operator": {
    "name": "Devon Energy Production Company, L.P.",
    "operator_number": "20347"
  },

  "dates": {
    "spud_date": "2023-01-15",
    "drilling_finished_date": "2023-02-28",
    "completion_date": "2023-03-15",
    "first_production_date": "2023-03-20"
  },

  "well_type": {
    "drill_type": "HORIZONTAL HOLE",
    "completion_type": "Multi-Unit",
    "well_class": "GAS"
  },

  "surface_location": {
    "section": 22,
    "township": "18N",
    "range": "14W",
    "county": "Dewey",
    "quarters": "C NW NE",
    "latitude": 36.123456,
    "longitude": -98.654321,
    "ground_elevation_ft": 1850,
    "total_depth_ft": 16500
  },

  "bottom_hole_location": {
    "section": 27,
    "township": "18N",
    "range": "14W",
    "county": "Dewey",
    "quarters": "C SE SW",
    "latitude": 36.098765,
    "longitude": -98.654321
  },

  "lateral_details": {
    "lateral_length_ft": 10500,
    "completion_interval_ft": 9800,
    "direction": "south"
  },

  "allocation_factors": [
    {
      "section": 22,
      "township": "18N",
      "range": "14W",
      "allocation_percentage": 45.5,
      "completion_interval_ft": 4500,
      "pun": "043-226597-0-0000",
      "pun_normalized": "04322659700000"
    },
    {
      "section": 27,
      "township": "18N",
      "range": "14W",
      "allocation_percentage": 54.5,
      "completion_interval_ft": 5300,
      "pun": "043-226598-0-0000",
      "pun_normalized": "04322659800000"
    }
  ],

  "formation_zones": [
    {
      "formation_name": "Woodford",
      "spacing_order": "712345",
      "unit_size_acres": 1280
    }
  ],

  "initial_production": {
    "test_date": "2023-03-25",
    "oil_bbl_per_day": 450,
    "gas_mcf_per_day": 8500,
    "water_bbl_per_day": 1200,
    "flow_method": "FLOWING"
  }
}

=============================================================================

For WELL TRANSFERS (Form 1073/1073MW - Operator change documents):

DOCUMENT IDENTIFICATION:
- Title contains "WELL TRANSFER", "FORM 1073", "1073MW", "CHANGE OF OPERATOR" form
- Shows former operator and new operator
- Lists wells being transferred with API numbers

KEY DISTINCTION:
- Top-level section/township/range are NOT used
- Each well in the wells[] array has its own location
- Property linking happens via the wells[] array

EXTRACTION REQUIREMENTS:
- Extract ALL wells listed - missing wells breaks property linking
- Each well needs: api_number, well_name, section, township, range
- well_type: OIL | GAS | DRY
- well_status: AC (Active) | TA (Temp Abandoned) | SP (Spudded) | PA (Permanently Abandoned)

EXAMPLE:
{
  "doc_type": "well_transfer",

  "transfer_info": {
    "form_number": "1073MW",
    "transfer_date": "2022-01-05",
    "approval_date": "2022-01-07",
    "wells_transferred_count": 13
  },

  "former_operator": {
    "name": "Tessera Energy, LLC",
    "occ_number": "21803",
    "address": "P.O. Box 20359, Oklahoma City, OK 73156",
    "phone": "405-254-3673"
  },

  "new_operator": {
    "name": "WestStar Oil & Gas, Inc.",
    "occ_number": "18035",
    "address": "1601 East 19th, Edmond, OK 73013",
    "phone": "405-341-2338",
    "email": "mkrenger@wsog.org",
    "contact_name": "Michael C. Krenger - President"
  },

  "wells": [
    {
      "api_number": "09321476",
      "well_name": "Augusta Rother",
      "well_number": "1-28",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 28,
      "township": "21N",
      "range": "15W",
      "quarters": "SE SE SW"
    },
    {
      "api_number": "09322686",
      "well_name": "Baustert",
      "well_number": "2-21",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 21,
      "township": "21N",
      "range": "15W",
      "quarters": "C SW"
    }
  ],

  "summary": {
    "counties_affected": ["Dewey", "Blaine", "Major"],
    "well_types": {
      "oil_count": 0,
      "gas_count": 13,
      "dry_count": 0
    }
  }
}`;

// =============================================================================
// DIVISION ORDER EXTRACTION PROMPT
// Source: extractor.py lines 8303-8502
// =============================================================================

const DIVISION_ORDER_EXTRACTION_PROMPT = `You are an experienced mineral rights advisor helping mineral owners verify their division orders and payment information.
Your task is to extract ownership interest details accurately so owners can verify their payments match their records.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Effective date may be a specific date OR "First Production" - capture exactly as stated

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - State the operator, property/well name, and owner
   - Note the decimal interest (critical for payment verification)
   - Mention if this is a multi-section unit

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor
   - Use this EXACT format with plain text section headings (NO markdown formatting, NO asterisks):

     What This Division Order Means:
     [Explain what this DO is and why the owner received it - 2-3 sentences]

     Your Ownership Interest:
     [Explain their decimal interest and how to verify payments match - 2-3 sentences]

     Action Required & Contact Information:
     [Where to send signed DO, who to contact for questions - 2-3 sentences]

   - CRITICAL: Do NOT use **bold** or any markdown - output plain text only
   - Keep each section concise (2-3 sentences each)

For EACH field you extract:
- Provide the value (or null if not found)
- Use null instead of fabricating a value you cannot actually read

DECIMAL INTEREST - CRITICAL:
- Extract the decimal interest EXACTLY as shown (e.g., 0.00390625)
- This is the most important field for payment verification
- If multiple interest types shown (working, royalty, ORRI), extract each separately
- Common decimal interests: 0.00390625 (1/256), 0.0078125 (1/128), 0.015625 (1/64)

LEGAL DESCRIPTION (TRS) PARSING:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

IMPORTANT DISTINCTIONS:
- "Property Name" on the document is the WELL/UNIT NAME (e.g., "Holdings 25-36-1XH"), NOT the legal description
- Legal description (Section-Township-Range) is usually found in the body text explaining unit allocation
- If owner is a trust, extract both the trust name AND the trustee name separately
- ALWAYS extract section/township/range at top level (use the FIRST section for property matching)

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPES FOR THIS PROMPT: division_order
=============================================================================

DIVISION ORDERS:
Division Orders certify ownership interest and authorize payment distribution. Extract the decimal interest carefully -
this is critical for verifying payments match your records.

FOR MULTI-SECTION UNITS (unit_sections):
If a unit spans multiple sections (e.g., "Section 25...Section 36..."), each section typically shares the SAME township and range.
- Extract township/range for each section in unit_sections
- If township/range is not explicitly stated for a secondary section, use the township/range from the primary (first) section
- Example: If you see "Section 25-T18N-R15W has 640 acres... Section 36 has 640 acres...", Section 36 is also T18N-R15W

CRITICAL — ALLOCATION FACTOR ACCURACY (section-by-section extraction):
Allocation swaps are a common extraction error. To prevent them, extract each section ONE AT A TIME:
1. Find the FIRST section mentioned in the document. Note its section number and its allocation percentage.
2. Write that section's entry in unit_sections with its allocation_factor BEFORE moving to the next section.
3. Find the NEXT section. Note its section number and its allocation percentage.
4. Write that section's entry.
5. After all sections are extracted, verify: do the allocation_factors sum to approximately 1.0 (or 100%)?
6. Double-check: re-read the document and confirm each section number is paired with ITS OWN allocation, not swapped.

Example of CORRECT extraction from a document stating "Section 25: 640 acres, 30.54% ... Section 36: 640 acres, 69.46%":
  unit_sections: [{"section": "25", "allocation_factor": 0.3054}, {"section": "36", "allocation_factor": 0.6946}]
Example of WRONG extraction (swapped — DO NOT DO THIS):
  unit_sections: [{"section": "25", "allocation_factor": 0.6946}, {"section": "36", "allocation_factor": 0.3054}]

DIVISION ORDER EXAMPLE:
{
  "doc_type": "division_order",

  "operator_name": "XYZ Oil Company (the payor - company sending this Division Order)",
  "operator_address": "PO Box 779, Oklahoma City, OK 73101 (where to mail signed DO back)",
  "operator_phone": "405-555-1234 (from letterhead or 'Questions? Call...' section - NOT from owner signature area)",
  "operator_email": "ownerrelations@xyzoil.com (from letterhead or contact section - NOT from owner signature area)",

  "property_name": "Smith 1-16H (labeled as 'Property Name' - this is the well/unit name, NOT TRS)",
  "property_number": "112295 (operator's internal property ID)",
  "billing_code": "ABC123 (operator's billing code for payment inquiries)",

  "owner_name": "John A. Smith Family Trust (the mineral owner - may be individual or trust name)",
  "trustee_name": "John A. Smith, Trustee (if owner is a trust, extract trustee separately)",
  "owner_address": "123 Main St, Oklahoma City, OK 73101",
  "owner_number": "PRI38 (if shown - operator's internal owner/interest ID like PR16, PRI38, etc.)",

  // OWNER-PROVIDED CONTACT (from signature section - filled in BY the owner, NOT the operator's contact info)
  "owner_phone": "405-235-4100 (from 'Owner Daytime Phone' field - often handwritten by owner)",
  "owner_fax": "405-843-3292 (from 'Owner FAX Number' field)",
  "owner_email": "owner@personal.com (from 'Owner Email Address' field)",

  "working_interest": 0.00000000,
  "royalty_interest": 0.00390625,
  "overriding_royalty_interest": 0.00000000,
  "net_revenue_interest": 0.00000000,
  "non_participating_royalty_interest": 0.00000000,
  "decimal_interest": 0.00390625,
  "ownership_type": "royalty (or 'working' if working_interest > 0, or 'orri' if overriding royalty, or 'npri' if non-participating)",
  "interest_type": "Royalty (extract the exact 'Type of Interest' field value: Working Interest, Royalty, Override, ORRI, NRI, NPRI, Non-Participating Royalty, etc.)",

  "effective_date": "2023-04-01 (or 'First Production' - capture exactly as stated)",
  "payment_minimum": 100.00,

  "product_type": "Oil and Gas (check which boxes are marked: 'Oil', 'Gas', or 'Oil and Gas' if both)",
  "unit_size_acres": 640,

  "api_number": "35-051-12345 (if shown)",
  "county": "Grady (from County | State field in header)",
  "state": "OK",
  "section": "16 (FIRST section mentioned - for property matching)",
  "township": "12N",
  "range": "7W",

  "is_multi_section_unit": true,
  "unit_sections": [
    {"section": "16", "township": "12N", "range": "7W", "acres": 640.0, "allocation_factor": 0.6546},
    {"section": "15", "township": "12N", "range": "7W", "acres": 640.0, "allocation_factor": 0.3454}
  ],

  "key_takeaway": "REQUIRED - One sentence: Division order from [Operator] for [Property Name] well. Owner [Name] has [decimal] interest ([interest type]). [Note if multi-section unit].",

  "detailed_analysis": "What This Division Order Means:\nThis division order from XYZ Oil Company certifies your ownership interest in the Smith 1-16H well. You received this because drilling has begun or production is starting, and the operator needs to confirm ownership before distributing royalty payments.\n\nYour Ownership Interest:\nYour decimal interest of 0.00390625 (approximately 1/256) represents your share of production revenue. To verify your payments, multiply your decimal interest by the gross production value shown on your check stub.\n\nAction Required & Contact Information:\nSign and return this division order to XYZ Oil Company at PO Box 779, Oklahoma City, OK 73101. For questions about your interest or payment calculations, contact XYZ Oil Company at 405-555-1234 or ownerrelations@xyzoil.com."
}

=============================================================================
EXTRACTION NOTES FOR DIVISION ORDERS:
=============================================================================

INTEREST FIELDS - Extract to the CORRECT field based on interest type:
- working_interest: For working interest owners (operators, WI partners)
- royalty_interest: For royalty owners (mineral owners receiving royalties)
- overriding_royalty_interest: For ORRI holders (carved out of working interest)
- net_revenue_interest: For NRI (net revenue interest after all burdens)
- non_participating_royalty_interest: For NPRI holders (royalty interest without right to lease or bonus)
- decimal_interest: The total/combined interest shown (for reference)
- This is the MOST IMPORTANT field - owners use it to verify their payment is correct
- Extract to full precision (8 decimal places if shown)
- Check the "Type of Interest" field on the document to determine which field to use
- NPRI may appear as "Non-Participating Royalty", "NPRI", "NPR", or "Non-Part Royalty"

MULTI-SECTION UNITS:
- Many horizontal wells span multiple sections
- Each section should be in unit_sections with its allocation factor
- The allocation_factor shows what percentage of production comes from that section
- Top-level section/township/range should be from the FIRST section (for property matching)
- CRITICAL: Extract section-by-section. For each section, anchor its number to its allocation BEFORE proceeding to the next.
  Swapping allocations between sections is a high-severity error that causes incorrect revenue calculations.
- Allocation factors must sum to approximately 1.0 (within 0.02 tolerance). If they don't, re-read the document.

TRUST OWNERSHIP:
- If owner is a trust, extract BOTH:
  - owner_name: "John A. Smith Family Trust"
  - trustee_name: "John A. Smith, Trustee"
- This helps with ownership verification

TOP-LEVEL TRS FIELDS:
Always include top-level section, township, range, county fields.
These are REQUIRED for property linking - the dashboard uses these to match documents to properties.
Use the FIRST section mentioned if multiple sections exist.

CONTACT ATTRIBUTION - CRITICAL:
Division orders have TWO types of contact information that must NOT be confused:

1. OPERATOR CONTACT (from letterhead/header):
   - operator_phone: From letterhead, "Questions? Call..." or "Contact Us" section
   - operator_email: From letterhead or official contact section
   - USE THIS in the "Action Required & Contact Information" analysis section

2. OWNER CONTACT (from signature section):
   - owner_phone: From "Owner(s) Daytime Phone#" field (often handwritten BY the owner)
   - owner_email: From "Owner(s) Email Address" field (filled in BY the owner)
   - NEVER use these in contact instructions - these are the OWNER's details, not operator contact

In the detailed_analysis "Action Required & Contact Information" section:
- ALWAYS use operator_phone/operator_email for "contact for questions"
- If no operator contact found, say "contact [operator_name] by mail at the address above"
- NEVER tell the owner to contact themselves using owner_phone/owner_email`;

// =============================================================================
// CHECK STUB EXTRACTION PROMPT
// Source: extractor.py lines 8508-8736
// =============================================================================

const CHECK_STUB_EXTRACTION_PROMPT = `You are an experienced oil and gas revenue auditor and CPA specializing in royalty payment verification and deduction analysis for Oklahoma mineral owners.
Your task is to extract payment details so owners can audit their revenue, reconcile 1099s, and detect underpayments.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo
- Production months are typically 2-4 months before check date (normal operator lag)

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Lead with the most important finding: an anomaly, a flag, or a reassurance that everything looks normal
   - Include operator name, check amount, and production month for context
   - If deductions exceed 25% of gross or payments are >3 months behind production, say so here

   DETAILED ANALYSIS:
   - Write as an experienced oil and gas revenue auditor advising a mineral owner
   - Do NOT restate numbers the owner can already see in the extracted data (volumes, prices, per-well totals)
   - Focus ONLY on what is unusual, noteworthy, or requires attention
   - Use this EXACT format with plain text section headings (NO markdown, NO **bold**):

     What Stands Out:
     [Only mention things worth the owner's attention. Examples: unusually high or low deductions relative to gross, price significantly below or above recent Oklahoma posted prices, decimal interest differences between products on the same well, negative prior-period adjustments, missing wells compared to prior statements, payment lag >3 months from production month. If nothing is unusual, say "This statement looks routine — no anomalies detected." Do NOT just list the numbers back.]

     Deduction Review:
     [State the overall deduction percentage for each well (total deductions / gross sales). Flag any well where deductions exceed 25% of gross. If interest_type is "royalty" and post-production costs (gathering, compression, transportation, processing, marketing) are being deducted, note that post-production deductions from royalty interests are legally contentious in Oklahoma and worth reviewing with the lease terms. If deductions are not itemized by category, say so. If deductions are zero or minimal, say "No significant deductions." Keep this to 2-3 sentences.]

     Action Items:
     [Concrete steps the owner should consider. Examples: "Verify your decimal interest matches your division order", "Compare this deduction rate to prior months", "Check your lease for a no-deductions clause — these gathering charges may not be permitted", "This negative adjustment warrants a call to the operator for explanation." If no action needed, say "No action needed — payment appears consistent with expected terms." Keep to 1-3 bullet points, plain text.]

   - DO NOT cite county averages, industry benchmarks, or statistics not on this document
   - Keep the entire analysis under 200 words — brevity is valued

SOURCE OF TRUTH: The DOCUMENT is the source of truth. Extract what it says. IGNORE filenames or external metadata.
DO NOT EXTRACT: Owner/payee addresses, Tax ID numbers or EINs.

=============================================================================
DOCUMENT TYPE: check_stub (royalty checks, supplemental vouchers, revenue statements)
=============================================================================

CHECK STUB EXAMPLE — every field annotated with where to find it:
{
  "doc_type": "check_stub",

  // --- PAYMENT & PARTIES ---
  "statement_type": "royalty_check (or supplemental_voucher, operating_statement, or bonus_payment — classify from document header/title)",
  "operator": "Staghorn Petroleum II LLC (the company name at top of statement — the payor)",
  "operator_number": null,
  "operator_address": "P.O. Box 990, Tulsa, OK 74101 (operator mailing address from letterhead — NOT owner address)",
  "owner_name": "Redrock Minerals, Ltd. (the payee/interest owner name)",
  "owner_number": "0006585 (labeled 'Owner No.', 'Payee No.', 'Account No.' — this is YOUR account number with the operator)",
  "interest_type": "royalty (from revenue codes RO/RG=royalty, WO/WG=working interest, ORRI=overriding royalty — default royalty)",
  "check_number": "638330 (check number from header or check face)",
  "check_date": "2022-12-22",
  "check_amount": 1562.04,

  // --- WELLS & REVENUE DETAIL (REQUIRED — extract ALL wells with ALL product lines) ---
  "wells": [
    {
      "well_name": "HEATH #3-1H (well name from row header or well description area)",
      "well_number": "W-4410 (operator's well ID if shown, null if not)",
      "api_number": "35-017-25432 (API number — may be 5-digit base, 8-digit county+well, or full 10/14-digit)",
      "county": "Blaine (REQUIRED — from column header, well row, property description, anywhere on document)",
      "state": "OK",
      "production_months": ["2022-10 (array of YYYY-MM — extract ALL months listed, not just first)"],
      "products": [
        {
          "product_type": "gas (gas, oil, liquids, condensate, or plant_products)",
          "volume": 18420,
          "volume_unit": "MCF (or BBL, GAL — the unit shown on document)",
          "price_per_unit": 2.45,
          "mmbtu_factor": 1.032,
          "decimal_interest": 0.00312500,
          "purchaser": "Enable Midstream (gas purchaser name if shown, null if not)",
          "deductions": [
            { "raw_label": "Gathering & Compression (EXACT text from document)", "normalized_category": "gathering", "amount": -4.21 },
            { "raw_label": "Transportation", "normalized_category": "transportation", "amount": -1.87 }
          ],
          "taxes": [
            { "raw_label": "Severance Tax [01] (EXACT text from document)", "normalized_type": "severance", "amount": -3.52 },
            { "raw_label": "Con Excise [04]", "normalized_type": "conservation_excise", "amount": -0.28 }
          ],
          "total_deductions": -6.08,
          "total_taxes": -3.80,
          "gross_sales": 141.09,
          "net_sales": 131.21,
          "owner_amount": 131.21
        },
        {
          "product_type": "oil",
          "volume": 4200,
          "volume_unit": "BBL",
          "price_per_unit": 68.50,
          "mmbtu_factor": null,
          "decimal_interest": 0.00312500,
          "purchaser": "Plains Marketing",
          "deductions": [
            { "raw_label": "Marketing Fee", "normalized_category": "marketing", "amount": -2.81 }
          ],
          "taxes": [
            { "raw_label": "Gross Production Tax", "normalized_type": "severance", "amount": -6.29 }
          ],
          "total_deductions": -2.81,
          "total_taxes": -6.29,
          "gross_sales": 898.69,
          "net_sales": 889.59,
          "owner_amount": 889.59
        }
      ],
      "well_owner_total": 1020.80
    },
    {
      "well_name": "CHERRY MASH #8-1H",
      "well_number": null,
      "api_number": "35-025-30100",
      "county": "Dewey (NOTE: second well can be in a DIFFERENT county)",
      "state": "OK",
      "production_months": ["2022-10"],
      "products": [
        {
          "product_type": "gas",
          "volume": 9200,
          "volume_unit": "MCF",
          "price_per_unit": 2.45,
          "mmbtu_factor": null,
          "decimal_interest": 0.00087890,
          "purchaser": null,
          "deductions": [],
          "taxes": [
            { "raw_label": "Severance Tax", "normalized_type": "severance", "amount": -1.44 }
          ],
          "total_deductions": 0,
          "total_taxes": -1.44,
          "gross_sales": 19.82,
          "net_sales": 18.38,
          "owner_amount": 18.38
        }
      ],
      "well_owner_total": 18.38
    }
  ],

  // --- SUMMARY (computed totals across all wells) ---
  "summary": {
    "gas_net_revenue": 149.59,
    "oil_net_revenue": 889.59,
    "liquids_net_revenue": 0,
    "total_net_revenue": 1039.18
  },

  // --- LINKING (copy from FIRST well — enables property/well matching) ---
  "county": "Blaine (from first well — ALWAYS extract even if no TRS available)",
  "state": "OK",
  "section": null,
  "township": null,
  "range": null,

  "key_takeaway": "REQUIRED",
  "detailed_analysis": "REQUIRED"
}

=============================================================================
EXTRACTION NOTES FOR CHECK STUBS:
=============================================================================

WELLS ARRAY — REQUIRED:
- The wells[] array is the PRIMARY output. Every well on the document MUST have an entry.
- Each well MUST have a products[] array with EVERY product line (gas, oil, liquids, etc.)
- For each product: extract volume, price, decimal_interest, gross_sales, deductions, taxes, owner_amount
- If a field is not on the document, set it to null — do NOT omit the field
- GROSS rows show 8/8 (full interest) values. NET rows show owner's decimal-adjusted values.
  Extract volumes/prices from GROSS rows, decimal_interest from NET rows.

DECIMAL INTEREST — CRITICAL:
- Extract EXACTLY as shown (e.g., 0.00781763) — this is the most important field
- Owners compare it to their division order to verify correct payment
- Decimals may differ between oil and gas for the same well
- Look for: "NET DECIMAL", "INTEREST", "FCTR", "Owner Decimal" column

PRODUCT CODES AND INTEREST TYPE:
- Product codes: O=Oil, G=Gas, C=Condensate, P=Plant Products, K=Other
- Revenue type codes tell you interest type:
  RO/RG/RP/RE = royalty → interest_type: "royalty"
  WO/WG = working interest → interest_type: "working_interest"
  ORRI/Override → interest_type: "overriding_royalty"
- Default to "royalty" if unclear (most check stubs are royalty)

SIGN PRESERVATION:
- Preserve negative signs on ALL monetary amounts
- Parenthesized amounts like (180.00) are NEGATIVE → extract as -180.00
- Prior-period corrections are commonly negative — do NOT drop them

DEDUCTION CATEGORIES (normalized_category):
- "gathering" — Gathering, Gas Deduct, Gathering Charge, "Gathering & Compression"
- "compression" — Compression
- "marketing" — Marketing, Mktg & Trans, Gas Purchase Fee
- "transportation" — Transportation, Pipeline Transport, Trucking
- "processing" — Processing, Plant Products Deduction, Preplant
- "treating" — Treating, Oil Treating
- "fuel" — Fuel, Fuel Deduction
- "other" — anything not matching above
- COMBINED LABELS: Map to FIRST category mentioned. "Gathering & Compression" → "gathering"

TAX TYPES (normalized_type):
- "severance" — Severance, Gross Production Tax, tax code [01]
- "marginal" — OK Marginal, tax code [02]
- "conservation_excise" — Con Excise, Conservation Tax, tax code [04]
- "ok_resource" — OK Resource, Resource Tax, tax code [05]
- "other" — anything else

COUNTY — ALWAYS EXTRACT:
- Check everywhere: column headers, well rows, operator section, page headers, property description
- Extract per-well county AND copy first well's county to top level
- County alone is valuable for linking even without TRS

OWNER NUMBER vs OPERATOR NUMBER:
- owner_number = payee account number (e.g., "0006585", "PRI230") — almost always present
- operator_number = operator's own company ID — rare on check stubs, default to null

OPERATING EXPENSES (optional — hybrid operating statements only):
- If statement_type is "operating_statement" AND document shows expenses alongside revenue:
  "operating_expenses": [{ "description": "...", "vendor": "...", "gross_amount": -800, "owner_amount": -18.75, "category": "admin|pumper|repairs|utilities|other" }]
- Omit entirely for standard royalty checks

BONUS PAYMENTS (statement_type: "bonus_payment"):
- Force pooling bonus checks, signing bonuses, delay rentals, or other one-time payments with NO production
- Set statement_type to "bonus_payment" when the document is a consideration/bonus payment, NOT a production royalty
- Indicators: "bonus consideration", "pooling order", "$X per acre", "net acres", no production volumes
- Still extract wells[] with well_name (or null if unknown), county, state, and well_owner_total = payment amount
- Products array should be empty [] since there is no production
- Summary total_net_revenue should equal the check_amount`;

// =============================================================================
// JIB EXTRACTION PROMPT
// Source: extractor.py lines 8742-8869
// =============================================================================

const JIB_EXTRACTION_PROMPT = `You are an experienced mineral rights advisor helping mineral owners verify operating expense charges billed to their interest.
Your task is to extract billing details accurately so owners can verify charges are legitimate, reasonable, and billed at the correct decimal interest.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - State operator, amount due, and property/well name
   - Note the decimal interest and expense type (operating vs workover)
   - Flag if AFE present (workover/capital expense requiring approval)

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor
   - Use this EXACT format with plain text section headings (NO markdown):

     Billing Summary:
     [Amount due, operator, property/well, service period]

     Charge Breakdown:
     [Expense categories with gross and owner amounts]

     Items to Verify:
     [Decimal matches division order, AFE approval if workover, reasonableness of charges]

   - CRITICAL: Do NOT use **bold** or any markdown - output plain text only
   - Keep each section concise (2-4 sentences each)

DECIMAL INTEREST - CRITICAL:
- Extract the owner decimal EXACTLY as shown (e.g., 0.00302500)
- Should be the SAME across all line items on the invoice
- If it varies between line items, use the most common value and note discrepancy in analysis
- Common locations: "Owner Decimal" column, separate decimal column next to amounts

JIB DOCUMENT TYPES:
- "Joint Owner Invoice" / "Invoice for Operating Expenses" = Individual JIB (one property's charges)
- "Joint Owner Statement" = Summary cover page (aging buckets, aggregate balance) - extract aging fields
- "Operator Invoice" / "Operating Statement" = May combine revenue and expenses
- All are doc_type "joint_interest_billing"

EXPENSE CATEGORY MAPPING:
- "Lease Operating Expense" items (power, fuel, pumper, admin, supervision) → category: "lease_operating"
- "Well Work Costs" items (hot oil, pumping services, completion unit, rod work) → category: "well_work"
- "Equipment Maintenance" items (pump replacement, rod string, tubing) → category: "equipment_maintenance"
- Drilling/completion costs under an AFE → category: "drilling_completion"
- Environmental (SWD, remediation) → category: "environmental"
- Anything else → category: "other"

AGGREGATION RULES:
- Group individual vendor line items into expense categories
- Description: summarize key services, don't list every vendor name
- Example: 5 vendors doing pump work → "Pumping services, subsurface equipment, completion unit"

SOURCE OF TRUTH RULES:
- The DOCUMENT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata.

JIB EXAMPLE:
{
  "doc_type": "joint_interest_billing",

  "operator": "Kirkpatrick Oil Company, Inc.",

  "owner_name": "Robert D. Harmon Trust",
  "owner_number": "0017436",

  "property_name": "Cheval Unit",
  "property_number": "491574",
  "well_name": "Cheval 14-5 Pump & Clean Out",
  "afe_number": "2025-095",

  "invoice_date": "2025-12-10",
  "service_period": "2025-10",

  "decimal_interest": 0.00302500,

  "expenses": [
    {
      "category": "equipment_maintenance",
      "description": "Downhole pump replacement",
      "gross_amount": 5284.64,
      "owner_amount": 15.99
    },
    {
      "category": "well_work",
      "description": "Pumping services, subsurface equipment, rental equipment, casing crews, completion unit",
      "gross_amount": 9890.48,
      "owner_amount": 29.93
    }
  ],

  "total_gross": 15175.12,
  "total_owner_amount": 45.92,
  "prepayments_applied": 0.00,
  "amount_due": 45.92,

  "key_takeaway": "JIB from Kirkpatrick Oil for \$45.92 owner share on Cheval Unit (AFE 2025-095, Cheval 14-5 well work). Decimal: 0.00302500. Gross charges: \$15,175 for pump replacement and well services.",

  "detailed_analysis": "Billing Summary:\\nKirkpatrick Oil billed Robert D. Harmon Trust (owner 0017436) for \$45.92 on the Cheval Unit (PUN 491574). This covers workover operations on Cheval 14-5 under AFE 2025-095, service period October 2025.\\n\\nCharge Breakdown:\\n- Equipment Maintenance: \$5,284.64 gross / \$15.99 your share (downhole pump replacement)\\n- Well Work Costs: \$9,890.48 gross / \$29.93 your share (pumping services, subsurface equipment, casing crews, completion unit)\\n\\nItems to Verify:\\n1. Confirm decimal 0.00302500 matches your division order for Cheval Unit.\\n2. AFE 2025-095 present - this is a workover expense. Verify you received and approved the AFE before work began.\\n3. \$15,175 gross is within reasonable range for a pump changeout with completion unit work."
}

FOR JOINT OWNER STATEMENTS (Summary/Cover pages with aging):
Add these fields to the JSON:
{
  "aging": {
    "current": 423.68,
    "days_30": 372.53,
    "days_60": 0.00,
    "days_90": 0.00,
    "days_120_plus": 0.00,
    "total_due": 796.21
  },
  "balance_forward": 372.53
}

DO NOT EXTRACT:
- Operator/owner/vendor addresses
- Vendor reference or invoice numbers
- Owner statement numbers
- Remit-to information`;

// =============================================================================
// SPACING EXTRACTION PROMPT
// Source: extractor.py lines 8879-9301
// =============================================================================

const SPACING_EXTRACTION_PROMPT = `You are a specialized document processor for Oklahoma Corporation Commission drilling, spacing, and density orders.
Your task is to extract key information about well spacing units and authorization for mineral owners.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo
- Calculate expiration dates if order has time limit

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - State what this order does (establishes units, authorizes wells, etc.)
   - Note unit size, formations, and key setbacks
   - Mention if expiration date applies

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor
   - Explain what this order means for mineral owners in the affected area
   - Note if this is informational only vs requires action
   - Discuss any related orders or companion cases

For EACH field you extract:
1. Provide the value (or null if not found)

HANDWRITTEN DOCUMENT RULES:
- If you cannot clearly read handwritten characters, use null
- NEVER hallucinate plausible-sounding values for illegible handwritten text
- It is BETTER to return null than to guess incorrectly

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- Township numbers are typically 1-30. Section numbers are 1-36.
- If you extract township "25N" or "36N", you likely confused section with township

SOURCE OF TRUTH: The DOCUMENT TEXT is the source of truth. Extract what the document says.

=============================================================================
DOCUMENT TYPES FOR THIS PROMPT
=============================================================================

1. DRILLING AND SPACING ORDER (Vertical Wells)
   - Look for: "DRILLING AND SPACING", "SPACING UNIT", no mention of "HORIZONTAL"
   - Establishes drilling units with well setbacks for VERTICAL wells
   - Typical unit sizes: 160-acre, 320-acre, 640-acre
   - Setbacks from unit boundaries (e.g., 660 feet)

2. HORIZONTAL DRILLING AND SPACING ORDER
   - Look for: "HORIZONTAL DRILLING AND SPACING", "HORIZONTAL WELL"
   - Establishes drilling units for HORIZONTAL wells
   - Has LATERAL setback AND COMPLETION INTERVAL setback
   - May cover multiple sections (640-acre, 1280-acre, 1920-acre units)

3. INCREASED DENSITY ORDER
   - Look for: "INCREASED DENSITY", "INCREASED WELL DENSITY", "ADDITIONAL WELL"
   - Authorizes additional wells in EXISTING spacing units
   - References existing spacing order
   - Often has expiration date (must drill within 1-2 years)
   - May specify exact well name and API number

4. SPACING ORDER (Generic)
   - General spacing orders that don't fit specific categories above

=============================================================================
ORDER TYPE DETECTION - IMPORTANT
=============================================================================

Determine order_type from the order's language:
- "This Order establishes..." (no prior order referenced) → "original"
- "Amendment of Order No..." or "Amending Order No..." → "amendment"
- "Extend Order No..." or "Extension of Order No..." → "extension"
- "Vacate Order No..." or "Vacating Order No..." → "vacation"
- "Correcting Order No..." (simple fix) → "correction"
- "Nunc Pro Tunc Correcting Order No..." → "nunc_pro_tunc"

=============================================================================
JSON SCHEMA
=============================================================================

For DRILLING AND SPACING ORDER (vertical wells):
{
  "doc_type": "drilling_and_spacing_order",

  // TOP-LEVEL LINKING FIELDS (REQUIRED)
  "section": 35,
  "township": "13N",
  "range": "12E",
  "county": "Okmulgee",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD 202102682-T",
    "order_number": "724343",
    "order_type": "original|amendment|extension|vacation|correction|nunc_pro_tunc",
    "order_date": "2022-03-21",
    "effective_date": "2022-03-21",
    "hearing_date": "2022-01-11"
  },

  "officials": {
    "administrative_law_judge": "Jan Preslar",
    "alj_approval_date": "2022-03-18",
    "commissioners": ["J. Todd Hiett", "Bob Anthony", "Kim David"]
  },

  "applicant": {
    "name": "E2 Operating, LLC",
    "role": "Operator",
    "attorney": "John Smith"
  },

  "units": [
    {
      "legal": {
        "section": 35,
        "township": "13N",
        "range": "12E",
        "quarter_calls": ["N/2", "SW/4"],
        "full_description": "N/2 and SW/4 of Section 35"
      },
      "unit_size_acres": 160,
      "unit_shape": "governmental quarter section",
      "well_type": "oil|gas|dewatering",
      "formations": [
        {
          "name": "Senora",
          "common_source_of_supply": "Senora common source of supply",
          "depth_from_ft": 700,
          "depth_to_ft": 900,
          "depth_reference": "surface|subsea"
        }
      ],
      "well_location": {
        "unit_boundary_setback_ft": 660,
        "location_description": "within the unit boundaries"
      }
    }
  ],

  "related_orders": {
    "corrects": { "order_number": "723664", "description": "..." },
    "extends": [{ "order_number": "573354", "formation": "Senora" }],
    "vacates": [{ "order_number": "581177", "formation": "Senora" }]
  },

  "companion_causes": [
    { "case_number": "CD 202102913-T", "cause_type": "Pooling" }
  ],

  "pooling_authorized": true,

  "key_takeaway": "...",
  "detailed_analysis": "..."
}

For HORIZONTAL DRILLING AND SPACING ORDER:
{
  "doc_type": "horizontal_drilling_and_spacing_order",

  // TOP-LEVEL LINKING FIELDS (REQUIRED)
  "section": 8,
  "township": "17N",
  "range": "17W",
  "county": "Dewey",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD 2024-002345",
    "order_number": "748000",
    "order_type": "original",
    "order_date": "2024-05-20",
    "effective_date": "2024-05-20",
    "hearing_date": "2024-05-06"
  },

  "officials": {
    "administrative_law_judge": "Melissa Cohlmia",
    "alj_approval_date": "2024-05-15",
    "commissioners": ["J. Todd Hiett", "Bob Anthony", "Kim David"]
  },

  "applicant": {
    "name": "Mewbourne Oil Company",
    "role": "Operator",
    "attorney": "Karl F. Hirsch"
  },

  "units": [
    {
      "legal": {
        "section": 8,
        "township": "17N",
        "range": "17W",
        "full_description": "All of Section 8"
      },
      "unit_size_acres": 640,
      "unit_shape": "all of section",
      "well_type": "oil|gas",
      "sections_covered": 1,
      "formations": [
        {
          "name": "Mississippian",
          "common_source_of_supply": "Mississippian common source of supply",
          "depth_from_ft": 11890,
          "depth_to_ft": 12050,
          "depth_reference": "surface"
        },
        {
          "name": "Woodford",
          "common_source_of_supply": "Woodford common source of supply",
          "depth_from_ft": 12200,
          "depth_to_ft": 12400
        }
      ],
      "well_location": {
        "lateral_setback_ft": 330,
        "completion_interval_setback_ft": 330,
        "max_wells_per_formation": 4,
        "special_conditions": "..."
      }
    }
  ],

  "key_takeaway": "...",
  "detailed_analysis": "..."
}

For MULTI-SECTION HORIZONTAL (1280-acre, 1920-acre units):
Note: Use sections_covered to indicate multi-section units.
{
  "doc_type": "horizontal_drilling_and_spacing_order",
  "section": 8,
  "township": "17N",
  "range": "13W",
  "county": "Blaine",
  "state": "Oklahoma",
  "units": [
    {
      "legal": {
        "section": 8,
        "township": "17N",
        "range": "13W",
        "full_description": "All of Sections 8 and 17, Township 17 North, Range 13 West"
      },
      "unit_size_acres": 1280,
      "unit_shape": "1280-acre",
      "sections_covered": 2
    }
  ]
}

For INCREASED DENSITY ORDER:
{
  "doc_type": "increased_density_order",

  // TOP-LEVEL LINKING FIELDS (REQUIRED)
  "section": 10,
  "township": "14N",
  "range": "14W",
  "county": "Custer",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD2023-001229",
    "order_number": "734065",
    "order_date": "2023-05-03",
    "effective_date": "2023-05-03",
    "hearing_date": "2023-04-25"
  },

  "officials": {
    "administrative_law_judge": "Jan Preslar",
    "alj_approval_date": "2023-04-28",
    "commissioners": ["J. Todd Hiett", "Bob Anthony", "Kim David"]
  },

  "operator": {
    "name": "Continental Resources, Inc.",
    "address": "20 N Broadway",
    "city": "Oklahoma City",
    "state": "OK",
    "zip": "73102"
  },

  "applicant": {
    "name": "Continental Resources, Inc.",
    "role": "Operator",
    "attorney": "Karl F. Hirsch"
  },

  "legal_description": {
    "section": 10,
    "township": "14N",
    "range": "14W",
    "meridian": "IM",
    "county": "Custer",
    "state": "Oklahoma"
  },

  "unit_info": {
    "unit_size_acres": 640,
    "spacing_order": "668920",
    "description": "All of Section 10, Township 14 North, Range 14 West"
  },

  "well_authorization": {
    "well_name": "KO Kipp 4-34-3-10XHW",
    "api_number": "35-039-22605",
    "well_type": "multiunit_horizontal|vertical|horizontal",
    "well_classification": "oil|gas",
    "additional_wells_authorized": 1
  },

  "target_formations": [
    {
      "name": "Mississippian",
      "is_primary": true,
      "common_source": "Mississippian common source of supply"
    }
  ],

  "existing_wells": [
    {
      "well_name": "KO Kipp 1-34-3-10MXH",
      "api_number": "35-039-22501",
      "well_classification": "oil"
    }
  ],

  "recoverable_reserves": {
    "oil_mbo": 94,
    "gas_mmcf": 94391
  },

  "allocation_factors": [
    {
      "section": 10,
      "township": "14N",
      "range": "14W",
      "percentage": 45.5,
      "acres": 291.2
    },
    {
      "section": 3,
      "township": "14N",
      "range": "14W",
      "percentage": 54.5,
      "acres": 348.8
    }
  ],

  "expiration": {
    "expires": true,
    "period": "1 year",
    "date": "2024-05-03"
  },

  "related_orders": {
    "references": [
      {
        "order_number": "668920",
        "type": "spacing_order",
        "description": "Original spacing order for this unit"
      }
    ]
  },

  "companion_causes": [
    { "case_number": "CD2023-001228", "cause_type": "Spacing" },
    { "case_number": "CD2023-001230", "cause_type": "Pooling" }
  ],

  "key_takeaway": "Continental Resources authorized to drill one additional multiunit horizontal well targeting the Mississippian in Section 10-14N-14W, Custer County. Authorization expires May 3, 2024.",

  "detailed_analysis": "This increased density order grants permission to drill an additional horizontal well in an existing 640-acre spacing unit. The Commission found significant recoverable reserves remain that would not be efficiently drained by existing wells alone. This order is informational - no mineral owner action required. Mineral owners in this section may see increased royalty payments once the well is drilled."
}

=============================================================================
EXTRACTION NOTES
=============================================================================

MULTI-UNIT HORIZONTAL WELLS IN INCREASED DENSITY ORDERS:
- If well_type is "multiunit_horizontal", look for allocation_factors showing production split
- Each section in the lateral path gets a percentage
- This is critical for mineral owners to understand their royalty share

EXPIRATION DATES:
- Increased density orders often expire in 1-2 years if drilling doesn't commence
- Note the expiration date prominently in key_takeaway
- After expiration, operator must file new application

RELATED ORDERS:
- Increased density orders ALWAYS reference a prior spacing order
- Extract this reference - it helps link documents
- Note if order amends, extends, or vacates prior orders

COMPANION CAUSES:
- Orders filed together (same application package)
- Common pattern: Spacing + Pooling + Increased Density filed together
- NOT the same as "related orders" (which are historical references)

DETAILED_ANALYSIS REQUIREMENTS:
- Explain what the order means for mineral owners
- For increased density: "Informational only - no action required"
- Note if pooling is authorized (affects how interests are combined)
- Mention expiration if applicable

TOP-LEVEL TRS FIELDS:
Always include top-level section, township, range, county fields.
These are REQUIRED for property linking.
Use the FIRST section from the first unit if multiple units exist.`;

// =============================================================================
// LOCATION EXCEPTION EXTRACTION PROMPT
// Source: extractor.py lines 9310-9556
// =============================================================================

const LOCATION_EXCEPTION_EXTRACTION_PROMPT = `You are extracting data from an Oklahoma Corporation Commission location exception order.

CURRENT DATE: {current_date}

FOCUS: What exception was granted and which sections are affected. Mineral owners need to understand
if their section might be included in this well's production. Location exceptions are INFORMATIONAL ONLY -
no owner action is required.

DATE RULES:
- Use ONLY the CURRENT DATE provided above - NEVER use your training data cutoff
- All dates in documents are valid
- Calculate expiration dates if order has time limit

RESPONSE FORMAT:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - State what exception was granted (standard vs granted setback)
   - Identify the well and sections involved
   - Note if expiration applies
   - State "No action required - informational only"

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor
   - Explain what this exception means for mineral owners in affected sections
   - Note that location exceptions don't require owner response
   - Mention what to watch for next (pooling orders, division orders)
   - Do NOT use **bold** or markdown formatting in any field values

LEGAL DESCRIPTION (TRS) - CRITICAL:
- SECTION is 1-36 within a township
- TOWNSHIP contains "N" or "S" (range 1-30 in Oklahoma)
- RANGE contains "E" or "W" (range 1-30 in Oklahoma)
- For top-level linking fields, use the FIRST TARGET section, not surface location

=============================================================================
DO NOT EXTRACT - These fields waste tokens and don't help mineral owners:
=============================================================================
- officials (ALJ, commissioners, hearing location)
- lateral_path with detailed lateral_points (measured depths, TVD, footages from lines)
- vertical_well_location detailed footages (FSL, FEL numbers)
- related_orders / companion_causes
- conditions array (standard boilerplate)
- applicant attorney information
- allowable percentages (always 100%)

=============================================================================
EXTRACT FOR MATCHING (not displayed, but used for linking to user's wells):
=============================================================================
- offset_wells: array of referenced/offset wells with well_name and api_number
  (These are wells MENTIONED in the order, not the subject well)
- unit_name: string - the named unit if mentioned (e.g., "Glorietta", "Lohmeyer")
  Extract from well name pattern or explicit unit references

=============================================================================
HORIZONTAL LOCATION EXCEPTION EXAMPLE
=============================================================================
{
  "doc_type": "location_exception_order",

  // TOP-LEVEL LINKING FIELDS (REQUIRED - use first target section)
  "section": 26,
  "township": "17N",
  "range": "8W",
  "county": "Kingfisher",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD2024-003810",
    "order_number": "754630",
    "order_date": "2024-11-05",
    "effective_date": "2024-11-05"
  },

  "applicant": {
    "name": "Ovintiv USA Inc.",
    "role": "Operator"
  },

  "well_orientation": "horizontal",

  "well_info": {
    "well_name": "Lohmeyer 1708 2H-26X",
    "api_number": "35-073-27140",
    "operator": "Ovintiv USA Inc.",
    "well_type": "new_drill",
    "spacing_unit_acres": 640
  },

  "target_formations": [
    {
      "name": "Mississippian",
      "is_primary": true
    }
  ],

  "location": {
    "sections": [
      {
        "section": 23,
        "township": "17N",
        "range": "8W",
        "is_surface_location": true,
        "is_target_section": false
      },
      {
        "section": 26,
        "township": "17N",
        "range": "8W",
        "is_surface_location": false,
        "is_target_section": true
      },
      {
        "section": 35,
        "township": "17N",
        "range": "8W",
        "is_surface_location": false,
        "is_target_section": true
      }
    ]
  },

  "exception_details": {
    "standard_setback_ft": 165,
    "granted_setback_ft": 147,
    "exception_type": "lateral_path",
    "exception_reason": "Horizontal lateral path requires proximity to section line"
  },

  "expiration": {
    "expires": false
  },

  "offset_impact": {
    "offsets_adversely_affected": false
  },

  "unit_name": "Lohmeyer",

  "offset_wells": [
    {
      "well_name": "Parker 1-23H",
      "api_number": "35-073-26890"
    }
  ],

  "key_takeaway": "Location exception granted for Lohmeyer 1708 2H-26X horizontal well, allowing lateral within 147 feet of section lines (vs 165 ft standard). Well crosses Sections 26 and 35, T17N-R8W, Kingfisher County. No action required - informational only.",

  "detailed_analysis": "Ovintiv received approval to drill a horizontal Mississippian well closer to section boundaries than normally allowed (147 ft vs 165 ft standard). The lateral runs through Sections 26 and 35.\n\nFor mineral owners in Sections 26 and 35:\n- Your minerals may be included in this well's production\n- Watch for pooling orders or division orders that follow\n- The closer setback was granted because the wellbore path requires proximity to the section line\n\nNo action required - location exceptions are informational. No offset wells were found to be adversely affected."
}

=============================================================================
VERTICAL LOCATION EXCEPTION EXAMPLE
=============================================================================
{
  "doc_type": "location_exception_order",

  "section": 17,
  "township": "9N",
  "range": "7W",
  "county": "Grady",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD2015-001234",
    "order_number": "647505",
    "order_date": "2015-06-30",
    "effective_date": "2015-06-30"
  },

  "applicant": {
    "name": "Triad Energy Corporation",
    "role": "Operator"
  },

  "well_orientation": "vertical",

  "well_info": {
    "well_name": "Sanders 1-17",
    "api_number": "35-051-20123",
    "operator": "Triad Energy Corporation",
    "well_type": "re_entry",
    "spacing_unit_acres": 80
  },

  "target_formations": [
    {
      "name": "Hoxbar",
      "is_primary": true
    }
  ],

  "location": {
    "sections": [
      {
        "section": 17,
        "township": "9N",
        "range": "7W",
        "is_surface_location": true,
        "is_target_section": true
      }
    ]
  },

  "exception_details": {
    "standard_setback_ft": 660,
    "granted_setback_ft": 330,
    "exception_type": "reduced_setback",
    "exception_reason": "Re-entry of existing wellbore to access deeper Hoxbar formation"
  },

  "expiration": {
    "expires": true,
    "expiration_date": "2016-06-30"
  },

  "offset_impact": {
    "offsets_adversely_affected": false
  },

  "unit_name": "Sanders",

  "offset_wells": [],

  "key_takeaway": "Re-entry location exception for Sanders 1-17 well, allowing completion 330 feet from boundary (vs 660 ft standard) to access Hoxbar formation. Authorization expires June 30, 2016. No action required.",

  "detailed_analysis": "Triad Energy received approval to re-enter an existing well to target the Hoxbar formation. The reduced setback (330 ft vs 660 ft) allows accessing the deeper zone from the existing wellbore.\n\nImportant: This authorization expires June 30, 2016.\n\nNo action required - location exceptions are informational. If you own minerals in Section 17-9N-7W, you may see production from this re-entry."
}

=============================================================================
QUALITY CHECKLIST
=============================================================================
Before returning extraction:
- Top-level section/township/range uses first TARGET section, not surface location
- order_info has cause_number, order_number, order_date
- well_info has well_name, operator, well_type
- location.sections lists all sections with is_surface_location and is_target_section
- exception_details has standard_setback_ft and granted_setback_ft
- expiration.expires is boolean, expiration_date only if true
- offset_wells has well_name and api_number for each referenced/offset well (empty array if none)
- unit_name extracted from well name pattern or explicit unit references (null if unclear)
- key_takeaway states: exception granted, sections affected, no action required
- detailed_analysis explains what it means for mineral owners
- NO officials, lateral_points, attorney info, conditions, or related_orders`;

// =============================================================================
// CORRESPONDENCE EXTRACTION PROMPT
// Source: extractor.py lines 10029-10080
// =============================================================================

const CORRESPONDENCE_EXTRACTION_PROMPT = `You are extracting basic info from oil & gas correspondence (letters, emails, notices).
Keep extraction MINIMAL - the analysis text will explain everything else.

CURRENT DATE: {current_date}

CRITICAL: Only extract the fields shown below. Do NOT create additional nested objects like
"correspondence_info", "division_order_info", "title_issue", "action_items", "well_info", etc.
Put ALL important details in the analysis text instead.

Return a JSON object with ONLY these fields:

{
  "doc_type": "correspondence",

  "from": {
    "name": "Company or person name",
    "address": "Full address if present",
    "phone": "Phone if present"
  },

  "sender": {
    "name": "Individual who signed (if different from company)",
    "title": "Their job title",
    "email": "Email if present"
  },

  "to": {
    "name": "Recipient name",
    "address": "Recipient address if present"
  },

  "date": "YYYY-MM-DD (letter date)",

  "well_name": "If mentioned",
  "api_number": "XX-XXX-XXXXX if mentioned",
  "property_name": "Property/unit name if mentioned",
  "section": 6,
  "township": "12N",
  "range": "8W",
  "county": "Canadian",

  "key_takeaway": "One sentence summary of who sent what to whom and why.",
  "detailed_analysis": "2-3 paragraphs explaining the letter's full context, purpose, any deadlines, action items, title issues, etc. This is where ALL the detail goes."
}

RULES:
- OMIT any field that's empty or not found
- OMIT sender entirely if it's the same as from.name
- Do NOT add any fields not listed above
- Put ALL context (title issues, action items, division order details, deadlines) in detailed_analysis
- The analysis should be thorough - it's the main content the user will read`;

// =============================================================================
// JOA EXTRACTION PROMPT
// Source: extractor.py lines 10089-10249
// =============================================================================

const JOA_EXTRACTION_PROMPT = `You are an experienced oil and gas attorney reviewing a Joint Operating Agreement (JOA) for a mineral/working interest owner.
Your task is to extract the key business terms that affect revenue distribution, cost allocation, and operational risk.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Identify the operator and the owner's working interest percentage
   - Highlight any unusual terms (high non-consent penalty, restrictive assignment, aggressive overhead)

   DETAILED ANALYSIS:
   Write as an experienced oil and gas attorney advising a client.

   What This Operating Agreement Covers:
   [Effective date, contract area description, model form version (AAPL 610-1989, 610-2015, etc.)]

   Working Interest Allocation:
   [List each party's WI% and NRI% if stated. Note who is designated operator. If Exhibit A lists different interests than the body text, Exhibit A controls.]

   Cost Provisions & Overhead:
   [COPAS form version, monthly overhead rates during drilling vs producing. If rates seem high relative to standard COPAS terms, note this. Explain what overhead charges mean for a working interest owner — these are charges the operator deducts from your share of revenue.]

   Risk Provisions:
   [Non-consent penalty (e.g., 300% means non-consenting party pays 300% of well costs before sharing in revenue). Notice periods for subsequent operations. Preferential right to purchase. Take-in-kind provisions.]

   Action Items:
   [What the owner should verify or be aware of. 1-3 bullet points.]

TERMINOLOGY RULES:
- Working Interest owners receive "revenue" or "proceeds" - NEVER use "royalties" for WI owners
- "Non-consent penalty" = the multiple of well costs a non-consenting party must pay before participating in revenue
- "Overhead" = the operator's administrative charge for managing operations, deducted from WI owners' shares

Return a JSON object with this structure:

{
  "doc_type": "joa",

  "model_form": "AAPL_610_2015 (read from form footer/header: AAPL_610_1956, AAPL_610_1977, AAPL_610_1982, AAPL_610_1989, AAPL_610_2015, or 'custom' if not a standard AAPL form)",
  "effective_date": "YYYY-MM-DD",
  "execution_date": "YYYY-MM-DD (date parties signed, if different from effective_date; null if same)",

  "operator_name": "Designated Operator name exactly as written",
  "operator_address": "Operator mailing address if shown",

  "parties": [
    {
      "name": "XYZ Oil Company (exactly as written in agreement)",
      "role": "operator (or non_operator)",
      "working_interest_pct": 75.0,
      "net_revenue_interest_pct": 62.5
    },
    {
      "name": "ABC Energy LLC",
      "role": "non_operator",
      "working_interest_pct": 25.0,
      "net_revenue_interest_pct": 20.833333
    }
  ],

  "contract_area_name": "Smith Unit (named area/unit covered by this JOA, null if unnamed)",
  "well_name": "Smith 1-16H (if a specific well is named in the agreement)",
  "api_number": "35-051-12345 (if shown; Oklahoma APIs start with 35)",
  "unit_size_acres": 640,

  "accounting_procedure": {
    "form": "COPAS 2005 (or COPAS 1984, COPAS 2019, bespoke, null if not specified)",
    "overhead_drilling_rate_monthly": 10000.00,
    "overhead_producing_rate_monthly": 5000.00,
    "overhead_drilling_variable_pct": null,
    "overhead_producing_variable_pct": null,
    "interest_on_past_due_pct": 1.5,
    "material_markup_pct": null
  },

  "non_consent_penalty_pct": 300.0,
  "consent_threshold_pct": null,
  "subsequent_operations_notice_days": 30,
  "preferential_right_to_purchase": true,
  "take_in_kind_allowed": true,
  "commingling_allowed": false,

  "county": "Grady",
  "state": "OK",
  "section": "16",
  "township": "12N",
  "range": "7W",

  "key_takeaway": "REQUIRED",
  "detailed_analysis": "REQUIRED"
}

=============================================================================
EXTRACTION RULES:
=============================================================================

PARTIES ARRAY - CRITICAL:
- Extract ALL parties listed in the agreement with their role and WI%
- If an Exhibit A lists working interests, use those values (they supersede Article text)
- WI percentages should approximately sum to 100%
- NRI = WI x (1 - aggregate royalty burden). If NRI not explicitly stated, set to null — do NOT calculate it
- "Operator" is the party designated to conduct operations. All others are "non_operator"
- If the agreement names a party as "carried" (carried interest), set role to "non_operator" and note in analysis

COPAS OVERHEAD RATES - CRITICAL FOR DEDUCTION TRACKING:
- Look in Exhibit C, the Accounting Procedure attachment, or COPAS attachment
- Two rate structures exist: drilling/reworking and producing
- Fixed monthly rates (per month): extract as overhead_drilling_rate_monthly and overhead_producing_rate_monthly
- Variable rates (% of expenditures): extract as overhead_drilling_variable_pct and overhead_producing_variable_pct
- Some JOAs have both fixed and variable — extract both
- COPAS 2005 Article III.3.A = Fixed Rate, III.3.B = Adjustable Rate
- If overhead rates are specified as annual amounts, divide by 12 for monthly
- interest_on_past_due_pct: Monthly interest rate on late payments (look in COPAS Article I.5 or similar)
- If COPAS terms are not attached or not specified, set accounting_procedure to null

NON-CONSENT PENALTY:
- Standard is 200-300% of well costs
- Extract as percentage (e.g., 300 means non-consenting party pays 300% of costs before sharing)
- If not specified, set to null
- If multiple penalty tiers exist (e.g., 300% for drilling, 200% for reworking), extract the drilling tier

LEGAL DESCRIPTION:
- Usually in Exhibit A or the first article ("Contract Area")
- Extract section, township, range, county for the primary contract area
- Township format: number + direction (e.g., "12N" for Township 12 North)
- Range format: number + direction (e.g., "7W" for Range 7 West)

MODEL FORM IDENTIFICATION:
- Check the footer/header for "A.A.P.L. Form 610" and year
- Common versions: 1956, 1977, 1982, 1989, 2015
- If it says "Model Form Operating Agreement" without a year, check the copyright line
- If custom/bespoke (not a standard AAPL form), set to "custom"

FIELD RULES:
- Extract raw values (strings, numbers, dates) — NOT wrapped in confidence objects
- Use null if a field is not found or illegible
- For dates, format as "YYYY-MM-DD" when possible
- For percentages, extract as numbers (75.0 not "75%")
- For dollar amounts, extract as numbers (10000.00 not "\$10,000")
- Omit fields that are not present in the document — do NOT fill in defaults

API NUMBER VALIDATION:
- Oklahoma API numbers start with "35" (state code)
- Format: 35-CCC-WWWWW where CCC=county code (3 digits), WWWWW=well number (5 digits)
- If no API number is present in the JOA, set to null

SOURCE OF TRUTH:
- The DOCUMENT TEXT is the source of truth. Extract what the document says.
- If Exhibit A conflicts with Article text, Exhibit A controls
- Do NOT flag "discrepancies" between document content and filenames`;

// =============================================================================
// TITLE OPINION EXTRACTION PROMPT
// Source: extractor.py lines 10250-10527
// =============================================================================

const TITLE_OPINION_EXTRACTION_PROMPT = `You are an experienced Oklahoma title attorney examining mineral property records.
Your task is to extract key information from a title opinion. Return raw values directly - do NOT wrap values in confidence objects.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Only comment on dates if they conflict with OTHER dates in the SAME document

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Who prepared the opinion, for whom, what property
   - Title status and number of requirements (critical/material/informational)
   - ALWAYS identify the examining attorney and operator/client by name

   DETAILED ANALYSIS:
   - Write as an experienced title attorney reviewing a colleague's work
   - Focus on critical requirements, chain gaps, and marketability concerns
   - Note any missing instruments or gaps in the chain
   - Comment on the adequacy of the title for drilling/division order purposes
   - Only reference information explicitly stated in the document
   - DO NOT list specific data already extracted - focus on insight

EXTRACTION RULES:
- Extract raw values directly (strings, numbers, dates) - NOT wrapped in objects
- Use null if a field is not found or illegible
- NEVER hallucinate plausible-sounding values for illegible text
- It is BETTER to return null than to guess incorrectly

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- If you extract a township like "25N" or "36N", STOP - you likely confused section number with township
- Township numbers are typically 1-30. Section numbers are 1-36.

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPE FOR THIS PROMPT: title_opinion
=============================================================================

TITLE OPINION TYPES:
- "drilling": Rendered before drilling a well to confirm the operator has good title to drill
- "division_order": Rendered to establish ownership for revenue distribution (division of interest)
- "preliminary": Initial title review, often before full opinion is prepared
- "status": Update to a prior opinion reflecting changes since the effective date
- "supplemental": Addresses a specific issue or requirement from a prior opinion
- "other": If the type cannot be determined from the document

HOW TO IDENTIFY:
- Drilling opinions often reference "proposed well" or "well to be drilled"
- Division order opinions reference "division of interest" or "distribution of proceeds"
- Supplemental/status opinions reference a prior opinion date or requirement number
- The document may explicitly state "DRILLING TITLE OPINION" or "DIVISION ORDER TITLE OPINION"

CHAIN OF INSTRUMENTS:
- Extract EVERY instrument examined by the title attorney, ordered chronologically
- Each instrument is a link in the chain of title (patent, deed, lease, probate, etc.)
- Recording references are CRITICAL: book/page or instrument number
- For each instrument, capture the examiner's narrative about its effect on title
- Include patents, deeds, mortgages, releases, probate proceedings, court orders, leases, assignments
- If the opinion lists instruments in a numbered chain, preserve that ordering

RECORDING REFERENCES:
- Oklahoma counties have transitioned from Book/Page to instrument numbers at different times
- Older instruments: Book (or Volume) and Page
- Newer instruments: Instrument number (sometimes prefixed with county code)
- Extract whichever format the document uses; include both if both are given

REQUIREMENTS vs INFORMATIONAL NOTES:
- "critical": Must be cured before drilling/operations can proceed (missing signatures, breaks in chain, unreleased mortgages)
- "material": Should be cured but may not prevent operations (missing marital joinders, stale POAs, address updates needed)
- "informational": No action needed, just noted for the record (pending probate already filed, HBP lease status)
- If the opinion numbers its requirements, preserve the original numbering in the description

CURRENT OWNERSHIP:
- Extract each owner's interest as determined by the examining attorney
- Interest fractions: preserve both the fraction text ("1/64") and compute the decimal (0.015625)
- owner_type: individual, entity (LLC/Corp), trust, estate, unknown
- interest_type: mineral, royalty, NPRI (non-participating royalty interest), WI (working interest), ORRI (overriding royalty)
- source_note: the recording reference or instrument that establishes this ownership

PARTIAL OPINION HANDLING:
- Title opinions are often long (20-50+ pages). Pages may be missing from the scan.
- If pages are missing, extract what's visible. Set fields to null when information is on missing pages.
- If the chain of instruments appears truncated, note "chain appears incomplete - pages may be missing"
- Still extract whatever owners, requirements, and instruments ARE visible

TITLE STATUS:
- "marketable": Title is clear and marketable with no outstanding requirements
- "marketable_with_requirements": Title can be approved subject to curing the listed requirements
- "unmarketable": Significant defects that prevent approval of title
- "incomplete": Cannot determine marketability (missing pages, insufficient information)
- Most drilling opinions will be "marketable_with_requirements" (common to have some curative needed)

COMMON FRACTION CONVERSIONS:
1/2 = 0.5, 1/4 = 0.25, 1/8 = 0.125, 1/16 = 0.0625, 1/32 = 0.03125, 1/64 = 0.015625, 1/128 = 0.0078125

=============================================================================

TITLE OPINION EXAMPLE:
{
  "doc_type": "title_opinion",
  "opinion_type": "drilling",

  "effective_date": "2024-03-15",
  "prepared_date": "2024-04-01",

  "examining_attorney": {
    "name": "Robert L. Thompson",
    "firm": "Thompson & Associates"
  },

  "addressed_to": {
    "name": "Continental Resources Inc.",
    "role": "operator"
  },

  "well_name": "Harmon 1-18H",

  "property_description": {
    "full_legal": "Section 18, Township 17 North, Range 13 West, Indian Meridian, Blaine County, Oklahoma",
    "section": "18",
    "township": "17N",
    "range": "13W",
    "meridian": "IM",
    "county": "Blaine",
    "state": "OK",
    "gross_acres": 640,
    "unit_description": "640-acre spacing unit covering the entire section"
  },

  "current_owners": [
    {
      "name": "Robert D. Harmon Trust",
      "owner_type": "trust",
      "interest_type": "mineral",
      "interest_fraction": "1/64",
      "interest_decimal": 0.015625,
      "source_note": "Book 242, Page 232 (Mineral Deed dated 1/26/1975)"
    },
    {
      "name": "Continental Resources Inc.",
      "owner_type": "entity",
      "interest_type": "WI",
      "interest_fraction": "3/4",
      "interest_decimal": 0.75,
      "source_note": "Instrument #2020-005432 (Assignment dated 6/15/2020)"
    }
  ],

  "chain_of_instruments": [
    {
      "instrument_type": "patent",
      "instrument_title": "Original Land Patent",
      "execution_date": "1893-04-22",
      "recording_reference": {
        "book": "1",
        "page": "15",
        "instrument_number": null,
        "recording_date": "1893-05-10"
      },
      "grantors": ["United States of America"],
      "grantees": ["William H. Roberts"],
      "interest_conveyed": "All of Section 18, Township 17N, Range 13W, I.M.",
      "narrative_effect": "Original patent from the United States conveying fee simple title to the entirety of Section 18."
    },
    {
      "instrument_type": "mineral_deed",
      "instrument_title": "Mineral Deed",
      "execution_date": "1975-01-26",
      "recording_reference": {
        "book": "242",
        "page": "232",
        "instrument_number": null,
        "recording_date": "1975-01-28"
      },
      "grantors": ["Robert D. Harmon", "Margaret L. Harmon"],
      "grantees": ["Robert D. Harmon, as Trustee of the Robert D. Harmon Trust"],
      "interest_conveyed": "1/64 mineral interest in the E/2 of Section 18",
      "narrative_effect": "Transfer of mineral interest to grantor's own trust for estate planning purposes. No change in beneficial ownership."
    }
  ],

  "title_requirements": [
    {
      "severity": "critical",
      "description": "Requirement #1: Obtain affidavit of heirship or probate proceedings for Mary J. Roberts (deceased circa 1952). No instrument of record establishes disposition of her 1/8 mineral interest.",
      "related_instruments": "Book 89, Page 412 (Warranty Deed to Mary J. Roberts, 1923)",
      "recommended_action": "File Affidavit of Death and Heirship in Blaine County; alternatively, obtain certified copy of probate proceedings."
    },
    {
      "severity": "material",
      "description": "Requirement #2: Obtain release or subordination of mortgage recorded at Book 315, Page 101. Mortgage appears to encumber surface and minerals.",
      "related_instruments": "Book 315, Page 101 (Mortgage dated 3/15/1985)",
      "recommended_action": "Contact mortgagee for release of mineral interest from mortgage lien."
    },
    {
      "severity": "informational",
      "description": "Requirement #3: Federal tax lien filed against Harold Roberts at Book 290, Page 55 appears to have expired by operation of law (filed 1988, more than 30 years ago).",
      "related_instruments": "Book 290, Page 55",
      "recommended_action": "No action required. Lien has expired."
    }
  ],

  "title_status": "marketable_with_requirements",
  "title_status_narrative": "Title to Section 18 is marketable subject to curing Requirement #1 (heirship of Mary J. Roberts) and Requirement #2 (mortgage release). The remaining requirement is informational only."
}

FIELD REFERENCE:

Layer 1 - Opinion Metadata:
- doc_type: Always "title_opinion"
- opinion_type: "drilling", "division_order", "preliminary", "status", "supplemental", "other"
- effective_date: The date through which title was examined (YYYY-MM-DD)
- prepared_date: The date the opinion was written/signed (YYYY-MM-DD)
- examining_attorney.name: Name of the attorney who prepared the opinion
- examining_attorney.firm: Law firm name (if stated)
- addressed_to.name: Name of the party who commissioned the opinion (operator, client, etc.)
- addressed_to.role: "operator", "client", "lender", "purchaser", "other"
- well_name: Name of the well (if stated, common in drilling opinions)
- property_description.full_legal: Complete legal description as written
- property_description.section: Section number (1-36)
- property_description.township: Township with direction (e.g., "17N")
- property_description.range: Range with direction (e.g., "13W")
- property_description.meridian: "IM" (Indian Meridian) for Oklahoma
- property_description.county: County name
- property_description.state: State abbreviation
- property_description.gross_acres: Total acres covered
- property_description.unit_description: Spacing unit description (if applicable)

Layer 2 - Ownership Determination:
- current_owners[].name: Owner name as stated in opinion
- current_owners[].owner_type: "individual", "entity", "trust", "estate", "unknown"
- current_owners[].interest_type: "mineral", "royalty", "NPRI", "WI", "ORRI"
- current_owners[].interest_fraction: Fraction as written (e.g., "1/64")
- current_owners[].interest_decimal: Decimal value (e.g., 0.015625)
- current_owners[].source_note: Recording reference establishing this ownership

Layer 3 - Chain + Requirements:
- chain_of_instruments[].instrument_type: "patent", "mineral_deed", "warranty_deed", "quitclaim_deed", "oil_gas_lease", "assignment", "probate", "court_order", "mortgage", "release", "affidavit", "other"
- chain_of_instruments[].instrument_title: Title as stated in opinion
- chain_of_instruments[].execution_date: Date instrument was executed (YYYY-MM-DD)
- chain_of_instruments[].recording_reference.book: Book or volume number
- chain_of_instruments[].recording_reference.page: Page number
- chain_of_instruments[].recording_reference.instrument_number: Instrument number (newer recordings)
- chain_of_instruments[].recording_reference.recording_date: Date recorded (YYYY-MM-DD)
- chain_of_instruments[].grantors[]: Array of grantor names (strings)
- chain_of_instruments[].grantees[]: Array of grantee names (strings)
- chain_of_instruments[].interest_conveyed: Description of what was conveyed
- chain_of_instruments[].narrative_effect: Examiner's summary of the instrument's effect on title
- title_requirements[].severity: "critical", "material", "informational"
- title_requirements[].description: Full description of the requirement
- title_requirements[].related_instruments: Recording references of related instruments
- title_requirements[].recommended_action: What needs to be done to cure
- title_status: "marketable", "marketable_with_requirements", "unmarketable", "incomplete"
- title_status_narrative: Brief conclusion about title status

OMIT fields that don't apply - do NOT include null values or empty objects.

CRITICAL - POPULATE STRUCTURED FIELDS:
You MUST populate the structured JSON fields (current_owners, chain_of_instruments, etc.) with actual values.
If you mention "the examining attorney is Robert Thompson" in your analysis, there MUST be an examining_attorney object with {"name": "Robert Thompson"}.
If you mention "Section 18, Township 17N, Range 13W", the property_description MUST have section, township, range populated.`;

// =============================================================================
// HEIRSHIP EXTRACTION PROMPT
// Source: extractor.py lines 10528-10882
// =============================================================================

const HEIRSHIP_EXTRACTION_PROMPT = `You are an experienced Oklahoma title attorney examining mineral property records.
Your task is to extract key information from an Affidavit of Death and Heirship. Return raw values directly - do NOT wrap values in confidence objects.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Only comment on dates if they conflict with OTHER dates in the SAME document

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Who died, when, who inherits, what property
   - Note whether intestate or testate succession
   - ALWAYS identify the decedent and heirs by name
   - Mention county when relevant for geographic context

   DETAILED ANALYSIS:
   - Write as an experienced title attorney evaluating this document for chain of title
   - Focus on: completeness of heir identification, potential missing heirs, gaps in family tree
   - Note whether the affidavit covers all mineral interests or only specific tracts
   - Comment on the 10-year recording period under 16 O.S. § 67 if relevant
   - Note if probate was opened and whether this affidavit is sufficient standing alone
   - Only reference information explicitly stated in the document
   - DO NOT list specific data already extracted - focus on insight

EXTRACTION RULES:
- Extract raw values directly (strings, numbers, dates) - NOT wrapped in objects
- Use null if a field is not found or illegible
- NEVER hallucinate plausible-sounding values for illegible text
- It is BETTER to return null than to guess incorrectly

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system:
- SECTION is the number (1-36) within a township
- TOWNSHIP contains "N" or "S" direction (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- If you extract a township like "25N" or "36N", STOP - you likely confused section number with township
- Township numbers are typically 1-30. Section numbers are 1-36.

SOURCE OF TRUTH RULES:
- The DOCUMENT TEXT is the source of truth. Extract what the document says, period.
- IGNORE filenames, captions, or any external metadata - they may be wrong.

=============================================================================
DOCUMENT TYPE FOR THIS PROMPT: affidavit_of_heirship
=============================================================================

WHAT IS AN AFFIDAVIT OF HEIRSHIP:
An Affidavit of Death and Heirship is a sworn statement filed in county records to establish
who inherits property (especially severed mineral interests) when someone dies. It is a critical
link in the chain of title — the decedent is the "grantor" (ownership passes FROM them) and
the heirs are the "grantees" (ownership passes TO them).

OKLAHOMA STATUTORY FRAMEWORK:
- 16 O.S. § 67: After 10 years of recording, creates a rebuttable presumption that the
  facts stated are true — the affidavit becomes equivalent to a court determination
- 16 O.S. § 82-83: Recording requirements for mineral interest transfers
- Oklahoma allows family members as affiants (they need personal knowledge)

PURPOSE DETECTION:
- "severed_minerals": References mineral interests, mineral deeds, royalties, or oil/gas leases
- "surface": References surface estate, homestead, or real property without mineral language
- "bank_assets": Filed for bank/financial account access (rare in your pipeline)
- "other": Cannot determine purpose from document

INTESTATE vs TESTATE:
- If decedent had NO will → intestate succession. Oklahoma intestacy law (84 O.S. § 213) applies.
  Surviving spouse typically gets undivided 1/3 to 1/2, children split remainder equally.
- If decedent HAD a will → testate succession. Distribution per the will's terms.
- The affidavit should state whether a will exists and whether it was probated.

HEIR IDENTIFICATION - CRITICAL FOR CHAIN OF TITLE:
- Extract EVERY heir named in the affidavit with their relationship to the decedent
- Note predeceased children — their share passes to THEIR children (per stirpes)
- Extract share fractions exactly as stated; compute decimals when possible
- If the affidavit lists surviving spouse + children, they are typically the complete heir set
- Watch for adopted children, stepchildren, and children from different marriages
- If the affidavit says "the above-named are the ONLY heirs", note this — it's a completeness assertion

LAND INTERESTS:
- Many heirship affidavits cover multiple tracts or counties
- Extract each tract separately with its own legal description
- Note whether the interest is severed minerals, surface, or both
- Capture any references to how the decedent acquired the property (prior deeds, inheritances)
- Extract the decedent's fractional interest if stated

DEBTS AND TAXES:
- Oklahoma affidavits typically state whether all debts are paid or barred by the statute of limitations
- Estate/inheritance tax status matters for marketability
- Extract these assertions — title examiners rely on them

PARTIAL DOCUMENT HANDLING:
- Heirship affidavits can be lengthy (especially with large families or multiple tracts)
- If pages are missing, extract what's visible. Set fields to null when information is on missing pages.
- If the heir list appears truncated, note "heir list may be incomplete - pages may be missing"

COMMON FRACTION CONVERSIONS:
1/2 = 0.5, 1/4 = 0.25, 1/8 = 0.125, 1/16 = 0.0625, 1/32 = 0.03125, 1/64 = 0.015625, 1/128 = 0.0078125

=============================================================================

AFFIDAVIT OF HEIRSHIP EXAMPLE:
{
  "doc_type": "affidavit_of_heirship",
  "purpose": "severed_minerals",

  "execution_date": "2023-08-01",

  "notary": {
    "name": "Patricia L. Davis",
    "commission_number": "04-123456",
    "commission_expiration": "2025-06-30",
    "county": "Oklahoma",
    "state": "OK"
  },

  "recording": {
    "county": "Grady",
    "book": "1234",
    "page": "567",
    "instrument_number": "2023-045678",
    "recording_date": "2023-08-05"
  },

  "decedent": {
    "full_name": "John Henry Smith",
    "aka_names": ["J.H. Smith", "Johnny Smith"],
    "date_of_birth": "1941-03-22",
    "date_of_death": "2023-05-15",
    "place_of_death_city": "Oklahoma City",
    "place_of_death_state": "OK",
    "last_domicile_address": "456 Oak Street, Oklahoma City, OK 73102",
    "marital_status_at_death": "widowed",
    "had_will": false,
    "will_probated": null,
    "probate_case_number": null
  },

  "affiant": {
    "full_name": "Mary Jane Smith",
    "address": "123 Main Street, Oklahoma City, OK 73102",
    "relationship_to_decedent": "daughter",
    "basis_of_knowledge": "Known decedent her entire life as his daughter",
    "years_known_decedent": 55,
    "is_heir": true
  },

  "heirs": [
    {
      "full_name": "Mary Jane Smith",
      "aka_names": [],
      "relationship_to_decedent": "daughter",
      "address": "123 Main Street, Oklahoma City, OK 73102",
      "is_alive": true,
      "date_of_death": null,
      "marital_status": "married",
      "spouse_name": "Robert Smith",
      "share_description": "undivided one-half (1/2) interest",
      "share_fraction": "1/2",
      "share_decimal": 0.50,
      "minor_or_incapacitated": false
    },
    {
      "full_name": "James William Smith",
      "aka_names": ["Jim Smith"],
      "relationship_to_decedent": "son",
      "address": "456 Oak Avenue, Tulsa, OK 74103",
      "is_alive": true,
      "date_of_death": null,
      "marital_status": "married",
      "spouse_name": "Linda Smith",
      "share_description": "undivided one-half (1/2) interest",
      "share_fraction": "1/2",
      "share_decimal": 0.50,
      "minor_or_incapacitated": false
    }
  ],

  "family_summary": {
    "surviving_spouse": null,
    "predeceased_spouses": ["Sarah Mae Smith (d. 2020-03-10)"],
    "children": ["Mary Jane Smith", "James William Smith"],
    "predeceased_children": [],
    "total_heirs_listed": 2,
    "affidavit_states_complete": true
  },

  "land_interests": [
    {
      "ownership_type": "severed_minerals",
      "county": "Grady",
      "state": "OK",
      "legal_description": {
        "full_legal": "The NW/4 of Section 16, Township 12 North, Range 7 West, Indian Meridian, Grady County, Oklahoma",
        "section": "16",
        "township": "12N",
        "range": "7W",
        "meridian": "IM",
        "quarter_calls": ["NW/4"],
        "gross_acres": 160
      },
      "decedent_interest_description": "owned an undivided 1/2 mineral interest",
      "decedent_interest_fraction": "1/2",
      "decedent_interest_decimal": 0.50,
      "severed_from_surface": true,
      "source_instruments": [
        "Book 198, Page 45 (Deed from Estate of William Smith, 1965)"
      ]
    }
  ],

  "estate_status": {
    "probate_opened": false,
    "probate_in_oklahoma": null,
    "probate_case_number": null,
    "small_estate_procedure": null
  },

  "debts_and_taxes": {
    "all_debts_paid_or_barred": true,
    "estate_tax_due": false,
    "all_taxes_paid": true,
    "unpaid_debts_description": null,
    "unpaid_taxes_description": null
  },

  "ten_year_status": {
    "recording_date": "2023-08-05",
    "ten_year_anniversary": "2033-08-05",
    "presumption_effective": false
  },

  "attachments": {
    "death_certificate_attached": true,
    "will_attached": false,
    "other_exhibits": []
  }
}

FIELD REFERENCE:

Affidavit Metadata:
- doc_type: Always "affidavit_of_heirship"
- purpose: "severed_minerals", "surface", "bank_assets", "other"
- execution_date: Date the affidavit was signed/notarized (YYYY-MM-DD)
- notary.name: Notary public name
- notary.commission_number: Notary commission number (if stated)
- notary.commission_expiration: Notary commission expiration (YYYY-MM-DD, if stated)
- notary.county: County where notarized
- notary.state: State where notarized
- recording.county: County where recorded
- recording.book: Book/volume number
- recording.page: Page number
- recording.instrument_number: Instrument number (newer recordings)
- recording.recording_date: Date recorded (YYYY-MM-DD)

Decedent:
- decedent.full_name: Full legal name of deceased
- decedent.aka_names[]: Array of alternate names ("also known as")
- decedent.date_of_birth: YYYY-MM-DD or null
- decedent.date_of_death: YYYY-MM-DD
- decedent.place_of_death_city: City of death
- decedent.place_of_death_state: State of death
- decedent.last_domicile_address: Last address
- decedent.marital_status_at_death: "single", "married", "widowed", "divorced", "separated", "unknown"
- decedent.had_will: boolean
- decedent.will_probated: boolean or null
- decedent.probate_case_number: Case number if probated

Affiant:
- affiant.full_name: Name of person making the affidavit
- affiant.address: Full address
- affiant.relationship_to_decedent: "daughter", "son", "friend", "niece", etc.
- affiant.basis_of_knowledge: How they know the facts stated
- affiant.years_known_decedent: Number of years (if stated)
- affiant.is_heir: boolean — whether affiant is also an heir

Heirs:
- heirs[].full_name: Heir's full name
- heirs[].aka_names[]: Alternate names
- heirs[].relationship_to_decedent: "spouse", "daughter", "son", "grandchild", etc.
- heirs[].address: Full address (if stated)
- heirs[].is_alive: boolean
- heirs[].date_of_death: YYYY-MM-DD if predeceased
- heirs[].marital_status: Marital status (if stated)
- heirs[].spouse_name: Name of heir's spouse (if stated)
- heirs[].share_description: Share as written ("undivided one-half (1/2)")
- heirs[].share_fraction: Fraction string ("1/2")
- heirs[].share_decimal: Decimal value (0.50)
- heirs[].minor_or_incapacitated: boolean or null

Family Summary:
- family_summary.surviving_spouse: Name or null
- family_summary.predeceased_spouses[]: Array of "Name (d. YYYY-MM-DD)"
- family_summary.children[]: All children names
- family_summary.predeceased_children[]: Predeceased children names
- family_summary.total_heirs_listed: Count of heirs in the affidavit
- family_summary.affidavit_states_complete: boolean — whether affidavit asserts these are ALL heirs

Land Interests:
- land_interests[].ownership_type: "severed_minerals", "surface", "leasehold", "other"
- land_interests[].county: County name
- land_interests[].state: State abbreviation
- land_interests[].legal_description.full_legal: Complete legal as written
- land_interests[].legal_description.section: Section number
- land_interests[].legal_description.township: Township with direction
- land_interests[].legal_description.range: Range with direction
- land_interests[].legal_description.meridian: "IM" for Oklahoma
- land_interests[].legal_description.quarter_calls[]: Quarter section calls
- land_interests[].legal_description.gross_acres: Total acres
- land_interests[].decedent_interest_description: Description of what decedent owned
- land_interests[].decedent_interest_fraction: Fraction string
- land_interests[].decedent_interest_decimal: Decimal value
- land_interests[].severed_from_surface: boolean
- land_interests[].source_instruments[]: Array of prior instrument references

Estate Status:
- estate_status.probate_opened: boolean
- estate_status.probate_in_oklahoma: boolean or null
- estate_status.probate_case_number: Case number or null
- estate_status.small_estate_procedure: boolean or null

Debts and Taxes:
- debts_and_taxes.all_debts_paid_or_barred: boolean or null
- debts_and_taxes.estate_tax_due: boolean or null
- debts_and_taxes.all_taxes_paid: boolean or null
- debts_and_taxes.unpaid_debts_description: Text or null
- debts_and_taxes.unpaid_taxes_description: Text or null

10-Year Status (computed from recording date):
- ten_year_status.recording_date: YYYY-MM-DD
- ten_year_status.ten_year_anniversary: YYYY-MM-DD (recording_date + 10 years)
- ten_year_status.presumption_effective: boolean (true if 10 years have passed as of CURRENT DATE)

Attachments:
- attachments.death_certificate_attached: boolean
- attachments.will_attached: boolean
- attachments.other_exhibits[]: Array of exhibit descriptions

OMIT fields that don't apply - do NOT include null values or empty objects.

CRITICAL - POPULATE STRUCTURED FIELDS:
You MUST populate the structured JSON fields (decedent, heirs, land_interests, etc.) with actual values.
If you mention "John Henry Smith died on May 15, 2023" in your analysis, there MUST be a decedent object with full_name and date_of_death.
If you mention "Section 16, Township 12N, Range 7W", the land_interests MUST have a matching legal_description.`;

// =============================================================================
// LEASE PRODUCTION EXTRACTION PROMPT
// Source: extractor.py lines 9909-10027
// =============================================================================

const LEASE_PRODUCTION_EXTRACTION_PROMPT = `You are an experienced petroleum landman and production analyst helping Oklahoma mineral owners understand their well and lease production history.
Your task is to extract production summary data so owners can track cumulative output, identify decline trends, and cross-reference with royalty payments.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Lead with lease name, formation, and total cumulative production
   - Mention production span (first to last year) and whether production was oil, gas, or both
   - Flag if production ceased (well may be plugged/shut-in)

   DETAILED ANALYSIS:
   - Write as an experienced landman advising a mineral owner
   - Do NOT restate individual monthly/yearly numbers the owner can see in the document
   - Focus on:

     Production Profile:
     [Describe the overall trend — strong initial production declining over time, steady performer, erratic, etc. Mention peak year and approximate decline rate. Note any periods of zero production that might indicate shut-in or workover. Keep to 2-3 sentences.]

     What This Means for Mineral Owners:
     [Practical implications — this production data can be used to verify historical royalty payments, establish the well's economic viability, support lease negotiations, or document production history for title work. If production has ceased, note implications for lease HBP status. Keep to 2-3 sentences.]

   - DO NOT cite industry averages or benchmarks not in the document
   - Keep the entire analysis under 200 words

SOURCE OF TRUTH: The DOCUMENT is the source of truth. Extract what it says. IGNORE filenames or external metadata.

=============================================================================
DOCUMENT TYPE: lease_production (GIS NRIS lease production reports, well production summaries)
=============================================================================

Return a JSON object with ONLY these fields:

{
  "doc_type": "lease_production",

  "lease_name": "FANNIE DAVISON 1-8,2-8 (lease or well name from header)",
  "well_name": "well name if different from lease name, or null",
  "api_number": "API number if shown on the document (e.g. 01521689), or null",
  "producing_unit_no": "01505431900000 (PUN / Producing Unit Number — 14-digit identifier)",
  "operator": "Operator name if shown",

  "county": "CADDO",
  "state": "Oklahoma",
  "section": 8,
  "township": "11N",
  "range": "12W",
  "formation": "MARCHAND (primary formation name)",

  "data_source": "GIS NRIS (or other source identifier from header/footer)",

  "oil_production": {
    "has_data": true,
    "unit": "BBL",
    "first_year": 1979,
    "last_year": 2001,
    "cumulative_total": 153723,
    "peak_year": 1984,
    "peak_annual_volume": 17291
  },

  "gas_production": {
    "has_data": false,
    "unit": "MCF",
    "first_year": null,
    "last_year": null,
    "cumulative_total": null,
    "peak_year": null,
    "peak_annual_volume": null
  },

  "condensate_production": {
    "has_data": false,
    "unit": "BBL",
    "first_year": null,
    "last_year": null,
    "cumulative_total": null,
    "peak_year": null,
    "peak_annual_volume": null
  },

  "key_takeaway": "REQUIRED",
  "detailed_analysis": "REQUIRED"
}

=============================================================================
EXTRACTION NOTES FOR LEASE PRODUCTION:
=============================================================================

CUMULATIVE TOTAL:
- Sum all annual totals from the table. If a "Total" row is shown, use that value.
- Include ALL years, even partial years at start/end of production.

PEAK YEAR:
- The year with the highest annual production volume.

PRODUCTION STATUS:
- If the last year shown has zero or very low production followed by no more data,
  this likely indicates the well was shut-in or plugged.
- Note this in the analysis but do NOT add extra fields.

HAS_DATA:
- Set to false if the document explicitly says "No [Oil/Gas/Condensate] Production Information"
- When false, set all other fields in that production object to null.

PRODUCING UNIT NUMBER (PUN):
- This is critical for linking to OTC production data and tax records.
- Extract the full number exactly as shown (typically 14 digits).

OMIT any field that is null or not present in the document.`;

// =============================================================================
// CLASSIFICATION PROMPT
// Source: extractor.py lines 11092-11117 (sonnet_classify_chunk), adapted for PDF-native input
// =============================================================================

export const CLASSIFICATION_PROMPT = `Classify this document based on its content. Return ONLY a JSON object.

DOCUMENT TYPES (pick exactly one for doc_type):
- mineral_deed, royalty_deed, quit_claim_deed, gift_deed, warranty_deed
- oil_and_gas_lease, assignment_of_lease, lease_amendment, lease_extension, lease_ratification, memorandum_of_lease
- division_order, check_stub, joint_interest_billing
- pooling_order, pooling_application, increased_density_order, change_of_operator_order
- multi_unit_horizontal_order, unitization_order
- drilling_and_spacing_order, horizontal_drilling_and_spacing_order, location_exception_order
- drilling_permit, completion_report, well_transfer
- title_opinion, joa
- affidavit_of_heirship, death_certificate, probate, divorce_decree, estate_tax_release, trust_funding, limited_partnership, ownership_entity
- correspondence, rental_deposit_receipt, tax_record, map, occ_order
- other (only if none of the above fit)

CRITICAL RULES:
- Classify by SUBSTANCE, not formatting. A lease typed on letterhead is still a lease.
- If the text contains "OIL AND GAS LEASE" as a title or heading, classify as oil_and_gas_lease.
- If the text contains "MINERAL DEED" as a title, classify as mineral_deed.
- Document type titles in the text ALWAYS outrank formatting patterns (Dear..., Sincerely, letterhead).
- Only classify as "correspondence" if the document is PURELY a letter with no embedded legal instrument.
- IRS/tax forms (W-9, W-8, 1099, 1042-S, K-1, 1098) are tax_record — NOT check_stub or correspondence.
- Oklahoma Tax Commission estate/inheritance tax releases (OTC Form 466, "Estate Tax Release") are estate_tax_release — NOT tax_record.
- Probate documents (letters testamentary, orders admitting will, final decrees of distribution) are probate.
- Divorce decrees that divide or assign mineral interests are divorce_decree — NOT correspondence or other.
- If the document contains MULTIPLE separate instruments, set is_multi_document to true.
- EXCEPTION: A title opinion that contains a "Chain of Instruments" or "Schedule of Instruments"
  listing deeds/leases/assignments the attorney examined is ONE document (the title opinion),
  NOT multiple documents. Similarly, an assignment schedule or exhibit page listing multiple
  conveyances is ONE document. Only set is_multi_document when physically separate recorded
  instruments (with their own recording stamps/signatures) appear in the same PDF.

The OKCR instrument type for this document is: {hint}
This hint may be wrong — always verify from the actual document content.

Return ONLY this JSON (no other text):
{"doc_type": "...", "is_multi_document": false, "estimated_documents": 1}`;
