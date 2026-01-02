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

2. **Parties**:
   - Grantor(s): name(s) and address if shown
   - Grantee(s): name(s) and address if shown

3. **Interest Conveyed**: The fractional interest (e.g., "1/8", "1/4", "all")

4. **Legal Description**:
   - Section number
   - Township (e.g., "6N")
   - Range (e.g., "27E")
   - County
   - Quarter calls if present (e.g., "NW/4 of SE/4")
   - Acres if stated

5. **Recording Information**:
   - Book number
   - Page number
   - Recording date

6. **Execution Date**: When the document was signed

7. **Consideration**: Dollar amount or description

8. **Per-Field Confidence Scoring**:
   For EACH extracted field, provide a confidence score from 0.0 to 1.0:
   
   - 0.9-1.0: Text is clear, unambiguous, fully visible
   - 0.6-0.89: Readable but some uncertainty (faded, unusual formatting, partially obscured)
   - 0.0-0.59: Very difficult to read, guessing, or field not found
   - null: Field not present in document (different from "couldn't read")
   
   Be honest about uncertainty. Users can review and correct low-confidence fields.

9. **Multi-Document Detection**:
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


def calculate_document_confidence(field_scores: dict) -> str:
    """Roll up per-field scores to document-level high/medium/low."""
    
    # Critical fields that drive review decisions
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
        result["document_confidence"] = calculate_document_confidence(field_scores)
        result["fields_needing_review"] = get_fields_needing_review(field_scores)
    else:
        # Process each document in multi-doc
        for doc in result.get("documents", []):
            field_scores = doc.get("field_scores", {})
            doc["document_confidence"] = calculate_document_confidence(field_scores)
            doc["fields_needing_review"] = get_fields_needing_review(field_scores)
    
    logger.info(f"Extraction complete. Doc type: {result.get('doc_type')}, Confidence: {result.get('document_confidence')}")
    
    return result
