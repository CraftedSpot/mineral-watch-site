"""Document extraction using Claude Vision API with per-field confidence and batching."""

import anthropic
import base64
import json
import logging
import asyncio
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from .config import CONFIG

logger = logging.getLogger(__name__)


# ============================================================================
# NAME NORMALIZATION FOR CHAIN OF TITLE
# ============================================================================

def normalize_party_name(name: str) -> str:
    """
    Normalize a party name for chain of title matching.

    Rules:
    - Convert to uppercase
    - Format individuals as "LAST, FIRST MIDDLE"
    - Remove titles (Mr., Mrs., Dr., etc.)
    - Standardize suffixes (Jr., Sr., III, etc.)
    - Standardize corporate suffixes (LLC, Inc., etc.)
    - Preserve maiden names in parentheses

    Args:
        name: Raw name string from document

    Returns:
        Normalized name string for matching
    """
    if not name:
        return ""

    name = str(name).strip()
    if not name:
        return ""

    # Convert to uppercase for consistency
    name = name.upper()

    # Remove common titles
    titles = [
        r'\bMR\.?\s*', r'\bMRS\.?\s*', r'\bMS\.?\s*', r'\bMISS\s+',
        r'\bDR\.?\s*', r'\bREV\.?\s*', r'\bHON\.?\s*'
    ]
    for title in titles:
        name = re.sub(title, '', name, flags=re.IGNORECASE)

    # Standardize suffixes
    suffix_map = {
        r'\bJUNIOR\b': 'JR',
        r'\bJR\.?\b': 'JR',
        r'\bSENIOR\b': 'SR',
        r'\bSR\.?\b': 'SR',
        r'\bII\b': 'II',
        r'\bIII\b': 'III',
        r'\bIV\b': 'IV',
    }

    suffix_found = None
    for pattern, replacement in suffix_map.items():
        if re.search(pattern, name):
            suffix_found = replacement
            name = re.sub(pattern, '', name)
            break

    # Check if this is a company/entity (not an individual)
    company_indicators = [
        r'\bLLC\b', r'\bL\.L\.C\.?\b', r'\bLIMITED LIABILITY\b',
        r'\bINC\.?\b', r'\bINCORPORATED\b',
        r'\bCORP\.?\b', r'\bCORPORATION\b',
        r'\bCO\.?\b', r'\bCOMPANY\b',
        r'\bLTD\.?\b', r'\bLIMITED\b',
        r'\bLP\b', r'\bL\.P\.?\b', r'\bLIMITED PARTNERSHIP\b',
        r'\bLLP\b', r'\bL\.L\.P\.?\b',
        r'\bTRUST\b', r'\bESTATE\b', r'\bESTATE OF\b',
        r'\bPARTNERS\b', r'\bPARTNERSHIP\b',
        r'\bASSOCIATES\b', r'\bGROUP\b', r'\bHOLDINGS\b',
        r'\bENERGY\b', r'\bRESOURCES\b', r'\bOIL\b', r'\bGAS\b',
        r'\bPETROLEUM\b', r'\bOPERATING\b', r'\bPRODUCTION\b',
        r'\b&\b', r'\bAND\b'
    ]

    is_company = any(re.search(pattern, name) for pattern in company_indicators)

    if is_company:
        # For companies, standardize common suffixes and clean up
        name = re.sub(r'\bL\.L\.C\.?\b', 'LLC', name)
        name = re.sub(r'\bLIMITED LIABILITY COMPANY\b', 'LLC', name)
        name = re.sub(r'\bINCORPORATED\b', 'INC', name)
        name = re.sub(r'\bCORPORATION\b', 'CORP', name)
        name = re.sub(r'\bLIMITED PARTNERSHIP\b', 'LP', name)
        name = re.sub(r'\bL\.P\.?\b', 'LP', name)
        name = re.sub(r'\bL\.L\.P\.?\b', 'LLP', name)
        name = re.sub(r'\bCOMPANY\b', 'CO', name)
        name = re.sub(r'\bLIMITED\b', 'LTD', name)
        # Clean up extra spaces and punctuation
        name = re.sub(r'\s+', ' ', name).strip()
        name = re.sub(r'\s*,\s*', ', ', name)
        return name

    # For individuals, convert to "LAST, FIRST MIDDLE" format
    # Clean up the name first
    name = re.sub(r'\s+', ' ', name).strip()
    name = name.replace(',', ' ')  # Remove any existing commas
    name = re.sub(r'\s+', ' ', name).strip()

    parts = name.split()

    if len(parts) == 0:
        return ""
    elif len(parts) == 1:
        # Just a last name
        result = parts[0]
    elif len(parts) == 2:
        # First Last -> LAST, FIRST
        result = f"{parts[1]}, {parts[0]}"
    else:
        # First Middle Last -> LAST, FIRST MIDDLE
        # Or First Middle Middle Last -> LAST, FIRST MIDDLE MIDDLE
        last = parts[-1]
        first_and_middle = ' '.join(parts[:-1])
        result = f"{last}, {first_and_middle}"

    # Add suffix back if found
    if suffix_found:
        result = f"{result} {suffix_found}"

    return result


def normalize_party_names(names: List[str]) -> List[str]:
    """
    Normalize a list of party names.

    Args:
        names: List of raw name strings

    Returns:
        List of normalized name strings
    """
    if not names:
        return []
    return [normalize_party_name(name) for name in names if name]

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=CONFIG.ANTHROPIC_API_KEY)

# Batch configuration
PAGES_PER_BATCH = 10
BATCH_DELAY_SECONDS = 3
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 60

DETECTION_PROMPT = """You are analyzing a PDF that may contain one or more mineral rights documents.

Your task is to identify EVERY separate legal document in this PDF.

CRITICAL: Each recorded document is a SEPARATE document, even if they appear similar.
Look for these indicators that signal a NEW document:
- Recording stamps with different book/page numbers (even sequential pages like 57, 58, 59)
- Different instrument or document numbers
- Different recording dates or times
- Signature pages followed by new content
- New cover pages or headers
- Changes in parties, even if subtle

COMMON PATTERN: A bundle of similar mineral deeds recorded sequentially
- Example: 40 deeds from same grantor, each recorded on different book/page
- Each deed with its own recording info is a SEPARATE document
- Do NOT group them as one document just because they're similar

IMPORTANT: If you see many similar documents (like multiple mineral deeds),
report them as SEPARATE documents if they have different recording references.
This is critical for maintaining proper title chain records.

Return ONLY valid JSON in this format:

For single document:
{
  "is_multi_document": false,
  "document_count": 1,
  "documents": [
    {
      "type": "mineral_deed",
      "start_page": 1,
      "end_page": 4,
      "confidence": 0.95
    }
  ]
}

For multiple documents (including bundles of similar documents):
{
  "is_multi_document": true,
  "document_count": 40,
  "documents": [
    {
      "type": "mineral_deed",
      "start_page": 1,
      "end_page": 1,
      "confidence": 0.90
    },
    {
      "type": "mineral_deed",
      "start_page": 2,
      "end_page": 2,
      "confidence": 0.90
    },
    // ... continue for all documents ...
  ]
}

IMPORTANT: 
- If you detect MANY similar documents (e.g., 20+ mineral deeds), still return is_multi_document: true
- You don't need to list every single document if there are too many
- If there are more than 10 documents, you can summarize with a note like:
  "documents": [
    {"type": "mineral_deed", "start_page": 1, "end_page": 1, "confidence": 0.90},
    {"type": "mineral_deed", "start_page": 2, "end_page": 2, "confidence": 0.90},
    {"note": "... and 38 more similar mineral_deed documents through page 40"}
  ]

Valid document types:
- division_order
- mineral_deed (includes royalty deeds, assignments, quitclaims)
- lease
- drilling_permit
- title_opinion
- check_stub (royalty statements, payment stubs)
- pooling_order (forced pooling orders with election options - use this for pooling specifically)
- increased_density_order (authorizes additional wells in existing unit - look for "INCREASED WELL DENSITY")
- change_of_operator_order (transfer of operatorship from one company to another - look for "CHANGE OF OPERATOR")
- multi_unit_horizontal_order (horizontal well authorization spanning multiple sections/units - look for allocation percentages)
- drilling_and_spacing_order (VERTICAL well spacing - establishes drilling/spacing units with well setbacks - look for "DRILLING AND SPACING", "SPACING UNIT", unit size like 160-acre, 640-acre with formation-specific setbacks)
- horizontal_drilling_and_spacing_order (HORIZONTAL well spacing - establishes horizontal drilling units - look for "HORIZONTAL DRILLING AND SPACING", "HORIZONTAL WELL", lateral setbacks, completion interval setbacks)
- location_exception_order (well location exceptions - permits drilling closer to boundaries than standard setbacks - look for "LOCATION EXCEPTION", footage distances, "exception from")
- occ_order (other OCC orders - NOT pooling, increased density, change of operator, multi-unit horizontal, spacing, or location exception)
- suspense_notice (Form 1081, escrow notices)
- joa (Joint Operating Agreement)
- affidavit_of_heirship (sworn statement identifying heirs of a deceased mineral owner - look for "AFFIDAVIT OF HEIRSHIP", decedent name, list of heirs/children/spouses, notarized)
- ownership_entity (probate, trust docs, LLC docs - NOT affidavit of heirship)
- legal_document (lawsuits, judgments, court orders)
- correspondence
- tax_record (tax assessments, property tax records)
- map (includes plats)
- multi_document
- other
"""

