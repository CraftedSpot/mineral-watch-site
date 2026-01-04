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

EXTRACTION_PROMPT = """You are analyzing scanned mineral rights documents from Oklahoma.
Extract structured data from these document images.

For each document (there may be multiple documents in this PDF), identify:

1. **Document Type**: One of:
   - mineral_deed
   - royalty_deed  
   - division_order
   - lease
   - lease_assignment
   - pooling_order
   - spacing_order
   - ratification
   - affidavit_of_heirship
   - probate_document
   - other (with explanation in notes)

2. **General Fields** (for all document types):
   - Grantor(s): name(s) and address if shown
   - Grantee(s): name(s) and address if shown
   - Interest Conveyed: The fractional interest (e.g., "1/8", "1/4", "all")
   - Legal Description: Section, Township, Range, County, Quarter calls, Acres
   - Recording Information: Book, Page, Recording date
   - Execution Date: When the document was signed
   - Consideration: Dollar amount or description

3. **Division Order Specific Fields** (only when doc_type is division_order):
   - well_name: Full well name (e.g., "LASSITER 1-20-29XH", "SMITH 1-15H")
   - api_number: API well number if shown (e.g., "35-019-12345")
   - owner_number: The operator's account/owner number for this interest holder
   - decimal_interest: The decimal ownership interest (e.g., "0.00123456", "0.000875")
   - interest_type: Type of interest (e.g., "royalty", "working interest", "overriding royalty", "mineral interest")
   - operator: Company name of the operator/payor
   - effective_date: When the division order takes effect
   - product_type: What the division order covers ("oil", "gas", "oil and gas", "condensate")

4. **Pooling Order Specific Fields** (only when doc_type is pooling_order):
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

5. **Per-Field Confidence Scoring**:
   For EACH extracted field, provide a confidence score from 0.0 to 1.0:
   
   - 0.9-1.0: Text is clear, unambiguous, fully visible
   - 0.6-0.89: Readable but some uncertainty (faded, unusual formatting, partially obscured)
   - 0.0-0.59: Very difficult to read, guessing, or field not found
   - null: Field not present in document (different from "couldn't read")
   
   Be honest about uncertainty. Users can review and correct low-confidence fields.

6. **Multi-Document Detection**:
   If this PDF contains multiple separate legal documents, identify the page boundaries.
   Set is_multi_document: true and provide document_boundaries array.

Return ONLY valid JSON (no markdown, no explanation) in this exact format:

{
  "is_multi_document": false,
  "doc_type": "mineral_deed",
  
  "grantor": {
    "name": "Full name(s) as shown",
    "name_confidence": 0.95,
    "address": "If provided, else empty string",
    "address_confidence": 0.70
  },
  
  "grantee": {
    "name": "Full name(s) as shown",
    "name_confidence": 0.98,
    "address": "",
    "address_confidence": null
  },
  
  "interest_conveyed": "1/8",
  "interest_confidence": 0.85,
  
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
    "acres": "160",
    "acres_confidence": 0.60
  },
  
  "recording_info": {
    "book": "123",
    "book_confidence": 0.90,
    "page": "456",
    "page_confidence": 0.90,
    "recording_date": "1980-08-15",
    "recording_date_confidence": 0.75
  },
  
  "execution_date": "1980-07-03",
  "execution_date_confidence": 0.95,
  
  "consideration": "$10.00 and other valuable consideration",
  "consideration_confidence": 0.88,
  
  "field_scores": {
    "grantor_name": 0.95,
    "grantor_address": 0.70,
    "grantee_name": 0.98,
    "grantee_address": null,
    "interest_conveyed": 0.85,
    "legal_section": 0.99,
    "legal_township": 0.99,
    "legal_range": 0.99,
    "legal_county": 0.95,
    "legal_quarter": 0.80,
    "legal_acres": 0.60,
    "recording_book": 0.90,
    "recording_page": 0.90,
    "recording_date": 0.75,
    "execution_date": 0.95,
    "consideration": 0.88
  },
  
  "notes": "Any additional relevant information or uncertainties about the extraction"
}

For division_order documents, include these additional fields:
{
  "doc_type": "division_order",
  
  "well_name": "LASSITER 1-20-29XH",
  "well_name_confidence": 0.98,
  
  "api_number": "35-019-12345",
  "api_number_confidence": 0.95,
  
  "owner_number": "323615003",
  "owner_number_confidence": 0.97,
  
  "decimal_interest": "0.00087500",
  "decimal_interest_confidence": 0.99,
  
  "interest_type": "royalty",
  "interest_type_confidence": 0.90,
  
  "operator": "Continental Resources",
  "operator_confidence": 0.95,
  
  "effective_date": "2018-03-05",
  "effective_date_confidence": 0.92,
  
  "product_type": "oil and gas",
  "product_type_confidence": 0.88,
  
  "field_scores": {
    "well_name": 0.98,
    "owner_number": 0.97,
    "decimal_interest": 0.99,
    "operator": 0.95,
    "effective_date": 0.92,
    "interest_type": 0.90,
    "product_type": 0.88,
    "api_number": 0.95
  }
}

For pooling_order documents, include these additional fields:
{
  "doc_type": "pooling_order",
  
  "cd_number": "201500614",
  "cd_number_confidence": 0.95,
  
  "order_number": "639589",
  "order_number_confidence": 0.98,
  
  "applicant": "Canyon Creek Energy Holdings LLC",
  "applicant_confidence": 0.97,
  
  "operator": "Canyon Creek Energy Operating LLC", 
  "operator_confidence": 0.95,
  
  "well_name": "Hockett #1-3",
  "well_name_confidence": 0.92,
  
  "well_cost": "886600.00",
  "well_cost_confidence": 0.90,
  
  "unit_size_acres": "160",
  "unit_size_acres_confidence": 0.95,
  
  "formations": ["Cromwell", "Upper Booch", "Lower Booch", "Hartshorne", "Gilcrease"],
  "formations_confidence": 0.88,
  
  "election_deadline_days": "20",
  "election_deadline_days_confidence": 0.90,
  
  "election_mailing_address": "P.O. Box 123, Oklahoma City, OK 73101",
  "election_mailing_address_confidence": 0.85,
  
  "election_options": [
    {
      "option_number": 1,
      "type": "participate",
      "cash_bonus_per_acre": null,
      "royalty_rate": "1/8",
      "net_revenue_interest": "87.5%",
      "description": "Pay proportionate share of well costs"
    },
    {
      "option_number": 2,
      "type": "cash_plus_royalty",
      "cash_bonus_per_acre": "350.00",
      "royalty_rate": "1/16",
      "net_revenue_interest": "81.25%",
      "description": "Cash consideration plus excess royalty"
    },
    {
      "option_number": 3,
      "type": "royalty_only",
      "cash_bonus_per_acre": "0.00",
      "royalty_rate": "1/8",
      "net_revenue_interest": "75%",
      "description": "No cash, excess royalty only"
    }
  ],
  "election_options_confidence": 0.85,
  
  "legal_description": {
    "section": "3",
    "township": "1N",
    "range": "8E",
    "county": "Coal",
    "quarter": "SE/4"
  },
  
  "order_date": "2015-04-20",
  "order_date_confidence": 0.95,
  
  "field_scores": {
    "cd_number": 0.95,
    "order_number": 0.98,
    "applicant": 0.97,
    "operator": 0.95,
    "well_name": 0.92,
    "well_cost": 0.90,
    "unit_size_acres": 0.95,
    "formations": 0.88,
    "election_deadline_days": 0.90,
    "election_options": 0.85,
    "order_date": 0.95
  }
}

For multi-document PDFs:
{
  "is_multi_document": true,
  "document_boundaries": [
    {"start_page": 1, "end_page": 4, "doc_type": "mineral_deed"},
    {"start_page": 5, "end_page": 8, "doc_type": "mineral_deed"},
    {"start_page": 9, "end_page": 12, "doc_type": "other", "notes": "Correspondence letter"}
  ],
  "documents": [
    { /* full extraction for doc 1 with all confidence scores */ },
    { /* full extraction for doc 2 with all confidence scores */ },
    { /* minimal info for "other" doc */ }
  ]
}

Remember: Return ONLY the JSON object, no other text."""


def calculate_document_confidence(field_scores: dict, doc_type: str = None) -> str:
    """Roll up per-field scores to document-level high/medium/low."""
    
    # Critical fields vary by document type
    if doc_type == 'division_order':
        critical_fields = [
            'well_name',
            'owner_number',
            'decimal_interest',
            'operator',
            'effective_date'
        ]
    elif doc_type == 'pooling_order':
        critical_fields = [
            'cd_number',
            'well_name',
            'well_cost',
            'election_options',
            'election_deadline_days',
            'unit_size_acres'
        ]
    else:
        critical_fields = [
            'grantor_name',
            'grantee_name',
            'interest_conveyed',
            'legal_section',
            'legal_township',
            'legal_range',
            'legal_county'
        ]
    
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
        logger.error(f"Response was: {response_text}")
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
