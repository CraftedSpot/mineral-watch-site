"""Document extraction using Claude Vision API with per-field confidence."""

import anthropic
import base64
import json
import logging
from pathlib import Path

from .config import CONFIG

logger = logging.getLogger(__name__)

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=CONFIG.ANTHROPIC_API_KEY)

DETECTION_PROMPT = """You are analyzing a PDF that may contain one or more mineral rights documents.

Your task is to quickly identify:
1. How many separate legal documents are in this PDF
2. The page boundaries for each document
3. The document type for each

Look for clear indicators of separate documents:
- New cover pages or title headers
- Recording stamps/information changing
- Different parties/properties
- Signature pages followed by new documents

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

For multiple documents:
{
  "is_multi_document": true,
  "document_count": 3,
  "documents": [
    {
      "type": "mineral_deed",
      "start_page": 1,
      "end_page": 4,
      "confidence": 0.90
    },
    {
      "type": "division_order",
      "start_page": 5,
      "end_page": 6,
      "confidence": 0.85
    },
    {
      "type": "lease",
      "start_page": 7,
      "end_page": 12,
      "confidence": 0.95
    }
  ]
}

Document types: mineral_deed, royalty_deed, division_order, lease, assignment, lease_assignment, pooling_order, spacing_order, ratification, affidavit_of_heirship, probate_document, right_of_way, release_of_lease, lease_amendment, lease_extension, divorce_decree, death_certificate, power_of_attorney, other

Return ONLY the JSON, no other text."""