EXTRACTION_PROMPT_TEMPLATE = """You are a specialized document processor for Oklahoma mineral rights documents.
Your task is to extract key information and provide a confidence score (0.0-1.0) for each field.

CURRENT DATE: {current_date}

DATE ANALYSIS RULES:
- Use ONLY the CURRENT DATE provided above when reasoning about time - NEVER use your training data cutoff
- All dates in documents are valid - do not flag any date as "in the future" or a typo based on your knowledge cutoff
- Only comment on dates if they conflict with OTHER dates in the SAME document (e.g., the same event listed with two different years)
- Division orders commonly have effective dates BEFORE the document date (often 6-18 months earlier) - this is NORMAL
- Retrospective effective dates reflect when production/ownership began, not when paperwork was processed
- Do NOT speculate that dates are typos unless literally impossible (e.g., effective date after document date by years)

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add TWO sections:

   KEY TAKEAWAY:
   - 2-3 sentences maximum
   - Lead with actions needed, if any
   - Answer: what does this mean for the mineral owner?
   - ALWAYS identify the owner entity by name
   - When multiple documents exist for same well, include distinguishing details (interest type, owner number) to differentiate
   - Mention county when relevant for geographic context
   - Include owner number (e.g., "PRI38") when it helps identify the record

   DETAILED ANALYSIS:
   - Write as an experienced mineral rights advisor providing insight to a client
   - Focus on what's genuinely significant, unusual, or actionable
   - Be direct and substantive - highlight implications that even experts might miss
   - Only reference information explicitly stated in the document
   - DO NOT list specific data already extracted (dates, names, etc.) - focus on insight, not summary

TERMINOLOGY RULES:
- Working Interest owners receive "revenue" or "proceeds" - NEVER use "royalties" for WI owners
- Royalty Interest and Override/ORRI owners receive "royalties"
- Use the correct term based on the interest type being analyzed

Document Types:
1. Division Order - Payment distribution instructions for royalty owners
2. Mineral Deed - Transfer of mineral rights (includes royalty deeds, assignments, quitclaims)
3. Lease - Oil & gas lease granting drilling rights to operator
4. Drilling Permit - OCC drilling permits, completion reports, well permits
5. Title Opinion - Attorney's opinion on mineral ownership
6. Check Stub / Royalty Statement - Payment documents showing production revenue
7. OCC Order - Oklahoma Corporation Commission orders (pooling, spacing, increased density, location exception)
8. Suspense Notice - Form 1081, escrow notices for unlocated owners
9. JOA - Joint Operating Agreement between working interest owners
10. Ownership/Entity - Probate docs, heirship affidavits, trust agreements, LLC operating agreements
11. Legal Document - Lawsuits, judgments, court orders, legal proceedings
12. Correspondence - Letters, notices, general communications
13. Tax Record - Tax assessments, property tax records, tax bills
14. Map/Plat - Survey maps, plat maps, unit maps
15. Multi-Document PDF - Multiple documents in one PDF file
16. Other - Any document not fitting above categories

For EACH field you extract:
1. Provide the value (or null if not found)
2. Provide a confidence score (0.0-1.0)
3. For names, always check for middle initials/names

CRITICAL EXTRACTION RULES:
1. ALWAYS use the doc_type field to specify one of the types above
2. Extract ALL names mentioned (grantor, grantee, lessor, lessee, etc.)
3. For deeds: grantor = seller, grantee = buyer
4. For leases: lessor = mineral owner, lessee = oil company
5. Look for execution dates (when signed) AND recording dates (when filed)
6. Extract the EXACT legal description as written
7. Check for royalty percentages, bonus payments, and term lengths
8. Extract any API numbers for wells
9. Look for any amendment or correction references
10. Always format dates as "YYYY-MM-DD" if possible

FIELD READING RULES (especially for Division Orders):
- Read all fields EXACTLY as printed - do not infer or correct values based on context
- For "Type of Interest" field: extract the literal value shown (Working Interest, Royalty, Override, ORRI, etc.)
- For "Production" field: check which option is marked (Oil, Gas, Other) - do NOT claim this is blank if one is checked/marked
- For "Owner Name & Address": extract the full entity name exactly as shown
- If a field appears blank, confirm it is actually blank before stating so in your analysis

LEGAL DESCRIPTION (TRS) PARSING - CRITICAL:
Oklahoma uses the Section-Township-Range (TRS) system for land descriptions.
When you see patterns like "Section 25-T18N-R15W" or "Section 25, Township 18 North, Range 15 West":
- SECTION is the number (1-36) within a township: "25" in the example
- TOWNSHIP contains "N" or "S" direction: "18N" means Township 18 North (valid range: 1-30 in Oklahoma)
- RANGE contains "E" or "W" direction: "15W" means Range 15 West (valid range: 1-30 in Oklahoma)

COMMON MISTAKE TO AVOID:
- "25" is the SECTION number, NOT the township.
- If you extract a township like "25N" or "36N", STOP and re-check - you likely confused the section number with the township.
- Township numbers in Oklahoma are typically 1-30. Section numbers are 1-36.

SANITY CHECK for TRS:
- If township > 30, you probably extracted the section number by mistake
- If section > 36, double-check your parsing
- Township always ends with N or S (North/South)
- Range always ends with E or W (East/West)

DOCUMENT RECOGNITION RULES:
- Check Stubs: Look for payment amounts, decimal interest, deductions, well/property ID, pay period, "payment advice", "royalty payment"
- OCC Orders: Look for cause numbers (CD-XXXXXX, PUD-XXXXXX), order captions, Form numbers, "Corporation Commission", "ORDER NO."
- Drilling Permits: Look for "drilling permit", "Intent to Drill", "Form 1000", "completion report", "well permit", API numbers
- Suspense Notices: Look for Form 1081, "escrow", "suspense", "unlocated owner", "held in suspense"
- Ownership/Entity: Look for "trust agreement", "LLC operating agreement", "probate", "letters testamentary", "affidavit of heirship", "death certificate"
- Legal Documents: Look for "lawsuit", "judgment", "court order", case numbers, "plaintiff", "defendant", court names
- Title Opinion: Look for "TITLE OPINION", attorney name/signature, "examining attorney", ownership chain analysis
- JOA: Look for "JOINT OPERATING AGREEMENT", "working interest", "operator", participation percentages
- Tax Records: Look for "tax assessment", "property tax", "tax bill", "assessed value", tax year
- Maps/Plats: Visual documents with survey lines, section/township/range grid, well locations, unit boundaries

For Mineral Deeds, note the sub-type if identifiable:
- Royalty Deed: Specifically mentions royalty interest
- Mineral Assignment: Uses "assign" language
- Quitclaim Deed: Uses "quitclaim" language
- Warranty Deed: Includes warranty language

Return your response as a JSON object with this exact structure:

For DEEDS (Mineral Deed, Royalty Deed, Warranty Deed, Quitclaim Deed, Assignment):
NOTE: Analyze this document as a title attorney would when building a chain of title for a client.
This document transfers ownership of mineral or royalty interests from one party to another.
Focus on extracting exactly what THIS document states. Do not infer prior ownership or subsequent transfers.

CHAIN OF TITLE EXTRACTION:
- Grantor is the party transferring ownership (seller/assignor)
- Grantee is the party receiving ownership (buyer/assignee)
- Extract normalized names for future matching (LAST, FIRST MIDDLE format for individuals)
- Note any reservations the grantor keeps for themselves
- Capture references to prior instruments in the chain

DEED TYPE DETECTION (for the "deed_type" field - this is the LEGAL type of conveyance, NOT the document category):
- warranty_deed: Contains warranty language guaranteeing title ("warrant and defend", "general warranty")
- special_warranty_deed: Limited warranty (only warrants against claims arising during grantor's ownership)
- quitclaim_deed: No warranty - just releases whatever interest grantor may have ("remise, release, quitclaim")
- grant_deed: Simple grant with implied warranties
- bargain_and_sale_deed: Implies grantor has title but no warranties
NOTE: Do NOT use "mineral_deed" or "royalty_deed" for deed_type - those describe WHAT is conveyed (doc_type), not the legal warranty type.

{
  "doc_type": "mineral_deed",
  "deed_type": "warranty_deed",
  "grantors": [
    {
      "name": "John A. Smith",
      "address": "123 Main Street, Oklahoma City, OK 73102",
      "marital_status": "married"
    },
    {
      "name": "Mary B. Smith",
      "address": "123 Main Street, Oklahoma City, OK 73102",
      "marital_status": "married"
    }
  ],
  "grantees": [
    {
      "name": "Robert C. Jones",
      "address": "456 Oak Avenue, Tulsa, OK 74103"
    }
  ],
  "recording_date": "2023-03-15",
  "execution_date": "2023-03-10",
  "recording_book": "350",
  "recording_page": "125",
  "instrument_number": "2023-012345",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady",
    "quarter_section": "NW/4",
    "acreage": 160,
    "full_description": "The NW/4 of Section 16, Township 12 North, Range 7 West, Grady County, Oklahoma, containing 160 acres more or less"
  },
  "interest_conveyed": {
    "type": "mineral",
    "fraction_text": "an undivided one-half (1/2) interest",
    "fraction_decimal": 0.50,
    "net_mineral_acres": 80.0,
    "depth_limitation": null,
    "formation_limitation": null
  },
  "reservation": {
    "has_reservation": false,
    "reservation_text": null,
    "reserved_interest_type": null,
    "reserved_fraction": null
  },
  "consideration": "$10,000.00",
  "prior_instruments": [
    {
      "book": "245",
      "page": "112",
      "instrument_number": null,
      "description": "Deed from William Smith to John A. Smith"
    }
  ],
  "chain_of_title": {
    "relevant": true,
    "category": "conveyance",
    "document_type": "mineral_deed",
    "parties": {
      "grantor": ["John A. Smith", "Mary B. Smith"],
      "grantor_normalized": ["SMITH, JOHN A", "SMITH, MARY B"],
      "grantor_type": "married_couple",
      "grantee": ["Robert C. Jones"],
      "grantee_normalized": ["JONES, ROBERT C"],
      "grantee_type": "individual"
    },
    "interest": {
      "type": "mineral",
      "fraction_text": "an undivided one-half (1/2) interest",
      "fraction_decimal": 0.50,
      "acreage": 160,
      "net_mineral_acres": 80.0,
      "undivided": true,
      "reservation": false
    },
    "dates": {
      "document_date": "2023-03-10",
      "recording_date": "2023-03-15",
      "effective_date": null
    },
    "recording": {
      "county": "Grady",
      "book": "350",
      "page": "125",
      "instrument_number": "2023-012345"
    },
    "chain_links": {
      "references_prior": [
        {
          "book": "245",
          "page": "112",
          "description": "Deed from William Smith to John A. Smith"
        }
      ]
    }
  },
  "field_scores": {
    "grantors": 0.95,
    "grantees": 0.98,
    "recording_date": 1.0,
    "execution_date": 0.90,
    "recording_book": 1.0,
    "recording_page": 1.0,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0,
    "acreage": 0.90,
    "interest_conveyed": 0.85,
    "consideration": 0.75,
    "chain_of_title": 0.90
  },
  "document_confidence": "high"
}

For LEASES:
{
  "doc_type": "lease",
  "lessor_names": ["John A. Smith", "Mary B. Smith"],
  "lessee_name": "XYZ Oil Company, LLC",
  "recording_date": "2023-03-15",
  "execution_date": "2023-03-10",
  "recording_book": "L-350",
  "recording_page": "125",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "primary_term_years": 3,
  "royalty_percentage": 18.75,
  "bonus_per_acre": "$500.00",
  "field_scores": {
    "lessor_names": 0.95,
    "lessee_name": 1.0,
    "recording_date": 1.0,
    "execution_date": 0.90,
    "recording_book": 1.0,
    "recording_page": 1.0,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0,
    "primary_term_years": 1.0,
    "royalty_percentage": 0.98,
    "bonus_per_acre": 0.85
  },
  "document_confidence": "high"
}

For DRILLING PERMITS (Form 1000 - Intent to Drill):
Form 1000 is the OCC "Notice of Intent / Permit to Drill" for oil, gas, and injection wells.

WHERE TO FIND KEY DATA:
- Page 1: API number, Well Name, Surface Location coordinates (latitude/longitude provided directly)
- Page 2: Operator Information (name, address, OCC number)
- Page 3: Target formation in "Zones of Significance" table
- Page 6: Multi-Unit Orders table (lists all sections affected with allocations)
- Page 12: "Take Point: Bottom Hole" table has BHL latitude/longitude - CRITICAL for lateral paths
- Page 12: Other "Take Point" rows between surface and bottom hole are section crossings

EXTRACT (flat structure for clean display):
{{
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

  "surface_location": {{
    "section": 19,
    "township": "11N",
    "range": "23W",
    "latitude": 35.408369,
    "longitude": -99.666761
  }},

  "bottom_hole_location": {{
    "section": 31,
    "township": "11N",
    "range": "23W",
    "latitude": 35.378663,
    "longitude": -99.666866
  }},

  "section_crossings": [
    {{"from_section": 30, "to_section": 31, "latitude": 35.392702, "longitude": -99.666814}}
  ],

  "multi_unit_sections": [
    {{"section": 30, "township": "11N", "range": "23W", "allocation_percentage": 50.0}},
    {{"section": 31, "township": "11N", "range": "23W", "allocation_percentage": 50.0}}
  ],

  "target_formation": "VIRGIL",
  "target_depth_top": 8400,
  "target_depth_bottom": 9100,
  "lateral_direction": "south",
  "lateral_length_ft": 10891,
  "unit_size_acres": 640,
  "spacing_order": "83283",

  "field_scores": {{
    "api_number": 1.0,
    "well_name": 1.0,
    "operator_name": 1.0,
    "surface_location": 1.0,
    "bottom_hole_location": 0.95,
    "target_formation": 0.90
  }},
  "document_confidence": "high"
}}

EXTRACTION NOTES FOR FORM 1000:
- Parse legal description: "19-11N-23W-IM" → section=19, township="11N", range="23W"
- Longitude should be NEGATIVE (west of prime meridian) - if you see positive, negate it
- Well numbers ending in "H" indicate horizontal wells
- Lateral direction: Compare surface to BHL latitude (BHL latitude < surface latitude = "south")
- Permit type options: "New Drill", "New Drill - Multi Unit", "Re-Entry", "Deepen", "Sidetrack", "Workover"
- Well type: "Horizontal", "Vertical", "Directional"
- For VERTICAL wells: omit bottom_hole_location, section_crossings, lateral_direction, lateral_length_ft
- BHL coordinates are CRITICAL for mapping lateral wellbore paths

For DIVISION ORDERS:
Division Orders certify ownership interest and authorize payment distribution. Extract the decimal interest carefully -
this is critical for verifying payments match your records.

IMPORTANT DISTINCTIONS:
- "Property Name" on the document is the WELL/UNIT NAME (e.g., "Holdings 25-36-1XH"), NOT the legal description
- Legal description (Section-Township-Range) is usually found in the body text explaining unit allocation
- Effective Date may be a specific date OR "First Production" - capture exactly as stated
- If owner is a trust, extract both the trust name AND the trustee name separately
- ALWAYS extract section/township/range at top level (use the FIRST section mentioned for property matching)

FOR MULTI-SECTION UNITS (unit_sections):
If a unit spans multiple sections (e.g., "Section 25...Section 36..."), each section typically shares the SAME township and range.
- Extract township/range for each section in unit_sections
- If township/range is not explicitly stated for a secondary section, use the township/range from the primary (first) section
- Example: If you see "Section 25-T18N-R15W has 640 acres... Section 36 has 640 acres...", Section 36 is also T18N-R15W
{
  "doc_type": "division_order",

  "operator_name": "XYZ Oil Company (the payor - company sending this Division Order)",
  "operator_address": "PO Box 779, Oklahoma City, OK 73101 (where to mail signed DO back)",

  "property_name": "Smith 1-16H (labeled as 'Property Name' - this is the well/unit name, NOT TRS)",
  "property_number": "112295 (operator's internal property ID)",
  "billing_code": "ABC123 (operator's billing code for payment inquiries)",

  "owner_name": "John A. Smith Family Trust (the mineral owner - may be individual or trust name)",
  "trustee_name": "John A. Smith, Trustee (if owner is a trust, extract trustee separately)",
  "owner_address": "123 Main St, Oklahoma City, OK 73101",
  "owner_number": "PRI38 (if shown - operator's internal owner/interest ID like PR16, PRI38, etc.)",

  "working_interest": 0.00000000,
  "royalty_interest": 0.00390625,
  "decimal_interest": 0.00390625,
  "ownership_type": "royalty (or 'working' if working_interest > 0)",
  "interest_type": "Royalty (extract the exact 'Type of Interest' field value: Working Interest, Royalty, Override, ORRI, etc.)",

  "effective_date": "2023-04-01 (or 'First Production' - capture exactly as stated)",
  "payment_minimum": 100.00,

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

  "field_scores": {
    "operator_name": 1.0,
    "operator_address": 0.95,
    "property_name": 1.0,
    "owner_name": 1.0,
    "working_interest": 1.0,
    "royalty_interest": 1.0,
    "effective_date": 0.95,
    "county": 1.0,
    "section": 0.95,
    "township": 0.95,
    "range": 0.95,
    "unit_sections": 0.90
  },
  "document_confidence": "high"
}

For TITLE OPINIONS:
{
  "doc_type": "title_opinion",
  "examining_attorney": "Johnson & Smith Law Firm",
  "client_name": "XYZ Oil Company",
  "effective_date": "2023-03-15",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "ownership_summary": "John Smith owns 50% mineral interest...",
  "title_requirements": ["Probate of Jane Doe Estate", "Release of mortgage"],
  "field_scores": {
    "examining_attorney": 0.95,
    "client_name": 0.90,
    "effective_date": 1.0,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "ownership_summary": 0.85,
    "title_requirements": 0.80
  },
  "document_confidence": "high"
}

For CHECK STUBS / ROYALTY STATEMENTS:
{
  "doc_type": "check_stub",
  "owner_name": "John A. Smith",
  "operator_name": "Continental Resources",
  "well_name": "Smith 1-16H",
  "check_date": "2024-01-15",
  "production_month": "12",
  "production_year": "2023",
  "gross_revenue": "$2,500.00",
  "net_revenue": "$2,125.00",
  "decimal_interest": 0.00390625,
  "api_number": "35-051-12345",
  "field_scores": {
    "owner_name": 1.0,
    "operator_name": 1.0,
    "well_name": 0.95,
    "check_date": 1.0,
    "production_month": 1.0,
    "production_year": 1.0,
    "gross_revenue": 1.0,
    "net_revenue": 1.0,
    "decimal_interest": 0.95,
    "api_number": 0.90
  },
  "document_confidence": "high"
}

For OCC ORDERS (Spacing, Increased Density, Location Exception - NOT Pooling):
{
  "doc_type": "occ_order",
  "cause_number": "CD 2023-001234",
  "order_type": "spacing",
  "order_date": "2023-03-15",
  "applicant": "XYZ Oil Company",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "unit_size": "640 acres",
  "effective_date": "2023-04-01",
  "field_scores": {
    "cause_number": 1.0,
    "order_type": 0.95,
    "order_date": 1.0,
    "applicant": 0.95,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "unit_size": 0.95,
    "effective_date": 0.90
  },
  "document_confidence": "high"
}

For POOLING ORDERS (Force pooling orders requiring mineral owner response):

Pooling orders compel unleased mineral owners to participate in well development. Extract ALL election options
with their specific financial terms - this is critical for owners to make informed decisions.

CRITICAL - FIELD NAME ENFORCEMENT:
You MUST use ONLY the exact field names shown in the schema below. Do NOT invent new field names.
- Use "attorney_information" NOT "Legal Representation Attorney" or "Attorney Info"
- Use "order_info.commissioners" NOT "Order Execution Commissioners"
- Use "additional_parties.respondents_with_known_addresses" NOT "Exhibit A Respondents Known Addresses"
- Use "subsequent_wells" NOT "Additional Provisions Subsequent Wells"
- Use "notes" for any additional provisions NOT captured elsewhere
If information doesn't fit an existing field, put it in "notes" as a text summary. Do NOT create new top-level fields.

ELECTION OPTION TYPES:
- "participate" - Working interest participation (owner pays proportionate costs, shares in production)
- "cash_bonus" - Cash payment per NMA, standard royalty, no excess royalty
- "cash_bonus_excess_royalty" - Cash payment plus excess royalty (reduced NRI to operator)
- "no_cash_higher_royalty" - No cash bonus, higher excess royalty
- "non_consent" - Risk penalty option (150-300% cost recovery before sharing in production)
- "statutory" - Falls under OCC statutory terms (52 O.S. §87.1)

KEY TAKEAWAY GUIDANCE - Help the mineral owner understand:
- WHO filed it (operator/applicant)
- WHAT well and formation(s)
- WHERE (section-township-range, county)
- WHEN they need to respond (election deadline days)
- DEFAULT consequence if they don't respond (bonus amount, NRI delivered)
- SUBSEQUENT WELLS if order covers future wells

DETAILED ANALYSIS GUIDANCE - Cover these topics:
- Plain English explanation of what force pooling means for this owner
- Election options compared (cash vs participation vs royalty trade-offs)
- Key deadlines (election period, payment deadlines)
- Default consequences if owner doesn't respond
- Where to send elections (operator contact info: name, address, email)
- Subsequent well provisions if applicable

{{
  "doc_type": "pooling_order",

  // Top-level TRS for property matching (also in unit_info.legal_description)
  "section": "3",
  "township": "1N",
  "range": "8E",
  "county": "Coal",

  "order_info": {{
    "case_number": "CD 201500614-T",
    "order_number": "639589",
    "hearing_date": "2015-03-10",
    "order_date": "2015-03-17",
    "effective_date": "2015-03-17",
    "alj_report_date": "2015-03-15",
    "commissioners": [
      {{"name": "Bob Anthony", "title": "Chairman"}},
      {{"name": "Dana L. Murphy", "title": "Vice Chairman"}},
      {{"name": "J. Todd Hiett", "title": "Commissioner"}}
    ]
  }},

  "applicant": {{
    "name": "Canyon Creek Energy Operating LLC"
  }},

  "attorney_information": {{
    "administrative_law_judge": "John Smith",
    "applicant_attorney": "Jane Doe",
    "applicant_attorney_firm": "Hall Estill"
  }},

  "operator": {{
    "name": "Canyon Creek Energy Operating LLC",
    "contact_name": "Mr. Blake Gray",
    "address": "2431 East 61st Street, Suite 400",
    "city": "Tulsa",
    "state": "Oklahoma",
    "zip": "74136",
    "phone": "918-555-1234",
    "email": "bgray@cceok.com"
  }},

  "unit_info": {{
    "legal_description": {{
      "section": "3",
      "township": "1N",
      "range": "8E",
      "county": "Coal",
      "meridian": "IM",
      "quarters": "SE/4"
    }},
    "unit_description": "The SE/4 of Section 3, Township 1 North, Range 8 East, IM, Coal County",
    "unit_size_acres": 160
  }},

  "well_info": {{
    "proposed_well_name": "Hockett 1-3",
    "well_type": "vertical",
    "well_status": "new",
    "api_number": null,
    "initial_well_cost": 886600
  }},

  "formations": [
    {{"name": "Cromwell", "order_number": "591429", "depth_from": 2800, "depth_to": 3200}},
    {{"name": "Booch", "order_number": "591429", "depth_from": 2200, "depth_to": 2600}}
  ],

  "election_options": [
    {{
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
    }},
    {{
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
    }},
    {{
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
    }}
  ],

  "deadlines": {{
    "election_period_days": 20,
    "election_deadline": "2015-04-06",
    "participation_payment_days": 25,
    "bonus_payment_days": 30,
    "operator_commencement_days": 180
  }},

  "default_election": {{
    "option_number": 2,
    "description": "If owner fails to respond within 20 days, deemed to have elected Option 2 ($350/NMA, 81.25% NRI)"
  }},

  "subsequent_wells": {{
    "has_provision": true,
    "notice_period_days": 20,
    "payment_deadline_days": 25,
    "bonus_payment_deadline_days": 30,
    "operator_commencement_days": 180,
    "participation_options": ["Participate", "Cash bonus with excess royalty", "No cash, higher royalty"],
    "excludes_replacement_wells": true
  }},

  "notes": "Additional provisions such as operator's lien, dispute resolution, etc.",

  "additional_parties": {{
    "respondents_with_known_addresses": [
      {{"name": "Osage Exploration and Development, Inc.", "address": "2445 Fifth Ave., Suite 310, San Diego, CA 92101"}}
    ],
    "respondents_with_unknown_addresses": 5,
    "respondents_dismissed": 2
  }},

  "field_scores": {{
    "case_number": 1.0,
    "order_number": 0.95,
    "operator": 1.0,
    "applicant": 0.95,
    "attorney_information": 0.85,
    "legal_description": 1.0,
    "election_options": 0.90,
    "deadlines": 0.95,
    "additional_parties": 0.80
  }},
  "document_confidence": "high"
}}

For INCREASED DENSITY ORDERS (Authorization for additional wells in existing unit):
NOTE: These orders do NOT require owner action - they are informational only.
Look for "INCREASED WELL DENSITY" or "INCREASED DENSITY" in the relief sought section.

{
  "doc_type": "increased_density_order",
  "case_number": "CD2025-001682",
  "order_number": "750759",
  "order_date": "2025-07-17",
  "effective_date": "2025-07-17",
  "hearing_date": "2025-06-17",
  "applicant": "R. Michael Lortz",
  "operator": "Charter Oak Production Co., LLC",
  "proposed_well_name": "Charter Oak 1-15",
  "legal_description": {
    "section": "15",
    "township": "13N",
    "range": "24W",
    "county": "Roger Mills"
  },
  "unit_description": "All of Section 15, Township 13 North, Range 24 West",
  "unit_size_acres": 640,
  "formations": [
    {
      "name": "Tonkawa",
      "depth_from": null,
      "depth_to": null
    }
  ],
  "well_type": "oil",
  "additional_wells_authorized": 1,
  "amends_order": "115709",
  "existing_wells": [
    {
      "well_name": "Barton 1-15H",
      "api_number": "35-129-23721",
      "classification": "oil"
    },
    {
      "well_name": "Luke 15-11",
      "api_number": "35-129-24084",
      "classification": "oil"
    }
  ],
  "engineering_data": {
    "recoverable_oil_stb": 1117000,
    "recoverable_gas_mmcf": 3977,
    "remaining_oil_stb": 990000,
    "remaining_gas_mmcf": 3297
  },
  "allowable_type": "normal 80-acre plus incentive horizontal",
  "allowable_notes": "If completed as gas well, shares single unit gas allowable",
  "expiration_period": "one year",
  "expiration_date": "2026-07-17",
  "companion_cases": ["CD2025-001680", "CD2025-001681"],
  "previous_orders": ["115709"],
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "applicant": 0.95,
    "operator": 1.0,
    "proposed_well_name": 0.85,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "unit_description": 0.90,
    "unit_size_acres": 0.95,
    "formations": 0.85,
    "well_type": 0.90,
    "additional_wells_authorized": 0.95,
    "existing_wells": 0.85,
    "engineering_data": 0.80,
    "expiration_date": 0.90
  },
  "document_confidence": "high"
}

For CHANGE OF OPERATOR ORDERS (Transfer of operatorship to new company):
NOTE: These orders transfer operational responsibility from one company to another.
Look for "CHANGE OF OPERATOR", "TRANSFER OF OPERATOR", or similar language.
Extract ALL affected wells with their names, API numbers, and OTC lease numbers if available.

{
  "doc_type": "change_of_operator_order",
  "case_number": "CD2023-002361",
  "order_number": "737686",
  "order_date": "2023-12-14",
  "effective_date": "2023-12-14",
  "hearing_date": "2023-11-28",
  "current_operator": "Panther Creek Resources, Inc.",
  "new_operator": "Unbridled Resources, LLC",
  "transfer_type": "Full Transfer",
  "legal_description": {
    "sections": ["10", "3", "4", "9"],
    "township": "20N",
    "range": "24W",
    "county": "Ellis"
  },
  "affected_wells": [
    {
      "well_name": "Davis Unit 10-1",
      "api_number": "35-045-22313",
      "otc_lease_number": "01665",
      "well_type": "Oil"
    },
    {
      "well_name": "Davis Unit 10-2",
      "api_number": "35-045-22314",
      "otc_lease_number": "01666",
      "well_type": "Oil"
    }
  ],
  "total_wells_transferred": 12,
  "bonding_requirements": "New operator must maintain proper bond coverage",
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "current_operator": 1.0,
    "new_operator": 1.0,
    "transfer_type": 0.90,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "affected_wells": 0.85,
    "total_wells_transferred": 0.95
  },
  "document_confidence": "high"
}

For MULTI-UNIT HORIZONTAL WELL ORDERS (Authorization for horizontal wells spanning multiple units):
NOTE: These orders allow horizontal wells to cross unit boundaries with specific allocation percentages.
Look for "MULTI-UNIT HORIZONTAL WELL", "HORIZONTAL WELL ORDER", "LOCATION EXCEPTION", or multiple sections being included in a single drilling unit.
Extract allocation percentages for each section/unit. Capture ALL available details including protests, attorneys, and special provisions.
IMPORTANT: Include ALL section locations in legal_description.sections array for property matching.

FOR MULTI-SECTION UNITS (unit_sections):
If a unit spans multiple sections (e.g., "Section 5...Section 8..."), each section typically shares the SAME township and range.
- Extract township/range for each section in unit_sections
- If township/range is not explicitly stated for a secondary section, use the township/range from the primary (first) section
- Example: If you see "Section 5-T17N-R17W... Section 8...", Section 8 is also T17N-R17W

{
  "doc_type": "multi_unit_horizontal_order",
  "case_number": "CD2023-001823-T",
  "order_number": "749719",
  "order_sub_type": "location_exception",
  "order_date": "2023-07-31",
  "effective_date": "2023-07-31",
  "hearing_date": "2023-07-10",
  "reopen_date": "2024-02-05",
  "reopen_purpose": "Introduction of bottom hole survey",
  "applicant": "Mewbourne Oil Company",
  "operator": "Mewbourne Oil Company",
  "proposed_well_name": "Simmons 0508 5-8-17-17 1MH",
  "unit_description": "640-acre horizontal units for Sections 5 and 8",
  "unit_size_acres": 640,
  "relief_granted": "Location exception for multiunit horizontal well",
  "legal_description": {
    "county": "Dewey",
    "sections": [
      {"section": "5", "township": "17N", "range": "17W"},
      {"section": "8", "township": "17N", "range": "17W"}
    ]
  },
  "unit_sections": [
    {
      "section": "5",
      "township": "17N",
      "range": "17W",
      "allocation_percentage": 50.00,
      "acres": 640,
      "spacing_order": "591429",
      "completion_interval_length_feet": 5000,
      "south_line_feet": 0,
      "north_line_feet": 165,
      "east_line_feet": 330,
      "west_line_feet": null,
      "exceptions": ["South line: 0 feet (exception from 330 feet)", "East line: 330 feet"]
    },
    {
      "section": "8",
      "township": "17N",
      "range": "17W",
      "allocation_percentage": 50.00,
      "acres": 640,
      "spacing_order": "742818",
      "completion_interval_length_feet": 5000,
      "south_line_feet": 165,
      "north_line_feet": 0,
      "east_line_feet": 330,
      "west_line_feet": null,
      "exceptions": ["North line: 0 feet (exception from 330 feet)", "East line: 330 feet"]
    }
  ],
  "total_unit_acres": 1280,
  "total_completion_interval_feet": 10000,
  "formations": [
    {
      "name": "Mississippian",
      "common_source_of_supply": "Mississippian common source of supply",
      "depth_from": 11890,
      "depth_to": 12050
    }
  ],
  "target_reservoir": "Mississippian",
  "adjacent_common_source": "Woodford",
  "well_type": "horizontal",
  "allocation_method": "Surface Acres",
  "completion_interval": {
    "top_depth": 11890,
    "bottom_depth": 12050,
    "length": 160
  },
  "referenced_spacing_orders": ["591429", "742818"],
  "referenced_pooling_orders": [],
  "companion_cases": ["CD2023-001824-T"],
  "protestant": "Excalibur Resources, LLC",
  "protest_status": "resolved",
  "special_provisions": "The entire length of the lateral will be cemented such that the perforations will be isolated from the beginning and end point of the lateral.",
  "cost_savings": "$1,000,000",
  "administrative_law_judge": "Tammy D. Barrett",
  "applicant_attorney": "Ron M. Barnes, Grayson Barnes",
  "protestant_attorney": "Benjamin J. Brown",
  "hearing_location": "Eastern Regional Office, 201 W. 5th St., Suite 540, Tulsa, OK 74103",
  "expiration_period": "one year",
  "expiration_date": "2024-07-31",
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "applicant": 1.0,
    "operator": 1.0,
    "proposed_well_name": 0.85,
    "legal_county": 1.0,
    "unit_sections": 0.90,
    "total_unit_acres": 0.95,
    "formations": 0.85,
    "well_type": 0.90,
    "allocation_method": 0.90,
    "completion_interval": 0.85,
    "referenced_spacing_orders": 0.90,
    "expiration_date": 0.90
  },
  "document_confidence": "high"
}

For DRILLING AND SPACING ORDERS (Vertical/Standard Spacing - establishes well units and setbacks):
NOTE: These orders establish drilling and spacing units for VERTICAL wells with formation-specific setbacks.
Look for "DRILLING AND SPACING", "SPACING UNIT", unit sizes (160-acre, 640-acre), and setback distances.
These define where wells can be drilled and production allocated within the unit.

{
  "doc_type": "drilling_and_spacing_order",
  "case_number": "CD2024-001234",
  "order_number": "745000",
  "order_date": "2024-03-15",
  "effective_date": "2024-03-15",
  "hearing_date": "2024-03-01",
  "applicant": "Continental Resources, Inc.",
  "operator": "Continental Resources, Inc.",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "unit_description": "The NW/4 of Section 16, Township 12 North, Range 7 West",
  "unit_size_acres": 160,
  "well_type": "oil",
  "formations": [
    {
      "name": "Senora",
      "common_source_of_supply": "Senora common source of supply",
      "depth_from": 8500,
      "depth_to": 8700,
      "setbacks": {
        "from_unit_boundary_feet": 660,
        "from_lease_line_feet": 330,
        "from_section_line_feet": null
      }
    }
  ],
  "well_location_requirements": {
    "standard_setback_feet": 660,
    "lease_line_setback_feet": 330,
    "special_conditions": "No well shall be drilled within 660 feet of any unit boundary"
  },
  "allowable_type": "normal 160-acre oil",
  "previous_orders": ["Order No. 123456 establishing original spacing"],
  "amends_order": null,
  "vacates_order": null,
  "order_status": "active",
  "controlling_order_info": {
    "is_controlling": true,
    "superseded_by": null,
    "supersedes": null
  },
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "applicant": 1.0,
    "operator": 0.95,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "unit_description": 0.90,
    "unit_size_acres": 0.95,
    "well_type": 0.90,
    "formations": 0.85,
    "well_location_requirements": 0.85,
    "allowable_type": 0.80
  },
  "document_confidence": "high"
}

For HORIZONTAL DRILLING AND SPACING ORDERS (Horizontal well spacing with lateral requirements):
NOTE: These orders establish drilling and spacing units for HORIZONTAL wells.
Look for "HORIZONTAL DRILLING AND SPACING", "HORIZONTAL WELL", lateral setbacks, completion interval requirements.
These have formation-specific setbacks for both lateral wellbore AND completion interval (perforated section).

{
  "doc_type": "horizontal_drilling_and_spacing_order",
  "case_number": "CD2024-002345",
  "order_number": "748000",
  "order_date": "2024-05-20",
  "effective_date": "2024-05-20",
  "hearing_date": "2024-05-06",
  "applicant": "Mewbourne Oil Company",
  "operator": "Mewbourne Oil Company",
  "legal_description": {
    "section": "8",
    "township": "17N",
    "range": "17W",
    "county": "Dewey"
  },
  "unit_description": "All of Section 8, Township 17 North, Range 17 West",
  "unit_size_acres": 640,
  "well_type": "horizontal",
  "formations": [
    {
      "name": "Mississippian",
      "common_source_of_supply": "Mississippian common source of supply",
      "depth_from": 11890,
      "depth_to": 12050,
      "setbacks": {
        "lateral_from_unit_boundary_feet": 330,
        "lateral_from_lease_line_feet": 165,
        "completion_interval_from_unit_boundary_feet": 330,
        "completion_interval_from_lease_line_feet": 165,
        "minimum_lateral_length_feet": null
      }
    },
    {
      "name": "Woodford",
      "common_source_of_supply": "Woodford common source of supply",
      "depth_from": 12200,
      "depth_to": 12400,
      "setbacks": {
        "lateral_from_unit_boundary_feet": 330,
        "lateral_from_lease_line_feet": 165,
        "completion_interval_from_unit_boundary_feet": 330,
        "completion_interval_from_lease_line_feet": 165,
        "minimum_lateral_length_feet": null
      }
    }
  ],
  "well_location_requirements": {
    "lateral_setback_feet": 330,
    "completion_interval_setback_feet": 330,
    "special_conditions": "The horizontal wellbore and completion interval shall not be located closer than 330 feet from any unit boundary"
  },
  "allowable_type": "normal 640-acre horizontal",
  "maximum_wells_per_formation": null,
  "previous_orders": [],
  "amends_order": null,
  "vacates_order": null,
  "order_status": "active",
  "controlling_order_info": {
    "is_controlling": true,
    "superseded_by": null,
    "supersedes": null
  },
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "applicant": 1.0,
    "operator": 0.95,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "unit_description": 0.90,
    "unit_size_acres": 0.95,
    "well_type": 1.0,
    "formations": 0.85,
    "well_location_requirements": 0.85,
    "allowable_type": 0.80
  },
  "document_confidence": "high"
}

For LOCATION EXCEPTION ORDERS (Permits drilling closer to boundaries than standard setbacks):
NOTE: These orders grant exceptions to standard well setback requirements.
Look for "LOCATION EXCEPTION", specific footage distances, "exception from", "permit the drilling".
Extract the EXACT footage from each boundary line - this is critical for understanding well placement.

{
  "doc_type": "location_exception_order",
  "case_number": "CD2024-003456",
  "order_number": "749500",
  "order_date": "2024-06-10",
  "effective_date": "2024-06-10",
  "hearing_date": "2024-05-28",
  "applicant": "Devon Energy Production Company, L.P.",
  "operator": "Devon Energy Production Company, L.P.",
  "well_name": "Smith 1-16",
  "api_number": "35-051-12345",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "unit_description": "The SE/4 of Section 16, Township 12 North, Range 7 West",
  "unit_size_acres": 160,
  "well_type": "re-entry",
  "exception_type": "standard_setback",
  "well_location": {
    "quarter_section": "SE/4",
    "footage_from_south_line": 330,
    "footage_from_north_line": null,
    "footage_from_east_line": 990,
    "footage_from_west_line": null,
    "surface_location_description": "330 feet from south line and 990 feet from east line of Section 16"
  },
  "standard_setback_feet": 660,
  "granted_setback_feet": 330,
  "exception_details": {
    "from_boundary": "south line",
    "standard_requirement_feet": 660,
    "approved_distance_feet": 330,
    "exception_amount_feet": 330
  },
  "reason_for_exception": "Re-entry of existing wellbore to access previously untapped formation",
  "formations": [
    {
      "name": "Hunton",
      "common_source_of_supply": "Hunton common source of supply",
      "depth_from": 9200,
      "depth_to": 9400
    }
  ],
  "referenced_spacing_order": "Order No. 456789",
  "special_provisions": "The exception is granted for the specific well location only and does not alter the established spacing pattern",
  "expiration_period": "one year",
  "expiration_date": "2025-06-10",
  "previous_orders": ["456789"],
  "field_scores": {
    "case_number": 1.0,
    "order_number": 0.95,
    "order_date": 1.0,
    "effective_date": 0.90,
    "hearing_date": 0.95,
    "applicant": 1.0,
    "operator": 0.95,
    "well_name": 0.90,
    "api_number": 0.85,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "unit_description": 0.90,
    "well_location": 0.90,
    "standard_setback_feet": 0.95,
    "granted_setback_feet": 0.95,
    "exception_details": 0.85,
    "reason_for_exception": 0.80,
    "formations": 0.85,
    "expiration_date": 0.90
  },
  "document_confidence": "high"
}

For AFFIDAVIT OF HEIRSHIP (sworn statement identifying heirs of deceased mineral owner):
NOTE: Analyze this document as a title attorney would when building a chain of title for a client.
This document establishes who inherits mineral rights when someone dies - it is a critical link in the ownership chain.
Focus on extracting exactly what THIS document states about ownership succession. Do not infer or construct
the broader chain - only extract what is explicitly stated in this document.

CHAIN OF TITLE EXTRACTION:
For chain of title purposes, the decedent is the "grantor" (ownership passes FROM them) and
the heirs are the "grantees" (ownership passes TO them). Extract normalized names for future matching.
Also extract any references to prior instruments that show how the decedent acquired the property.

{
  "doc_type": "affidavit_of_heirship",
  "decedent": {
    "name": "John Henry Smith",
    "date_of_death": "2023-05-15",
    "date_of_birth": "1941-03-22",
    "age_at_death": 82,
    "place_of_death": {
      "facility": "St. Mary's Hospital",
      "county": "Oklahoma",
      "state": "Oklahoma"
    },
    "residence_at_death": {
      "address": "456 Oak Street",
      "city": "Oklahoma City",
      "county": "Oklahoma",
      "state": "Oklahoma"
    }
  },
  "affiant": {
    "name": "Mary Jane Smith",
    "address": "123 Main Street, Oklahoma City, OK 73102",
    "relationship_to_decedent": "daughter",
    "years_known_decedent": 55
  },
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady",
    "full_description": "The NW/4 of Section 16, Township 12 North, Range 7 West, Grady County, Oklahoma"
  },
  "property_acquisition": {
    "when_acquired": "1965",
    "acquired_from": "Estate of William Smith",
    "how_acquired": "inheritance",
    "prior_instrument_reference": {
      "book": "198",
      "page": "45",
      "instrument_number": null,
      "description": "Deed from Estate of William Smith"
    }
  },
  "will_and_probate": {
    "has_will": true,
    "will_probated": true,
    "probate_county": "Oklahoma",
    "probate_state": "Oklahoma",
    "probate_case_number": "PB-2023-1234",
    "probate_date": "2023-07-20",
    "executor_name": "Mary Jane Smith",
    "executor_address": "123 Main Street, Oklahoma City, OK 73102"
  },
  "spouses": [
    {
      "name": "Sarah Mae Smith",
      "marriage_date": "1962-06-15",
      "marriage_county": "Oklahoma",
      "status": "deceased",
      "death_date": "2020-03-10",
      "divorce_info": null
    }
  ],
  "children_living": [
    {
      "name": "Mary Jane Smith",
      "date_of_birth": "1965-02-20",
      "by_which_spouse": "Sarah Mae Smith",
      "address": "123 Main Street, Oklahoma City, OK 73102",
      "spouse_name": "Robert Smith",
      "spouse_address": "123 Main Street, Oklahoma City, OK 73102"
    },
    {
      "name": "James William Smith",
      "date_of_birth": "1968-08-14",
      "by_which_spouse": "Sarah Mae Smith",
      "address": "456 Oak Avenue, Tulsa, OK 74103",
      "spouse_name": "Linda Smith",
      "spouse_address": "456 Oak Avenue, Tulsa, OK 74103"
    }
  ],
  "children_predeceased": [],
  "grandchildren_of_predeceased": [],
  "adopted_stepchildren": [],
  "heirs_summary": [
    {
      "name": "Mary Jane Smith",
      "relationship": "daughter",
      "estimated_share": "50%",
      "share_decimal": 0.50
    },
    {
      "name": "James William Smith",
      "relationship": "son",
      "estimated_share": "50%",
      "share_decimal": 0.50
    }
  ],
  "unpaid_debts": {
    "has_debts": false,
    "debt_details": null
  },
  "inheritance_tax_status": "No inheritance tax due",
  "notary": {
    "notary_date": "2023-08-01",
    "notary_county": "Oklahoma",
    "notary_state": "Oklahoma"
  },
  "recording_info": {
    "book": "1234",
    "page": "567",
    "document_number": "2023-045678",
    "recording_date": "2023-08-05",
    "recording_county": "Grady"
  },
  "chain_of_title": {
    "relevant": true,
    "category": "probate",
    "document_type": "affidavit_of_heirship",
    "parties": {
      "grantor": ["John Henry Smith"],
      "grantor_normalized": ["SMITH, JOHN HENRY"],
      "grantor_type": "individual_deceased",
      "grantee": ["Mary Jane Smith", "James William Smith"],
      "grantee_normalized": ["SMITH, MARY JANE", "SMITH, JAMES WILLIAM"],
      "grantee_type": "individuals"
    },
    "interest": {
      "type": "mineral",
      "fraction_text": "all mineral interest owned by decedent",
      "creates_fractional": true,
      "heir_shares": [
        {"heir": "Mary Jane Smith", "share_decimal": 0.50},
        {"heir": "James William Smith", "share_decimal": 0.50}
      ]
    },
    "dates": {
      "document_date": "2023-08-01",
      "recording_date": "2023-08-05",
      "effective_date": "2023-05-15",
      "date_of_death": "2023-05-15"
    },
    "recording": {
      "county": "Grady",
      "book": "1234",
      "page": "567",
      "instrument_number": "2023-045678"
    },
    "chain_links": {
      "references_prior": [
        {
          "book": "198",
          "page": "45",
          "description": "Deed showing how decedent acquired property"
        }
      ],
      "probate_case": "PB-2023-1234"
    }
  },
  "field_scores": {
    "decedent_name": 1.0,
    "decedent_death_date": 0.95,
    "affiant_name": 1.0,
    "affiant_relationship": 0.95,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "has_will": 0.90,
    "spouses": 0.85,
    "children_living": 0.85,
    "heirs_summary": 0.80,
    "recording_info": 0.95,
    "chain_of_title": 0.85
  },
  "document_confidence": "high"
}

For SUSPENSE NOTICES:
{
  "doc_type": "suspense_notice",
  "owner_name": "John A. Smith",
  "operator_name": "Devon Energy",
  "well_name": "Smith 1-16H",
  "notice_date": "2023-03-15",
  "suspense_reason": "Need updated W-9 form",
  "amount_held": "$5,234.56",
  "api_number": "35-051-12345",
  "field_scores": {
    "owner_name": 0.95,
    "operator_name": 1.0,
    "well_name": 0.95,
    "notice_date": 1.0,
    "suspense_reason": 1.0,
    "amount_held": 0.95,
    "api_number": 0.90
  },
  "document_confidence": "high"
}

For JOA (Joint Operating Agreement):
{
  "doc_type": "joa",
  "operator_name": "XYZ Oil Company",
  "non_operators": ["ABC Energy", "DEF Resources"],
  "unit_name": "Smith Unit",
  "effective_date": "2023-03-15",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "operator_interest": 0.75,
  "field_scores": {
    "operator_name": 1.0,
    "non_operators": 0.90,
    "unit_name": 0.95,
    "effective_date": 1.0,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0,
    "operator_interest": 0.85
  },
  "document_confidence": "high"
}

For OWNERSHIP/ENTITY DOCUMENTS:
{
  "doc_type": "ownership_entity",
  "entity_name": "Smith Family Trust",
  "entity_type": "trust",
  "formation_date": "2020-01-15",
  "trustee_names": ["John A. Smith", "Mary B. Smith"],
  "beneficiaries": ["Robert Smith", "Sarah Smith"],
  "state": "Oklahoma",
  "ein": "XX-XXXXXXX",
  "field_scores": {
    "entity_name": 1.0,
    "entity_type": 1.0,
    "formation_date": 0.95,
    "trustee_names": 0.95,
    "beneficiaries": 0.90,
    "state": 1.0,
    "ein": 0.85
  },
  "document_confidence": "high"
}

For LEGAL DOCUMENTS:
{
  "doc_type": "legal_document",
  "case_number": "CJ-2023-1234",
  "plaintiff": "John Smith",
  "defendant": "XYZ Oil Company",
  "court": "District Court of Grady County",
  "filing_date": "2023-03-15",
  "case_type": "Quiet Title Action",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "field_scores": {
    "case_number": 1.0,
    "plaintiff": 0.95,
    "defendant": 0.95,
    "court": 1.0,
    "filing_date": 1.0,
    "case_type": 0.90,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0
  },
  "document_confidence": "high"
}

For CORRESPONDENCE:
{
  "doc_type": "correspondence",
  "from": "Devon Energy Production Company",
  "to": "John A. Smith",
  "date": "2023-03-15",
  "subject": "Notice of Drilling Operations",
  "summary": "Notice of intent to drill the Smith 1-16H well...",
  "field_scores": {
    "from": 1.0,
    "to": 1.0,
    "date": 1.0,
    "subject": 0.95,
    "summary": 0.85
  },
  "document_confidence": "high"
}

For TAX RECORDS:
{
  "doc_type": "tax_record",
  "owner_name": "John A. Smith",
  "tax_year": "2023",
  "assessed_value": "$125,000",
  "tax_amount": "$1,250.00",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "parcel_number": "12345-67890",
  "field_scores": {
    "owner_name": 0.95,
    "tax_year": 1.0,
    "assessed_value": 1.0,
    "tax_amount": 1.0,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0,
    "parcel_number": 1.0
  },
  "document_confidence": "high"
}

For MAPS:
{
  "doc_type": "map",
  "map_type": "plat",
  "title": "Section 16 Unit Plat",
  "date": "2023-03-15",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "prepared_by": "Smith Surveying Inc.",
  "scale": "1 inch = 500 feet",
  "field_scores": {
    "map_type": 0.95,
    "title": 0.90,
    "date": 1.0,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "prepared_by": 0.85,
    "scale": 0.90
  },
  "document_confidence": "high"
}

Confidence levels based on overall document quality:
- "high": Most fields extracted with high confidence (avg > 0.85)
- "medium": Some uncertainty in extracted data (avg 0.70-0.85)  
- "low": Significant uncertainty, needs manual review (avg < 0.70)

IMPORTANT: Only calculate average confidence based on fields that actually exist in the document.
Do NOT penalize confidence for missing fields (e.g., recording info on unrecorded deeds,
middle names that don't exist, etc.). If a field is not present in the document,
exclude it from the confidence calculation entirely.

FLAGGING GUIDELINES - What IS and IS NOT unusual:

NOT unusual (do not flag as concerns):
- Missing API number on division orders (common - request if needed for tracking)
- Effective date before document date (standard industry practice for division orders)
- $100 minimum payment threshold (industry standard)
- NADOA Model Form language (standard)

Potentially unusual (worth noting in DETAILED ANALYSIS):
- Same decimal interest for different interest types on same well/owner
- Effective date significantly in the FUTURE relative to document date
- Interest type that doesn't match owner's expected holdings
- Decimal interest that seems inconsistent with known acreage

REMEMBER - Examples of good output:

KEY TAKEAWAY example:
"Continental Resources is now operating 3 wells on your section. Expect updated division orders within 60-90 days - verify your decimal interest matches your records before signing."

DETAILED ANALYSIS examples:
- "The retained overriding royalty here is unusual - the grantor is keeping a piece of future production even after selling. If you're the buyer, factor this into your valuation. The depth limitation also means any deeper formations remain with the original owner."
- "This pooling order has a tight 20-day election deadline. If you're considering participating, you'll need to evaluate the $15,000/NMA cost quickly. The 200% non-consent penalty is standard, but the operator's proposed 3/16ths royalty is below market - Option 2's 1/5th royalty may be worth the lower cash bonus."
- "Multiple small decimal interests here suggest inherited minerals that have been divided over generations. Expect smaller royalty checks but also proportionally smaller decisions to make."
- "This is a location exception allowing the horizontal lateral closer to section lines than normally permitted. The protest was resolved, but the special cementing provision protects against potential drainage issues with the adjacent operator."

What to avoid:
- Data dumps: "The well was drilled to 20,783 feet with 13.375 inch surface casing..."
- Too generic: "This is a standard pooling order"
- Just restating fields: "The order date is January 15, 2024 and the applicant is Devon Energy..."
"""


