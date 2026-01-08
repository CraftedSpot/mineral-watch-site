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

Your task is to quickly identify:
1. How many separate legal documents are in this PDF
2. The page boundaries for each document
3. The document type for each

Look for clear indicators of separate documents:
- New cover pages or title headers
- Recording stamps/information changing
- Different parties/properties
- Signature pages followed by new documents

IMPORTANT: Each document with a unique recording reference should be identified 
as a SEPARATE document. This includes:
- Different book/page numbers (e.g., Book 350 Page 57 vs Book 350 Page 56)
- Different instrument/document numbers
- Different recording dates

Even if parties, property, and execution dates are similar, separate recorded 
instruments must be tracked as separate documents for title chain purposes.

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

Valid document types:
- mineral_deed
- lease
- drilling_permit
- well_completion_report
- production_report
- division_order
- tax_record
- correspondence
- legal_document
- other
"""

EXTRACTION_PROMPT = """You are a specialized document processor for Oklahoma mineral rights documents.
Your task is to extract key information and provide a confidence score (0.0-1.0) for each field.

Document Types:
1. Mineral Deed - Transfer of mineral rights ownership
2. Lease - Grants drilling rights to operator
3. Drilling Permit - OCC permit to drill a well
4. Well Completion Report - Final drilling results submitted to OCC
5. Production Report - Oil/gas production volumes and revenue
6. Division Order - Payment distribution instructions
7. Tax Record - Property tax assessments for minerals
8. Correspondence - Letters, notices, or communications
9. Legal Document - Court orders, probate, judgments
10. Other - Any document not fitting above categories

For EACH field you extract:
1. Provide the value (or null if not found)
2. Provide a confidence score (0.0-1.0)
3. For names, always check for middle initials/names

CRITICAL EXTRACTION RULES:
1. ALWAYS use the doc_type field to specify one of the 10 types above
2. Extract ALL names mentioned (grantor, grantee, lessor, lessee, etc.)
3. For deeds: grantor = seller, grantee = buyer
4. For leases: lessor = mineral owner, lessee = oil company
5. Look for execution dates (when signed) AND recording dates (when filed)
6. Extract the EXACT legal description as written
7. Check for royalty percentages, bonus payments, and term lengths
8. Extract any API numbers for wells
9. Look for any amendment or correction references
10. Always format dates as "YYYY-MM-DD" if possible

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

Confidence levels based on overall document quality:
- "high": Most fields extracted with high confidence (avg > 0.85)
- "medium": Some uncertainty in extracted data (avg 0.70-0.85)  
- "low": Significant uncertainty, needs manual review (avg < 0.70)
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
        # Sample strategy: First 5, last 5, and evenly spaced middle pages
        sample_indices = []
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
        
        logger.info(f"Sampling {len(sample_indices)} pages for detection: {sample_indices}")
        
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
        if json_str.startswith("```json"):
            json_str = json_str[7:]
        if json_str.endswith("```"):
            json_str = json_str[:-3]
        
        try:
            extracted_data = json.loads(json_str.strip())
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
        if json_str.startswith("```json"):
            json_str = json_str[7:]
        if json_str.endswith("```"):
            json_str = json_str[:-3]
        
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
    # Step 1: Detect documents
    detection = await detect_documents(image_paths)
    
    if not detection.get("is_multi_document", False):
        # Single document - extract it
        return await extract_single_document(image_paths)
    
    # Multiple documents - extract each one
    documents = detection.get("documents", [])
    results = {
        "is_multi_document": True,
        "document_count": len(documents),
        "documents": []
    }
    
    for doc in documents:
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
        if doc != documents[-1]:  # Not the last document
            logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
            await asyncio.sleep(BATCH_DELAY_SECONDS)
    
    return results


def calculate_document_confidence(field_scores: dict, doc_type: str = None) -> str:
    """Calculate overall document confidence based on field scores."""
    if not field_scores:
        return "low"
    
    scores = [v for v in field_scores.values() if isinstance(v, (int, float))]
    if not scores:
        return "low"
    
    avg_score = sum(scores) / len(scores)
    
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