EXTRACTION_PROMPT = """You are analyzing a scanned mineral rights document from Oklahoma.
Extract structured data from this single document.

Identify the following information:

1. **Document Type**: One of:
   - mineral_deed
   - royalty_deed  
   - division_order
   - lease
   - assignment (or lease_assignment)
   - pooling_order
   - spacing_order
   - ratification
   - affidavit_of_heirship
   - probate_document
   - right_of_way
   - release_of_lease
   - lease_amendment (or lease_extension)
   - divorce_decree
   - death_certificate
   - power_of_attorney
   - other (with explanation in notes)

2. **Universal Fields** (extract for ALL document types):
   
   Recording Information:
   - recording_book: Book number
   - recording_page: Page number  
   - document_number: Instrument/document number if shown
   - recording_date: Date recorded at county clerk
   - recording_county: County where recorded
   
   Execution:
   - execution_date: Date document was signed
   - effective_date: Date document takes effect (if different)
   - prepared_by: Attorney, title company, or preparer name
   - notary_date: Date of notarization
   - notary_county: County of notarization
   - notary_state: State of notarization
   
   References:
   - related_documents: Array of referenced recordings (book/page, document numbers)
   - exhibits: Array of exhibits mentioned (Exhibit A, B, etc.)
   - prior_instruments: References to prior deeds, leases, etc.
   
   Legal Description:
   - legal_description.section
   - legal_description.township  
   - legal_description.range
   - legal_description.county
   - legal_description.quarter (NE/4, SW/4 NW/4, etc.)
   - legal_description.lot_block (if platted land)
   - legal_description.acres
   - legal_description.full_text (verbatim legal if complex)

3. **Mineral Deed / Royalty Deed Specific Fields** (only when doc_type is mineral_deed or royalty_deed):
   
   Parties:
   - grantor_name: Person/entity conveying interest
   - grantor_address: Address if shown
   - grantor_marital_status: Single, married, widow/widower
   - grantee_name: Person/entity receiving interest  
   - grantee_address: Address if shown
   
   Interest:
   - interest_conveyed: Fraction or percentage (e.g., "1/2", "undivided 1/8")
   - interest_type: "mineral", "royalty", "overriding royalty", "executive rights"
   - depth_limitations: Any depth restrictions ("surface to 100'", "all depths")
   - formation_limitations: Specific formations included/excluded
   - mineral_types: "oil and gas", "oil, gas, and other minerals", "coal", etc.
   
   Consideration:
   - consideration_amount: Dollar amount if stated
   - consideration_description: "Ten dollars and other good and valuable consideration"
   
   Reservations & Exceptions:
   - reservations: Array of interests retained by grantor
   - exceptions: Array of prior conveyances excepted
   - subject_to: Existing leases, encumbrances mentioned
   
   Title Information:
   - warranty_type: "general warranty", "special warranty", "quitclaim", "bargain and sale"
   - source_of_title: How grantor acquired (inheritance, deed from X, etc.)

4. **Lease Specific Fields** (only when doc_type is lease):
   
   Parties:
   - lessor_name: Mineral owner(s) granting lease
   - lessor_address: Address if shown
   - lessee_name: Company/person taking lease
   - lessee_address: Address if shown
   
   Lease Terms:
   - primary_term: Length of primary term ("3 years", "5 years")
   - royalty_rate: Lessor's royalty ("1/8", "3/16", "1/5")
   - bonus_amount: Bonus paid for signing
   - delay_rental: Annual rental during primary term
   - shut_in_royalty: Payment if well shut in
   
   Depth & Formations:
   - depth_from: Starting depth if limited
   - depth_to: Ending depth if limited  
   - formations_included: Specific formations leased
   - formations_excluded: Specific formations excepted
   - pugh_clause: Yes/No - horizontal Pugh clause present
   - vertical_pugh_clause: Yes/No - vertical/depth Pugh clause
   
   Special Provisions:
   - pooling_authorization: Can lessee pool the lease?
   - pooling_limitations: Acreage limits on pooling
   - surface_restrictions: Limitations on surface use
   - no_surface_clause: Yes/No - drilling from offsite only
   - attorney_approval_clause: Yes/No
   - extension_provisions: How lease can be extended
   - top_lease_prohibition: Yes/No
   
   Assignments:
   - assignable: Can lease be assigned?
   - assignment_restrictions: Any limitations

5. **Assignment Specific Fields** (only when doc_type is assignment or lease_assignment):
   
   Parties:
   - assignor_name: Party assigning interest
   - assignor_address: Address if shown
   - assignee_name: Party receiving assignment
   - assignee_address: Address if shown
   
   What's Being Assigned:
   - interest_assigned: Fraction/percentage being assigned
   - interest_type: "working interest", "overriding royalty", "net profits", "lease"
   - original_lease_reference: Book/page or doc number of underlying lease
   - original_lease_date: Date of underlying lease
   - original_lessor: Lessor on underlying lease
   - original_lessee: Lessee on underlying lease
   
   Assignment Terms:
   - consideration_amount: Dollar amount if stated
   - effective_date: When assignment takes effect
   - proportionate_reduction: Is interest subject to proportionate reduction?
   - retained_overriding: ORRI retained by assignor
   - back_in_after_payout: Any reversionary interest
   
   Warranties:
   - warranty_of_title: Does assignor warrant title?
   - warranty_scope: What's warranted (by, through, under assignor only?)

6. **Division Order Specific Fields** (only when doc_type is division_order):
   
   Well Information:
   - well_name: Full well name
   - api_number: API well number
   - well_location: Legal description of well location
   - operator: Operating company
   - purchaser: Who purchases production (if different)
   
   Owner Information:
   - owner_name: Interest owner name (usually the user)
   - owner_number: Operator's account number for owner
   - owner_address: Address on file
   
   Interest Details:
   - decimal_interest: Decimal ownership (e.g., "0.00087500")
   - interest_type: "royalty", "working interest", "ORRI", "mineral"
   - net_revenue_interest: NRI if working interest
   
   Product & Payment:
   - product_type: "oil", "gas", "oil and gas", "condensate", "NGLs"
   - effective_date: When division order takes effect
   - payment_frequency: Monthly, etc.
   - minimum_payment: Minimum check amount before holding
   
   Property Coverage:
   - unit_name: Name of drilling/spacing unit
   - formations: Formations covered
   - depths: Depth intervals if specified
   
   Certification:
   - requires_signature: Yes/No
   - signature_deadline: Date to return signed
   - signature_warranty: What signing certifies

7. **Pooling Order Specific Fields** (only when doc_type is pooling_order):
   - cd_number: The CD/Cause Docket number (e.g., "201500614-T" → extract "201500614")
   - order_number: The Order number (e.g., "639589")
   - applicant: Company that filed the application
   - operator: Designated operator (may be same as or subsidiary of applicant)
   - well_name: Proposed well name (e.g., "Hockett #1-3")
   - well_cost: Total estimated cost/AFE (e.g., "$886,600.00")
   - unit_size_acres: Size of the drilling/spacing unit (e.g., "160", "640")
   - formations: Array of formation/common source of supply names being pooled
   - election_deadline_days: Number of days to make election (usually 20 or 25)
   - election_mailing_address: Where to send election response
   - election_options: Array of election options offered (CRITICAL - extract all):
     Each option should include:
     - option_number: 1, 2, or 3
     - type: "participate" | "cash_plus_royalty" | "royalty_only"
     - cash_bonus_per_acre: Dollar amount or null
     - royalty_rate: The royalty percentage/fraction
     - net_revenue_interest: NRI percentage if stated
     - description: Brief description of the option
   - order_date: When the order was issued

8. **Ratification Specific Fields** (only when doc_type is ratification):
   
   Parties:
   - ratifying_party: Who is ratifying
   - ratifying_party_capacity: "heir", "successor trustee", "personal representative"
   - original_party: Who they're ratifying for (deceased, prior trustee, etc.)
   
   What's Being Ratified:
   - original_document_type: "lease", "deed", "assignment"
   - original_document_date: Date of document being ratified
   - original_document_reference: Book/page or recording info
   - original_parties: Parties to original document
   
   Ratification Terms:
   - effective_date: When ratification takes effect
   - interest_covered: What interest is being ratified
   - consideration: Any additional consideration paid
   - modifications: Any changes to original terms

9. **Right of Way / Easement Specific Fields** (only when doc_type is right_of_way):
   - grantor_name: Person/entity granting right of way
   - grantee_name: Person/entity receiving (usually pipeline company)
   - purpose: "pipeline", "road", "power line"
   - width: Width of easement
   - length: Length or "across property"
   - term: Perpetual or limited term
   - consideration_amount: Dollar amount paid
   - surface_damages: Any surface damage payment

10. **Release of Lease Specific Fields** (only when doc_type is release_of_lease):
    - releasor: Company releasing lease
    - original_lease_date: Date of lease being released
    - original_lease_reference: Book/page of original lease
    - original_lessor: Who leased originally
    - release_type: "full release", "partial release"
    - lands_released: Legal description of released lands
    - lands_retained: If partial, what's retained
    - effective_date: When release takes effect

11. **Affidavit of Heirship Specific Fields** (only when doc_type is affidavit_of_heirship):
    - decedent_name: Person who died
    - decedent_death_date: Date of death
    - decedent_death_place: Place of death
    - decedent_residence: Where they lived
    - marital_history: Marriages listed
    - heirs: Array of heirs with:
      - name: Heir's full name
      - relationship: Relationship to decedent
      - share: Their fractional share
    - property_description: What property is covered
    - affiant_name: Who signed affidavit
    - affiant_relationship: How affiant knew decedent

12. **Probate / Letters Testamentary Specific Fields** (only when doc_type is probate_document):
    - decedent_name: Person who died
    - case_number: Court case number
    - court_name: Name of court
    - executor_name: Named executor/administrator
    - executor_type: "executor", "administrator", "personal representative"
    - date_appointed: When executor was appointed
    - bond_amount: If bond required

13. **Spacing Order Specific Fields** (only when doc_type is spacing_order):
    - cd_number: The CD/Cause Docket number
    - cause_number: Alternative to cd_number
    - order_number: The Order number
    - applicant: Company that filed the application
    - operator: Designated operator
    - unit_size_acres: Unit size (40, 80, 160, 320, 640, etc.)
    - unit_shape: "square", "rectangular", or other
    - formations: Array of formations covered
    - legal_description: Full legal with section, township, range, county
    - order_date: When the order was issued
    - well_type: "vertical", "horizontal", or other

14. **Lease Amendment/Extension Specific Fields** (only when doc_type is lease_amendment):
    - amendment_type: "extension", "amendment", "ratification"
    - original_lease_date: Date of lease being amended
    - original_lease_reference: Book/page of original lease
    - original_lessor: Lessor on original lease
    - original_lessee: Original lessee
    - current_lessee: Current lessee if assigned
    - changes_made: What's being modified
    - new_expiration_date: If extended
    - additional_bonus: Any additional bonus paid
    - additional_terms: New provisions added
    - effective_date: When amendment takes effect

15. **Divorce Decree Specific Fields** (only when doc_type is divorce_decree):
    - case_number: Court case number
    - court_name: Name of court
    - petitioner_name: Person who filed for divorce
    - respondent_name: Other party
    - decree_date: Date of final decree
    - mineral_provisions: Description of how minerals divided
    - property_awarded_to: Who gets the mineral interests
    - legal_descriptions: Array of properties affected
    - recording_info: If recorded at county

16. **Death Certificate Specific Fields** (only when doc_type is death_certificate):
    - decedent_name: Full name of deceased
    - date_of_death: Date person died
    - place_of_death: City/County/State
    - date_of_birth: Birth date
    - residence_at_death: Where they lived
    - marital_status: Single, married, widowed, divorced
    - spouse_name: If married or widowed
    - certificate_number: Official certificate number
    - filing_date: When filed with state

17. **Power of Attorney Specific Fields** (only when doc_type is power_of_attorney):
    - principal_name: Person granting POA
    - agent_name: Person receiving authority (attorney-in-fact)
    - poa_type: "general", "limited", "durable", "mineral specific"
    - powers_granted: What agent can do (array or description)
    - effective_date: When POA takes effect
    - expiration_date: If limited term
    - property_covered: Specific properties or "all"
    - recording_info: Book/page if recorded
    - revocation_provisions: How POA can be revoked

18. **Per-Field Confidence Scoring**:
    For EACH extracted field, provide a confidence score from 0.0 to 1.0:
    
    - 0.9-1.0: Text is clear, unambiguous, fully visible
    - 0.6-0.89: Readable but some uncertainty (faded, unusual formatting, partially obscured)
    - 0.0-0.59: Very difficult to read, guessing, or field not found
    - null: Field not present in document (different from "couldn't read")
    
    Be honest about uncertainty. Users can review and correct low-confidence fields.

19. **Important Extraction Notes**:
    - Extract ALL fields listed under Universal Fields for EVERY document
    - Only include type-specific fields when the document matches that type
    - Include any unusual terms, clauses, or observations in the "notes" field
    - If legal description is complex (metes and bounds, multiple tracts), include full text
    - For dates, use ISO format (YYYY-MM-DD) when possible
    - For amounts, extract numeric values without $ or commas
    - For Yes/No fields, use boolean true/false or null if not mentioned

Return ONLY valid JSON (no markdown, no explanation) in this exact format:

{
  "doc_type": "mineral_deed",
  
  // Universal Fields - Recording Information
  "recording_book": "123",
  "recording_book_confidence": 0.90,
  "recording_page": "456", 
  "recording_page_confidence": 0.90,
  "document_number": "2023-001234",
  "document_number_confidence": 0.95,
  "recording_date": "2023-01-15",
  "recording_date_confidence": 0.98,
  "recording_county": "Beaver",
  "recording_county_confidence": 0.95,
  
  // Universal Fields - Execution
  "execution_date": "2023-01-03",
  "execution_date_confidence": 0.95,
  "effective_date": "2023-01-03",
  "effective_date_confidence": 0.90,
  "prepared_by": "Smith & Associates Law Firm",
  "prepared_by_confidence": 0.85,
  "notary_date": "2023-01-03",
  "notary_date_confidence": 0.95,
  "notary_county": "Oklahoma",
  "notary_county_confidence": 0.90,
  "notary_state": "Oklahoma",
  "notary_state_confidence": 0.95,
  
  // Universal Fields - References
  "related_documents": ["Book 100 Page 200", "Document #2020-5678"],
  "related_documents_confidence": 0.80,
  "exhibits": ["Exhibit A", "Exhibit B"],
  "exhibits_confidence": 0.90,
  "prior_instruments": ["Mineral Deed recorded in Book 80 Page 100"],
  "prior_instruments_confidence": 0.75,
  
  // Universal Fields - Legal Description
  "legal_description": {
    "section": 11,
    "section_confidence": 0.99,
    "township": "6N",
    "township_confidence": 0.99,
    "range": "27E",
    "range_confidence": 0.99,
    "county": "Beaver",
    "county_confidence": 0.95,
    "quarter": "SW/4",
    "quarter_confidence": 0.80,
    "lot_block": null,
    "lot_block_confidence": null,
    "acres": "160",
    "acres_confidence": 0.90,
    "full_text": null,
    "full_text_confidence": null
  },
  
  // Type-Specific Fields for Mineral Deed
  "grantor_name": "John Smith and Jane Smith",
  "grantor_name_confidence": 0.95,
  "grantor_address": "123 Main St, Tulsa, OK 74101",
  "grantor_address_confidence": 0.85,
  "grantor_marital_status": "married",
  "grantor_marital_status_confidence": 0.90,
  
  "grantee_name": "ABC Oil Company, LLC",
  "grantee_name_confidence": 0.98,
  "grantee_address": "",
  "grantee_address_confidence": null,
  
  "interest_conveyed": "undivided 1/8",
  "interest_conveyed_confidence": 0.95,
  "interest_type": "mineral",
  "interest_type_confidence": 0.98,
  "depth_limitations": "all depths",
  "depth_limitations_confidence": 0.90,
  "formation_limitations": null,
  "formation_limitations_confidence": null,
  "mineral_types": "oil, gas, and other minerals",
  "mineral_types_confidence": 0.95,
  
  "consideration_amount": "10.00",
  "consideration_amount_confidence": 0.90,
  "consideration_description": "Ten dollars and other good and valuable consideration",
  "consideration_description_confidence": 0.95,
  
  "reservations": [],
  "reservations_confidence": 0.90,
  "exceptions": ["All oil and gas leases of record"],
  "exceptions_confidence": 0.85,
  "subject_to": ["Existing oil and gas lease to XYZ Company"],
  "subject_to_confidence": 0.80,
  
  "warranty_type": "general warranty",
  "warranty_type_confidence": 0.95,
  "source_of_title": "Inherited from father John Smith Sr.",
  "source_of_title_confidence": 0.85,
  
  "field_scores": {
    // Universal fields
    "recording_book": 0.90,
    "recording_page": 0.90,
    "document_number": 0.95,
    "recording_date": 0.98,
    "recording_county": 0.95,
    "execution_date": 0.95,
    "effective_date": 0.90,
    "prepared_by": 0.85,
    "notary_date": 0.95,
    "notary_county": 0.90,
    "notary_state": 0.95,
    "related_documents": 0.80,
    "exhibits": 0.90,
    "prior_instruments": 0.75,
    "legal_section": 0.99,
    "legal_township": 0.99,
    "legal_range": 0.99,
    "legal_county": 0.95,
    "legal_quarter": 0.80,
    "legal_acres": 0.90,
    // Type-specific fields
    "grantor_name": 0.95,
    "grantor_address": 0.85,
    "grantor_marital_status": 0.90,
    "grantee_name": 0.98,
    "grantee_address": null,
    "interest_conveyed": 0.95,
    "interest_type": 0.98,
    "depth_limitations": 0.90,
    "mineral_types": 0.95,
    "consideration_amount": 0.90,
    "consideration_description": 0.95,
    "reservations": 0.90,
    "exceptions": 0.85,
    "subject_to": 0.80,
    "warranty_type": 0.95,
    "source_of_title": 0.85
  },
  
  "notes": "Document appears to be in good condition. All parties clearly identified."
}

Remember: Return ONLY the JSON object, no other text."""