def get_extraction_prompt() -> str:
    """
    Get the extraction prompt with current date injected.

    Returns:
        Formatted extraction prompt with today's date
    """
    current_date = datetime.now().strftime("%B %d, %Y")
    return EXTRACTION_PROMPT_TEMPLATE.replace("{current_date}", current_date)


async def retry_with_backoff(func, *args, **kwargs):
    """
    Retry function with exponential backoff for rate limit errors.
    
    Args:
        func: Async function to retry
        *args: Positional arguments for func
        **kwargs: Keyword arguments for func
    
    Returns:
        Result from successful function call
    
    Raises:
        Last exception if all retries fail
    """
    retry_delay = INITIAL_RETRY_DELAY
    
    for attempt in range(MAX_RETRIES):
        try:
            return await func(*args, **kwargs)
        except anthropic.RateLimitError as e:
            if attempt == MAX_RETRIES - 1:
                logger.error(f"Max retries ({MAX_RETRIES}) reached for rate limit error")
                raise
            
            logger.warning(f"Rate limit hit (attempt {attempt + 1}/{MAX_RETRIES}). Waiting {retry_delay} seconds...")
            await asyncio.sleep(retry_delay)
            retry_delay *= 2  # Exponential backoff
        except Exception as e:
            # Re-raise non-rate-limit errors immediately
            raise


