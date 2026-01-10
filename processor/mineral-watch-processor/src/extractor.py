"""Document extraction using Claude Vision API with per-field confidence and batching."""

import anthropic
import base64
import json
import logging
import asyncio
from pathlib import Path
from typing import Optional

from .config import CONFIG

logger = logging.getLogger(__name__)

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
- occ_order (pooling, spacing, increased density, location exception)
- suspense_notice (Form 1081, escrow notices)
- joa (Joint Operating Agreement)
- ownership_entity (probate, heirship, trust docs, LLC docs)
- legal_document (lawsuits, judgments, court orders)
- correspondence
- tax_record (tax assessments, property tax records)
- map (includes plats)
- multi_document
- other
"""

EXTRACTION_PROMPT = """You are a specialized document processor for Oklahoma mineral rights documents.
Your task is to extract key information and provide a confidence score (0.0-1.0) for each field.

IMPORTANT: Structure your response as follows:
1. FIRST: The JSON object with extracted data
2. THEN: After the JSON, add a section labeled "OBSERVATIONS:" with:
   - A short paragraph (3-5 sentences) summarizing the document in plain English
   - Focus on what makes this document significant or noteworthy
   - Highlight key business implications or unusual aspects
   - Write for someone who wants a quick understanding without reading the full document
   - DO NOT list specific data already extracted (formations, book/page, dates, etc.)

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