def calculate_document_confidence(field_scores: dict, doc_type: str = None) -> str:
    """Roll up per-field scores to document-level high/medium/low."""
    
    # Universal critical fields for all documents
    universal_critical = [
        'recording_date',
        'execution_date',
        'legal_section',
        'legal_township',
        'legal_range',
        'legal_county'
    ]
    
    # Type-specific critical fields
    type_critical = {
        'mineral_deed': [
            'grantor_name',
            'grantee_name',
            'interest_conveyed',
            'interest_type',
            'warranty_type'
        ],
        'royalty_deed': [
            'grantor_name',
            'grantee_name',
            'interest_conveyed',
            'interest_type',
            'warranty_type'
        ],
        'lease': [
            'lessor_name',
            'lessee_name',
            'primary_term',
            'royalty_rate',
            'bonus_amount'
        ],
        'assignment': [
            'assignor_name',
            'assignee_name',
            'interest_assigned',
            'interest_type',
            'original_lease_reference'
        ],
        'division_order': [
            'well_name',
            'owner_number',
            'decimal_interest',
            'operator',
            'effective_date'
        ],
        'pooling_order': [
            'cd_number',
            'well_name',
            'well_cost',
            'election_options',
            'election_deadline_days',
            'unit_size_acres'
        ],
        'ratification': [
            'ratifying_party',
            'original_document_type',
            'original_document_reference'
        ],
        'right_of_way': [
            'grantor_name',
            'grantee_name',
            'purpose',
            'width',
            'consideration_amount'
        ],
        'release_of_lease': [
            'releasor',
            'original_lease_reference',
            'release_type',
            'lands_released'
        ],
        'affidavit_of_heirship': [
            'decedent_name',
            'decedent_death_date',
            'heirs',
            'affiant_name'
        ],
        'probate_document': [
            'decedent_name',
            'case_number',
            'court_name',
            'executor_name'
        ],
        'spacing_order': [
            'cd_number',
            'order_number',
            'unit_size_acres',
            'formations',
            'order_date'
        ],
        'lease_amendment': [
            'amendment_type',
            'original_lease_reference',
            'changes_made',
            'effective_date'
        ],
        'divorce_decree': [
            'case_number',
            'petitioner_name',
            'respondent_name',
            'mineral_provisions',
            'property_awarded_to'
        ],
        'death_certificate': [
            'decedent_name',
            'date_of_death',
            'certificate_number'
        ],
        'power_of_attorney': [
            'principal_name',
            'agent_name',
            'poa_type',
            'powers_granted'
        ]
    }
    
    # Get critical fields for this document type
    critical_fields = universal_critical + type_critical.get(doc_type, [])
    
    scores = []
    for field in critical_fields:
        score = field_scores.get(field)
        if score is not None:  # null means field not present, not low confidence
            scores.append(score)
    
    if not scores:
        return 'low'
    
    min_score = min(scores)
    
    # Any critical field below 0.6 = document needs review
    if min_score < 0.6:
        return 'low'
    
    # Any critical field below 0.9 = medium confidence
    if min_score < 0.9:
        return 'medium'
    
    # All critical fields 0.9+ = high confidence
    return 'high'