async def process_image_batch(images: list[tuple[int, str]], batch_description: str) -> list[dict]:
    """
    Process a batch of images and return content array for Claude.
    
    Args:
        images: List of (page_num, image_path) tuples
        batch_description: Description of this batch (e.g., "pages 1-10 of 40")
    
    Returns:
        Content array for Claude API
    """
    content = []
    
    for page_num, image_path in images:
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
        
        # Import PIL for image processing
        from PIL import Image
        import io
        
        # Open image to check dimensions and size
        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size
        needs_processing = False
        
        # Check if image is over 5MB or dimensions exceed 2000px
        if len(image_bytes) > 5 * 1024 * 1024:
            needs_processing = True
            
        if width > 2000 or height > 2000:
            needs_processing = True
            
        if needs_processing:
            # Resize if needed
            if width > 2000 or height > 2000:
                ratio = min(2000/width, 2000/height)
                new_width = int(width * ratio)
                new_height = int(height * ratio)
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # Re-save with compression
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=85, optimize=True)
            image_bytes = output.getvalue()
        
        image_data = base64.standard_b64encode(image_bytes).decode('utf-8')
        
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": image_data
            }
        })
        content.append({
            "type": "text",
            "text": f"Page {page_num} - {batch_description}"
        })
    
    return content


