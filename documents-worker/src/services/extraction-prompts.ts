/**
 * Extraction Prompts for County Records
 *
 * Ported from processor/mineral-watch-processor/src/extractor.py
 * Same battle-tested prompts used for user-uploaded documents.
 *
 * LEASE prompt: covers oil_gas_lease, lease_amendment, lease_extension, lease_ratification, memorandum_of_lease
 * DEED prompt: covers mineral_deed, royalty_deed, warranty_deed, quitclaim_deed, gift_deed, trust_funding, assignment_of_lease
 * GENERIC prompt: fallback for unknown document types
 */

// Instrument type names from OKCR vary by county (e.g., "Oil & Gas Lease" vs "Oil And Gas Lease")
// This function normalizes and selects the right prompt
export function getExtractionPrompt(instrumentType?: string): string {
  if (!instrumentType) return GENERIC_EXTRACTION_PROMPT;

  const normalized = instrumentType.toLowerCase().trim();

  // Lease types
  if (
    normalized.includes('lease') ||
    normalized.includes('memorandum') ||
    normalized.includes('ratification')
  ) {
    return LEASE_EXTRACTION_PROMPT;
  }

  // Deed types
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

  // Pooling / OCC force pooling types
  if (
    normalized.includes('pooling') ||
    normalized.includes('force pool')
  ) {
    return POOLING_EXTRACTION_PROMPT;
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

EXAMPLE EXTRACTION:
{
  "doc_type": "oil_gas_lease",
  "lease_form": "Hefner Form or AAPL Form 675 or omit if unknown",

  "lessor": {
    "name": "REQUIRED - Price Oil & Gas, Ltd.",
    "address": "6801 N. Country Club Drive",
    "city": "Oklahoma City",
    "state": "OK",
    "zip": "73116",
    "capacity": "Mineral Owner|Trustee|Personal Representative|Guardian|Attorney-in-Fact|Manager|President",
    "signatory": "William S. Price - person who signed if different from entity",
    "signatory_title": "Manager - title if signing in representative capacity"
  },

  "lessee": {
    "name": "REQUIRED - Hefner Energy, LLC",
    "address": "16224 Muirfield Place",
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
    "original_lessee": "Hefner Energy, LLC",
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

MINERAL DEED EXAMPLE:
{
  "doc_type": "mineral_deed",
  "deed_type": "warranty",

  "grantors": [
    {
      "name": "Joel S. Price",
      "address": "6801 No. Country Club Dr., Oklahoma City, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    },
    {
      "name": "Virginia K. Price",
      "address": "6801 No. Country Club Dr., Oklahoma City, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    }
  ],

  "grantees": [
    {
      "name": "Joel S. Price",
      "address": "6801 N. Ctry Club Dr. O.C.",
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
- Trust name mentioned (e.g., "Virginia K. Price Trust")
- Often includes nominal consideration ($10.00)

{
  "doc_type": "trust_funding",
  "deed_type": "quitclaim",

  "grantors": [
    {
      "name": "Virginia K. Price",
      "capacity": "Individual"
    }
  ],

  "grantees": [
    {
      "name": "Virginia K. Price Trust dated January 15, 1990",
      "trustee": "Virginia K. Price",
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
    "quarters": "SE/4"
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
      "royalty_rate": "1/8",
      "excess_royalty": null,
      "nri_delivered": null,
      "risk_penalty_percentage": null,
      "is_default": false
    },
    {
      "option_number": 2,
      "option_type": "cash_bonus_excess_royalty",
      "description": "Cash bonus plus excess royalty",
      "bonus_per_nma": 350,
      "cost_per_nma": null,
      "royalty_rate": "1/8",
      "excess_royalty": "1/16",
      "nri_delivered": "81.25%",
      "risk_penalty_percentage": null,
      "is_default": true
    },
    {
      "option_number": 3,
      "option_type": "no_cash_higher_royalty",
      "description": "No cash, higher royalty",
      "bonus_per_nma": null,
      "cost_per_nma": null,
      "royalty_rate": "1/8",
      "excess_royalty": "1/8",
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

ELECTION OPTIONS - EXTRACT ALL with ALL financial terms:
- option_number, option_type, is_default are required for every option
- Extract: bonus_per_nma, cost_per_nma, royalty_rate, excess_royalty, nri_delivered
- The DEFAULT option is critical - what happens if owner doesn't respond

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