For DEEDS:
{
  "doc_type": "mineral_deed",
  "grantor_names": ["John A. Smith", "Mary B. Smith"],
  "grantee_names": ["Robert C. Jones"],
  "recording_date": "2023-03-15",
  "execution_date": "2023-03-10",
  "recording_book": "350",
  "recording_page": "125",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "interest_conveyed": "1/2 mineral interest in and under...",
  "consideration": "$10,000.00",
  "field_scores": {
    "grantor_names": 0.95,
    "grantee_names": 0.98,
    "recording_date": 1.0,
    "execution_date": 0.90,
    "recording_book": 1.0,
    "recording_page": 1.0,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0,
    "interest_conveyed": 0.85,
    "consideration": 0.75
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

For DRILLING PERMITS:
{
  "doc_type": "drilling_permit",
  "operator_name": "XYZ Oil Company",
  "well_name": "Smith 1-16H",
  "permit_date": "2023-03-15",
  "api_number": "35-051-12345",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "permit_type": "horizontal",
  "target_formation": "Woodford",
  "unit_size_acres": "640",
  "field_scores": {
    "operator_name": 1.0,
    "well_name": 1.0,
    "permit_date": 1.0,
    "api_number": 0.95,
    "legal_section": 1.0,
    "legal_township": 1.0,
    "legal_range": 1.0,
    "legal_county": 1.0,
    "permit_type": 0.90,
    "target_formation": 0.85,
    "unit_size_acres": 0.90
  },
  "document_confidence": "high"
}

For DIVISION ORDERS:
{
  "doc_type": "division_order",
  "owner_name": "John A. Smith",
  "operator_name": "XYZ Oil Company",
  "well_name": "Smith 1-16H",
  "effective_date": "2023-04-01",
  "decimal_interest": 0.00390625,
  "api_number": "35-051-12345",
  "legal_description": {
    "section": "16",
    "township": "12N",
    "range": "7W",
    "county": "Grady"
  },
  "field_scores": {
    "owner_name": 1.0,
    "operator_name": 1.0,
    "well_name": 1.0,
    "effective_date": 0.95,
    "decimal_interest": 1.0,
    "api_number": 0.90,
    "legal_section": 0.95,
    "legal_township": 0.95,
    "legal_range": 0.95,
    "legal_county": 1.0
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

For OCC ORDERS (Pooling, Spacing, etc.):
{
  "doc_type": "occ_order",
  "cause_number": "CD 2023-001234",
  "order_type": "pooling",
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

REMEMBER FOR OBSERVATIONS:
- Write a short paragraph that helps someone quickly understand the document
- Use plain English, avoid technical jargon
- Focus on significance and business implications
- Examples of good observations:
  - "This completion report documents a successful horizontal well with strong initial production results. The well appears to be a high-quality producer based on the oil gravity and gas-oil ratio. The extensive fracturing treatment suggests this was a significant investment, typical of modern horizontal drilling operations in this area."
  - "This mineral deed transfers mineral rights with the grantor retaining an overriding royalty interest, which is somewhat unusual. The deed includes depth limitations that could affect future development. This appears to be part of a larger transaction given the substantial consideration amount."
  - "This division order establishes payment instructions for a producing gas well with complex ownership. Multiple small decimal interests suggest the minerals have been divided through inheritance or multiple sales over time. The operator will need to carefully manage these numerous small payments."
- What to avoid:
  - Data dumps: "The well was drilled to 20,783 feet with 13.375 inch surface casing..."
  - Too generic: "This is a standard document"
  - Technical lists: "Formations penetrated include Big Lime, Verdigris, Inola..."
"""


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
  "reasoning": "Brief explanation"
}

MULTI-DOCUMENT DETECTION:
Determine if this PDF contains multiple separate documents. Look for:
- Multiple recording stamps with different book/page numbers
- Repeated document headers (e.g., "MINERAL DEED" appearing multiple times)
- Different document dates or execution dates
- Different parties (grantors/grantees) in separate sections
- Clear page breaks between distinct documents
- Multiple check stubs or multiple division orders

If you see evidence of multiple documents, set is_multi_document: true and estimate the count.

DOCUMENT TYPES (if not one of these, return "other"):
- mineral_deed, royalty_deed, lease, division_order, assignment
- pooling_order, spacing_order, drilling_permit, title_opinion
- check_stub, occ_order, suspense_notice, joa
- ownership_entity, legal_document, correspondence
- tax_record, map

Examples of "other" documents:
- General business contracts, personal letters, medical records
- Financial statements (non-oil/gas), government forms (non-mineral rights)
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
    
    # Parse response
    response_text = response.content[0].text
    logger.debug(f"Detection response: {response_text}")
    
    try:
        result = json.loads(response_text.strip())
        logger.info(f"Detected {result.get('document_count', 1)} documents")
        return result
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse detection response: {e}")
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
            "text": EXTRACTION_PROMPT
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
            
            # Look for observations section after the JSON
            observations = None
            if "OBSERVATIONS:" in response_text:
                obs_start = response_text.find("OBSERVATIONS:")
                if obs_start != -1:
                    observations = response_text[obs_start + 13:].strip()
                    # Clean up any markdown formatting
                    if observations.startswith("```"):
                        observations = observations[3:].strip()
                    if observations.endswith("```"):
                        observations = observations[:-3].strip()
                    
                    # Add observations to the extracted data
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
                "text": EXTRACTION_PROMPT
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


async def extract_document_data(image_paths: list[str]) -> dict:
    """
    Main entry point for document extraction.
    Detects multiple documents and extracts data from each.
    
    Args:
        image_paths: List of paths to page images
    
    Returns:
        Combined extraction results
    """
    # Step 1: Always do quick classification first (most efficient)
    classification = await quick_classify_document(image_paths[:3])  # Use first 3 pages
    
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
            
            # Filter out any summary notes from the documents list
            actual_documents = [doc for doc in documents if "note" not in doc and "type" in doc]
            
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
                if "type" not in doc or "start_page" not in doc:
                    logger.warning(f"Skipping invalid document entry: {doc}")
                    continue
                    
                logger.info(f"Extracting {doc['type']} from pages {doc['start_page']}-{doc['end_page']}")
                
                doc_data = await extract_single_document(
                    image_paths, 
                    doc["start_page"], 
                    doc["end_page"]
                )
                
                # Add document boundaries to extracted data
                doc_data["_start_page"] = doc["start_page"]
                doc_data["_end_page"] = doc["end_page"]
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