async def quick_classify_document(image_paths: list[str]) -> dict:
    """
    Quick classification to determine if document is "other" type.
    Uses fewer pages and simpler prompt for efficiency.
    
    Args:
        image_paths: List of paths to first few page images
    
    Returns:
        Classification result with doc_type and confidence
    """
    logger.info(f"Quick classification using {len(image_paths)} pages")
    logger.info(f"Using Claude model: {CONFIG.CLAUDE_MODEL}")
    logger.info(f"API key configured: {'Yes' if CONFIG.ANTHROPIC_API_KEY else 'No'}")
    logger.info(f"API key length: {len(CONFIG.ANTHROPIC_API_KEY) if CONFIG.ANTHROPIC_API_KEY else 0}")
    
    # Build message content
    content = [{
        "type": "text",
        "text": """Classify this document and detect if it contains multiple separate documents.

Return ONLY a JSON object with:
{
  "doc_type": "mineral_deed|lease|division_order|... or other",
  "confidence": "high|medium|low",
  "is_multi_document": true or false,
  "estimated_doc_count": number (1 if single document),
  "rotation_needed": 0|90|180|270,
  "reasoning": "Brief explanation"
}

ROTATION DETECTION:
Check if the document is rotated from normal reading orientation.
- rotation_needed: 0 if text reads normally (no rotation needed)
- rotation_needed: 90 if document needs 90° clockwise rotation to read normally
- rotation_needed: 180 if document is upside down
- rotation_needed: 270 if document needs 270° clockwise (or 90° counter-clockwise) rotation

MULTI-DOCUMENT DETECTION:
Determine if this PDF contains multiple separate documents. Look for:
- Multiple recording stamps with different book/page numbers
- Repeated document headers (e.g., "MINERAL DEED" appearing multiple times)
- Different document dates or execution dates
- Different parties (grantors/grantees) in separate sections
- Clear page breaks between distinct documents
- Multiple check stubs or multiple division orders
- DIVISION ORDERS: Different Property Numbers or Property Names = SEPARATE DOCUMENTS (even if same owner/operator)
  Example: Page 1 has "Property #: 112295, Property Name: Holdings 25-36-1XH"
           Page 2 has "Property #: 112294, Property Name: Holdings 24-25-1XH"
           This is TWO separate division orders, not one!

If you see evidence of multiple documents, set is_multi_document: true and estimate the count.

DOCUMENT TYPES (if not one of these, return "other"):
- mineral_deed, royalty_deed, lease, division_order, assignment
- pooling_order, increased_density_order, change_of_operator_order, multi_unit_horizontal_order
- drilling_and_spacing_order, horizontal_drilling_and_spacing_order, location_exception_order
- drilling_permit, title_opinion
- check_stub, occ_order, suspense_notice, joa
- affidavit_of_heirship, ownership_entity, legal_document, correspondence
- tax_record, map

AFFIDAVIT OF HEIRSHIP DETECTION:
- affidavit_of_heirship: Look for "AFFIDAVIT OF HEIRSHIP" title. Contains decedent (deceased person) name, list of heirs/children/spouses, legal description of mineral property, notarized. Establishes who inherits mineral rights.

OCC ORDER TYPE DETECTION - be specific:
- horizontal_drilling_and_spacing_order: Look for "HORIZONTAL DRILLING AND SPACING" or "HORIZONTAL WELL" in the relief/order title. Contains lateral setbacks, completion interval requirements, often 640-acre units.
- drilling_and_spacing_order: Look for "DRILLING AND SPACING" without "HORIZONTAL". Establishes vertical well units with setback distances (like 660ft from boundary). Often 160-acre or 640-acre units for vertical wells.
- location_exception_order: Look for "LOCATION EXCEPTION" - allows wells closer to boundaries than standard setbacks. Shows specific footage from boundary lines.
- pooling_order: Contains election options for mineral owners (participate, cash bonus, royalty conversion, non-consent penalties).
- increased_density_order: Look for "INCREASED DENSITY" or "INCREASED WELL DENSITY" - authorizes additional wells in existing units.
- occ_order: ONLY use this for OCC orders that don't fit the specific types above.

Examples of "other" documents (oil and gas docs that don't fit defined categories):
- Farmout agreements, surface use agreements, pipeline agreements
- AFEs, payout statements, salt water disposal agreements
- Seismic permits, unitization agreements, general operator correspondence
"""
    }]
    
    # Add images
    for path in image_paths[:3]:  # Max 3 pages for quick classification
        try:
            with open(path, 'rb') as img:
                img_data = base64.b64encode(img.read()).decode()
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": img_data
                    }
                })
        except Exception as e:
            logger.error(f"Failed to read image {path}: {e}")
    
    try:
        response = client.messages.create(
            model=CONFIG.CLAUDE_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": content}]
        )

        # Strip markdown code fences if present
        response_text = response.content[0].text.strip()
        if response_text.startswith("```"):
            # Remove opening fence (```json or ```)
            lines = response_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            # Remove closing fence
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            response_text = "\n".join(lines)

        result = json.loads(response_text)
        logger.info(f"Quick classification result: {result}")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"Quick classification failed - Invalid JSON response: {e}")
        logger.error(f"Response text was: {response.content[0].text if 'response' in locals() else 'No response'}")
        return {"doc_type": "other", "confidence": "low", "reasoning": "Classification failed - Invalid JSON"}
    except Exception as e:
        logger.error(f"Quick classification failed: {type(e).__name__}: {str(e)}")
        logger.error(f"Full error details: {repr(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {"doc_type": "other", "confidence": "low", "reasoning": f"Classification failed - {type(e).__name__}"}


async def detect_documents(image_paths: list[str]) -> dict:
    """
    Detect if PDF contains multiple documents and identify boundaries.
    Uses batching for large PDFs.
    
    Args:
        image_paths: List of paths to page images
    
    Returns:
        Detection result with document boundaries
    """
    logger.info(f"Detecting documents in {len(image_paths)} pages")
    
    # For detection, we'll sample pages if there are too many
    if len(image_paths) > 20:
        # Enhanced sampling for better document boundary detection
        sample_indices = []
        
        # For very large documents (30+ pages), assume possible multi-doc
        if len(image_paths) >= 30:
            # Sample more aggressively to catch document boundaries
            # First 3 pages
            sample_indices.extend(range(min(3, len(image_paths))))
            
            # Then every 2-3 pages to catch document boundaries
            step = 2 if len(image_paths) < 50 else 3
            sample_indices.extend(range(3, len(image_paths), step))
            
            # Ensure we don't exceed our limit
            if len(sample_indices) > 25:
                # Keep first, last, and evenly distributed
                total_samples = 25
                new_indices = [0]  # Always include first page
                step = (len(image_paths) - 1) / (total_samples - 1)
                for i in range(1, total_samples - 1):
                    new_indices.append(int(i * step))
                new_indices.append(len(image_paths) - 1)  # Always include last page
                sample_indices = new_indices
        else:
            # Original strategy for smaller documents
            sample_indices.extend(range(5))  # First 5 pages
            sample_indices.extend(range(len(image_paths) - 5, len(image_paths)))  # Last 5 pages
            
            # Add evenly spaced middle pages (up to 10 more)
            middle_start = 5
            middle_end = len(image_paths) - 5
            if middle_end > middle_start:
                step = max(1, (middle_end - middle_start) // 10)
                sample_indices.extend(range(middle_start, middle_end, step))
        
        # Remove duplicates and sort
        sample_indices = sorted(list(set(sample_indices)))
        
        logger.info(f"Sampling {len(sample_indices)} pages for detection from {len(image_paths)} total pages")
        
        # Add warning for large documents
        if len(image_paths) >= 30:
            logger.warning(f"Large document with {len(image_paths)} pages - possible multi-document bundle")
        
        # Build content with sampled pages
        sampled_images = [(i + 1, image_paths[i]) for i in sample_indices]
    else:
        # Use all pages if 20 or fewer
        sampled_images = [(i + 1, path) for i, path in enumerate(image_paths)]
    
    # Process in batches if needed
    all_content = []
    
    for i in range(0, len(sampled_images), PAGES_PER_BATCH):
        batch = sampled_images[i:i + PAGES_PER_BATCH]
        batch_description = f"batch {i//PAGES_PER_BATCH + 1} of detection sampling"
        
        batch_content = await process_image_batch(batch, batch_description)
        all_content.extend(batch_content)
        
        # Add delay between batches to avoid rate limits
        if i + PAGES_PER_BATCH < len(sampled_images):
            await asyncio.sleep(BATCH_DELAY_SECONDS)
    
    all_content.append({
        "type": "text",
        "text": f"NOTE: This PDF has {len(image_paths)} total pages. " + 
                ("I'm showing you a sample of pages. " if len(image_paths) > 20 else "") +
                (f"Large PDFs ({len(image_paths)} pages) often contain multiple documents bundled together. " if len(image_paths) >= 30 else "") +
                "Please identify all documents and their page boundaries based on what you can see.\n\n" +
                DETECTION_PROMPT
    })
    
    # Call Claude for detection with retry logic
    async def make_detection_call():
        return client.messages.create(
            model=CONFIG.CLAUDE_MODEL,
            max_tokens=1024,  # Small response expected
            messages=[
                {"role": "user", "content": all_content}
            ]
        )
    
    logger.info(f"Calling Claude API for document detection")
    response = await retry_with_backoff(make_detection_call)
    
    # Parse response - strip markdown fences if present
    response_text = response.content[0].text.strip()
    logger.debug(f"Detection response: {response_text}")

    # Strip markdown code fences if Claude wrapped the JSON
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]  # Remove opening fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]  # Remove closing fence
        response_text = "\n".join(lines)

    try:
        result = json.loads(response_text.strip())
        logger.info(f"Detected {result.get('document_count', 1)} documents")
        return result
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse detection response: {e}")
        logger.error(f"Response text was: {response_text[:500]}")
        # Default to single document
        return {
            "is_multi_document": False,
            "document_count": 1,
            "documents": [{"type": "unknown", "start_page": 1, "end_page": len(image_paths), "confidence": 0.5}]
        }


async def extract_single_document(image_paths: list[str], start_page: int = 1, end_page: int = None) -> dict:
    """
    Extract data from a single document using batching for large documents.
    
    Args:
        image_paths: List of ALL page images from the PDF
        start_page: First page of this document (1-based)
        end_page: Last page of this document (1-based, inclusive)
    
    Returns:
        Extracted data dictionary with confidence scores
    """
    if end_page is None:
        end_page = len(image_paths)
        
    logger.info(f"Extracting single document from pages {start_page} to {end_page}")
    
    # Get the pages for this document
    doc_pages = []
    for i in range(start_page - 1, end_page):
        if i < len(image_paths):
            doc_pages.append((i + 1, image_paths[i]))
    
    total_pages = len(doc_pages)
    
    # If document is small enough, process in one batch
    if total_pages <= PAGES_PER_BATCH:
        content = await process_image_batch(doc_pages, f"all {total_pages} pages")
        content.append({
            "type": "text",
            "text": get_extraction_prompt()
        })

        # Call Claude for extraction with retry logic
        async def make_extraction_call():
            return client.messages.create(
                model=CONFIG.CLAUDE_MODEL,
                max_tokens=4096,
                messages=[
                    {"role": "user", "content": content}
                ]
            )
        
        logger.info(f"Calling Claude API for extraction ({CONFIG.CLAUDE_MODEL})")
        response = await retry_with_backoff(make_extraction_call)
        
        # Parse response
        response_text = response.content[0].text
        logger.debug(f"Claude response: {response_text[:500]}...")
        
        # Extract JSON from response
        json_str = response_text.strip()
        
        # Try to find JSON in the response
        # First, check if it's wrapped in ```json blocks
        if "```json" in json_str:
            start = json_str.find("```json") + 7
            end = json_str.find("```", start)
            if end != -1:
                json_str = json_str[start:end].strip()
        # Otherwise, look for the first { and last }
        elif "{" in json_str and "}" in json_str:
            # Find the first { and last } to extract just the JSON
            start = json_str.find("{")
            end = json_str.rfind("}") + 1
            if start != -1 and end != 0:
                json_str = json_str[start:end]
        
        try:
            extracted_data = json.loads(json_str.strip())
            
            # Look for KEY TAKEAWAY and DETAILED ANALYSIS sections after the JSON
            key_takeaway = None
            detailed_analysis = None

            if "KEY TAKEAWAY:" in response_text:
                kt_start = response_text.find("KEY TAKEAWAY:")
                kt_end = response_text.find("DETAILED ANALYSIS:", kt_start) if "DETAILED ANALYSIS:" in response_text else len(response_text)
                if kt_start != -1:
                    key_takeaway = response_text[kt_start + 13:kt_end].strip()
                    # Clean up any markdown formatting
                    if key_takeaway.startswith("```"):
                        key_takeaway = key_takeaway[3:].strip()
                    if key_takeaway.endswith("```"):
                        key_takeaway = key_takeaway[:-3].strip()
                    # Remove trailing # and ** markdown artifacts
                    key_takeaway = key_takeaway.rstrip('#').strip().strip('*').strip()

            if "DETAILED ANALYSIS:" in response_text:
                da_start = response_text.find("DETAILED ANALYSIS:")
                if da_start != -1:
                    detailed_analysis = response_text[da_start + 18:].strip()
                    # Clean up any markdown formatting
                    if detailed_analysis.startswith("```"):
                        detailed_analysis = detailed_analysis[3:].strip()
                    if detailed_analysis.endswith("```"):
                        detailed_analysis = detailed_analysis[:-3].strip()
                    # Remove ** markdown artifacts
                    detailed_analysis = detailed_analysis.strip('*').strip()

            # Add to extracted data
            if key_takeaway:
                extracted_data["key_takeaway"] = key_takeaway
            if detailed_analysis:
                extracted_data["ai_observations"] = detailed_analysis  # Keep ai_observations for backward compatibility

            # Fallback: check for old OBSERVATIONS format for backward compatibility
            if not detailed_analysis and "OBSERVATIONS:" in response_text:
                obs_start = response_text.find("OBSERVATIONS:")
                if obs_start != -1:
                    observations = response_text[obs_start + 13:].strip()
                    if observations.startswith("```"):
                        observations = observations[3:].strip()
                    if observations.endswith("```"):
                        observations = observations[:-3].strip()
                    if observations:
                        extracted_data["ai_observations"] = observations
            
            return extracted_data
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse extraction response: {e}")
            logger.error(f"Response was: {response_text}")
            return {"error": "Failed to parse response", "raw_response": response_text}
    
    # For larger documents, we need to process in batches
    logger.info(f"Document has {total_pages} pages, processing in batches of {PAGES_PER_BATCH}")
    
    # Strategy for large documents:
    # 1. Process first batch to get main document info
    # 2. Process remaining batches looking for additional info
    # 3. Merge results
    
    extracted_data = None
    
    for batch_num, i in enumerate(range(0, total_pages, PAGES_PER_BATCH)):
        batch = doc_pages[i:i + PAGES_PER_BATCH]
        batch_description = f"pages {batch[0][0]}-{batch[-1][0]} of {total_pages}"
        
        content = await process_image_batch(batch, batch_description)
        
        if batch_num == 0:
            # First batch - full extraction
            content.append({
                "type": "text",
                "text": get_extraction_prompt()
            })
        else:
            # Subsequent batches - look for additional/missing info
            content.append({
                "type": "text",
                "text": f"""This is batch {batch_num + 1} of a multi-page document. 
The first batch contained the main document information. 
Please check these pages for any additional important information that might have been missed, 
such as:
- Additional parties (grantors/grantees, lessors/lessees)
- Exhibits or attachments with property descriptions
- Amendment or modification information
- Additional legal descriptions or property details

If you find additional information, provide it in the same JSON format as before.
If these pages don't contain significant new information, return: {{"additional_info": "none"}}
"""
            })
        
        # Make API call with retry logic
        async def make_batch_call():
            return client.messages.create(
                model=CONFIG.CLAUDE_MODEL,
                max_tokens=4096 if batch_num == 0 else 2048,
                messages=[
                    {"role": "user", "content": content}
                ]
            )
        
        logger.info(f"Processing batch {batch_num + 1}/{(total_pages + PAGES_PER_BATCH - 1) // PAGES_PER_BATCH}")
        response = await retry_with_backoff(make_batch_call)
        
        # Parse response
        response_text = response.content[0].text
        json_str = response_text.strip()
        
        # Try to find JSON in the response
        # First, check if it's wrapped in ```json blocks
        if "```json" in json_str:
            start = json_str.find("```json") + 7
            end = json_str.find("```", start)
            if end != -1:
                json_str = json_str[start:end].strip()
        # Otherwise, look for the first { and last }
        elif "{" in json_str and "}" in json_str:
            # Find the first { and last } to extract just the JSON
            start = json_str.find("{")
            end = json_str.rfind("}") + 1
            if start != -1 and end != 0:
                json_str = json_str[start:end]
        
        try:
            batch_data = json.loads(json_str.strip())

            if batch_num == 0:
                # First batch becomes our base data
                extracted_data = batch_data

                # Look for KEY TAKEAWAY and DETAILED ANALYSIS sections (first batch only)
                key_takeaway = None
                detailed_analysis = None

                if "KEY TAKEAWAY:" in response_text:
                    kt_start = response_text.find("KEY TAKEAWAY:")
                    kt_end = response_text.find("DETAILED ANALYSIS:", kt_start) if "DETAILED ANALYSIS:" in response_text else len(response_text)
                    if kt_start != -1:
                        key_takeaway = response_text[kt_start + 13:kt_end].strip()
                        if key_takeaway.startswith("```"):
                            key_takeaway = key_takeaway[3:].strip()
                        if key_takeaway.endswith("```"):
                            key_takeaway = key_takeaway[:-3].strip()
                        # Remove trailing # and ** markdown artifacts
                        key_takeaway = key_takeaway.rstrip('#').strip().strip('*').strip()

                if "DETAILED ANALYSIS:" in response_text:
                    da_start = response_text.find("DETAILED ANALYSIS:")
                    if da_start != -1:
                        detailed_analysis = response_text[da_start + 18:].strip()
                        if detailed_analysis.startswith("```"):
                            detailed_analysis = detailed_analysis[3:].strip()
                        if detailed_analysis.endswith("```"):
                            detailed_analysis = detailed_analysis[:-3].strip()
                        # Remove ** markdown artifacts
                        detailed_analysis = detailed_analysis.strip('*').strip()

                if key_takeaway:
                    extracted_data["key_takeaway"] = key_takeaway
                    logger.info(f"Extracted key takeaway from batch 1: {key_takeaway[:100]}...")
                if detailed_analysis:
                    extracted_data["ai_observations"] = detailed_analysis
                    logger.info(f"Extracted detailed analysis from batch 1: {detailed_analysis[:100]}...")

                # Fallback: check for old OBSERVATIONS format
                if not detailed_analysis and "OBSERVATIONS:" in response_text:
                    obs_start = response_text.find("OBSERVATIONS:")
                    if obs_start != -1:
                        observations = response_text[obs_start + 13:].strip()
                        if observations.startswith("```"):
                            observations = observations[3:].strip()
                        if observations.endswith("```"):
                            observations = observations[:-3].strip()
                        if observations:
                            extracted_data["ai_observations"] = observations
                            logger.info(f"Extracted observations from batch 1: {observations[:100]}...")
            else:
                # Merge additional data if found
                if "additional_info" not in batch_data or batch_data["additional_info"] != "none":
                    logger.info(f"Found additional information in batch {batch_num + 1}")
                    # Merge logic would go here - append to arrays, update fields, etc.
                    # This is simplified - you'd want more sophisticated merging
                    if isinstance(batch_data, dict) and isinstance(extracted_data, dict):
                        for key, value in batch_data.items():
                            if key not in extracted_data and value is not None:
                                extracted_data[key] = value
                            elif isinstance(value, list) and isinstance(extracted_data.get(key), list):
                                # Merge lists (e.g., multiple grantors)
                                for item in value:
                                    if item not in extracted_data[key]:
                                        extracted_data[key].append(item)
        
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse batch {batch_num + 1} response: {e}")
        
        # Add delay between batches to avoid rate limits
        if i + PAGES_PER_BATCH < total_pages:
            logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next batch...")
            await asyncio.sleep(BATCH_DELAY_SECONDS)
    
    return extracted_data or {"error": "Failed to extract data from document"}


async def extract_document_data(image_paths: list[str], _rotation_attempted: bool = False, pdf_path: str = None) -> dict:
    """
    Main entry point for document extraction.
    Detects multiple documents and extracts data from each.

    Args:
        image_paths: List of paths to page images
        _rotation_attempted: Internal flag to prevent infinite rotation loops
        pdf_path: Optional path to original PDF for deterministic text-based splitting

    Returns:
        Combined extraction results
    """
    # Step 1: Always do quick classification first (most efficient)
    classification = await quick_classify_document(image_paths[:3])  # Use first 3 pages

    # Step 1.5: Check if rotation is needed (only for direct images, not PDFs)
    # Only attempt rotation once to avoid loops
    rotation_needed = classification.get("rotation_needed", 0)
    if rotation_needed and rotation_needed != 0 and not _rotation_attempted:
        logger.info(f"Document needs {rotation_needed}° rotation - applying correction")

        # Import rotation function from main module
        from .main import rotate_image

        # Rotate all images
        rotated_paths = []
        for img_path in image_paths:
            try:
                rotated_path = rotate_image(img_path, rotation_needed)
                rotated_paths.append(rotated_path)
            except Exception as e:
                logger.error(f"Failed to rotate image {img_path}: {e}")
                rotated_paths.append(img_path)  # Use original on failure

        # Re-run extraction with rotated images (with flag to prevent loops)
        logger.info(f"Re-running extraction with {len(rotated_paths)} rotated image(s)")
        result = await extract_document_data(rotated_paths, _rotation_attempted=True, pdf_path=pdf_path)

        # Add rotation info to result
        result["rotation_applied"] = rotation_needed
        return result

    # If it's "other", skip ALL extraction and detection
    if classification.get("doc_type") == "other":
        logger.info(f"Document classified as 'other', skipping all extraction and detection")
        return {
            "doc_type": "other",
            "category": "other",
            "document_confidence": classification.get("confidence", "high"),
            "classification_model": CONFIG.CLAUDE_MODEL,
            "classification_scores": classification.get("scores", {}),
            "page_count": len(image_paths),
            "skip_extraction": True,
            "ai_observations": classification.get("reasoning", "Document type not recognized for automatic extraction.")
        }

    # Step 1.7: For Division Orders, try deterministic text-based splitting first
    # This is more reliable than AI-based detection for standardized forms
    doc_type = classification.get("doc_type")
    if doc_type == "division_order" and pdf_path and len(image_paths) > 1:
        logger.info("Division Order detected - attempting deterministic text-based splitting")
        try:
            from .splitters import DivisionOrderSplitter
            splitter = DivisionOrderSplitter()
            text_by_page = splitter.extract_text_from_pdf(pdf_path)

            if text_by_page:
                split_result = splitter.split(text_by_page)

                if split_result.success and split_result.document_count > 1:
                    logger.info(f"Deterministic splitter found {split_result.document_count} Division Orders: {split_result.page_ranges}")

                    # Process each document
                    results = {
                        "is_multi_document": True,
                        "document_count": split_result.document_count,
                        "split_method": "deterministic_text_patterns",
                        "documents": []
                    }

                    for i, (start_page, end_page) in enumerate(split_result.page_ranges):
                        logger.info(f"Extracting Division Order {i + 1} from pages {start_page}-{end_page}")

                        doc_data = await extract_single_document(
                            image_paths,
                            start_page,
                            end_page
                        )

                        # Add document boundaries and metadata
                        doc_data["_start_page"] = start_page
                        doc_data["_end_page"] = end_page
                        if split_result.document_metadata and i < len(split_result.document_metadata):
                            doc_data["_split_metadata"] = split_result.document_metadata[i]

                        results["documents"].append(doc_data)

                        # Add delay between documents to avoid rate limits
                        if i < split_result.document_count - 1:
                            logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
                            await asyncio.sleep(BATCH_DELAY_SECONDS)

                    return results
                elif split_result.reason == "no_extractable_text":
                    # Scanned PDF - try OCR
                    logger.info("No embedded text found - attempting OCR")
                    ocr_text_by_page = splitter.ocr_images(image_paths)

                    if ocr_text_by_page and not splitter.is_text_empty(ocr_text_by_page):
                        logger.info(f"OCR successful - extracted text from {len(ocr_text_by_page)} pages")
                        # Re-run splitter with OCR'd text
                        ocr_split_result = splitter.split(ocr_text_by_page)

                        if ocr_split_result.success and ocr_split_result.document_count > 1:
                            logger.info(f"OCR splitter found {ocr_split_result.document_count} Division Orders: {ocr_split_result.page_ranges}")

                            results = {
                                "is_multi_document": True,
                                "document_count": ocr_split_result.document_count,
                                "split_method": "ocr_text_patterns",
                                "documents": []
                            }

                            for i, (start_page, end_page) in enumerate(ocr_split_result.page_ranges):
                                logger.info(f"Extracting Division Order {i + 1} from pages {start_page}-{end_page}")

                                doc_data = await extract_single_document(
                                    image_paths,
                                    start_page,
                                    end_page
                                )

                                doc_data["_start_page"] = start_page
                                doc_data["_end_page"] = end_page
                                if ocr_split_result.document_metadata and i < len(ocr_split_result.document_metadata):
                                    doc_data["_split_metadata"] = ocr_split_result.document_metadata[i]

                                results["documents"].append(doc_data)

                                if i < ocr_split_result.document_count - 1:
                                    logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
                                    await asyncio.sleep(BATCH_DELAY_SECONDS)

                            return results
                        else:
                            # OCR patterns didn't find multiple docs - fall back to classification
                            logger.info(f"OCR splitter found single document: {ocr_split_result.reason}")
                            logger.info("OCR patterns failed - falling back to classification inference")
                            estimated_count = classification.get("estimated_doc_count", 1)
                            if classification.get("is_multi_document") and estimated_count == len(image_paths):
                                logger.info(f"Using classification inference ({estimated_count} docs on {len(image_paths)} pages)")

                                results = {
                                    "is_multi_document": True,
                                    "document_count": estimated_count,
                                    "split_method": "classification_page_inference",
                                    "documents": []
                                }

                                for page_num in range(1, estimated_count + 1):
                                    logger.info(f"Extracting Division Order {page_num} from page {page_num}")

                                    doc_data = await extract_single_document(
                                        image_paths,
                                        page_num,
                                        page_num
                                    )

                                    doc_data["_start_page"] = page_num
                                    doc_data["_end_page"] = page_num
                                    results["documents"].append(doc_data)

                                    if page_num < estimated_count:
                                        logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
                                        await asyncio.sleep(BATCH_DELAY_SECONDS)

                                return results
                    else:
                        # OCR completely failed - fall back to classification inference
                        logger.info("OCR failed or returned empty text - trying classification inference")
                        estimated_count = classification.get("estimated_doc_count", 1)
                        if classification.get("is_multi_document") and estimated_count == len(image_paths):
                            logger.info(f"Using classification inference ({estimated_count} docs on {len(image_paths)} pages)")

                            results = {
                                "is_multi_document": True,
                                "document_count": estimated_count,
                                "split_method": "classification_page_inference",
                                "documents": []
                            }

                            for page_num in range(1, estimated_count + 1):
                                logger.info(f"Extracting Division Order {page_num} from page {page_num}")

                                doc_data = await extract_single_document(
                                    image_paths,
                                    page_num,
                                    page_num
                                )

                                doc_data["_start_page"] = page_num
                                doc_data["_end_page"] = page_num
                                results["documents"].append(doc_data)

                                if page_num < estimated_count:
                                    logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
                                    await asyncio.sleep(BATCH_DELAY_SECONDS)

                            return results
                else:
                    logger.info(f"Deterministic splitter found single document: {split_result.reason}")
        except ImportError as e:
            logger.warning(f"Could not import splitter module: {e}. Falling back to AI detection.")
        except Exception as e:
            logger.warning(f"Deterministic splitting failed: {e}. Falling back to AI detection.")

    # Step 2: Check if classification detected multiple documents
    # The quick classification now includes multi-doc detection
    if classification.get("is_multi_document", False):
        logger.info(f"Classification detected multi-document PDF (estimated {classification.get('estimated_doc_count', 'unknown')} documents)")

        # Get detailed document boundaries
        detection = await detect_documents(image_paths)

        if detection.get("is_multi_document", False):
            # Handle multi-document flow
            documents = detection.get("documents", [])
            document_count = detection.get("document_count", len(documents))

            logger.info(f"Detection returned {len(documents)} document entries")

            # Filter out any summary notes - accept both "type" and "doc_type" as valid
            actual_documents = []
            for doc in documents:
                if "note" in doc:
                    continue  # Skip summary notes
                if "type" in doc or "doc_type" in doc:
                    # Normalize to use "type"
                    if "doc_type" in doc and "type" not in doc:
                        doc["type"] = doc["doc_type"]
                    actual_documents.append(doc)
                else:
                    logger.warning(f"Document entry missing type field: {doc}")

            logger.info(f"After filtering: {len(actual_documents)} valid documents")

            results = {
                "is_multi_document": True,
                "document_count": document_count,
                "documents": []
            }

            # If we have too many documents detected, we'll process as a bundle
            if document_count > 10 and len(actual_documents) < document_count:
                logger.warning(f"Detected {document_count} documents but only {len(actual_documents)} were detailed. Processing as multi-document bundle.")
                results["doc_type"] = "multi_document"
                results["needs_manual_split"] = True
                results["estimated_document_count"] = document_count
                return results

            # Extract each document
            for doc in actual_documents:
                if "start_page" not in doc:
                    logger.warning(f"Skipping document entry without start_page: {doc}")
                    continue

                doc_type = doc.get("type", doc.get("doc_type", "unknown"))
                logger.info(f"Extracting {doc_type} from pages {doc['start_page']}-{doc.get('end_page', doc['start_page'])}")
                
                start_page = doc["start_page"]
                end_page = doc.get("end_page", start_page)

                doc_data = await extract_single_document(
                    image_paths,
                    start_page,
                    end_page
                )

                # Add document boundaries to extracted data
                doc_data["_start_page"] = start_page
                doc_data["_end_page"] = end_page
                doc_data["_detection_confidence"] = doc.get("confidence", 0.5)
                
                results["documents"].append(doc_data)
                
                # Add delay between documents to avoid rate limits
                if doc != actual_documents[-1]:  # Not the last document
                    logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
                    await asyncio.sleep(BATCH_DELAY_SECONDS)
            
            return results
    
    # Step 3: Single document - we already know it's not "other"
    result = await extract_single_document(image_paths)
    
    # Check if this might be a missed multi-document bundle
    if (len(image_paths) >= 30 and 
        result.get("doc_type") in ["other", None] and
        result.get("document_confidence", "medium") != "high"):
        logger.warning(f"Large PDF ({len(image_paths)} pages) detected as single document of type '{result.get('doc_type')}'. May be a multi-document bundle.")
        result["possible_multi_document"] = True
        result["page_count"] = len(image_paths)
    
    return result


def calculate_document_confidence(field_scores: dict, doc_type: str = None, extracted_data: dict = None) -> str:
    """Calculate overall document confidence based on field scores.
    
    Only considers fields that were actually extracted (not missing fields).
    """
    if not field_scores:
        return "low"
    
    # Only include scores for fields that were actually found in the document
    relevant_scores = []
    
    if extracted_data:
        # Include scores for fields that have non-null values in extracted_data
        for field, score in field_scores.items():
            if isinstance(score, (int, float)):
                # Check if this field was actually extracted (not null/empty)
                field_value = extracted_data.get(field)
                
                # Skip fields that are null, None, empty string, or 0 confidence
                if field_value is not None and field_value != "" and field_value != "null":
                    relevant_scores.append(score)
                elif score > 0:  # Include fields with confidence > 0 even if not found
                    relevant_scores.append(score)
    else:
        # Fallback: only include non-zero scores
        relevant_scores = [v for v in field_scores.values() if isinstance(v, (int, float)) and v > 0]
    
    if not relevant_scores:
        return "low"
    
    avg_score = sum(relevant_scores) / len(relevant_scores)
    
    if avg_score >= 0.85:
        return "high"
    elif avg_score >= 0.70:
        return "medium"
    else:
        return "low"


def get_fields_needing_review(field_scores: dict, threshold: float = 0.9) -> list[str]:
    """Get list of fields with confidence below threshold."""
    if not field_scores:
        return []
    
    return [field for field, score in field_scores.items() 
            if isinstance(score, (int, float)) and score < threshold]