def get_fields_needing_review(field_scores: dict, threshold: float = 0.9) -> list[str]:
    """Return list of fields below confidence threshold."""
    return [
        field for field, score in field_scores.items()
        if score is not None and score < threshold
    ]


async def extract_document_data(image_paths: list[str]) -> dict:
    """
    Extract document data using Claude Vision.
    
    Args:
        image_paths: List of paths to page images
    
    Returns:
        Extracted data dictionary with confidence scores
    """
    logger.info(f"Extracting data from {len(image_paths)} pages")
    
    # Build content array with images
    content = []
    
    for i, image_path in enumerate(image_paths):
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
        
        # Import PIL for image processing
        from PIL import Image
        import io
        
        # Open image to check dimensions and size
        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size
        needs_processing = False
        
        # Check if image is over 5MB (Claude's limit)
        if len(image_bytes) > 5 * 1024 * 1024:
            logger.warning(f"Page {i+1} exceeds 5MB ({len(image_bytes)} bytes), will compress...")
            needs_processing = True
            
        # Check if dimensions exceed 2000px (Claude's multi-image limit)
        if width > 2000 or height > 2000:
            logger.warning(f"Page {i+1} dimensions {width}x{height} exceed 2000px limit, will resize...")
            needs_processing = True
            
        if needs_processing:
            # Resize if needed to fit within 2000x2000
            if width > 2000 or height > 2000:
                # Calculate new size maintaining aspect ratio
                ratio = min(2000/width, 2000/height)
                new_width = int(width * ratio)
                new_height = int(height * ratio)
                img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                logger.info(f"Resized to {new_width}x{new_height}")
            
            # Re-save with compression
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=85, optimize=True)
            image_bytes = output.getvalue()
            logger.info(f"Final size: {len(image_bytes)} bytes")
        
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
            "text": f"Page {i + 1} of {len(image_paths)}"
        })
    
    content.append({
        "type": "text",
        "text": EXTRACTION_PROMPT
    })
    
    # Call Claude
    logger.info(f"Calling Claude API ({CONFIG.CLAUDE_MODEL})")
    response = client.messages.create(
        model=CONFIG.CLAUDE_MODEL,
        max_tokens=4096,
        messages=[
            {"role": "user", "content": content}
        ]
    )
    
    # Parse response
    response_text = response.content[0].text
    logger.debug(f"Claude response: {response_text[:500]}...")
    
    # Extract JSON from response (handle markdown code blocks if present)
    json_str = response_text.strip()
    if json_str.startswith("```json"):
        json_str = json_str[7:]
    if json_str.startswith("```"):
        json_str = json_str[3:]
    if json_str.endswith("```"):
        json_str = json_str[:-3]
    json_str = json_str.strip()
    
    try:
        result = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Claude response as JSON: {e}")
        logger.error(f"Response was: {response_text[:1000]}...")  # Log first 1000 chars
        
        # Try to find JSON in the response using regex
        import re
        json_match = re.search(r'(\{[\s\S]*\})', response_text)
        if json_match:
            try:
                logger.info("Attempting to extract JSON using regex...")
                result = json.loads(json_match.group(1))
                logger.info("Successfully extracted JSON from malformed response")
            except json.JSONDecodeError:
                # If still fails, try to fix common issues
                cleaned = json_match.group(1)
                # Fix unescaped quotes in strings (common issue)
                cleaned = re.sub(r'(?<!\\)"(?=[^"]*":)', r'\"', cleaned)
                try:
                    result = json.loads(cleaned)
                    logger.info("Successfully parsed after cleaning JSON")
                except:
                    raise ValueError(f"Invalid JSON response from Claude: {e}")
        else:
            raise ValueError(f"Invalid JSON response from Claude: {e}")
    
    # Add calculated fields if not multi-document
    if not result.get("is_multi_document", False):
        field_scores = result.get("field_scores", {})
        doc_type = result.get("doc_type")
        result["document_confidence"] = calculate_document_confidence(field_scores, doc_type)
        result["fields_needing_review"] = get_fields_needing_review(field_scores)
    else:
        # Process each document in multi-doc
        for doc in result.get("documents", []):
            field_scores = doc.get("field_scores", {})
            doc_type = doc.get("doc_type")
            doc["document_confidence"] = calculate_document_confidence(field_scores, doc_type)
            doc["fields_needing_review"] = get_fields_needing_review(field_scores)
    
    logger.info(f"Extraction complete. Doc type: {result.get('doc_type')}, Confidence: {result.get('document_confidence')}")
    
    return result
