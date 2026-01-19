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

# ============================================================================
# STAGE 1: PAGE-LEVEL CLASSIFICATION (Two-Stage Pipeline)
# ============================================================================

# Coarse document types for page-level classification
# These are broader categories - fine-grained types come in Stage 2
COARSE_TYPES = [
    "deed",           # mineral deed, quit claim, warranty deed, correction deed
    "lease",          # oil & gas lease, assignment of lease, ratification
    "order",          # OCC orders (pooling, spacing, density, location exception)
    "permit",         # drilling permits, completion reports
    "check",          # check stubs, royalty statements
    "tax",            # tax records, assessments
    "title_opinion",  # attorney title opinions
    "affidavit",      # affidavits of heirship, death, identity
    "correspondence", # letters, notices, miscellaneous
    "exhibit",        # exhibit pages, attachments (attach to previous)
    "other"           # unknown/unclassifiable
]

# Regex patterns for heuristic title detection
# Format: (pattern, coarse_type)
TITLE_PATTERNS = [
    # Deeds
    (r"MINERAL\s+DEED", "deed"),
    (r"QUIT\s*CLAIM\s+DEED", "deed"),
    (r"QUITCLAIM\s+DEED", "deed"),
    (r"WARRANTY\s+DEED", "deed"),
    (r"CORRECTION\s+(QUIT\s*CLAIM\s+)?DEED", "deed"),
    (r"CORRECTIVE\s+(QUIT\s*CLAIM\s+)?DEED", "deed"),
    (r"ROYALTY\s+DEED", "deed"),
    (r"GENERAL\s+WARRANTY\s+DEED", "deed"),
    (r"SPECIAL\s+WARRANTY\s+DEED", "deed"),
    # Leases
    (r"OIL\s+AND\s+GAS\s+LEASE", "lease"),
    (r"ASSIGNMENT\s+OF.*LEASE", "lease"),
    (r"PARTIAL\s+ASSIGNMENT\s+OF\s+LEASE", "lease"),
    (r"RATIFICATION\s+OF.*LEASE", "lease"),
    (r"MEMORANDUM\s+OF\s+LEASE", "lease"),
    (r"LEASE\s+AGREEMENT", "lease"),
    # OCC Orders
    (r"POOLING\s+ORDER", "order"),
    (r"SPACING\s+ORDER", "order"),
    (r"DRILLING\s+AND\s+SPACING", "order"),
    (r"HORIZONTAL\s+DRILLING\s+AND\s+SPACING", "order"),
    (r"INCREASED\s+DENSITY", "order"),
    (r"INCREASED\s+WELL\s+DENSITY", "order"),
    (r"LOCATION\s+EXCEPTION", "order"),
    (r"CHANGE\s+OF\s+OPERATOR", "order"),
    (r"MULTI[- ]?UNIT\s+HORIZONTAL", "order"),
    (r"UNITIZATION\s+ORDER", "order"),
    (r"UNIT\s+ORDER", "order"),
    (r"OPERATING\s+UNIT", "order"),
    (r"ENHANCED\s+RECOVERY\s+UNIT", "order"),
    (r"SECONDARY\s+RECOVERY\s+UNIT", "order"),
    (r"WATERFLOOD\s+UNIT", "order"),
    (r"PRESSURE\s+MAINTENANCE\s+UNIT", "order"),
    (r"CAUSE\s+CD\s+NO", "order"),
    (r"BEFORE\s+THE\s+CORPORATION\s+COMMISSION", "order"),
    (r"ORDER\s+NO\.\s*\d+", "order"),
    # Permits
    (r"DRILLING\s+PERMIT", "permit"),
    (r"PERMIT\s+TO\s+DRILL", "permit"),
    (r"FORM\s+1000", "permit"),
    (r"COMPLETION\s+REPORT", "permit"),
    (r"FORM\s+1002", "permit"),
    # Check/Statement
    (r"CHECK\s+STUB", "check"),
    (r"ROYALTY\s+STATEMENT", "check"),
    (r"REVENUE\s+STATEMENT", "check"),
    (r"OWNER\s+STATEMENT", "check"),
    (r"DIVISION\s+ORDER", "check"),  # Division orders are payment-related
    # Tax
    (r"TAX\s+STATEMENT", "tax"),
    (r"AD\s+VALOREM", "tax"),
    (r"PROPERTY\s+TAX", "tax"),
    # Title Opinion
    (r"TITLE\s+OPINION", "title_opinion"),
    (r"ATTORNEY['']?S?\s+OPINION", "title_opinion"),
    (r"PRELIMINARY\s+TITLE", "title_opinion"),
    # Affidavits
    (r"AFFIDAVIT\s+OF\s+HEIRSHIP", "affidavit"),
    (r"AFFIDAVIT\s+OF\s+DEATH", "affidavit"),
    (r"AFFIDAVIT\s+OF\s+IDENTITY", "affidavit"),
    (r"DEATH\s+CERTIFICATE", "affidavit"),
    # Exhibits
    (r"EXHIBIT\s+[A-Z][\s\-–—]", "exhibit"),
    (r"ATTACHMENT\s+[A-Z]", "exhibit"),
    (r"ADDENDUM\s+[A-Z]", "exhibit"),
    (r"SCHEDULE\s+[A-Z]", "exhibit"),
]

# Patterns that indicate start of a new document
START_INDICATORS = [
    r"KNOW\s+ALL\s+MEN\s+BY\s+THESE\s+PRESENTS",
    r"STATE\s+OF\s+OKLAHOMA\s*[,\n]",
    r"THIS\s+(AGREEMENT|DEED|LEASE|INDENTURE|ASSIGNMENT)\s+made",
    r"THIS\s+IS\s+TO\s+CERTIFY",
    r"BEFORE\s+THE\s+CORPORATION\s+COMMISSION",
    r"FILED\s+FOR\s+RECORD",
    r"RECORDED\s+IN\s+BOOK",
    r"DOCUMENT\s+NO[.:]\s*\d+",
    r"INSTRUMENT\s+NO[.:]\s*\d+",
]

# Patterns that indicate this is a CONTINUATION page, NOT a new document start
# These are checked FIRST, before title patterns - if matched, page is immediately marked as continuation
# Be conservative - only include patterns that NEVER appear on page 1 of a document
CONTINUATION_PATTERNS = [
    # Form 1002A Completion Report back pages (various layouts)
    r"FORMATION\s+RECORD",  # Classic 1002A page 2 header
    r"FOR\s+COMMISSION\s+USE\s+ONLY",  # Modern 1002A page 2 - OCC internal section
    r"Initial\s+Test\s+Data",  # Horizontal completion 1002A page 2
    r"Completion\s+and\s+Test\s+Data\s+by\s+Producing\s+Formation",  # Another 1002A page 2 variant
    r"Status:\s*Accepted",  # OCC acceptance stamp - only on processed page 2
    # Page 2 of 2 indicator (but NOT page 1 of 2)
    r"\b2\s+of\s+2\b",  # "2 of 2" - definitively page 2
    r"\bPage\s+2\s+of\s+2\b",  # "Page 2 of 2"
]

# Minimum text length required for certain patterns to be treated as document start
# If text is shorter than this AND only matches certain patterns (like "ORDER NO."),
# the page is treated as continuation (likely a scanned page with only header extracted)
MIN_TEXT_FOR_ORDER_START = 100  # Characters - "ORDER NO. XXXXX" alone is ~17 chars


def extract_text_from_pdf(pdf_path: str) -> list[str]:
    """
    Extract text from each page of a PDF using PyMuPDF.

    Args:
        pdf_path: Path to the PDF file

    Returns:
        List of text strings, one per page. Empty strings if extraction fails.
    """
    if not pdf_path:
        return []

    try:
        import fitz  # PyMuPDF

        text_by_page = []
        doc = fitz.open(pdf_path)

        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            text_by_page.append(text)

        doc.close()
        logger.debug(f"Extracted text from {len(text_by_page)} pages of {pdf_path}")
        return text_by_page

    except ImportError:
        logger.warning("PyMuPDF (fitz) not installed. Heuristic checks will be skipped.")
        return []
    except Exception as e:
        logger.warning(f"Failed to extract text from PDF {pdf_path}: {e}")
        return []


def heuristic_page_check(page_text: str, page_index: int = -1) -> dict:
    """
    Quick regex-based pre-classification of a page.

    Args:
        page_text: OCR or extracted text from a single page
        page_index: Page index for logging purposes

    Returns:
        dict with heuristic_type, heuristic_is_start, matched_title
    """
    result = {
        "heuristic_type": None,
        "heuristic_is_start": False,
        "matched_title": None,
        "confidence": 0.0
    }

    if not page_text:
        logger.info(f"Page {page_index}: heuristic_page_check - NO TEXT (empty)")
        return result

    # Normalize text for matching (but preserve original for title extraction)
    text_upper = page_text.upper()

    # DEBUG: Log text length and check for literal "FORMATION RECORD"
    logger.info(f"Page {page_index}: heuristic_page_check - text length: {len(page_text)}")
    has_formation_record_literal = "FORMATION RECORD" in text_upper
    logger.info(f"Page {page_index}: Literal 'FORMATION RECORD' in text: {has_formation_record_literal}")

    # CRITICAL: Check for continuation patterns FIRST, before checking titles
    # This ensures "FORMATION RECORD" on page 2 of Form 1002A is caught
    # even if other title-like text exists on the same page
    for pattern in CONTINUATION_PATTERNS:
        match = re.search(pattern, text_upper, re.IGNORECASE | re.MULTILINE)
        logger.info(f"Page {page_index}: Checking continuation pattern '{pattern}' -> match: {match is not None}")
        if match:
            logger.info(f"Page {page_index}: CONTINUATION MATCHED '{pattern}' - returning is_continuation=True")
            result["heuristic_is_start"] = False
            result["is_continuation"] = True
            result["heuristic_type"] = "permit"  # Form 1002A continuation pages are permits
            result["confidence"] = 0.9  # High confidence this is NOT a start
            logger.info(f"Page {page_index}: heuristic result: {result}")
            return result  # Return immediately - continuation takes priority

    # Check for short pages with only "ORDER NO." header
    # Multi-page OCC orders have "ORDER NO. XXXXX" on every page as a header
    # If extracted text is very short and only contains this header, it's a continuation
    # (The actual content is scanned/image-based and didn't extract as text)
    # IMPORTANT: Only apply this rule if page_index > 0 - page 0 should never be marked as continuation
    # This prevents misclassifying a truncated first page as a continuation
    if page_index > 0 and len(page_text.strip()) < MIN_TEXT_FOR_ORDER_START:
        order_no_match = re.search(r"ORDER\s+NO\.\s*\d+", text_upper)
        # Check if "ORDER NO." is present but NOT "BEFORE THE CORPORATION COMMISSION" (which indicates page 1)
        has_commission_header = re.search(r"BEFORE\s+THE\s+CORPORATION\s+COMMISSION", text_upper)
        if order_no_match and not has_commission_header:
            logger.info(f"Page {page_index}: Short page ({len(page_text)} chars) with only ORDER NO. header - treating as continuation")
            result["heuristic_is_start"] = False
            result["is_continuation"] = True
            result["heuristic_type"] = "order"  # It's part of an order
            result["confidence"] = 0.85
            logger.info(f"Page {page_index}: heuristic result: {result}")
            return result

    # Check for document titles
    for pattern, doc_type in TITLE_PATTERNS:
        match = re.search(pattern, text_upper, re.IGNORECASE)
        if match:
            result["heuristic_type"] = doc_type
            result["matched_title"] = match.group(0).strip()
            result["heuristic_is_start"] = True
            result["confidence"] = 0.8
            logger.info(f"Page {page_index}: Title pattern matched: '{match.group(0)}' -> type: {doc_type}")
            break

    # Check for start indicators (even if we didn't find a title)
    for pattern in START_INDICATORS:
        if re.search(pattern, text_upper, re.IGNORECASE):
            result["heuristic_is_start"] = True
            if result["confidence"] < 0.5:
                result["confidence"] = 0.5
            break

    logger.info(f"Page {page_index}: heuristic result: {result}")
    return result


PAGE_CLASSIFIER_PROMPT = """You are a document page classifier for oil & gas mineral rights documents.

For this SINGLE PAGE, determine:
1. What broad document type does this page belong to?
2. Is this the START of a new document (first page), or a continuation/middle page?

You only see a SINGLE PAGE. Do not guess based on what might be on other pages.

COARSE DOCUMENT TYPES (pick exactly one):
- deed: Mineral deeds, quit claim deeds, warranty deeds, correction deeds, conveyances, trust funding assignments
- lease: Oil & gas leases, assignments of lease, lease ratifications, memoranda of lease
- order: OCC/Commission orders (pooling, spacing, density, location exception, change of operator)
- permit: Drilling permits, completion reports, well permits (Form 1000, 1002)
- check: Check stubs, royalty statements, payment statements, division orders
- tax: Tax records, ad valorem assessments, tax statements
- title_opinion: Attorney title opinions, title runsheets
- affidavit: Affidavits of heirship, affidavits of death, identity affidavits, death certificates
- correspondence: Letters, notices, cover letters, transmittal sheets (contains "Dear Sir or Madam", "Re: [Well Name]")
- exhibit: Exhibit pages (EXHIBIT A, ATTACHMENT A), attachments, addenda, plat attachments
- other: Cannot determine type from this page

DOCUMENT START INDICATORS (high confidence = multiple present):
- Clear title/heading at top: "MINERAL DEED", "OIL AND GAS LEASE", "POOLING ORDER"
- Formal opening: "KNOW ALL MEN BY THESE PRESENTS", "STATE OF OKLAHOMA"
- Case/cause number header: "CAUSE CD NO.", "ORDER NO."
- Recording stamp/info at top of page
- Date and parties introduction: "This Agreement made this ___ day of..."
- Document number or instrument number

CONTINUATION/MIDDLE PAGE INDICATORS (NOT a start page):
- Page starts mid-sentence or mid-paragraph
- No title or header
- Continuation of legal description
- Signature blocks (usually end of document, not start)
- Notary blocks (usually end of document)
- "Page 2 of 3" or similar pagination
- Just exhibits/attachments
- "FORMATION RECORD" header (this is page 2 of a Completion Report Form 1002A, NOT a new document)
- APPROVED/DISAPPROVED stamps with signature (end of completion report, not start)

Respond with JSON only:
{
  "page_index": <use the provided index>,
  "coarse_type": "<type from list above>",
  "is_document_start": <true if this is first page of a document>,
  "start_confidence": <0.0-1.0>,
  "detected_title": "<exact title text if visible, null if not>",
  "features": {
    "has_title_phrase": <true/false>,
    "has_granting_clause": <true/false - "KNOW ALL MEN", "WITNESSETH", etc.>,
    "has_signature_block": <true/false>,
    "has_notary_block": <true/false>,
    "has_exhibit_label": <true/false>,
    "has_legal_description": <true/false>,
    "has_recording_stamp": <true/false>
  }
}"""


async def classify_single_page(image_path: str, page_index: int, page_text: str = None) -> dict:
    """
    Classify a single page using heuristics first, then Haiku if needed.

    Args:
        image_path: Path to the page image
        page_index: 0-based page index
        page_text: Optional pre-extracted text (for heuristic check)

    Returns:
        PageClassification dict
    """
    # First try heuristics if we have text
    heuristic_result = None
    if page_text:
        logger.info(f"Page {page_index}: Running heuristic check (text length: {len(page_text)})")
        heuristic_result = heuristic_page_check(page_text, page_index)
        logger.info(f"Page {page_index}: Heuristic result: {heuristic_result}")

        # CRITICAL: Check continuation FIRST - this is a veto that overrides everything else
        # If continuation pattern matched, return immediately - don't let title patterns or Haiku override
        if heuristic_result.get("is_continuation"):
            logger.info(f"Page {page_index}: CONTINUATION VETO - is_continuation=True - SKIPPING HAIKU")
            return {
                "page_index": page_index,
                "coarse_type": heuristic_result.get("heuristic_type", "permit"),
                "is_document_start": False,
                "start_confidence": heuristic_result["confidence"],
                "detected_title": None,
                "features": {
                    "has_title_phrase": False,
                    "has_granting_clause": False,
                    "has_signature_block": False,
                    "has_notary_block": False,
                    "has_exhibit_label": False,
                    "has_legal_description": False,
                    "has_recording_stamp": False
                },
                "classification_method": "heuristic_continuation",
                "is_continuation": True  # Propagate this flag for splitter
            }

        # If heuristics found a high-confidence title match (and NOT continuation), use it
        if heuristic_result["confidence"] >= 0.8 and heuristic_result["heuristic_type"]:
            logger.info(f"Page {page_index}: Using heuristic match - {heuristic_result['heuristic_type']} "
                        f"(title: {heuristic_result['matched_title']}) - SKIPPING HAIKU")
            return {
                "page_index": page_index,
                "coarse_type": heuristic_result["heuristic_type"],
                "is_document_start": heuristic_result["heuristic_is_start"],
                "start_confidence": heuristic_result["confidence"],
                "detected_title": heuristic_result["matched_title"],
                "features": {
                    "has_title_phrase": bool(heuristic_result["matched_title"]),
                    "has_granting_clause": False,
                    "has_signature_block": False,
                    "has_notary_block": False,
                    "has_exhibit_label": heuristic_result["heuristic_type"] == "exhibit",
                    "has_legal_description": False,
                    "has_recording_stamp": False
                },
                "classification_method": "heuristic",
                "is_continuation": False  # Explicitly not a continuation
            }
    else:
        logger.info(f"Page {page_index}: NO page_text provided - will use Haiku")

    # Fall back to Haiku for classification
    logger.info(f"Page {page_index}: Calling Haiku for classification (heuristic didn't match)")
    try:
        with open(image_path, 'rb') as img:
            img_data = base64.b64encode(img.read()).decode()

        content = [
            {"type": "text", "text": f"Page index: {page_index}\n\n{PAGE_CLASSIFIER_PROMPT}"},
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": img_data
                }
            }
        ]

        response = client.messages.create(
            model="claude-3-5-haiku-20241022",  # Use Haiku for speed/cost
            max_tokens=512,
            messages=[{"role": "user", "content": content}]
        )

        response_text = response.content[0].text.strip()

        # Strip markdown code fences if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            response_text = "\n".join(lines)

        result = json.loads(response_text)
        result["page_index"] = page_index  # Ensure correct index
        result["classification_method"] = "haiku"

        logger.debug(f"Page {page_index}: Haiku classified as {result.get('coarse_type')} "
                    f"(start: {result.get('is_document_start')}, conf: {result.get('start_confidence')})")

        return result

    except Exception as e:
        logger.error(f"Failed to classify page {page_index}: {e}")
        # Return a safe default
        return {
            "page_index": page_index,
            "coarse_type": "other",
            "is_document_start": page_index == 0,  # Assume first page starts a doc
            "start_confidence": 0.3,
            "detected_title": None,
            "features": {},
            "classification_method": "fallback",
            "error": str(e)
        }


async def classify_pages(image_paths: list[str], page_texts: list[str] = None) -> list[dict]:
    """
    Classify all pages in a PDF using Stage 1 (page-level) classification.

    Args:
        image_paths: List of paths to page images
        page_texts: Optional list of pre-extracted text per page

    Returns:
        List of PageClassification dicts
    """
    logger.info(f"Stage 1: Classifying {len(image_paths)} pages")

    # If no page texts provided, use empty strings
    if page_texts is None:
        page_texts = [""] * len(image_paths)

    # Classify pages concurrently (but with some rate limiting)
    # Process in batches of 5 to avoid overwhelming the API
    results = []
    batch_size = 5

    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i:i + batch_size]
        batch_texts = page_texts[i:i + batch_size]
        batch_indices = range(i, i + len(batch_paths))

        # Process batch concurrently
        tasks = [
            classify_single_page(path, idx, text)
            for path, idx, text in zip(batch_paths, batch_indices, batch_texts)
        ]

        batch_results = await asyncio.gather(*tasks)
        results.extend(batch_results)

        # Small delay between batches
        if i + batch_size < len(image_paths):
            await asyncio.sleep(0.5)

    logger.info(f"Stage 1 complete: Classified {len(results)} pages")
    return results


def split_pages_into_documents(page_classifications: list[dict]) -> dict:
    """
    Group page classifications into logical document chunks.

    Args:
        page_classifications: List of PageClassification dicts from classify_pages

    Returns:
        SplitResult dict with chunks and metadata
    """
    logger.info(f"Splitting {len(page_classifications)} pages into documents")

    chunks = []
    current_chunk = None

    for page in page_classifications:
        page_idx = page["page_index"]
        coarse_type = page.get("coarse_type", "other")
        is_start = page.get("is_document_start", False)
        start_conf = page.get("start_confidence", 0.0)
        is_continuation = page.get("is_continuation", False)

        should_start_new = False
        split_reason = None

        # Rule 0 (VETO): If page is marked as continuation, ALWAYS attach to current document
        # This overrides all other rules including type_change
        if is_continuation and current_chunk is not None:
            logger.info(f"Page {page_idx}: is_continuation=True - forcing attachment to current document")
            current_chunk["page_end"] = page_idx
            continue

        # Rule 1: First page always starts a document
        if current_chunk is None:
            should_start_new = True
            split_reason = "first_page"

        # Rule 2: High-confidence document start (but NOT if is_continuation)
        elif is_start and start_conf >= 0.7:
            should_start_new = True
            split_reason = "title_detected"

        # Rule 3: Type change (incompatible types)
        elif coarse_type != current_chunk["coarse_type"]:
            # Exhibit/other/correspondence can attach to previous
            if coarse_type in ["exhibit", "correspondence"]:
                # Check if this looks like an attachment
                if not is_start or start_conf < 0.5:
                    # Attach as part of current document
                    if "attachment_pages" not in current_chunk:
                        current_chunk["attachment_pages"] = []
                    current_chunk["attachment_pages"].append(page_idx)
                    logger.debug(f"Page {page_idx}: Attaching {coarse_type} to previous document")
                    continue

            # "other" with low confidence attaches to previous
            if coarse_type == "other" and start_conf < 0.5:
                current_chunk["page_end"] = page_idx
                continue

            # Significant type change = new document
            should_start_new = True
            split_reason = "type_change"

        # Rule 4: Medium-confidence start within same type
        elif is_start and start_conf >= 0.5:
            # Could be same type repeated (e.g., two mineral deeds)
            should_start_new = True
            split_reason = "new_document_same_type"

        if should_start_new:
            # Close previous chunk
            if current_chunk:
                chunks.append(current_chunk)

            # Start new chunk
            current_chunk = {
                "chunk_index": len(chunks),
                "page_start": page_idx,
                "page_end": page_idx,
                "coarse_type": coarse_type,
                "detected_title": page.get("detected_title"),
                "attachment_pages": [],
                "split_reason": split_reason
            }
            logger.debug(f"Page {page_idx}: Starting new {coarse_type} document ({split_reason})")
        else:
            # Continue current chunk
            current_chunk["page_end"] = page_idx

    # Don't forget the last chunk
    if current_chunk:
        chunks.append(current_chunk)

    # Build result
    result = {
        "total_pages": len(page_classifications),
        "is_multi_document": len(chunks) > 1,
        "document_count": len(chunks),
        "chunks": chunks,
        "page_classifications": page_classifications,
        "split_metadata": {
            "model": "claude-3-5-haiku-20241022",
            "heuristics_used": any(p.get("classification_method") == "heuristic" for p in page_classifications)
        }
    }

    logger.info(f"Split result: {len(chunks)} documents from {len(page_classifications)} pages")
    for i, chunk in enumerate(chunks):
        logger.info(f"  Doc {i+1}: pages {chunk['page_start']+1}-{chunk['page_end']+1} ({chunk['coarse_type']}) - {chunk['split_reason']}")

    return result


# ============================================================================
# ORIGINAL DETECTION PROMPT (for backwards compatibility / Stage 2)
# ============================================================================

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
16. Trust Funding - Assignment of property from individual to their trust (estate planning)
17. Other - Any document not fitting above categories

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

For DEEDS (Mineral Deed, Royalty Deed, Warranty Deed, Quitclaim Deed, Gift Deed, Assignment):
NOTE: Analyze this document as a title attorney would when building a chain of title for a client.
This document transfers ownership of mineral or royalty interests from one party to another.
Focus on extracting exactly what THIS document states. Do not infer prior ownership or subsequent transfers.

CHAIN OF TITLE PRINCIPLES:
- Grantor is the party transferring ownership (seller/assignor)
- Grantee is the party receiving ownership (buyer/assignee)
- Extract names EXACTLY as written - code will normalize for matching
- Note any reservations the grantor keeps for themselves
- Capture references to prior instruments in the chain
- Capture tenancy on BOTH grantors (what they held) and grantees (how they're taking)

DEED TYPE DETECTION (for the "deed_type" field - this is the LEGAL type of conveyance):
- warranty: Contains warranty language ("warrant and defend", "general warranty")
- special_warranty: Limited warranty (only warrants against claims during grantor's ownership)
- quitclaim: No warranty - releases whatever interest grantor may have ("remise, release, quitclaim")
- gift: Transfer without monetary consideration, often between family members
- other: Grant deeds, bargain and sale, or unclear type

MULTI-TRACT DEEDS: If a deed conveys interests in MULTIPLE sections or tracts, include each as a separate entry in the tracts array. Each tract has its own legal description and interest details.

OMIT fields that don't apply - do NOT include null values or empty objects.

REQUIRED FIELDS: doc_type, deed_type, grantors, grantees, tracts (with at least one), execution_date, consideration

{{
  "doc_type": "mineral_deed",
  "deed_type": "warranty",

  "grantors": [
    {{
      "name": "Joel S. Price",
      "address": "6801 No. Country Club Dr., Oklahoma City, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    }},
    {{
      "name": "Virginia K. Price",
      "address": "6801 No. Country Club Dr., Oklahoma City, Oklahoma",
      "tenancy": "joint_tenants_wros",
      "marital_status": "married"
    }}
  ],

  "grantees": [
    {{
      "name": "Joel S. Price",
      "address": "6801 N. Ctry Club Dr. O.C.",
      "capacity": "Trustee"
    }}
  ],

  "tracts": [
    {{
      "legal": {{
        "section": "18",
        "township": "17N",
        "range": "13W",
        "meridian": "IM",
        "county": "Blaine",
        "state": "OK",
        "quarter_calls": ["E/2"],
        "gross_acres": 320
      }},
      "interest": {{
        "type": "mineral",
        "fraction_text": "One Sixty fourths (1/64)",
        "fraction_decimal": 0.015625,
        "net_mineral_acres": 5
      }}
    }}
  ],

  "execution_date": "1975-01-26",

  "recording": {{
    "recording_date": "1975-01-28",
    "book": "242",
    "page": "232",
    "county": "Blaine",
    "state": "OK"
  }},

  "consideration": "No Monetary Consideration",

  "extraction_notes": "Grantors held as joint tenants, transferring to one of them as Trustee.",

  "key_takeaway": "Joel S. and Virginia K. Price transferred their 1/64 mineral interest in Section 18-17N-13W to Joel S. Price as Trustee.",

  "detailed_analysis": "This deed transfers a fractional mineral interest from a married couple holding as joint tenants with right of survivorship to one of them acting as Trustee. The transfer is for no monetary consideration, indicating an estate planning transaction. The interest conveyed is 1/64 of the minerals in the East Half (E/2) of Section 18, Township 17 North, Range 13 West, Blaine County, Oklahoma, equating to approximately 5 net mineral acres."
}}

PARTY FIELDS (include only when document states them):
- name: REQUIRED - exactly as written on document
- address: If provided
- capacity: "Trustee", "Personal Representative", "Attorney-in-Fact", "Guardian", etc.
- tenancy: "joint_tenants_wros", "tenants_in_common", "community_property" (on both grantors AND grantees)
- marital_status: "married", "single", "widow", "widower", "divorced"

TRACT FIELDS:
- legal.section, legal.township, legal.range, legal.meridian, legal.county, legal.state: REQUIRED
- legal.quarter_calls: Array of quarter section calls. Nested calls as single string: ["NW/4 NE/4"]. Multiple separate tracts as multiple items: ["NW/4", "SE/4"]
- legal.gross_acres: Total acres in the tract
- legal.full_description: For metes-and-bounds or complex descriptions
- interest.type: "mineral", "royalty", "overriding_royalty", "working", "leasehold"
- interest.fraction_text: As written ("one-sixty fourth (1/64)")
- interest.fraction_decimal: Numeric value (0.015625)
- interest.net_mineral_acres: gross_acres × fraction_decimal
- interest.depth_clause: Only if depth limitation exists
- interest.formation_clause: Only if formation limitation exists
- interest.term_clause: Only if term mineral interest (e.g., "for 20 years")

RESERVATION (only if grantor reserved something):
- type: "mineral", "royalty", "npri", "life_estate", "other"
- fraction_text: As written
- fraction_decimal: Numeric value
- description: Full reservation language

PRIOR INSTRUMENTS (references to source of grantor's title):
- book, page, instrument_number: Recording reference
- description: "Deed from William Smith dated..."

COMMON FRACTION CONVERSIONS:
1/2 = 0.5, 1/4 = 0.25, 1/8 = 0.125, 1/16 = 0.0625, 1/32 = 0.03125, 1/64 = 0.015625, 1/128 = 0.0078125, 1/256 = 0.00390625

For OIL AND GAS LEASES:
Extract comprehensive lease terms. Pay special attention to Exhibit A or Addendum which may override printed form.

CRITICAL INSTRUCTIONS:
1. CHECK FOR EXHIBIT A - Many leases have an Exhibit A that modifies the printed form. Look for:
   - "See Exhibit A attached hereto"
   - Separate page titled "Exhibit A" or "Addendum"
   - Depth Clause, Pugh Clause, Shut-In Limitation, No Deductions Clause
2. EXTRACT ALL TRACTS - Missing tracts break property linking
3. CALCULATE EXPIRATION DATE - Add primary term years to commencement date
4. NOTE ABSENT CLAUSES - In detailed_analysis, mention when protective clauses are NOT present

Common Royalty Fractions: 1/8=0.125, 3/16=0.1875, 1/5=0.20, 1/4=0.25, 1/6=0.166667

{{
  "doc_type": "oil_gas_lease",
  "lease_form": "Hefner Form or AAPL Form 675 or omit if unknown",

  "lessor": {{
    "name": "REQUIRED - Price Oil & Gas, Ltd.",
    "address": "6801 N. Country Club Drive",
    "city": "Oklahoma City",
    "state": "OK",
    "zip": "73116",
    "capacity": "Mineral Owner|Trustee|Personal Representative|Guardian|Attorney-in-Fact|Manager|President",
    "signatory": "William S. Price - person who signed if different from entity",
    "signatory_title": "Manager - title if signing in representative capacity"
  }},

  "lessee": {{
    "name": "REQUIRED - Hefner Energy, LLC",
    "address": "16224 Muirfield Place",
    "city": "Edmond",
    "state": "OK",
    "zip": "73013"
  }},

  "execution_date": "REQUIRED - 2016-08-09",
  "effective_date": "omit if same as execution_date",

  "recording_info": {{
    "book": "L-350",
    "page": "125",
    "instrument_number": "2016-12345",
    "recording_date": "2016-08-15",
    "county": "REQUIRED - Blaine",
    "state": "Oklahoma"
  }},

  "section": "REQUIRED - integer from first tract, e.g. 20",
  "township": "REQUIRED - string with direction from first tract, e.g. 16N",
  "range": "REQUIRED - string with direction from first tract, e.g. 13W",
  "county": "REQUIRED - from first tract or recording_info, e.g. Blaine",
  "state": "Oklahoma",

  "tracts": [
    {{
      "tract_number": 1,
      "legal_description": {{
        "section": 20,
        "township": "16N",
        "range": "13W",
        "meridian": "IM",
        "county": "Blaine",
        "state": "Oklahoma",
        "quarters": "SW/4 SE/4"
      }},
      "acres": 40.0,
      "acres_qualifier": "more or less",
      "depths_limited": false,
      "formations_limited": null,
      "mineral_interest_fraction": "1/2 - only if lessor owns partial minerals"
    }}
  ],

  "primary_term": {{
    "years": 3,
    "months": 0,
    "commencement_date": "REQUIRED - 2016-08-09",
    "expiration_date": "REQUIRED - 2019-08-09"
  }},

  "consideration": {{
    "bonus_stated": "REQUIRED - $10.00 and other good and valuable consideration",
    "bonus_per_acre": 500.00,
    "total_bonus": 20000.00,
    "is_paid_up": true,
    "delay_rental": "REQUIRED if is_paid_up is false",
    "delay_rental_per_acre": 10.00,
    "delay_rental_due_date": "anniversary of lease"
  }},

  "royalty": {{
    "oil": {{
      "fraction": "REQUIRED - 1/4",
      "decimal": 0.25
    }},
    "gas": {{
      "fraction": "REQUIRED - 1/4",
      "decimal": 0.25
    }},
    "other_minerals": {{
      "fraction": "1/10",
      "decimal": 0.10,
      "note": "sulphur $1.00 per long ton"
    }}
  }},

  "pooling_provisions": {{
    "lessee_has_pooling_rights": true,
    "pooling_type": "lessee option|requires lessor consent|OCC only",
    "vertical_oil_well": {{
      "max_acres": 80,
      "tolerance": "10%"
    }},
    "gas_or_horizontal_well": {{
      "max_acres": 640,
      "tolerance": "10%"
    }},
    "governmental_override": true,
    "allocation_method": "surface acres|net mineral acres",
    "pugh_clause_limits_pooling": true,
    "anti_pugh_language": false,
    "anti_pugh_text": "quote the language if present"
  }},

  "habendum_clause": {{
    "cessation_period_days": 180,
    "continuous_operations": true,
    "operations_definition": "drilling, reworking, or production"
  }},

  "shut_in_provisions": {{
    "shut_in_royalty": "$1.00 per acre",
    "shut_in_royalty_per_acre": 1.00,
    "trigger_period_days": 90,
    "payment_frequency": "annual",
    "limitation": {{
      "has_limitation": true,
      "max_consecutive_years": 2,
      "source": "Exhibit A"
    }}
  }},

  "depth_clause": {{
    "has_depth_clause": true,
    "trigger": "extended solely by commercial production beyond primary term",
    "depth_retained": "100 feet below stratigraphic equivalent of base of deepest penetrated formation",
    "depth_feet": null,
    "reference_point": "deepest penetrated formation",
    "source": "Exhibit A"
  }},

  "pugh_clause": {{
    "has_pugh_clause": true,
    "type": "Corporation Commission unit|production unit|voluntary pooling",
    "trigger": "expiration of primary term",
    "releases": "portions not in OCC unit and not producing or drilling",
    "horizontal_pugh": true,
    "vertical_pugh": false,
    "unit_change_provision": "90 days to develop or release if unit boundaries change",
    "source": "Exhibit A"
  }},

  "deductions_clause": {{
    "has_no_deductions_clause": true,
    "scope": "all post-production costs",
    "prohibited_deductions": ["producing", "gathering", "storing", "separating", "treating", "dehydrating", "compressing", "processing", "transporting", "marketing"],
    "exception": "value-enhancing costs if reasonable and based on actual cost",
    "source": "Exhibit A"
  }},

  "continuous_development_clause": {{
    "has_continuous_development": false,
    "period_between_wells_days": null,
    "wells_required": null,
    "penalty_for_breach": null,
    "applies_after": null
  }},

  "top_lease_provision": {{
    "has_top_lease_rofr": true,
    "response_period_days": 15,
    "trigger": "bona fide offer during primary term",
    "matching_required": true,
    "notice_requirements": null
  }},

  "force_majeure": {{
    "has_force_majeure": true,
    "extension_period": "first anniversary 90+ days after removal of delay",
    "excluded_causes": ["financial"],
    "included_causes": ["war", "strikes", "regulations", "acts of God"]
  }},

  "surface_use": {{
    "water_use_free_of_royalty": true,
    "setback_from_house_feet": 200,
    "setback_from_barn_feet": 200,
    "no_surface_operations": false,
    "surface_use_limited_to_acres": null,
    "designated_drill_site": null,
    "surface_damage_payment": {{
      "required": true,
      "amount": null,
      "basis": "damages to growing crops and timber"
    }},
    "restoration_required": true
  }},

  "assignment_status": {{
    "original_lessee": "Hefner Energy, LLC",
    "current_holder": null,
    "has_been_assigned": false,
    "assignment_noted_on_document": false,
    "note": null
  }},

  "exhibit_a": {{
    "has_exhibit_a": true,
    "provisions": ["Depth Clause", "Pugh Clause", "Shut-In Royalty Limitation (2 years)", "No Deductions Clause"],
    "controls_over_printed_form": true,
    "additional_terms": null
  }},

  "notarization": {{
    "notary_name": "Jane Doe",
    "notary_date": "2016-08-09",
    "commission_number": "12345678",
    "commission_expires": "2020-03-15"
  }},

  "notes": "any additional information not captured elsewhere",

  "key_takeaway": "REQUIRED - One sentence: 3-year paid-up lease from [Lessor] to [Lessee] covering [acres] acres in [quarters] of Section [S]-[T]-[R], [County] County, with [royalty] royalty and [key provisions or 'standard form with no protective clauses'].",

  "detailed_analysis": "REQUIRED - 3-5 paragraphs covering: (1) parties, date, legal description; (2) primary term and consideration; (3) royalty and economic terms; (4) protective clauses PRESENT and ABSENT - explicitly note if Pugh, depth, no-deductions clauses are missing; (5) current status if primary term has expired.",

  "field_scores": {{
    "lessor_name": 0.95,
    "lessee_name": 1.0,
    "execution_date": 0.90,
    "recording_info": 1.0,
    "tracts": 0.95,
    "primary_term": 1.0,
    "royalty": 0.98,
    "depth_clause": 0.90,
    "pugh_clause": 0.90,
    "deductions_clause": 0.85,
    "exhibit_a": 1.0
  }},
  "document_confidence": "high"
}}

IMPORTANT FOR LEASES WITHOUT PROTECTIVE CLAUSES:
If no Exhibit A or addendum, set:
- depth_clause.has_depth_clause: false
- pugh_clause.has_pugh_clause: false
- deductions_clause.has_no_deductions_clause: false
- exhibit_a.has_exhibit_a: false

Check for anti-Pugh pooling language like:
- "Production from a pooled unit shall maintain this lease as to all lands covered hereby"
- "Pooling shall extend this lease as to all lands"
If found, set pooling_provisions.anti_pugh_language: true and quote in anti_pugh_text.

detailed_analysis MUST note: "This lease uses a standard printed form with NO Exhibit A. Notably absent are: a Pugh clause, a depth clause, and a no-deductions clause."

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

For COMPLETION REPORTS (Form 1002A - documents that a well has been drilled and completed):

DOCUMENT IDENTIFICATION:
- Title contains "COMPLETION REPORT" or "FORM 1002A"
- Has "LEASE NAME" and "WELL NO" fields
- Shows perforation intervals, formations, and production test results
- Contains OCC file number and approval stamps

EXTRACTION PRIORITIES:
1. Well identification (API, name, PUN for OTC crosswalk)
2. Location (surface, and bottom hole if horizontal)
3. Formation zones with per-zone data (CRITICAL for commingled wells)
4. Initial production test results
5. Key dates (spud, completion, first production)

WELL NAME EXTRACTION (CRITICAL):
- Form 1002A has separate fields: "LEASE NAME" and "WELL NO"
- Combine them: well_name = "{{LEASE NAME}} {{WELL NO}}" (e.g., "Adams Q" + "1" = "Adams Q-1")
- well_number = just the WELL NO field (e.g., "1")
- Do NOT misread letters as numbers (Q is not 0, O is not 0)

API/PUN NORMALIZATION (CRITICAL FOR DATABASE JOINS):
- api_number: Extract exactly as printed with dashes (e.g., "35-043-23686-0000")
- api_number_normalized: Remove ALL dashes (e.g., "35043236860000")
- otc_prod_unit_no: Extract exactly as printed (e.g., "043-226597-0-0000")
- otc_prod_unit_no_normalized: Remove ALL dashes (e.g., "04322659700000")
NOTE: Do NOT pad with zeros. Just remove dashes.

FORMATION_ZONES[] ARRAY (CRITICAL FOR COMMINGLED WELLS):
Many vertical wells complete MULTIPLE formations with separate spacing orders and perforation intervals.
Use formation_zones[] to capture per-formation data:
- formation_name: Name of the formation (e.g., "Oswego", "Red Fork")
- formation_code: Code if shown (e.g., "318OSWE")
- spacing_order: Spacing order number for THIS formation
- unit_size_acres: Unit size from the spacing order (40, 80, 160, 640)
- perforated_intervals: Array of intervals for THIS formation
- stimulation: Stimulation data specific to THIS formation (if available)

IF a well has ONE formation with ONE spacing order: Use a single element in formation_zones[]
IF a well has MULTIPLE formations (commingled): Each formation gets its own entry in formation_zones[]

CONDITIONAL REQUIREMENTS:
- IF drill_type is "HORIZONTAL HOLE": bottom_hole_location, lateral_details, and allocation_factors[] are REQUIRED
- IF drill_type is "DIRECTIONAL HOLE": bottom_hole_location is REQUIRED
- IF well spans multiple sections: allocation_factors[] MUST include ALL sections with PUN for each
- IF well_class is "DRY": OMIT initial_production and first_sales entirely
- IF first_sales information is visible: first_sales is REQUIRED
- IF stimulation/frac summary data is visible: Include in formation_zones[].stimulation OR top-level stimulation

OMIT: Casing program details, cement volumes, mud weights, BOP test data, detailed drilling operations.

COMMINGLED VERTICAL WELL EXAMPLE (multiple formations with separate spacing orders):
{{
  "doc_type": "completion_report",

  "section": 14,
  "township": "17N",
  "range": "8W",
  "county": "Kingfisher",
  "state": "Oklahoma",

  "api_number": "35-073-21234-0000",
  "api_number_normalized": "35073212340000",
  "well_name": "MORRISON 1-14",
  "well_number": "1-14",
  "otc_prod_unit_no": "073-18234-0-0000",
  "otc_prod_unit_no_normalized": "07318234000000",
  "permit_number": "PD-2019-005678",

  "operator": {{
    "name": "Sandstone Energy, LLC",
    "operator_number": "31456"
  }},

  "dates": {{
    "spud_date": "2019-03-15",
    "drilling_finished_date": "2019-04-02",
    "completion_date": "2019-04-20",
    "first_production_date": "2019-05-01",
    "initial_test_date": "2019-05-05"
  }},

  "well_type": {{
    "drill_type": "VERTICAL HOLE",
    "completion_type": "Commingled",
    "well_class": "GAS"
  }},

  "surface_location": {{
    "section": 14,
    "township": "17N",
    "range": "8W",
    "county": "Kingfisher",
    "quarters": "C SE NE",
    "footage_ns": "660 FSL",
    "footage_ew": "660 FEL",
    "latitude": 35.876543,
    "longitude": -97.654321,
    "ground_elevation_ft": 1150,
    "total_depth_ft": 9850
  }},

  "formation_zones": [
    {{
      "formation_name": "Oswego",
      "formation_code": "318OSWE",
      "spacing_order": "687654",
      "unit_size_acres": 640,
      "perforated_intervals": [
        {{ "from_ft": 7450, "to_ft": 7520 }},
        {{ "from_ft": 7580, "to_ft": 7640 }}
      ],
      "stimulation": {{
        "method": "Acidize",
        "total_fluid_bbls": 200
      }}
    }},
    {{
      "formation_name": "Red Fork",
      "formation_code": "318RDFK",
      "spacing_order": "712345",
      "unit_size_acres": 160,
      "perforated_intervals": [
        {{ "from_ft": 8200, "to_ft": 8280 }}
      ],
      "stimulation": {{
        "method": "Hydraulic Fracturing",
        "stages": 1,
        "total_proppant_lbs": 50000,
        "total_fluid_bbls": 1500
      }}
    }},
    {{
      "formation_name": "Skinner",
      "formation_code": "318SKNR",
      "spacing_order": "698765",
      "unit_size_acres": 160,
      "perforated_intervals": [
        {{ "from_ft": 8750, "to_ft": 8820 }}
      ]
    }}
  ],

  "initial_production": {{
    "test_date": "2019-05-05",
    "oil_bbl_per_day": 45,
    "oil_gravity_api": 42,
    "gas_mcf_per_day": 850,
    "gas_oil_ratio": 18889,
    "water_bbl_per_day": 25,
    "flow_method": "FLOWING",
    "initial_shut_in_pressure_psi": 1850,
    "choke_size": "16/64"
  }},

  "first_sales": {{
    "date": "2019-05-10",
    "purchaser": "DCP Midstream",
    "gas_plant": "Kingfisher Plant"
  }},

  "related_orders": {{
    "references": [
      {{ "order_number": "687654", "type": "spacing_order", "formation": "Oswego", "unit_size_acres": 640 }},
      {{ "order_number": "712345", "type": "spacing_order", "formation": "Red Fork", "unit_size_acres": 160 }},
      {{ "order_number": "698765", "type": "spacing_order", "formation": "Skinner", "unit_size_acres": 160 }},
      {{ "order_number": "723456", "type": "commingling", "description": "Authority to commingle Oswego, Red Fork, Skinner" }}
    ]
  }},

  "formation_tops": [
    {{ "name": "Oswego", "depth_ft": 7420 }},
    {{ "name": "Red Fork", "depth_ft": 8150 }},
    {{ "name": "Skinner", "depth_ft": 8700 }}
  ],

  "status": "Accepted",
  "occ_file_number": "1198765",

  "key_takeaway": "Sandstone Energy completed the MORRISON 1-14 commingled vertical well in Kingfisher County, producing from three formations (Oswego, Red Fork, Skinner) with initial test showing 45 BOPD and 850 MCFD flowing.",

  "detailed_analysis": "This completion report documents the MORRISON 1-14, a vertical well completed in three commingled formations in Section 14-17N-8W, Kingfisher County. The well was spud on March 15, 2019 and completed April 20, 2019.\n\nThe well produces from three formations under separate spacing orders:\n- Oswego (Order 687654, 640-acre unit): Perforated 7,450-7,520 and 7,580-7,640 feet, acidized\n- Red Fork (Order 712345, 160-acre unit): Perforated 8,200-8,280 feet, hydraulically fractured\n- Skinner (Order 698765, 160-acre unit): Perforated 8,750-8,820 feet\n\nInitial production test showed 45 BOPD, 850 MCFD gas, and 25 BWPD flowing through a 16/64 choke. First sales to DCP Midstream commenced May 10, 2019.\n\nMineral owners should note the different spacing orders - the Oswego production is allocated across a 640-acre unit while Red Fork and Skinner use 160-acre spacing.",

  "field_scores": {{
    "api_number": 0.95,
    "well_name": 0.95,
    "operator": 0.95,
    "dates": 0.95,
    "surface_location": 0.95,
    "formation_zones": 0.90,
    "initial_production": 0.95,
    "first_sales": 0.85
  }},
  "document_confidence": "high"
}}

SINGLE-ZONE VERTICAL WELL EXAMPLE (one formation, simple case):
{{
  "doc_type": "completion_report",

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

  "operator": {{
    "name": "ABC Energy, LLC",
    "operator_number": "24567"
  }},

  "dates": {{
    "spud_date": "2020-06-01",
    "drilling_finished_date": "2020-06-15",
    "completion_date": "2020-07-01",
    "first_production_date": "2020-07-10",
    "initial_test_date": "2020-07-12"
  }},

  "well_type": {{
    "drill_type": "VERTICAL HOLE",
    "completion_type": "Single Zone",
    "well_class": "OIL"
  }},

  "surface_location": {{
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
  }},

  "formation_zones": [
    {{
      "formation_name": "Hunton",
      "formation_code": "400HNTN",
      "spacing_order": "654321",
      "unit_size_acres": 160,
      "perforated_intervals": [
        {{ "from_ft": 8450, "to_ft": 8520 }}
      ],
      "stimulation": {{
        "method": "Acidize",
        "total_fluid_bbls": 500
      }}
    }}
  ],

  "initial_production": {{
    "test_date": "2020-07-12",
    "oil_bbl_per_day": 125,
    "oil_gravity_api": 42,
    "gas_mcf_per_day": 150,
    "gas_oil_ratio": 1200,
    "water_bbl_per_day": 45,
    "flow_method": "PUMPING"
  }},

  "first_sales": {{
    "date": "2020-07-15",
    "purchaser": "Plains Marketing"
  }},

  "related_orders": {{
    "references": [
      {{ "order_number": "654321", "type": "spacing_order", "formation": "Hunton", "unit_size_acres": 160 }}
    ]
  }},

  "formation_tops": [
    {{ "name": "Viola", "depth_ft": 7890 }},
    {{ "name": "Hunton", "depth_ft": 8400 }}
  ],

  "status": "Accepted",
  "occ_file_number": "1145678",

  "key_takeaway": "ABC Energy completed the SMITH 1-22 vertical Hunton well in Grady County with initial production of 125 BOPD and 150 MCFD on pump.",

  "detailed_analysis": "This completion report documents the SMITH 1-22, a vertical well targeting the Hunton formation in Section 22-9N-4W, Grady County. The well was drilled to 8,650 feet total depth and perforated in the Hunton at 8,450-8,520 feet.\n\nThe well was acidized and initial production test showed 125 BOPD (42 API gravity), 150 MCFD gas, and 45 BWPD on pump. First oil sales to Plains Marketing commenced July 15, 2020.\n\nThis is a single-zone vertical well operating under spacing order 654321 (160-acre unit). The OTC PUN (051-19876-0-0000) links this well to Oklahoma Tax Commission production records.",

  "field_scores": {{
    "api_number": 0.95,
    "well_name": 0.95,
    "operator": 0.95,
    "dates": 0.95,
    "surface_location": 0.95,
    "formation_zones": 0.95,
    "initial_production": 0.95,
    "first_sales": 0.85
  }},
  "document_confidence": "high"
}}

HORIZONTAL MULTIUNIT WELL EXAMPLE (lateral crossing sections):
{{
  "doc_type": "completion_report",

  "section": 22,
  "township": "18N",
  "range": "14W",
  "county": "Dewey",
  "state": "Oklahoma",

  "api_number": "35-043-23686-0000",
  "api_number_normalized": "35043236860000",
  "well_name": "NEWLEY 15-22-1XH",
  "well_number": "15-22-1XH",
  "otc_prod_unit_no": "043-226597-0-0000",
  "otc_prod_unit_no_normalized": "04322659700000",
  "permit_number": "PD-2018-001234",

  "operator": {{
    "name": "Derby Exploration, LLC",
    "operator_number": "24143",
    "address": "P.O. Box 779, 100 Park Ave Ste 400",
    "city": "Oklahoma City",
    "state": "OK",
    "zip": "73101-0779"
  }},

  "dates": {{
    "spud_date": "2019-02-01",
    "drilling_finished_date": "2019-06-22",
    "completion_date": "2019-11-27",
    "first_production_date": "2019-11-27",
    "initial_test_date": "2019-12-27"
  }},

  "well_type": {{
    "drill_type": "HORIZONTAL HOLE",
    "completion_type": "Single Zone",
    "well_class": "GAS"
  }},

  "surface_location": {{
    "section": 22,
    "township": "18N",
    "range": "14W",
    "county": "Dewey",
    "quarters": "W2 SW SE SW",
    "footage_ns": "330 FSL",
    "footage_ew": "1485 FWL",
    "latitude": 36.01550178,
    "longitude": -98.68457972,
    "ground_elevation_ft": 1880
  }},

  "bottom_hole_location": {{
    "section": 15,
    "township": "18N",
    "range": "14W",
    "county": "Dewey",
    "quarters": "NE NW NE NW",
    "footage_ns": "52 FNL",
    "footage_ew": "1974 FWL",
    "measured_depth_ft": 20783,
    "true_vertical_depth_ft": 10180,
    "distance_from_unit_line_ft": 52
  }},

  "lateral_details": {{
    "depth_of_deviation_ft": 9917,
    "radius_of_turn_ft": 760,
    "direction_degrees": 11,
    "lateral_length_ft": 10106
  }},

  "formation_zones": [
    {{
      "formation_name": "Mississippian",
      "formation_code": "359MSSP",
      "perforated_intervals": [
        {{ "from_ft": 10797, "to_ft": 15414 }},
        {{ "from_ft": 15451, "to_ft": 20068 }}
      ],
      "stimulation": {{
        "method": "Hydraulic Fracturing",
        "stages": 45,
        "total_proppant_lbs": 12500000,
        "total_fluid_bbls": 425000
      }}
    }}
  ],

  "initial_production": {{
    "test_date": "2019-12-27",
    "oil_bbl_per_day": 186.9,
    "oil_gravity_api": 52.2,
    "gas_mcf_per_day": 3490,
    "gas_oil_ratio": 18672,
    "water_bbl_per_day": 1359,
    "flow_method": "FLOWING",
    "initial_shut_in_pressure_psi": 2950,
    "choke_size": "28/64",
    "flow_tubing_pressure_psi": 2127
  }},

  "first_sales": {{
    "date": "2019-12-15",
    "purchaser": "ONEOK",
    "purchaser_number": "48291",
    "gas_plant": "Cana Plant"
  }},

  "allocation_factors": [
    {{
      "section": 22,
      "township": "18N",
      "range": "14W",
      "county": "Dewey",
      "pun": "043-226597-0-0000",
      "pun_normalized": "04322659700000",
      "percentage": 54.5,
      "decimal": 0.545,
      "acres": 348.8,
      "is_surface_location": true
    }},
    {{
      "section": 15,
      "township": "18N",
      "range": "14W",
      "county": "Dewey",
      "pun": "043-226597-0-0001",
      "pun_normalized": "04322659700001",
      "percentage": 45.5,
      "decimal": 0.455,
      "acres": 291.2,
      "is_surface_location": false
    }}
  ],

  "related_orders": {{
    "references": [
      {{ "order_number": "685493", "type": "spacing_order", "formation": "Mississippian", "unit_size_acres": 640 }},
      {{ "order_number": "687876", "type": "spacing_order", "formation": "Mississippian", "unit_size_acres": 640 }},
      {{ "order_number": "708745", "type": "multiunit", "description": "Multiunit horizontal authorization" }},
      {{ "order_number": "708632", "type": "location_exception" }}
    ]
  }},

  "formation_tops": [
    {{ "name": "Big Lime", "depth_ft": 8312 }},
    {{ "name": "Verdigris", "depth_ft": 8570 }},
    {{ "name": "Inola", "depth_ft": 8870 }},
    {{ "name": "Chester", "depth_ft": 9497 }}
  ],

  "status": "Accepted",
  "occ_file_number": "1144764",

  "key_takeaway": "Derby Exploration completed the NEWLEY 15-22-1XH horizontal Mississippian well in Dewey County with initial production of 187 BOPD, 3,490 MCFD gas, and 1,359 BWPD, with the lateral extending from Section 22 (54.5%) to Section 15 (45.5%).",

  "detailed_analysis": "This completion report documents the NEWLEY 15-22-1XH, a horizontal well targeting the Mississippian formation in Dewey County. The well was spud February 1, 2019 and completed November 27, 2019.\n\nThe surface location is in Section 22-18N-14W, with the lateral extending north into Section 15-18N-14W. Total measured depth is 20,783 feet with a true vertical depth of 10,180 feet and lateral length of approximately 10,106 feet.\n\nTwo perforation intervals were completed: 10,797-15,414 feet and 15,451-20,068 feet, for a total perforated length of roughly 9,234 feet. The well was stimulated with 45 frac stages using approximately 12.5 million pounds of proppant.\n\nInitial production test on December 27, 2019 showed 186.9 BOPD (52.2 API gravity), 3,490 MCFD gas, and 1,359 BWPD, flowing naturally with a GOR of 18,672.\n\nProduction is allocated 54.5% to Section 22 (PUN 043-226597-0-0000) and 45.5% to Section 15 (PUN 043-226597-0-0001). Mineral owners in both sections should expect to see this well on their division orders.",

  "field_scores": {{
    "api_number": 0.95,
    "well_name": 0.95,
    "operator": 0.95,
    "dates": 0.95,
    "surface_location": 0.95,
    "bottom_hole_location": 0.90,
    "lateral_details": 0.90,
    "formation_zones": 0.95,
    "initial_production": 0.95,
    "first_sales": 0.85,
    "allocation_factors": 0.90
  }},
  "document_confidence": "high"
}}

For WELL TRANSFERS (Form 1073 / 1073MW):
Well Transfer documents record the official change of operatorship for oil and gas wells. When wells change
operators, mineral owners receive new division orders and must contact a different company for royalty questions.

CRITICAL: This doc type covers MULTIPLE wells potentially in DIFFERENT locations.
- Top-level section/township/range are NOT used
- Each well in the wells[] array has its own location
- Property linking happens via the wells[] array, not top-level fields

EXTRACTION REQUIREMENTS:
- Extract ALL wells listed - missing wells breaks property linking
- Each well needs: api_number, well_name, section, township, range
- well_type: OIL | GAS | DRY
- well_status: AC (Active) | TA (Temp Abandoned) | SP (Spudded) | ND (Not Drilled) | TM (Temp Shut-in) | PA (Permanently Abandoned)
- Use comments field to flag discrepancies (e.g., well number doesn't match section)

OMIT: Notary signatures, commission expiration, form payment info, OCC stamps, instructions text.

MULTI-WELL TRANSFER EXAMPLE (Form 1073MW - 13 wells):
{{
  "doc_type": "well_transfer",

  "transfer_info": {{
    "form_number": "1073MW",
    "transfer_date": "2022-01-05",
    "approval_date": "2022-01-07",
    "wells_transferred_count": 13
  }},

  "former_operator": {{
    "name": "Tessera Energy, LLC",
    "occ_number": "21803",
    "address": "P.O. Box 20359, Oklahoma City, OK 73156-0359",
    "phone": "405-254-3673"
  }},

  "new_operator": {{
    "name": "WestStar Oil & Gas, Inc.",
    "occ_number": "18035",
    "address": "1601 East 19th, Edmond, OK 73013",
    "phone": "405-341-2338",
    "email": "mkrenger@wsog.org",
    "contact_name": "Michael C. Krenger - President"
  }},

  "wells": [
    {{
      "api_number": "09321476",
      "well_name": "Augusta Rother",
      "well_number": "1-28",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 28,
      "township": "21N",
      "range": "15W",
      "quarters": "SE SE SW"
    }},
    {{
      "api_number": "09322686",
      "well_name": "Baustert",
      "well_number": "2-21",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 21,
      "township": "21N",
      "range": "15W",
      "quarters": "C SW"
    }},
    {{
      "api_number": "09323213",
      "well_name": "Boehs",
      "well_number": "2-28",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 28,
      "township": "21N",
      "range": "15W",
      "quarters": "S2 N2 SW"
    }}
  ],

  "summary": {{
    "counties_affected": ["Dewey", "Blaine", "Major"],
    "well_types": {{
      "oil_count": 0,
      "gas_count": 13,
      "dry_count": 0
    }}
  }},

  "key_takeaway": "Tessera Energy transferred 13 gas wells to WestStar Oil & Gas across Dewey, Blaine, and Major counties, effective January 7, 2022.",

  "detailed_analysis": "This transfer moves operatorship of 13 gas wells from Tessera Energy, LLC to WestStar Oil & Gas, Inc. All wells are classified as active (AC) gas wells. The transfer was approved by the Oklahoma Corporation Commission on January 7, 2022.\n\nMineral owners with interests in any of these wells should expect to receive new division orders from WestStar Oil & Gas. Future royalty payments will come from the new operator, and any questions about production or payments should be directed to WestStar at 405-341-2338 or mkrenger@wsog.org.",

  "field_scores": {{
    "transfer_info": 0.95,
    "former_operator": 0.95,
    "new_operator": 0.95,
    "wells": 0.95
  }},
  "document_confidence": "high"
}}

MIXED WELL TYPES EXAMPLE (Form 1073MW - 17 wells, oil + gas, multiple statuses):
{{
  "doc_type": "well_transfer",

  "transfer_info": {{
    "form_number": "1073MW",
    "transfer_date": "2018-10-17",
    "approval_date": "2018-11-07",
    "wells_transferred_count": 17
  }},

  "former_operator": {{
    "name": "Jolen Operating Company",
    "occ_number": "11403",
    "address": "100 N. Broadway, Ste 2460, OKC, OK 73102",
    "phone": "405-235-8448",
    "email": "OPERATIONS@JOLEN.COM",
    "contact_name": "C. Brad Williams, VP"
  }},

  "new_operator": {{
    "name": "Kirkpatrick Oil Company, Inc.",
    "occ_number": "19792",
    "address": "1001 W. Wilshire Blvd, OKC, OK 73116",
    "phone": "405-840-2946",
    "email": "mmcginnis@kirkpatrickoil.com",
    "contact_name": "Mike McGinnis, VP Operations"
  }},

  "wells": [
    {{
      "api_number": "00721231",
      "well_name": "Traxler",
      "well_number": "1-6",
      "well_type": "GAS",
      "well_status": "AC",
      "section": 6,
      "township": "3N",
      "range": "23E",
      "county": "Adair",
      "quarters": "C SW"
    }},
    {{
      "api_number": "04321546",
      "well_name": "Hutton",
      "well_number": "2-14",
      "well_type": "OIL",
      "well_status": "AC",
      "section": 14,
      "township": "17N",
      "range": "15W",
      "county": "Dewey",
      "quarters": "N2 S2 NW SW"
    }},
    {{
      "api_number": "09324773",
      "well_name": "Cheval",
      "well_number": "15-7",
      "well_type": "OIL",
      "well_status": "AC",
      "section": 8,
      "township": "21N",
      "range": "14W",
      "county": "Major",
      "quarters": "SW SW NW NW",
      "comments": "Well number 15-7 but located in Section 8 per document"
    }},
    {{
      "api_number": "05921174",
      "well_name": "Litz",
      "well_number": "1R-2",
      "well_type": "GAS",
      "well_status": "TA",
      "section": 2,
      "township": "26N",
      "range": "23W",
      "county": "Harper",
      "quarters": "SW SW NE SE"
    }}
  ],

  "summary": {{
    "counties_affected": ["Adair", "Dewey", "Ellis", "Harper", "Major", "Woodward"],
    "well_types": {{
      "oil_count": 8,
      "gas_count": 9,
      "dry_count": 0
    }}
  }},

  "key_takeaway": "Jolen Operating Company transferred 17 wells (8 oil, 9 gas) to Kirkpatrick Oil Company across six counties, effective November 7, 2018.",

  "detailed_analysis": "This transfer moves operatorship of 17 wells from Jolen Operating Company to Kirkpatrick Oil Company, Inc. The portfolio includes 8 oil wells and 9 gas wells spread across six Oklahoma counties: Adair, Dewey, Ellis, Harper, Major, and Woodward.\n\nThe largest concentration is the Cheval field in Major County with 8 oil wells. Three wells are temporarily abandoned. Mineral owners should expect new division orders from Kirkpatrick Oil Company. Contact Mike McGinnis at 405-840-2946 or mmcginnis@kirkpatrickoil.com.",

  "field_scores": {{
    "transfer_info": 0.95,
    "former_operator": 0.95,
    "new_operator": 0.95,
    "wells": 0.90
  }},
  "document_confidence": "high"
}}

SINGLE WELL TRANSFER EXAMPLE (Form 1073):
{{
  "doc_type": "well_transfer",

  "transfer_info": {{
    "form_number": "1073",
    "transfer_date": "2023-06-15",
    "approval_date": "2023-06-20",
    "wells_transferred_count": 1
  }},

  "former_operator": {{
    "name": "Smith Energy Co.",
    "occ_number": "15432",
    "address": "123 Main St, Tulsa, OK 74101"
  }},

  "new_operator": {{
    "name": "Jones Petroleum LLC",
    "occ_number": "18976",
    "address": "456 Oak Ave, Oklahoma City, OK 73102",
    "phone": "405-555-1234"
  }},

  "wells": [
    {{
      "api_number": "04320156",
      "well_name": "Miller",
      "well_number": "1-15",
      "well_type": "OIL",
      "well_status": "AC",
      "section": 15,
      "township": "18N",
      "range": "12W"
    }}
  ],

  "key_takeaway": "Smith Energy transferred the Miller 1-15 oil well to Jones Petroleum in Section 15-18N-12W, effective June 20, 2023.",

  "detailed_analysis": "This single well transfer moves the Miller 1-15 from Smith Energy to Jones Petroleum. Mineral owners in Section 15-18N-12W should expect new division orders from Jones Petroleum.",

  "field_scores": {{
    "transfer_info": 0.95,
    "former_operator": 0.90,
    "new_operator": 0.95,
    "wells": 1.0
  }},
  "document_confidence": "high"
}}

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

CRITICAL - FIELD NAME ENFORCEMENT:
You MUST use ONLY the exact field names shown in the schema below. Do NOT invent new field names.
- Use "order_info" NOT "case_info" or "Order Information"
- Use "officials" NOT "commissioners_info" or "Officials Information"
- Use "well_authorization" NOT "proposed_well" or "Well Info"
- Use "target_formations" NOT "formations" or "Target Formation"
- Use "recoverable_reserves" NOT "engineering_data" or "reserves"
- Use "related_orders" NOT "previous_orders" or "companion_orders"
If information doesn't fit an existing field, put it in "notes" as a text summary.

REQUIRED FIELDS: order_info.case_number, order_info.order_number, order_info.order_date,
officials.administrative_law_judge, operator.name, applicant.name, applicant.is_operator,
legal_description (all subfields), well_authorization.well_name, well_authorization.well_type,
target_formations (at least one with is_primary: true), key_takeaway, detailed_analysis

OMIT IF EMPTY (do NOT include null, None, N/A, or empty values):
- operator address fields (address, city, state, zip)
- applicant.attorney, applicant.attorney_oba, applicant.attorney_address, applicant.attorney_phone
- well_authorization.api_number, well_authorization.well_classification
- unit_info.description
- existing_wells (omit entire array if none listed)
- recoverable_reserves (omit if no engineering data)
- allocation_factors (REQUIRED for MULTIUNIT wells - these wells cross multiple sections and you MUST extract ALL sections with their allocation percentages. Look carefully in: (1) Appendix A or allocation appendices, (2) tables showing "allocation factors" or "percentage allocation", (3) legal description that lists multiple sections. Extract EVERY section the well crosses - typically 2-4 sections. Each entry needs section, township, range, and percentage. If acres are shown, include those too. Missing sections will break property linking.)
- allowable_notes
- related_orders.amends_order, related_orders.companion_cases

{{
  "doc_type": "increased_density_order",

  "order_info": {{
    "case_number": "CD2023-001229",
    "order_number": "734065",
    "order_date": "2023-05-03",
    "hearing_date": "2023-04-25"
  }},

  "officials": {{
    "administrative_law_judge": "Jan Preslar",
    "commissioners": ["J. Todd Hiett", "Bob Anthony", "Kim David"]
  }},

  "operator": {{
    "name": "Continental Resources, Inc.",
    "address": "20 N Broadway",
    "city": "Oklahoma City",
    "state": "OK",
    "zip": "73102"
  }},

  "applicant": {{
    "name": "Continental Resources, Inc.",
    "is_operator": true,
    "attorney": "Karl F. Hirsch",
    "attorney_oba": "4232",
    "attorney_address": "Two Leadership Square, Oklahoma City, OK 73102",
    "attorney_phone": "(405) 235-4100"
  }},

  "legal_description": {{
    "section": 10,
    "township": "14N",
    "range": "14W",
    "meridian": "IM",
    "county": "Custer",
    "state": "Oklahoma"
  }},

  "unit_info": {{
    "unit_size_acres": 640,
    "spacing_order": "668920",
    "description": "All of Section 10, Township 14 North, Range 14 West"
  }},

  "well_authorization": {{
    "well_name": "KO Kipp 4-34-3-10XHW",
    "api_number": "35-039-22605",
    "well_type": "multiunit_horizontal",
    "well_classification": "oil",
    "additional_wells_authorized": 1
  }},

  "target_formations": [
    {{
      "name": "Mississippian",
      "is_primary": true,
      "common_source": "Mississippian common source of supply"
    }}
  ],

  "existing_wells": [
    {{
      "well_name": "KO Kipp 1-34-3-10MXH",
      "api_number": "35-039-22501",
      "well_classification": "oil"
    }}
  ],

  "recoverable_reserves": {{
    "oil_mbo": 94,
    "gas_mmcf": 94391
  }},

  "allocation_factors": [
    {{
      "section": 10,
      "township": "14N",
      "range": "14W",
      "percentage": 45.5,
      "acres": 291.2
    }},
    {{
      "section": 3,
      "township": "14N",
      "range": "14W",
      "percentage": 54.5,
      "acres": 348.8
    }}
  ],

  "allowable_notes": "Multiunit horizontal allocation factors per Appendix A supplemented by Appendix C; gas per 165:10-3-28(h)(2)",

  "expiration": {{
    "period": "1 year",
    "date": "2024-05-03"
  }},

  "related_orders": {{
    "spacing_order": "668920",
    "amends_order": "720145",
    "companion_cases": ["CD2023-001228", "CD2023-001230"]
  }},

  "key_takeaway": "Continental Resources authorized to drill one additional multiunit horizontal well (KO Kipp 4-34-3-10XHW) targeting the Mississippian in Section 10-14N-14W, Custer County.",

  "detailed_analysis": "This increased density order grants Continental Resources permission to drill an additional horizontal well in an existing 640-acre spacing unit in Section 10. The well, named KO Kipp 4-34-3-10XHW, will target the Mississippian formation.\n\nThe Commission found that significant recoverable reserves remain in the unit - approximately 94,000 barrels of oil and 94 billion cubic feet of gas - that would not be efficiently drained by existing wells alone.\n\nThis order is informational only and does not require mineral owner action. If you own minerals in this section, you may see increased royalty payments once the well is drilled and begins production. The authorization expires May 3, 2024 if drilling operations have not commenced.",

  "field_scores": {{
    "order_info": 0.95,
    "officials": 0.90,
    "operator": 0.95,
    "applicant": 0.95,
    "legal_description": 1.0,
    "unit_info": 0.90,
    "well_authorization": 0.95,
    "target_formations": 0.90,
    "existing_wells": 0.85,
    "recoverable_reserves": 0.80,
    "allocation_factors": 0.85,
    "expiration": 0.90,
    "related_orders": 0.85
  }},
  "document_confidence": "high"
}}

For CHANGE OF OPERATOR ORDERS (Transfer of operatorship to new company):
NOTE: These orders transfer operational responsibility from one company to another.
Look for "CHANGE OF OPERATOR", "TRANSFER OF OPERATOR", or similar language.

KEY EXTRACTION POINTS:
- Extract BOTH former and new operator details including OTC operator numbers
- Extract ALL affected wells with names, API numbers, and OTC lease numbers
- If order modifies existing pooling/spacing orders, capture those in modified_orders[]
- If subsequent well provisions are added, capture all deadline details
- Many change of operator orders also ADD subsequent well language to older orders that didn't have it

CRITICAL: Use standard OCC order structure (order_info, officials, etc.)

EXAMPLE - Simple Change of Operator:
{
  "doc_type": "change_of_operator_order",

  "section": 22,
  "township": "7N",
  "range": "19E",
  "county": "Haskell",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD-202200987",
    "order_number": "728456",
    "order_date": "2022-04-01",
    "effective_date": "2022-04-01",
    "hearing_date": "2022-03-15"
  },

  "officials": {
    "administrative_law_judge": "Richard Grimes",
    "alj_approval_date": "2022-03-20",
    "technical_reviewer": "John Smith",
    "technical_review_date": "2022-03-18",
    "hearing_location": "Jim Thorpe Building, Oklahoma City",
    "commissioners": ["Kim David", "J. Todd Hiett", "Brian Bingman"]
  },

  "applicant": {
    "name": "Pride Energy Company",
    "role": "Proposed Operator",
    "attorney": "Jane Attorney",
    "attorney_oba": "12345"
  },

  "former_operator": {
    "name": "Samson Resources Company",
    "address": "15 E. 5th St, Ste. 1000",
    "city": "Tulsa",
    "state": "Oklahoma",
    "zip": "74103",
    "otc_operator_number": "5415"
  },

  "new_operator": {
    "name": "Pride Energy Company",
    "address": "PO Box 701950",
    "city": "Tulsa",
    "state": "Oklahoma",
    "zip": "74170",
    "otc_operator_number": "19430",
    "in_business_since": "1994-10-06",
    "wells_currently_operated": 57,
    "financial_statement_amount": 50000.00,
    "form_1006b_renewal_date": "2022-08-01"
  },

  "target_formations": [
    {"name": "Basal Atoka (Spiro)", "common_source": "Basal Atoka (Spiro)"},
    {"name": "Middle Atoka", "common_source": "Middle Atoka"},
    {"name": "Upper Atoka", "common_source": "Upper Atoka"}
  ],

  "affected_wells": [
    {
      "well_name": "Sappington 1-22",
      "api_number": "35-061-20698",
      "otc_number": "061-019480-0",
      "well_type": "vertical",
      "producing_formations": ["Atoka", "Cromwell"],
      "status": "producing"
    }
  ],

  "modified_orders": [
    {
      "order_number": "155561",
      "order_date": "1979-07-24",
      "order_type": "Pooling",
      "modifications_made": [
        "Delete Samson Resources Company as operator",
        "Name Pride Energy Company as operator",
        "Add subsequent well provision"
      ]
    },
    {
      "order_number": "158121",
      "order_date": "1979-10-01",
      "order_type": "Pooling",
      "modifications_made": [
        "Delete Samson Resources Company as operator",
        "Name Pride Energy Company as operator",
        "Add subsequent well provision"
      ]
    }
  ],

  "subsequent_wells": {
    "has_provision": true,
    "notice_period_days": 20,
    "payment_deadline_days": 25,
    "operator_commencement_days": 180,
    "non_election_consequence": "Owner deemed to have relinquished all right, title, interest to operator for proposed subsequent well"
  },

  "key_takeaway": "Change of operator from Samson Resources to Pride Energy for the Basal Atoka, Middle Atoka, and Upper Atoka formations in Section 22-7N-19E, Haskell County. Modifies two 1979 pooling orders and adds subsequent well provisions.",

  "detailed_analysis": "This Change of Operator Order transfers operatorship from Samson Resources Company to Pride Energy Company for the Basal Atoka (Spiro), Middle Atoka, and Upper Atoka formations in Section 22-7N-19E, Haskell County, Oklahoma.\n\nThe order modifies two existing pooling orders from 1979 (Order No. 155561 and 158121) to delete Samson as operator and name Pride Energy. Pride Energy has assumed operations of the Sappington 1-22 well, a vertical Atoka and Cromwell producer.\n\nPride Energy has been in business since October 1994, currently operates 57 wells, and maintains a $50,000 financial statement on file with the Commission.\n\nSignificantly, this order also adds subsequent well development provisions to the original pooling orders. Mineral owners who elected to participate in the initial well will receive written notice of any proposed subsequent wells and have 20 days to elect participation and 25 days to pay their proportionate share. Owners who fail to timely elect or pay will be deemed to have relinquished their rights to the proposed well.",

  "field_scores": {
    "order_info": "high",
    "officials": "high",
    "applicant": "high",
    "former_operator": "high",
    "new_operator": "high",
    "target_formations": "high",
    "affected_wells": "high",
    "modified_orders": "high",
    "subsequent_wells": "high"
  },
  "document_confidence": "high"
}

EXAMPLE - Simple Change of Operator (no modified orders, no subsequent wells):
{
  "doc_type": "change_of_operator_order",

  "section": 10,
  "township": "20N",
  "range": "24W",
  "county": "Ellis",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD-202302361",
    "order_number": "737686",
    "order_date": "2023-12-14",
    "effective_date": "2023-12-14",
    "hearing_date": "2023-11-28"
  },

  "officials": {
    "administrative_law_judge": "Mary Johnson",
    "hearing_location": "Jim Thorpe Building, Oklahoma City",
    "commissioners": ["Kim David", "J. Todd Hiett", "Brian Bingman"]
  },

  "applicant": {
    "name": "Unbridled Resources, LLC",
    "role": "Proposed Operator"
  },

  "former_operator": {
    "name": "Panther Creek Resources, Inc.",
    "otc_operator_number": "8823"
  },

  "new_operator": {
    "name": "Unbridled Resources, LLC",
    "otc_operator_number": "21456",
    "wells_currently_operated": 34,
    "financial_statement_amount": 75000.00
  },

  "affected_wells": [
    {
      "well_name": "Davis Unit 10-1",
      "api_number": "35-045-22313",
      "otc_number": "01665",
      "well_type": "vertical",
      "status": "producing"
    },
    {
      "well_name": "Davis Unit 10-2",
      "api_number": "35-045-22314",
      "otc_number": "01666",
      "well_type": "vertical",
      "status": "producing"
    }
  ],

  "subsequent_wells": {
    "has_provision": false
  },

  "key_takeaway": "Change of operator from Panther Creek Resources to Unbridled Resources for 2 wells in Section 10-20N-24W, Ellis County.",

  "detailed_analysis": "This Change of Operator Order transfers operatorship from Panther Creek Resources, Inc. to Unbridled Resources, LLC for 2 wells in Section 10-20N-24W, Ellis County, Oklahoma. The Davis Unit 10-1 and 10-2 wells are both producing vertical wells. Unbridled Resources currently operates 34 wells and maintains a $75,000 financial statement on file with the Commission. This is a straightforward operator transfer with no modifications to existing orders.",

  "field_scores": {
    "order_info": "high",
    "officials": "medium",
    "former_operator": "high",
    "new_operator": "high",
    "affected_wells": "high"
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

IMPORTANT: One order may establish MULTIPLE units with different sizes, sections, and setback rules.
Use the units[] array to capture each unit separately. Setbacks are per-unit, not per-formation.

Order Type Detection:
- "This Order establishes..." (no prior order referenced) → order_type: "original"
- "Amendment of Order No..." → order_type: "amendment"
- "Extend Order No..." → order_type: "extension"
- "Vacate Order No..." → order_type: "vacation"
- "Correcting Order No..." (simple fix) → order_type: "correction"
- "Nunc Pro Tunc Correcting Order No..." → order_type: "nunc_pro_tunc"

{
  "doc_type": "drilling_and_spacing_order",
  "case_number": "CD 202102682-T",
  "order_number": "724343",
  "order_type": "nunc_pro_tunc",
  "applicant": "E2 Operating, LLC",
  "hearing_date": "2022-01-11",
  "order_date": "2022-03-21",
  "county": "Okmulgee",
  "state": "OK",
  "units": [
    {
      "legal": {
        "section": "35",
        "township": "13N",
        "range": "12E",
        "quarter_calls": ["N/2", "SW/4"]
      },
      "unit_size_acres": 160,
      "unit_shape": "governmental quarter section",
      "well_type": "dewatering",
      "formations": [
        {
          "name": "Senora",
          "common_source_of_supply": "Senora common sources of supply",
          "depth_description": "700'"
        }
      ],
      "well_location": {
        "unit_boundary_setback_ft": 660
      }
    },
    {
      "legal": {
        "section": "35",
        "township": "13N",
        "range": "12E",
        "quarter_calls": ["NE/4", "SW/4"],
        "full_description": "NE and SW 40-acre tracts"
      },
      "unit_size_acres": 80,
      "unit_shape": "40-acre tract",
      "well_type": "dewatering",
      "formations": [
        {
          "name": "Senora",
          "common_source_of_supply": "Senora common sources of supply"
        }
      ],
      "well_location": {
        "unit_boundary_setback_ft": 330,
        "location_description": "within the center square 10 acres of the NE and SW 40-acre tracts"
      }
    }
  ],
  "related_orders": {
    "corrects": {
      "order_number": "723664",
      "description": "Corrects caption to reference NW/4 of Section 2"
    },
    "extends": [
      {
        "order_number": "573354",
        "formation": "Senora",
        "lands_affected": "SE/4 of Section 35"
      }
    ],
    "vacates": [
      {
        "order_number": "581177",
        "formation": "Senora",
        "lands_affected": "S/2 NE/4 of Section 35"
      }
    ]
  },
  "companion_causes": [
    { "case_number": "CD 202102913-T", "cause_type": "Pooling" }
  ],
  "pooling_authorized": true,
  "extraction_notes": "Order is Nunc Pro Tunc correcting prior Order 723664. Different setback rules for 160-acre (660') vs 80-acre (330') units."
}

For HORIZONTAL DRILLING AND SPACING ORDERS (Horizontal well spacing with lateral requirements):
NOTE: These orders establish drilling and spacing units for HORIZONTAL wells.
Look for "HORIZONTAL DRILLING AND SPACING", "HORIZONTAL WELL", lateral setbacks, completion interval requirements.
These have setbacks for both lateral wellbore AND completion interval (perforated section).

IMPORTANT: One order may establish MULTIPLE units. Use the units[] array to capture each unit separately.
Setbacks are per-unit in well_location, not per-formation. Multi-section units (1280-acre, 1920-acre) should use sections_covered.

Order Type Detection (same as vertical):
- "This Order establishes..." (no prior order referenced) → order_type: "original"
- "Amendment of Order No..." → order_type: "amendment"
- "Extend Order No..." → order_type: "extension"
- "Vacate Order No..." → order_type: "vacation"
- "Correcting Order No..." (simple fix) → order_type: "correction"
- "Nunc Pro Tunc Correcting Order No..." → order_type: "nunc_pro_tunc"

{
  "doc_type": "horizontal_drilling_and_spacing_order",
  "case_number": "CD 2024-002345",
  "order_number": "748000",
  "order_type": "original",
  "applicant": "Mewbourne Oil Company",
  "hearing_date": "2024-05-06",
  "order_date": "2024-05-20",
  "county": "Dewey",
  "state": "OK",
  "units": [
    {
      "legal": {
        "section": "8",
        "township": "17N",
        "range": "17W",
        "full_description": "All of Section 8"
      },
      "unit_size_acres": 640,
      "unit_shape": "all of section",
      "well_type": "oil",
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
          "depth_to_ft": 12400,
          "depth_reference": "surface"
        }
      ],
      "well_location": {
        "lateral_setback_ft": 330,
        "completion_interval_setback_ft": 330,
        "special_conditions": "The horizontal wellbore and completion interval shall not be located closer than 330 feet from any unit boundary"
      }
    }
  ]
}

Multi-section horizontal example (1280-acre unit covering 2 sections):
{
  "doc_type": "horizontal_drilling_and_spacing_order",
  "case_number": "CD 2024-003456",
  "order_number": "749500",
  "order_type": "original",
  "applicant": "Continental Resources, Inc.",
  "hearing_date": "2024-06-10",
  "order_date": "2024-06-25",
  "county": "Blaine",
  "state": "OK",
  "units": [
    {
      "legal": {
        "section": "8",
        "township": "17N",
        "range": "13W",
        "full_description": "All of Sections 8 and 17, Township 17 North, Range 13 West"
      },
      "unit_size_acres": 1280,
      "unit_shape": "1280-acre",
      "well_type": "oil",
      "sections_covered": 2,
      "formations": [
        {
          "name": "Woodford",
          "common_source_of_supply": "Woodford common source of supply",
          "depth_from_ft": 12500,
          "depth_to_ft": 12700,
          "depth_reference": "subsea"
        }
      ],
      "well_location": {
        "lateral_setback_ft": 330,
        "completion_interval_setback_ft": 330,
        "max_wells_per_formation": 4
      }
    }
  ]
}

For LOCATION EXCEPTION ORDERS (Permits drilling closer to boundaries than standard setbacks):
NOTE: These orders grant exceptions to standard well setback requirements for BOTH vertical and horizontal wells.
Look for "LOCATION EXCEPTION" or "HORIZONTAL LOCATION EXCEPTION", specific footage distances, "exception from", "permit the drilling".
For HORIZONTAL wells: Look for lateral path tables with measured depth, TVD, and section crossings.
For RE-ENTRY wells: Note the previous formation and well_type = "re_entry".

CRITICAL DISTINCTIONS:
- PRIOR ORDERS: Orders being amended, superseded, or referenced (historical relationship)
- COMPANION CAUSES: Causes filed together in the same application package (same development project)

TOP-LEVEL LINKING FIELDS: Always populate section/township/range/county at root level for property matching.
- For VERTICAL wells: Use the well location section
- For HORIZONTAL wells: Use the FIRST TARGET SECTION (where lateral starts), not surface section

HORIZONTAL WELL EXAMPLE:
{
  "doc_type": "location_exception_order",

  "section": 26,
  "township": "17N",
  "range": "8W",
  "county": "Kingfisher",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD2024-003810",
    "order_number": "754630",
    "order_date": "2024-11-05",
    "effective_date": "2024-11-05",
    "hearing_date": "2024-10-15"
  },

  "officials": {
    "administrative_law_judge": "Paul E. Porter",
    "hearing_location": "Jim Thorpe Building, Oklahoma City",
    "commissioners": [
      {"name": "Bob Anthony", "vote": "aye"},
      {"name": "Todd Hiett", "vote": "aye"},
      {"name": "Kim David", "vote": "aye"}
    ]
  },

  "applicant": {
    "name": "Ovintiv USA Inc.",
    "role": "Applicant"
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
      "formation_name": "Mississippian",
      "qualifier": "less Chester",
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
    "actual_setback_ft": 147,
    "exception_type": "lateral_path",
    "exception_reason": "Horizontal lateral path through multiple sections"
  },

  "lateral_path": {
    "surface_location": {
      "section": 23,
      "township": "17N",
      "range": "8W",
      "footage_fnl": 200,
      "footage_fel": 1430
    },
    "lateral_points": [
      {
        "point_type": "first_perforation",
        "section": 26,
        "township": "17N",
        "range": "8W",
        "measured_depth_ft": 10540,
        "true_vertical_depth_ft": 7490,
        "footage_fnl": 156,
        "footage_fel": 2326
      },
      {
        "point_type": "section_crossing",
        "section": 35,
        "township": "17N",
        "range": "8W",
        "measured_depth_ft": 15348,
        "true_vertical_depth_ft": 7488,
        "footage_fsl": 0,
        "footage_fel": 2241,
        "line_crossed": "south",
        "description": "Crosses from Section 26 to Section 35"
      },
      {
        "point_type": "last_perforation",
        "section": 35,
        "township": "17N",
        "range": "8W",
        "measured_depth_ft": 20608,
        "true_vertical_depth_ft": 7537,
        "footage_fsl": 1316,
        "footage_fel": 2159
      },
      {
        "point_type": "terminus_bhl",
        "section": 35,
        "township": "17N",
        "range": "8W",
        "measured_depth_ft": 20783,
        "true_vertical_depth_ft": 7550,
        "footage_fsl": 1359,
        "footage_fel": 2155,
        "description": "Bottom Hole Location"
      }
    ],
    "total_lateral_length_ft": 10243,
    "drilling_direction": "north to south"
  },

  "allowable": {
    "oil_allowable_percent": 100,
    "gas_allowable_percent": 100
  },

  "offset_impact": {
    "offsets_adversely_affected": false
  },

  "expiration": {
    "expires": false,
    "notes": "Well drilled and completed - order remains in effect"
  },

  "related_orders": {
    "references": [
      {
        "order_number": "647505",
        "order_date": "2015-06-30",
        "description": "Establishes drilling unit"
      },
      {
        "order_number": "747579",
        "description": "Interim order for this cause"
      }
    ]
  },

  "companion_causes": [
    {
      "cause_number": "CD2024-003803",
      "cause_type": "increased_density",
      "description": "Authorizes additional well in unit"
    },
    {
      "cause_number": "CD2024-003807",
      "cause_type": "multiunit_horizontal",
      "description": "Establishes multiunit horizontal well"
    },
    {
      "cause_number": "CD2024-003811",
      "cause_type": "600_foot_rule",
      "description": "600-foot rule exception for lateral"
    }
  ],

  "conditions": [
    "The location exception is granted for the horizontal well described herein only",
    "Operator shall comply with all other applicable rules and regulations"
  ],

  "key_takeaway": "Horizontal location exception for the Lohmeyer 1708 2H-26X well allowing the lateral to pass within 147 feet of the north section line (vs 165 ft standard). The lateral runs from Section 26 through Section 35, with surface location in Section 23. Engineering testimony confirmed no adverse impact on offset wells.",

  "detailed_analysis": "This post-drill location exception addresses an inadvertent surveying error that placed the lateral toe 18 feet closer to the north line than the 165-foot standard setback. Ovintiv operates Mississippian wells in the north offset Section 23 and presented engineering testimony that fractures run east-west with minimal damage around the toe. No pressure communication with adjacent Lohmeyer 1708 2H-26X and 3H-26X wells was observed. The Commission found no offset would be adversely affected. This is part of a larger development package including increased density (CD2024-003803), multiunit horizontal (CD2024-003807), and 600-foot rule exception (CD2024-003811) causes.",

  "field_scores": {
    "order_info": "high",
    "officials": "high",
    "well_info": "high",
    "target_formations": "high",
    "location": "high",
    "exception_details": "high",
    "lateral_path": "high",
    "related_orders": "medium",
    "companion_causes": "medium"
  },

  "document_confidence": "high"
}

VERTICAL WELL LOCATION EXCEPTION EXAMPLE (Re-entry):
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
    "effective_date": "2015-06-30",
    "hearing_date": "2015-06-15"
  },

  "officials": {
    "administrative_law_judge": "Keith Thomas",
    "hearing_location": "Jim Thorpe Building, Oklahoma City",
    "commissioners": [
      {"name": "Bob Anthony", "vote": "aye"},
      {"name": "Todd Hiett", "vote": "aye"},
      {"name": "Dana Murphy", "vote": "aye"}
    ]
  },

  "applicant": {
    "name": "Triad Energy Corporation",
    "role": "Applicant"
  },

  "well_orientation": "vertical",

  "well_info": {
    "well_name": "Sanders 1-17",
    "api_number": "35-051-20123",
    "operator": "Triad Energy Corporation",
    "well_type": "re_entry",
    "previous_formation": "Hunton",
    "spacing_unit_acres": 80
  },

  "target_formations": [
    {
      "formation_name": "Hoxbar",
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
    "exception_reason": "Re-entry of existing wellbore to access Hoxbar formation"
  },

  "vertical_well_location": {
    "footage_from_south": 330,
    "footage_from_east": 990,
    "quarter_section": "SE/4"
  },

  "allowable": {
    "oil_allowable_percent": 100,
    "gas_allowable_percent": 100
  },

  "offset_impact": {
    "offsets_adversely_affected": false
  },

  "expiration": {
    "expires": true,
    "expiration_period": "one year",
    "expiration_date": "2016-06-30"
  },

  "related_orders": {
    "references": [
      {
        "order_number": "456789",
        "description": "Establishes drilling unit"
      }
    ]
  },

  "conditions": [
    "Exception granted for specific well location only",
    "Does not alter established spacing pattern"
  ],

  "key_takeaway": "Re-entry location exception for the Sanders 1-17 well, allowing completion 330 feet from the south line (vs 660 ft standard) to access the Hoxbar formation. This well previously produced from the Hunton formation which is now depleted.",

  "detailed_analysis": "This is a re-entry location exception allowing Triad Energy to recomplete an existing Hunton well into the Hoxbar formation. The well is located 330 feet from the south line and 990 feet from the east line of Section 17. Because this is an existing wellbore, the operator cannot move the location to meet standard setbacks. The exception expires in one year if drilling/recompletion has not commenced. The Commission found no offset would be adversely affected by this exception.",

  "field_scores": {
    "order_info": "high",
    "officials": "high",
    "well_info": "high",
    "target_formations": "high",
    "location": "high",
    "exception_details": "high",
    "vertical_well_location": "high",
    "related_orders": "medium"
  },

  "document_confidence": "high"
}

For MULTI-UNIT HORIZONTAL ORDER (authorization to drill horizontal wells across multiple spacing units):
NOTE: Multi-unit horizontal orders authorize horizontal wells that cross section boundaries, with production allocated between affected units based on completion interval length in each section.

CRITICAL - ALLOCATION FACTORS:
- MUST extract ALL sections with allocation percentages
- Missing sections breaks property linking for mineral owners in those sections
- Production is allocated based on feet of lateral in each section

PROPERTY LINKING:
- Primary section (top-level) is where first perforation occurs
- All sections in allocation_factors[] are linked to the document
- is_surface_location=true only for section containing surface hole
- is_target_section=true for all sections the lateral passes through

{
  "doc_type": "multi_unit_horizontal_order",

  "section": 13,
  "township": "2N",
  "range": "9E",
  "county": "Coal",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD-202101431-T",
    "order_number": "724496",
    "order_date": "2022-03-28",
    "order_type": "original",
    "hearing_date": "2021-08-16",
    "final_hearing_date": "2022-03-07"
  },

  "officials": {
    "administrative_law_judge": "Connie Moore",
    "alj_approval_date": "2022-03-23",
    "technical_reviewer": "Russell H. Blasing",
    "technical_review_date": "2022-03-17",
    "hearing_location": "Eastern Regional Office, 201 W. 5th St., Suite 540, Tulsa, OK 74103",
    "commissioners": ["Dana L. Murphy", "Bob Anthony", "J. Todd Hiett"]
  },

  "applicant": {
    "name": "Canyon Creek Energy - Arkoma, LLC",
    "role": "Operator",
    "attorney": "Ron M. Barnes, Grayson Barnes",
    "attorney_oba": "OBA #534, OBA #31475"
  },

  "well_authorization": {
    "well_name": "LDC 24/25-4H",
    "api_number": "029-21406",
    "well_type": "multiunit_horizontal",
    "well_classification": "oil"
  },

  "target_formations": [
    {
      "name": "Woodford",
      "common_source": "Woodford common source of supply",
      "is_primary": true,
      "depth_range": {
        "top_ft": 6607,
        "bottom_ft": 6850
      }
    }
  ],

  "well_location": {
    "surface_location": {
      "section": 13,
      "township": "2N",
      "range": "9E",
      "footage_ns": "1,952' FSL",
      "footage_ew": "2,323' FEL"
    },
    "first_perforation": {
      "section": 13,
      "township": "2N",
      "range": "9E",
      "formation": "Woodford",
      "measured_depth_ft": 7755,
      "tvd_ft": 6768,
      "footage_ns": "683' FSL",
      "footage_ew": "1,506' FEL"
    },
    "last_perforation": {
      "section": 25,
      "township": "2N",
      "range": "9E",
      "formation": "Woodford",
      "measured_depth_ft": 14880,
      "tvd_ft": 6607,
      "footage_ns": "1,148' FNL",
      "footage_ew": "1,435' FEL"
    },
    "total_measured_depth_ft": 14880,
    "lateral_total_length_ft": 7125
  },

  "allocation_factors": [
    {
      "section": 13,
      "township": "2N",
      "range": "9E",
      "county": "Coal",
      "unit_size_acres": 640,
      "completion_interval_length_ft": 686,
      "allocation_percentage": 9.6281,
      "is_surface_location": true,
      "is_target_section": true,
      "spacing_order_number": "537528"
    },
    {
      "section": 24,
      "township": "2N",
      "range": "9E",
      "county": "Coal",
      "unit_size_acres": 640,
      "completion_interval_length_ft": 5288,
      "allocation_percentage": 74.2175,
      "is_surface_location": false,
      "is_target_section": true,
      "spacing_order_number": "662358",
      "entry_point": {
        "description": "South Line of Section 13/North Line of Section 24",
        "footage_ns": "0' FNL",
        "footage_ew": "1,457' FEL",
        "measured_depth_ft": 8441
      }
    },
    {
      "section": 25,
      "township": "2N",
      "range": "9E",
      "county": "Coal",
      "unit_size_acres": 640,
      "completion_interval_length_ft": 1151,
      "allocation_percentage": 16.1544,
      "is_surface_location": false,
      "is_target_section": true,
      "spacing_order_number": "662358",
      "entry_point": {
        "description": "South Line of Section 24/North Line of Section 25",
        "footage_ns": "0' FNL",
        "footage_ew": "1,464' FEL",
        "measured_depth_ft": 13729
      }
    }
  ],

  "related_orders": {
    "references": [
      {
        "order_number": "720189",
        "type": "interim_order",
        "description": "Interim Order granting authorization and permission, superseded by this order"
      },
      {
        "order_number": "537528",
        "type": "spacing_order",
        "section": 13,
        "township": "2N",
        "range": "9E",
        "formation": "Woodford"
      },
      {
        "order_number": "662358",
        "type": "spacing_order",
        "section": 24,
        "township": "2N",
        "range": "9E",
        "formation": "Woodford"
      },
      {
        "order_number": "662358",
        "type": "spacing_order",
        "section": 25,
        "township": "2N",
        "range": "9E",
        "formation": "Woodford"
      }
    ]
  },

  "companion_causes": [
    {
      "cause_number": "CD-202101432-T",
      "order_number": "720264",
      "cause_type": "Location Exception"
    },
    {
      "cause_number": "CD-202101435-T",
      "order_number": "720265",
      "cause_type": "Increased Well Density"
    }
  ],

  "relief_granted": {
    "reason_summary": "Multiunit authorization prevents waste by not requiring a second vertical hole and allows shared surface facilities",
    "cost_savings": "Approximately $1,000,000 savings",
    "reservoir_justification": "Woodford common source of supply has approximately the same thickness and quality across all affected units"
  },

  "special_provisions": {
    "shortened_lateral_reason": "Lateral shortened in Section 13 due to faulting north of wellbore; shortened in Section 25 due to faulting south of wellbore",
    "cemented_perforations": true,
    "amendments_at_hearing": "Well location amended to exact location, completion interval amended to exact footage and percentage"
  },

  "conditions": [
    "Perforations shall be cemented to isolate production",
    "Allocation percentages shall be used for reporting and division of production"
  ],

  "key_takeaway": "Canyon Creek Energy authorized to operate the LDC 24/25-4H multiunit horizontal well targeting Woodford across Sections 13, 24, and 25 of T2N-R9E, Coal County, with production allocated 9.63% to Section 13, 74.22% to Section 24, and 16.15% to Section 25.",

  "detailed_analysis": "This order authorizes Canyon Creek Energy - Arkoma, LLC to operate a multiunit horizontal well (LDC 24/25-4H) that spans three 640-acre spacing units in Coal County. The well targets the Woodford formation and was drilled with a lateral extending from Section 13 through Section 24 and into Section 25.\n\nProduction from this well will be allocated between the three sections based on the length of the completion interval within each unit. Section 24 receives the largest share (74.22%) with 5,288 feet of lateral, Section 25 receives 16.15% with 1,151 feet, and Section 13 receives 9.63% with only 686 feet. The shortened laterals in Sections 13 and 25 are due to geological faulting that limited the wellbore path.\n\nMineral owners in any of these three sections should ensure their division orders reflect the correct allocation percentage for their section. The well was drilled pursuant to spacing orders 537528 (Section 13) and 662358 (Sections 24-25).\n\nThe order supersedes Interim Order No. 720189 and is associated with companion Location Exception and Increased Well Density causes.",

  "field_scores": {
    "order_info": "high",
    "officials": "high",
    "well_authorization": "high",
    "target_formations": "high",
    "well_location": "high",
    "allocation_factors": "high"
  },
  "document_confidence": "high"
}

SECOND MULTI-UNIT HORIZONTAL ORDER EXAMPLE (Two sections, simpler case):
{
  "doc_type": "multi_unit_horizontal_order",

  "section": 5,
  "township": "15N",
  "range": "11W",
  "county": "Blaine",
  "state": "Oklahoma",

  "order_info": {
    "cause_number": "CD-202300567-T",
    "order_number": "731200",
    "order_date": "2023-09-15",
    "order_type": "original",
    "hearing_date": "2023-08-22"
  },

  "officials": {
    "administrative_law_judge": "Michael Peters",
    "alj_approval_date": "2023-09-10",
    "hearing_location": "Jim Thorpe Building, Oklahoma City, OK",
    "commissioners": ["Kim David", "Bob Anthony", "Todd Hiett"]
  },

  "applicant": {
    "name": "Continental Resources, Inc.",
    "role": "Operator",
    "attorney": "James Taylor",
    "attorney_oba": "OBA #12345"
  },

  "well_authorization": {
    "well_name": "Hansen 5-8H",
    "api_number": "35-011-23456",
    "well_type": "multiunit_horizontal",
    "well_classification": "oil"
  },

  "target_formations": [
    {
      "name": "Mississippian",
      "common_source": "Mississippian common source of supply",
      "is_primary": true
    }
  ],

  "well_location": {
    "surface_location": {
      "section": 5,
      "township": "15N",
      "range": "11W",
      "footage_ns": "660' FSL",
      "footage_ew": "1980' FWL"
    },
    "first_perforation": {
      "section": 5,
      "township": "15N",
      "range": "11W",
      "formation": "Mississippian",
      "measured_depth_ft": 11200,
      "tvd_ft": 8500
    },
    "last_perforation": {
      "section": 8,
      "township": "15N",
      "range": "11W",
      "formation": "Mississippian",
      "measured_depth_ft": 21000,
      "tvd_ft": 8450
    },
    "total_measured_depth_ft": 21000,
    "lateral_total_length_ft": 9800
  },

  "allocation_factors": [
    {
      "section": 5,
      "township": "15N",
      "range": "11W",
      "county": "Blaine",
      "unit_size_acres": 640,
      "completion_interval_length_ft": 4500,
      "allocation_percentage": 45.92,
      "is_surface_location": true,
      "is_target_section": true,
      "spacing_order_number": "680000"
    },
    {
      "section": 8,
      "township": "15N",
      "range": "11W",
      "county": "Blaine",
      "unit_size_acres": 640,
      "completion_interval_length_ft": 5300,
      "allocation_percentage": 54.08,
      "is_surface_location": false,
      "is_target_section": true,
      "spacing_order_number": "680001",
      "entry_point": {
        "description": "South Line of Section 5/North Line of Section 8",
        "footage_ns": "0' FNL",
        "measured_depth_ft": 15700
      }
    }
  ],

  "related_orders": {
    "references": [
      {
        "order_number": "680000",
        "type": "spacing_order",
        "section": 5,
        "township": "15N",
        "range": "11W",
        "formation": "Mississippian"
      },
      {
        "order_number": "680001",
        "type": "spacing_order",
        "section": 8,
        "township": "15N",
        "range": "11W",
        "formation": "Mississippian"
      }
    ]
  },

  "relief_granted": {
    "reason_summary": "Multiunit well prevents waste and reduces surface disturbance",
    "reservoir_justification": "Mississippian formation extends continuously across both sections"
  },

  "key_takeaway": "Continental Resources authorized to operate the Hansen 5-8H multiunit horizontal well targeting Mississippian across Sections 5 and 8 of T15N-R11W, Blaine County, with production allocated 45.92% to Section 5 and 54.08% to Section 8.",

  "detailed_analysis": "This order authorizes Continental Resources to operate a multiunit horizontal well spanning two 640-acre spacing units in Blaine County. The Hansen 5-8H targets the Mississippian formation with a lateral extending from Section 5 into Section 8.\n\nProduction will be allocated between the sections based on completion interval length. Section 8 receives the larger share (54.08%) with 5,300 feet of lateral, while Section 5 receives 45.92% with 4,500 feet. Total lateral length is 9,800 feet.\n\nMineral owners in either section should verify their division orders reflect the correct allocation percentage. The existing spacing orders (680000 for Section 5, 680001 for Section 8) established the 640-acre units for the Mississippian formation.",

  "field_scores": {
    "order_info": "high",
    "well_authorization": "high",
    "allocation_factors": "high"
  },
  "document_confidence": "high"
}

For UNITIZATION ORDER (OCC order creating an enhanced recovery or secondary recovery unit):
NOTE: Unitization orders create operating units spanning multiple sections/tracts for enhanced recovery operations
(waterflooding, nitrogen injection, pressure maintenance). Each tract has a participation percentage that determines
its share of unit production. These orders often supersede prior spacing orders in the unit area.

CRITICAL - TRACTS EXTRACTION:
- MUST extract ALL tracts with their participation percentages
- These percentages are how mineral owners get paid - missing tracts breaks revenue calculation
- Watch for split tracts (7A, 7B) which represent same acreage split between formation intervals
- Preserve full precision on participation_percent (e.g., 0.99004430, not 0.99)

PROPERTY LINKING:
- Each tract in the tracts[] array links to the document for that legal description
- The sections[] in location provide the overall unit boundary
- Counties array shows all counties the unit spans

{
  "doc_type": "unitization_order",
  "doc_type_display": "Unitization Order",

  "order_info": {
    "cause_number": "CD 2022-002035",
    "order_number": "731833",
    "applicant": "Mack Energy Co.",
    "hearing_date": "2022-12-15",
    "order_date": "2023-01-31",
    "effective_date": "2022-12-15",
    "alj_name": "Michael Norris"
  },

  "unit_info": {
    "unit_name": "Carter Knox Subthrusted Morrow Operating Unit",
    "unit_type": "Enhanced Recovery Unit",
    "unit_subtype": "enhanced_recovery",
    "unit_operator": "Mack Energy Co.",
    "total_acres": 5026,
    "tract_count": 40
  },

  "location": {
    "counties": ["Grady", "Stephens"],
    "state": "Oklahoma",
    "sections": [
      {
        "section": 5,
        "township": "3N",
        "range": "5W",
        "county": "Grady",
        "quarters": "all",
        "acres_in_unit": 378.19
      },
      {
        "section": 6,
        "township": "3N",
        "range": "5W",
        "county": "Grady",
        "quarters": "NW/4 portions",
        "acres_in_unit": 86.22
      },
      {
        "section": 2,
        "township": "2N",
        "range": "5W",
        "county": "Stephens",
        "quarters": "portions",
        "acres_in_unit": 320.00
      }
    ]
  },

  "target_formations": [
    {
      "name": "Subthrusted Morrow",
      "is_primary": true,
      "depth_top_ft": 9900,
      "depth_bottom_ft": 10628,
      "includes": ["Primrose", "1st Repeated Morrow", "2nd Repeated Morrow", "Downthrusted Morrow", "Deep Morrow", "Deep Primrose", "Subthrusted Morrow"]
    }
  ],

  "reference_well": {
    "well_name": "Harrison Deep 1",
    "api_number": "051-22408",
    "section": 28,
    "township": "3N",
    "range": "5W",
    "county": "Grady",
    "quarters": "NE/4 NE/4",
    "depth_interval_top_ft": 9900,
    "depth_interval_bottom_ft": 10628
  },

  "authorized_operations": {
    "primary_recovery": false,
    "secondary_recovery": true,
    "enhanced_recovery": true,
    "injection_wells_permitted": true,
    "specific_methods": ["pressure maintenance", "waterflooding", "cycling", "nitrogen injection"]
  },

  "allocation_formula": {
    "factors": [
      {"factor_name": "Useable Wellbores", "weight_percent": 20},
      {"factor_name": "Remaining Primary (BOE)", "weight_percent": 20},
      {"factor_name": "Surface Acreage", "weight_percent": 20},
      {"factor_name": "Net Acre-Ft", "weight_percent": 20},
      {"factor_name": "Cumulative Production", "weight_percent": 20}
    ],
    "as_of_date": "2021-05-31"
  },

  "tracts": [
    {
      "tract_number": "1",
      "description": "NW4 Section 6-T3N-R5W, save and except 86.22 acres",
      "section": 6,
      "township": "3N",
      "range": "5W",
      "county": "Grady",
      "acres": 86.22,
      "participation_percent": 0.99004430
    },
    {
      "tract_number": "7A",
      "description": "Section 8-T3N-R5W, save and except 581.50 acres, limited to the Repeated Morrow portion",
      "section": 8,
      "township": "3N",
      "range": "5W",
      "county": "Grady",
      "acres": 581.50,
      "participation_percent": 2.66164432,
      "formation_qualifier": "limited to Repeated Morrow portion of the Subthrusted Morrow"
    },
    {
      "tract_number": "7B",
      "description": "Section 8-T3N-R5W, save and except 581.50 acres, Subthrusted Morrow less the Repeated Morrow",
      "section": 8,
      "township": "3N",
      "range": "5W",
      "county": "Grady",
      "acres": 581.50,
      "participation_percent": 6.69121198,
      "formation_qualifier": "Subthrusted Morrow less the Repeated Morrow"
    }
  ],

  "ratification": {
    "lessee_percent": 66.28,
    "owner_percent": 64.97,
    "required_percent": 63,
    "effective_method": "voluntary ratification"
  },

  "related_orders": [
    {"order_number": "163830", "relationship": "supersedes"},
    {"order_number": "270590", "relationship": "supersedes"},
    {"order_number": "307260", "relationship": "supersedes"},
    {"order_number": "439779", "relationship": "supersedes"},
    {"order_number": "431164", "relationship": "supersedes", "description": "modified by Orders Nunc Pro Tunc"},
    {"order_number": "432585", "relationship": "supersedes", "description": "modified by Orders Nunc Pro Tunc"}
  ],

  "exhibits": [
    {"exhibit_letter": "A", "description": "Unit Boundary Map"},
    {"exhibit_letter": "B", "description": "Tracts and Tract Participation Schedule"}
  ],

  "termination_provisions": {
    "lease_extension_days": 90,
    "salvage_period_months": 6,
    "temporarily_abandoned_months": 6
  },

  "parties": {
    "applicant": {
      "name": "Mack Energy Co.",
      "attorneys": ["John Smith", "Jane Doe"]
    },
    "other_parties": [
      {
        "name": "XYZ Oil Company",
        "role": "Working Interest Owner",
        "attorney": "Robert Jones"
      }
    ]
  },

  "commissioners": {
    "chairman": "Dana L. Murphy",
    "vice_chairman": "Bob Anthony",
    "commissioner": "J. Todd Hiett"
  },

  "key_takeaway": "Mack Energy Co. created the Carter Knox Subthrusted Morrow Operating Unit covering 5,026 acres across 40 tracts in Grady and Stephens Counties. If your minerals are in one of the included sections, your share of unit production is determined by your tract's participation percentage shown in Exhibit B. This unit supersedes all prior Morrow spacing orders in the area.",

  "ai_observations": "This is an enhanced recovery unit for the Subthrusted Morrow formation, authorizing nitrogen injection to increase oil and gas recovery. The unit spans two counties and 40 tracts with a sophisticated 5-factor allocation formula.\n\nFor mineral owners: Your participation percentage determines your share of ALL unit production, regardless of which specific well produces it. If you own minerals in Section 8-T3N-R5W, note that tracts 7A and 7B split the same acreage between different Morrow intervals - you may have interests in both.\n\nThe 90-day lease extension provision means if unit operations cease, your lease gets a 90-day extension to allow the lessee to resume operations before the lease terminates.\n\nAll prior Morrow spacing orders in the unit area (over 30 orders listed) are superseded by this unit.",

  "field_scores": {
    "order_info": "high",
    "unit_info": "high",
    "location": "high",
    "target_formations": "high",
    "tracts": "high",
    "allocation_formula": "high"
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

For DEATH CERTIFICATE (establishes date of death, domicile, and surviving family for chain of title):
NOTE: Death certificates are critical for chain of title - they establish:
1. WHEN the person died (triggers inheritance)
2. WHERE they were domiciled (determines which state's intestacy laws apply)
3. WHO survived them (spouse, children, other heirs)

EXTRACTION PRIORITIES:
- MUST extract ALL family members listed anywhere on the certificate
- Generate name variations for title matching (J. Scott Price, Joel S. Price, etc.)
- Identify domicile state clearly - this determines which intestacy laws apply
- Note whether heirship is fully determinable from this certificate alone

SSN HANDLING:
If Social Security Number is visible, extract ONLY the last 4 digits.
Never extract full SSN even if visible. Purpose is matching only.

FAMILY MEMBERS - LOOK IN THESE PLACES:
- Informant section (name + relationship)
- Surviving spouse field
- "Traveling abroad with relatives" (consular reports)
- "Other known relatives" (consular reports)
- Any named individuals with stated relationships

STATE CERTIFICATE EXAMPLE:
{{
  "doc_type": "death_certificate",

  "county": "Oklahoma",
  "state": "Oklahoma",

  "certificate_info": {{
    "state_file_number": "75-012345",
    "local_registrar_number": "1234",
    "certificate_type": "state",
    "issue_date": "1975-07-01",
    "issuing_authority": "Oklahoma State Department of Health",
    "is_certified_copy": true
  }},

  "decedent": {{
    "full_name": "Joel Scott Price",
    "name_suffix": "M.D.",
    "sex": "male",
    "race": "White",
    "date_of_death": "1975-06-14",
    "time_of_death": "14:30",
    "age_at_death_years": 73,
    "date_of_birth": "1901-09-22",
    "birthplace": {{
      "city": "Guthrie",
      "state": "Oklahoma",
      "country": "USA"
    }},
    "ssn_last_four": "1234",
    "occupation": "Surgeon-Physician",
    "industry": "Medical"
  }},

  "death_location": {{
    "facility_name": "Mercy Hospital",
    "facility_type": "hospital",
    "city": "Oklahoma City",
    "county": "Oklahoma",
    "state": "Oklahoma",
    "country": "USA",
    "inside_city_limits": true
  }},

  "residence_at_death": {{
    "street_address": "6801 Country Club Drive",
    "city": "Oklahoma City",
    "county": "Oklahoma",
    "state": "Oklahoma",
    "zip_code": "73116",
    "country": "USA"
  }},

  "marital_status": {{
    "status": "married",
    "surviving_spouse": {{
      "name_on_certificate": "Virginia Reynolds",
      "married_name": "Virginia K. Price",
      "is_surviving": true
    }},
    "years_married": 45
  }},

  "parents": {{
    "father": {{
      "full_name": "Joel Scott Price Sr."
    }},
    "mother": {{
      "full_name": "Rilla Reynolds"
    }}
  }},

  "family_members": [
    {{
      "name": "Virginia K. Price",
      "relationship": "spouse",
      "relationship_source": "stated",
      "address": "6801 Country Club Drive, Oklahoma City, OK 73116",
      "role_on_certificate": "informant"
    }}
  ],

  "cause_of_death": {{
    "immediate_cause": "Myocardial infarction",
    "contributing_causes": ["Arteriosclerotic heart disease"],
    "manner": "natural",
    "autopsy_performed": false
  }},

  "disposition": {{
    "method": "burial",
    "date": "1975-06-17",
    "cemetery_name": "Rose Hill Cemetery",
    "cemetery_location": "Oklahoma City, Oklahoma",
    "funeral_home": "Hahn-Cook Funeral Home",
    "funeral_director": "Robert Cook"
  }},

  "certification": {{
    "certifier_name": "Dr. James Wilson",
    "certifier_title": "M.D.",
    "certifier_type": "attending_physician",
    "date_signed": "1975-06-14"
  }},

  "chain_of_title": {{
    "decedent_name_as_owner": "Joel Scott Price",
    "name_variations": ["J. Scott Price", "Joel S. Price", "Dr. Joel Price", "Joel Scott Price, M.D."],
    "domicile_state": "Oklahoma",
    "domicile_county": "Oklahoma",
    "has_surviving_spouse": true,
    "surviving_spouse_name": "Virginia K. Price",
    "children_identified": false,
    "children_names": [],
    "other_potential_heirs": ["Joel Scott Price Sr. (father)", "Rilla Reynolds (mother)"],
    "heir_identification_completeness": "partial"
  }},

  "related_documents": {{
    "expected_companion_documents": ["affidavit_of_heirship", "probate_order"],
    "notes": "Certificate does not list children. Affidavit of heirship or probate records needed to identify complete heir list."
  }},

  "key_takeaway": "Dr. Joel Scott Price died June 14, 1975 in Oklahoma City, survived by wife Virginia K. Price; domiciled in Oklahoma County, Oklahoma.",

  "detailed_analysis": "Dr. Joel Scott Price died on June 14, 1975 at Mercy Hospital in Oklahoma City, Oklahoma at age 73. He was a surgeon-physician who resided at 6801 Country Club Drive, Oklahoma City, Oklahoma County, Oklahoma.\n\nAt the time of death, he was married to Virginia K. Price (née Reynolds). His parents were Joel Scott Price Sr. and Rilla Reynolds. The informant on the certificate was Mrs. Joel Scott Price at the residence address.\n\nFor mineral title purposes, Dr. Price was domiciled in Oklahoma, meaning Oklahoma intestacy and probate law governs the distribution of his mineral interests. As a married decedent, his surviving spouse Virginia K. Price would have inheritance rights under Oklahoma law. An affidavit of heirship or probate records would be needed to establish the complete chain of title from Dr. Price to his heirs.",

  "field_scores": {{
    "decedent_identity": "high",
    "death_date": "high",
    "residence": "high",
    "marital_status": "high",
    "family_members": "medium"
  }},
  "document_confidence": "high"
}}

CONSULAR REPORT EXAMPLE (death abroad):
{{
  "doc_type": "death_certificate",

  "county": "Oklahoma",
  "state": "Oklahoma",

  "certificate_info": {{
    "state_file_number": null,
    "local_registrar_number": null,
    "certificate_type": "consular_report",
    "issue_date": "1979-09-05",
    "issuing_authority": "U.S. Department of State",
    "is_certified_copy": true
  }},

  "decedent": {{
    "full_name": "Robert Allison Price",
    "name_suffix": null,
    "sex": "male",
    "race": "White",
    "date_of_death": "1979-08-15",
    "time_of_death": null,
    "age_at_death_years": 42,
    "date_of_birth": "1937-04-07",
    "birthplace": {{
      "city": "Oklahoma City",
      "state": "Oklahoma",
      "country": "USA"
    }},
    "ssn_last_four": "3459",
    "occupation": "Attorney",
    "industry": "Legal"
  }},

  "death_location": {{
    "facility_name": null,
    "facility_type": "foreign",
    "city": "Sirdal",
    "county": null,
    "state": "Vest-Agder",
    "country": "Norway",
    "inside_city_limits": null
  }},

  "residence_at_death": {{
    "street_address": "1104 First National Center",
    "city": "Oklahoma City",
    "county": "Oklahoma",
    "state": "Oklahoma",
    "zip_code": "73102",
    "country": "USA"
  }},

  "marital_status": {{
    "status": "married",
    "surviving_spouse": {{
      "name_on_certificate": "Gudbjorg D. Price",
      "married_name": "Gudbjorg D. Price",
      "is_surviving": true
    }},
    "years_married": null
  }},

  "parents": {{
    "father": {{
      "full_name": "Joel Scott Price"
    }},
    "mother": {{
      "full_name": "Virginia K. Price"
    }}
  }},

  "family_members": [
    {{
      "name": "Gudbjorg D. Price",
      "relationship": "spouse",
      "relationship_source": "stated",
      "address": null,
      "role_on_certificate": "next_of_kin"
    }},
    {{
      "name": "Siri M. Price",
      "relationship": "daughter",
      "relationship_source": "stated",
      "address": null,
      "role_on_certificate": "traveling_companion"
    }},
    {{
      "name": "Eirik S. Price",
      "relationship": "son",
      "relationship_source": "stated",
      "address": null,
      "role_on_certificate": "traveling_companion"
    }},
    {{
      "name": "Virginia K. Price",
      "relationship": "mother",
      "relationship_source": "stated",
      "address": "6801 Country Club Drive, Oklahoma City, OK",
      "role_on_certificate": "other_known_relative"
    }},
    {{
      "name": "William Scott Price",
      "relationship": "brother",
      "relationship_source": "stated",
      "address": null,
      "role_on_certificate": "other_known_relative"
    }},
    {{
      "name": "Montine Price Tyree",
      "relationship": "sister",
      "relationship_source": "stated",
      "address": null,
      "role_on_certificate": "other_known_relative"
    }}
  ],

  "cause_of_death": {{
    "immediate_cause": "Accidental drowning",
    "contributing_causes": [],
    "manner": "accident",
    "autopsy_performed": true
  }},

  "disposition": {{
    "method": "removal",
    "date": "1979-08-20",
    "cemetery_name": null,
    "cemetery_location": null,
    "funeral_home": null,
    "funeral_director": null
  }},

  "certification": {{
    "certifier_name": "George S. Vest",
    "certifier_title": "Consul of the United States of America",
    "certifier_type": "consul",
    "date_signed": "1979-09-05"
  }},

  "consular_info": {{
    "embassy_location": "Oslo, Norway",
    "consul_name": "George S. Vest",
    "report_date": "1979-09-05",
    "passport_number": "Z1234567",
    "passport_issue_location": "Oklahoma City"
  }},

  "chain_of_title": {{
    "decedent_name_as_owner": "Robert Allison Price",
    "name_variations": ["Robert A. Price", "R. Allison Price", "R.A. Price"],
    "domicile_state": "Oklahoma",
    "domicile_county": "Oklahoma",
    "has_surviving_spouse": true,
    "surviving_spouse_name": "Gudbjorg D. Price",
    "children_identified": true,
    "children_names": ["Siri M. Price", "Eirik S. Price"],
    "other_potential_heirs": ["Virginia K. Price (mother)", "William Scott Price (brother)", "Montine Price Tyree (sister)"],
    "heir_identification_completeness": "partial"
  }},

  "related_documents": {{
    "expected_companion_documents": ["affidavit_of_heirship", "probate_order", "will"],
    "notes": "Consular report lists children and other relatives. Probate records would confirm complete distribution of estate."
  }},

  "key_takeaway": "Robert Allison Price died August 15, 1979 in Sirdal, Norway at age 42, survived by wife Gudbjorg D. Price and children Siri and Eirik; domiciled in Oklahoma City, Oklahoma.",

  "detailed_analysis": "Robert Allison Price, an attorney, died on August 15, 1979 in Sirdal, Norway at age 42 due to accidental drowning. Although he died abroad, his permanent residence was 1104 First National Center, Oklahoma City, Oklahoma County, Oklahoma.\n\nThe consular report identifies his surviving family: wife Gudbjorg D. Price, daughter Siri M. Price, and son Eirik S. Price (listed as traveling companions). The report also lists other known relatives: mother Virginia K. Price, brother William Scott Price, and sister Montine Price Tyree.\n\nFor mineral title purposes, Robert was domiciled in Oklahoma despite dying in Norway. Oklahoma intestacy and probate law governs his estate. His surviving spouse and two children are the primary heirs. The presence of identified children simplifies the heirship determination compared to cases where children must be discovered through other means.\n\nTo complete the chain of title, an affidavit of heirship or Oklahoma probate records should be obtained showing the actual distribution of his mineral interests to his heirs.",

  "field_scores": {{
    "decedent_identity": "high",
    "death_date": "high",
    "residence": "high",
    "marital_status": "high",
    "family_members": "high"
  }},
  "document_confidence": "high"
}}

For TRUST FUNDING documents (assignment of property from individual to their trust):
NOTE: Analyze this document as a title attorney would when building a chain of title for a client.
This document transfers ownership from an individual to a trust where the individual is typically the trustee.
The same person often appears in BOTH roles - as assignor (individual) AND as assignee (trustee).

SAME PARTY DIFFERENT CAPACITIES:
- When the same person signs as both assignor AND trustee/assignee, create SEPARATE party objects
- Individual capacity and trustee capacity have different legal significance
- Extract both roles even when names match

BLANKET VS SPECIFIC COVERAGE:
- Some trust fundings transfer "all property" (blanket) vs specific enumerated properties
- Check for language like "all my interest in any and all oil, gas, and minerals"
- Flag future-acquired property language ("now owned or hereafter acquired")

HANDWRITTEN ANNOTATIONS:
- Trust documents often have handwritten notes identifying specific properties
- Capture these with source: "handwritten" to distinguish from printed content

PROPERTY LINKING:
- Even for blanket assignments, include top-level section/township/range/county if any specific property is mentioned
- This enables linking to known properties in the system

{{
  "doc_type": "trust_funding",

  "assignor": {{
    "name": "REQUIRED - Virginia K. Price (now Giles)",
    "address": "6801 N. Country Club Drive, Oklahoma City, Oklahoma 73116",
    "capacity": "Individual",
    "signatory": "same as name unless signed by attorney-in-fact"
  }},

  "assignee": {{
    "name": "REQUIRED - Virginia K. Price (now Giles)",
    "capacity": "Trustee",
    "trust_name": "REQUIRED - Virginia K. Price Trust",
    "trust_date": "1967-12-27",
    "address": "6801 N. Country Club Drive, Oklahoma City, Oklahoma 73116"
  }},

  "execution_date": "REQUIRED - 1991-02-20",

  "recording_info": {{
    "book": "L-350",
    "page": "125",
    "instrument_number": "1991-12345",
    "recording_date": "1991-03-05",
    "county": "Oklahoma",
    "state": "Oklahoma"
  }},

  "consideration": {{
    "stated": "$10.00 and other good and valuable consideration",
    "type": "nominal",
    "amount": null,
    "per_acre": null
  }},

  "is_blanket_assignment": true,
  "includes_future_acquired": true,
  "includes_mineral_interests": true,

  "property_categories": {{
    "personal_effects": true,
    "household_goods": true,
    "financial_accounts": true,
    "real_property": false,
    "mineral_interests": true,
    "vehicles": false,
    "other_property": true
  }},

  "mineral_interests": {{
    "description": "All oil, gas and other minerals, producing or non-producing, whether presently owned or hereafter acquired",
    "types_included": ["royalty", "working_interest", "mineral_interest", "overriding_royalty"],
    "geographic_scope": "State of Oklahoma and elsewhere",
    "depth_limitation": null,
    "formation_limitation": null
  }},

  "section": "extract from first specific property if any, otherwise null",
  "township": "extract from first specific property if any, otherwise null",
  "range": "extract from first specific property if any, otherwise null",
  "county": "extract from recording_info.county if no specific property",
  "state": "Oklahoma",

  "specific_properties": [
    {{
      "property_name": "La Fortuna",
      "source": "handwritten",
      "legal_description": {{
        "section": 14,
        "township": "9N",
        "range": "4W",
        "county": "Grady",
        "state": "Oklahoma",
        "quarters": null,
        "full_description": null
      }},
      "interest_type": null,
      "notes": "Handwritten annotation on page 2 - appears to reference Florida real estate"
    }}
  ],

  "acceptance": {{
    "trustee_accepted": true,
    "acceptance_date": "1991-02-20",
    "accepted_by": "Virginia K. Price (now Giles)",
    "capacity": "Trustee"
  }},

  "notarization": {{
    "notary_name": "Jane Doe",
    "notary_date": "1991-02-20",
    "notary_county": "Oklahoma",
    "notary_state": "Oklahoma",
    "commission_expires": "1993-12-31"
  }},

  "witnesses": [
    {{
      "name": "John Smith",
      "address": null
    }}
  ],

  "notes": "Any additional information not captured elsewhere",

  "key_takeaway": "REQUIRED - One sentence: [Assignor name] transferred [blanket/specific] property interests to the [Trust Name], including mineral interests. This is an estate planning document that moves ownership from individual to trust.",

  "detailed_analysis": "REQUIRED - 3-4 paragraphs covering: (1) parties - note when same person appears in multiple capacities; (2) scope of assignment - blanket vs specific, what property types are included; (3) mineral interest implications - does this affect mineral ownership, which states/counties; (4) chain of title significance - this document is the link between individual ownership and trust ownership for any properties the assignor held at execution date (and after, if includes_future_acquired is true).",

  "field_scores": {{
    "assignor_name": 1.0,
    "assignee_name": 1.0,
    "trust_name": 1.0,
    "trust_date": 0.95,
    "execution_date": 1.0,
    "is_blanket_assignment": 0.95,
    "includes_mineral_interests": 0.95,
    "specific_properties": 0.80,
    "acceptance": 0.90
  }},
  "document_confidence": "high"
}}

PARTY FIELDS (trust funding specific):
- assignor.name: REQUIRED - individual transferring property, exactly as written
- assignor.capacity: Always "Individual" for trust funding documents
- assignee.name: REQUIRED - same person but in trustee capacity
- assignee.capacity: Always "Trustee"
- assignee.trust_name: REQUIRED - full name of the trust
- assignee.trust_date: Date the trust was created (often in trust name)

BLANKET ASSIGNMENT FLAGS:
- is_blanket_assignment: true if document transfers "all property" or categories of property
- includes_future_acquired: true if "now owned or hereafter acquired" language present
- includes_mineral_interests: true if minerals are explicitly or implicitly included

PROPERTY CATEGORIES (set each to true/false):
- personal_effects, household_goods, financial_accounts, real_property, mineral_interests, vehicles, other_property

SPECIFIC PROPERTIES:
- If blanket, this may be empty []
- Include any properties mentioned by name or legal description
- Mark source as "printed" or "handwritten"
- Handwritten notes often identify specific properties affected

CONSIDERATION TYPES:
| Value | Meaning |
| nominal | Token amount + "other consideration" - common for trust funding |
| gift | Love and affection - family transfer |
| specific | Exact dollar amount stated |
| not_stated | No consideration clause |

ACCEPTANCE:
- Many trust funding documents have a trustee acceptance section
- Extract if present, note if acceptance is missing

CHAIN OF TITLE LINKING:
- For blanket assignments: Link to ALL grantor's properties as of execution_date
- For blanket + future_acquired: Flag for ongoing linkage to newly acquired properties
- For specific only: Link only to enumerated properties

For LIMITED PARTNERSHIP (Certificate of Limited Partnership or LP Agreement):
NOTE: This is an entity formation document critical for chain of title.
The partnership structure determines how mineral interests are owned and what happens on death/transfer.

EXTRACTION PRIORITY:
1. Entity name and formation date - links to all documents naming this entity
2. ALL partners with their percentages - determines ownership allocation
3. Succession provisions - what happens when a partner dies
4. Assignment restrictions - can interests be transferred

SAME PARTY DIFFERENT CAPACITIES:
- One person may appear multiple times (e.g., as individual AND as custodian for minors)
- Extract each appearance as a SEPARATE partner entry
- Include `custodian_for` field when acting as custodian

{{
  "doc_type": "limited_partnership",

  "entity_info": {{
    "name": "REQUIRED - Price Oil and Gas Company",
    "formation_date": "REQUIRED - 1980-01-20",
    "governing_law": "Oklahoma Uniform Limited Partnership Act, Title 54 O.S. 1971 § 141",
    "jurisdiction": "Oklahoma"
  }},

  "term": {{
    "duration_type": "fixed",
    "years": 50,
    "expiration_date": "2030-01-20",
    "termination_events": ["majority of General Partners vote to terminate", "expiration of term"]
  }},

  "principal_office": {{
    "address": "6801 North Country Club Drive",
    "city": "Oklahoma City",
    "state": "Oklahoma",
    "zip": "73116"
  }},

  "general_partners": [
    {{
      "name": "REQUIRED - Montine Price Foerster Sprehe",
      "address": "7520 Nichols Road, Oklahoma City, Oklahoma 73120",
      "capacity": "Individual",
      "interest_fraction": "25%",
      "interest_decimal": 0.25,
      "capital_contribution": "$1,666.67"
    }}
  ],

  "limited_partners": [
    {{
      "name": "REQUIRED - Gudbjorg Price",
      "address": "1416 Brighton, Oklahoma City, Oklahoma 73120",
      "capacity": "Individual",
      "custodian_for": null,
      "interest_fraction": "8-1/3%",
      "interest_decimal": 0.083333,
      "capital_contribution": "$555.56"
    }},
    {{
      "name": "Gudbjorg Price",
      "address": "1416 Brighton, Oklahoma City, Oklahoma 73120",
      "capacity": "Custodian",
      "custodian_for": "Siri Montine Price",
      "interest_fraction": "8-1/3%",
      "interest_decimal": 0.083333,
      "capital_contribution": "$555.56"
    }}
  ],

  "business_purpose": {{
    "stated_purpose": "ownership of real property, including oil and gas royalties and leasehold estates, the conduct of farming operations, the exploration and exploitation of oil and gas properties, and the owning and holding of other types of investment",
    "includes_mineral_interests": true,
    "includes_oil_gas_operations": true,
    "includes_real_property": true,
    "purpose_categories": ["mineral_interests", "royalties", "working_interests", "leasehold", "farming", "real_property", "investments"]
  }},

  "contribution_provisions": {{
    "types_accepted": ["cash", "accounts_receivable", "mineral_interests", "royalty_interests", "working_interests", "oil_gas_ventures", "personal_property", "real_property"],
    "additional_contributions_required": false,
    "return_of_contributions_guaranteed": false
  }},

  "distribution_provisions": {{
    "method": "per_interest",
    "in_kind_allowed": false,
    "description": "Profits distributed per contribution percentages. LPs can only receive cash unless proportionate distribution to all partners."
  }},

  "management_provisions": {{
    "gp_voting": "equal_voice",
    "gp_voting_description": "All General Partners have equal voice regardless of contribution amounts",
    "majority_binds_all": true,
    "if_two_gps_both_required": true,
    "lp_can_participate_in_management": false,
    "lp_inspection_rights": true,
    "gp_compensation_allowed": true,
    "gp_expense_reimbursement": true
  }},

  "assignment_provisions": {{
    "lp_can_assign": true,
    "assignment_to_existing_partners": true,
    "assignment_to_third_parties": true,
    "third_party_requires_gp_approval": true,
    "new_lp_admission_requires_gp_consent": true,
    "family_relationship_required": true,
    "family_relationship_type": "blood or marriage to a General Partner"
  }},

  "succession_provisions": {{
    "survives_death_of_gp": true,
    "survives_retirement_of_gp": true,
    "survives_insanity_of_gp": true,
    "on_death_interest_descends_to_heirs": true,
    "gp_interest_converts_to_lp_on_death": true,
    "conversion_description": "The interest of any General Partner passing to a legatee or other beneficiary shall automatically become a Limited Partnership interest"
  }},

  "liability_provisions": {{
    "lp_liability_limited_to_contribution": true,
    "gp_liability_unlimited": true
  }},

  "dissolution_provisions": {{
    "triggers": ["expiration of term", "agreement of majority of General Partners"],
    "liquidation_priority": ["liabilities and obligations to creditors", "remaining assets to partners per capital accounts"]
  }},

  "recording_info": {{
    "recorded": false,
    "book": null,
    "page": null,
    "instrument_number": null,
    "recording_date": null,
    "county": null,
    "state": null
  }},

  "execution_info": {{
    "execution_date": "1980-01-20",
    "notarized": true,
    "notary_date": "1980-04-23",
    "notary_county": "Oklahoma",
    "notary_state": "Oklahoma",
    "notary_commission_expires": "1980-05-03"
  }},

  "county": "Oklahoma",
  "state": "Oklahoma",

  "key_takeaway": "REQUIRED - One sentence: Price Oil and Gas Company is an Oklahoma limited partnership formed January 20, 1980 with a 50-year term, owned 75% by three General Partners (Montine Price Foerster Sprehe, Kelsey Price Walters, William S. Price) and 25% by Limited Partners, with GP interests converting to LP interests upon death.",

  "detailed_analysis": "REQUIRED - 3-4 paragraphs covering: (1) entity structure - who are the partners and what are their percentages; (2) management - how decisions are made, LP restrictions; (3) succession - critical: what happens when partners die, especially the GP-to-LP conversion; (4) assignment restrictions - family-only new LPs, GP approval required.",

  "field_scores": {{
    "entity_info": 1.0,
    "formation_date": 1.0,
    "general_partners": 1.0,
    "limited_partners": 1.0,
    "term": 0.95,
    "succession_provisions": 1.0,
    "assignment_provisions": 0.95
  }},
  "document_confidence": "high"
}}

PARTNER INTEREST EXTRACTION:
- MUST include both `interest_fraction` (as stated: "25%", "8-1/3%") and `interest_decimal` (computed: 0.25, 0.083333)
- Common fractions: 1/3 = 0.333333, 1/4 = 0.25, 8-1/3% = 0.083333, 16-2/3% = 0.166667
- Preserve full decimal precision
- Include `capital_contribution` if stated in the document

SAME PARTY DIFFERENT CAPACITIES:
- If Gudbjorg Price appears as Individual AND as Custodian for two minors, create THREE separate entries
- Set `capacity` to "Individual" or "Custodian"
- Set `custodian_for` to the minor's name when acting as custodian

SUCCESSION PROVISIONS - CRITICAL:
- `gp_interest_converts_to_lp_on_death`: Does a GP interest become an LP interest when inherited? This is crucial for control vs ownership.
- `on_death_interest_descends_to_heirs`: Does interest pass by will/intestacy?
- `survives_death_of_gp`: Does the partnership continue when a GP dies?

CHAIN OF TITLE LINKING:
- Entity documents don't have section/township/range
- Link by entity name matching to division orders, deeds, leases
- Partner names link to individual deeds/conveyances

For ASSIGNMENT OF LEASE (Assignment of Oil and Gas Lease, Partial Assignment, Assignment of Operating Rights):
NOTE: This document transfers a lessee's working interest/operating rights to a new party.
Critical for chain of title - determines who currently holds the lease.

Core Question: "Who now holds the operating rights to this lease, and what did they acquire?"

EXTRACTION PRIORITY:
1. Assignor(s) and Assignee(s) - who transferred to whom
2. Interest assigned - all, partial, depth-limited
3. Underlying lease - original lessor/lessee, date, recording
4. Retained interests - did assignor keep an ORRI?
5. Legal description for property linking

{{
  "doc_type": "assignment_of_lease",

  "section": "REQUIRED - integer for property linking",
  "township": "REQUIRED - string with direction (e.g., '15N')",
  "range": "REQUIRED - string with direction (e.g., '12W')",
  "county": "REQUIRED - string",
  "state": "Oklahoma",

  "assignors": [
    {{
      "name": "REQUIRED - Montine Price Foerster Sprehe",
      "address": "7520 Nichols Road, Oklahoma City, Oklahoma",
      "capacity": "Individual",
      "entity_name": null,
      "entity_type": null
    }},
    {{
      "name": "Kelsey Price Walters",
      "address": "same capacity pattern",
      "capacity": "Individual"
    }}
  ],

  "assignees": [
    {{
      "name": "REQUIRED - Robert A. Price",
      "address": "1416 Brighton Ave, Oklahoma City, Oklahoma",
      "capacity": "Individual",
      "interest_share": {{
        "fraction": "ALL",
        "decimal": 1.0
      }}
    }}
  ],

  "interest_assigned": {{
    "type": "all | partial | undivided",
    "fraction": "ALL",
    "decimal": 1.0,
    "description": "all of Assignors' right, title and interest in and to the within described lease",
    "depths": null,
    "formations": null,
    "acres": 20.0
  }},

  "retained_interests": {{
    "has_retained_interest": false
  }},

  "subject_to": {{
    "has_subject_to_clause": true,
    "existing_royalties": true,
    "existing_overrides": false,
    "existing_burdens": ["Lessor's 1/8 royalty"],
    "burdens_description": "subject to the terms of said lease and the royalty reserved therein"
  }},

  "proportionate_reduction": {{
    "has_clause": false
  }},

  "underlying_lease": {{
    "lease_date": "REQUIRED - 1974-03-04",
    "lessor": {{
      "name": "REQUIRED - Joel S. Price and Virginia K. Price, as Trustee",
      "capacity": "Individual and Trustee"
    }},
    "original_lessee": {{
      "name": "REQUIRED - Robert A. Price"
    }},
    "recording_info": {{
      "book": "456",
      "page": "123",
      "instrument_number": null,
      "recording_date": "1974-03-10",
      "county": "Blaine"
    }},
    "lease_description": "Oil and Gas Lease covering 20 acres in SE/4"
  }},

  "legal_description": {{
    "section": 27,
    "township": "15N",
    "range": "12W",
    "meridian": "IM",
    "county": "Blaine",
    "state": "Oklahoma",
    "quarters": "SE/4",
    "gross_acres": 160,
    "net_acres": 20,
    "description_verbatim": "An undivided 20 acres in the SE/4 of Section 27, Township 15 North, Range 12 West, I.M., Blaine County, Oklahoma"
  }},

  "consideration": {{
    "stated": "REQUIRED - One Dollar ($1.00) and other good and valuable consideration",
    "amount": 1.00,
    "is_nominal": true
  }},

  "warranties": {{
    "has_warranty": true,
    "warranty_type": "general | special | quitclaim | none",
    "covenants": ["lawful owners", "good title", "free of encumbrances", "warrant and defend"],
    "warranty_language": "Assignors covenant they are the lawful owners with good title, free and clear of all encumbrances, and will warrant and forever defend"
  }},

  "execution_info": {{
    "execution_date": "REQUIRED - 1974-09-27",
    "effective_date": null,
    "execution_location": "Oklahoma County, Oklahoma",
    "notarized": true,
    "notary_name": "Jane Smith",
    "notary_county": "Oklahoma",
    "notary_commission_expires": "1976-05-15",
    "witnesses": []
  }},

  "recording_info": {{
    "recorded": true,
    "book": "789",
    "page": "456",
    "instrument_number": null,
    "recording_date": "1974-10-05",
    "county": "Blaine",
    "state": "Oklahoma",
    "fee": "$3.00"
  }},

  "annotations": {{
    "has_annotations": true,
    "handwritten_notes": [
      {{
        "content": "DRY HOLE",
        "location": "top margin",
        "significance": "Well drilled under this lease was non-productive"
      }}
    ],
    "stamps": ["FILED Oct 5 1974"],
    "marginal_notes": []
  }},

  "key_takeaway": "REQUIRED - Assignment from Price family members to Robert A. Price of 20-acre leasehold interest in Section 27-15N-12W, Blaine County.",

  "detailed_analysis": "REQUIRED - 2-4 paragraphs covering: (1) who assigned what to whom; (2) underlying lease details; (3) consideration type; (4) chain of title significance.",

  "field_scores": {{
    "assignors": 1.0,
    "assignees": 1.0,
    "interest_assigned": 0.95,
    "underlying_lease": 0.90,
    "legal_description": 1.0,
    "consideration": 0.95,
    "warranties": 0.90,
    "execution_info": 1.0
  }},
  "document_confidence": "high"
}}

RETAINED INTERESTS - CRITICAL:
- `has_retained_interest`: MUST be explicitly true or false, never omitted
- If assignor keeps an overriding royalty (ORRI), capture fraction AND decimal
- `payable_out_of`: "working_interest" or "gross_production" (8/8) - affects calculation

RETAINED ORRI EXAMPLE:
{{
  "retained_interests": {{
    "has_retained_interest": true,
    "overriding_royalty": {{
      "fraction": "1/16 of 8/8",
      "decimal": 0.0625,
      "payable_out_of": "gross_production"
    }},
    "description": "Assignor reserves an overriding royalty of 1/16 of 8/8"
  }}
}}

SUBJECT TO CLAUSE:
- Captures existing burdens the interest is subject to
- Common: lessor's royalty, existing ORRIs

PARTIAL/DEPTH-LIMITED ASSIGNMENT:
{{
  "interest_assigned": {{
    "type": "partial",
    "fraction": "ALL",
    "decimal": 1.0,
    "description": "all interest from surface to 100 feet below the Hunton",
    "depths": "surface to 100' below Hunton",
    "formations": ["Hunton", "all formations above"]
  }}
}}

WARRANTY TYPE DETECTION:
| Keywords | warranty_type |
| "warrant and defend", "good title", "lawful owner" | general |
| "by, through, or under grantor only" | special |
| "quitclaim", "remise, release", "without warranty" | quitclaim |
| No warranty language | none |

SAME PARTY DIFFERENT CAPACITIES:
- If Virginia K. Price assigns as Individual AND as Trustee, create TWO assignor entries
- Capture entity_name and entity_type for trustee/entity capacities

For QUIT CLAIM DEED (Quitclaim Deed, Correction Quit Claim Deed):
NOTE: This document transfers whatever interest the grantor may have WITHOUT WARRANTY.
The grantor makes NO PROMISES about whether they actually own anything.

Core Question: "What interest (if any) was transferred, and why was a quit claim used instead of a warranty deed?"

COMMON USES:
- Trust funding (individual → their own trust)
- Clearing cloud on title (possible claimant releases any interest)
- Divorce transfers (spouse → ex-spouse)
- Correction of prior erroneous deed
- Family gifts/transfers
- Estate distribution (heir → heir to consolidate)

EXTRACTION PRIORITY:
1. Is this a CORRECTION deed? (critical classification)
2. Grantors and Grantees with capacities (same person may appear in both as different capacity)
3. Interest conveyed - all, partial, mineral only
4. Legal description for property linking
5. If correction: what prior document is being corrected and why

{{
  "doc_type": "quit_claim_deed",

  "section": "REQUIRED - integer for property linking",
  "township": "REQUIRED - string with direction (e.g., '15N')",
  "range": "REQUIRED - string with direction (e.g., '12W')",
  "county": "REQUIRED - string",
  "state": "Oklahoma",

  "deed_classification": {{
    "is_correction_deed": "REQUIRED - boolean - explicitly true or false",
    "correction_info": {{
      "corrects_document": {{
        "doc_type": "quit_claim_deed",
        "recording_reference": "Book 615, Page 2",
        "recording_date": "1991-03-28",
        "original_grantor": "Virginia K. Price (now Giles)",
        "original_grantee": "Virginia K. Price (now Giles), Trustee of the Virginia K. Price Trust"
      }},
      "reason_for_correction": "REQUIRED if is_correction_deed - The deed was filed in error. Grantor had no interest to convey.",
      "what_was_wrong": "Grantor had no individual interest - the mineral interest was already conveyed by the Trust"
    }}
  }},

  "grantors": [
    {{
      "name": "REQUIRED - Virginia K. Price (now Giles)",
      "name_variations": ["Virginia K. Price", "Virginia K. Giles", "Virginia K. Price Giles"],
      "marital_status": "Widow",
      "address": "123 Main St",
      "city": "Oklahoma City",
      "state": "Oklahoma",
      "capacity": "Individual | Trustee | Successor Trustee | Personal Representative | Executor | Administrator | Attorney-in-Fact | Guardian | Entity",
      "entity_name": null,
      "entity_type": null,
      "trust_date": null
    }}
  ],

  "grantees": [
    {{
      "name": "REQUIRED - Virginia K. Price (now Giles)",
      "address": "123 Main St",
      "city": "Oklahoma City",
      "state": "Oklahoma",
      "capacity": "Trustee",
      "entity_name": "Virginia K. Price Trust",
      "entity_type": "Trust",
      "trust_date": "1967-12-27",
      "tenancy": null
    }}
  ],

  "interest_conveyed": {{
    "type": "all | partial | undivided | specific",
    "fraction": "ALL",
    "decimal": 1.0,
    "interest_description": "all of her right, title and interest in and to the oil, gas, and other minerals",
    "mineral_surface": "mineral | surface | both | not_specified",
    "depths": null,
    "formations": null
  }},

  "legal_description": {{
    "section": 27,
    "township": "15N",
    "range": "12W",
    "meridian": "IM",
    "county": "Blaine",
    "state": "Oklahoma",
    "quarters": "SE/4",
    "gross_acres": 160,
    "net_acres": 20,
    "description_verbatim": "The SE/4 of Section 27, Township 15 North, Range 12 West, I.M., Blaine County, Oklahoma"
  }},

  "consideration": {{
    "stated": "REQUIRED - One Dollar ($1.00) and other good and valuable consideration",
    "amount": 1.00,
    "is_nominal": true,
    "stamps_required": false,
    "stamps_amount": null
  }},

  "granting_clause": {{
    "granting_words": "quitclaim, grant, bargain",
    "habendum": "to have and to hold",
    "purpose_stated": "for estate planning purposes"
  }},

  "warranties": {{
    "has_warranty": false,
    "warranty_type": "quitclaim | none",
    "warranty_language": "without warranty"
  }},

  "reservations_exceptions": {{
    "has_reservations": false,
    "reserved_interests": [],
    "exceptions": [],
    "subject_to": ["existing oil and gas leases"]
  }},

  "execution_info": {{
    "execution_date": "REQUIRED - 1991-03-18",
    "effective_date": null,
    "execution_location": "Oklahoma County, Oklahoma",
    "notarized": true,
    "notary_name": "Jane Smith",
    "notary_county": "Oklahoma",
    "notary_state": "Oklahoma",
    "notary_commission_expires": "1993-05-15",
    "witnesses": []
  }},

  "recording_info": {{
    "recorded": true,
    "book": "615",
    "page": "2",
    "instrument_number": null,
    "recording_date": "1991-03-28",
    "filing_date": null,
    "county": "Blaine",
    "state": "Oklahoma",
    "fee": "$5.00",
    "clerk_name": null,
    "deputy_name": null
  }},

  "return_to": {{
    "name": "Price Oil and Gas Company",
    "address": "123 Oil Street",
    "city": "Oklahoma City",
    "state": "Oklahoma",
    "zip": "73102"
  }},

  "chain_of_title_links": {{
    "grantor_entities": ["Virginia K. Price", "Virginia K. Giles", "Virginia K. Price (now Giles)"],
    "grantee_entities": ["Virginia K. Price Trust", "Virginia K. Price (now Giles), Trustee"],
    "prior_documents": [
      {{
        "doc_type": "mineral_deed",
        "description": "Deed from Joel S. Price to Virginia K. Price",
        "recording_reference": "Book 500, Page 100",
        "relationship": "source_of_title"
      }}
    ],
    "subsequent_documents": []
  }},

  "annotations": {{
    "has_annotations": true,
    "handwritten_notes": [
      {{
        "content": "Didn't have anything to give",
        "location": "middle of page, over legal description",
        "significance": "Researcher noted grantor had no actual interest"
      }},
      {{
        "content": "VKP nothing - written a correction deed",
        "location": "margin",
        "significance": "Notes that correction deed was filed"
      }}
    ],
    "stamps": ["FILED Mar 28 1991", "COPY stamp at top"],
    "marginal_notes": []
  }},

  // IMPORTANT: stamps must be a JSON array of properly quoted strings
  // CORRECT: ["FILED Mar 28 1991", "COPY stamp at top"]
  // WRONG: ["COPY" stamp at top] - this is invalid JSON

  "key_takeaway": "REQUIRED - Quit claim deed from Virginia K. Price (now Giles) to herself as Trustee of the Virginia K. Price Trust for trust funding purposes.",

  "detailed_analysis": "REQUIRED - 2-4 paragraphs covering: (1) who conveyed to whom and in what capacities; (2) what interest was conveyed; (3) why a quit claim was used (trust funding, correction, etc.); (4) chain of title significance; (5) if correction deed, explain what error is being fixed.",

  "field_scores": {{
    "grantors": 1.0,
    "grantees": 1.0,
    "deed_classification": 1.0,
    "interest_conveyed": 0.95,
    "legal_description": 1.0,
    "consideration": 0.95,
    "execution_info": 1.0
  }},
  "document_confidence": "high"
}}

CORRECTION DEED DETECTION:
- Look for "Correction", "Corrective", "Corrected" in title
- Look for language: "to correct", "filed in error", "erroneously filed"
- If is_correction_deed is true, correction_info MUST be populated

SAME PARTY DIFFERENT CAPACITIES (Trust Funding Pattern):
- Same person as grantor (Individual) AND grantee (Trustee) = trust funding
- Example: Virginia K. Price (Individual) → Virginia K. Price (Trustee of VKP Trust)
- This is NOT a sale - it's an estate planning transaction

NAME VARIATIONS:
- Capture all: maiden names, "now known as", "formerly", "aka", etc.
- Example: "Virginia K. Price (now Giles)" = ["Virginia K. Price", "Virginia K. Giles"]

INTEREST TYPE CLASSIFICATION:
| Type | When to Use |
| all | "All right, title and interest" |
| partial | Fractional interest (1/4, 1/8, etc.) |
| undivided | Undivided interest in acreage |
| specific | Mineral only, surface only, specific formations |

WARRANTY TYPE (typically false for quit claim):
{{
  "warranties": {{
    "has_warranty": false,
    "warranty_type": "quitclaim",
    "warranty_language": "without warranty"
  }}
}}

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

IMPORTANT: Look at ALL provided page images. If you see DIFFERENT document types on different pages (e.g., "Assignment of Oil and Gas Lease" on one page, "Quit Claim Deed" on another, "Mineral Deed" on another), this is a MULTI-DOCUMENT PDF containing separate documents that need to be split.

Return ONLY a JSON object with:
{
  "doc_type": "mineral_deed|lease|division_order|... or multi_document",
  "confidence": "high|medium|low",
  "is_multi_document": true or false,
  "estimated_doc_count": number (1 if single document),
  "rotation_needed": 0|90|180|270,
  "reasoning": "Brief explanation"
}

CRITICAL FOR MULTI-DOCUMENT PDFs:
- If pages contain DIFFERENT document types, set "is_multi_document": true and "doc_type": "multi_document"
- Set "estimated_doc_count" to the number of separate documents (usually equals number of pages if each page is a different document)
- Example: PDF with Assignment on page 1, Quit Claim Deed on page 2, Mineral Deed on page 3 → is_multi_document: true, doc_type: "multi_document", estimated_doc_count: 3

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
- DIFFERENT document type headers on different pages (e.g., "ASSIGNMENT OF LEASE" on page 1, "QUIT CLAIM DEED" on page 2, "MINERAL DEED" on page 3) - THIS IS A MULTI-DOCUMENT PDF
- Different document dates or execution dates
- Different parties (grantors/grantees) in separate sections
- Clear page breaks between distinct documents
- Multiple check stubs or multiple division orders
- DIVISION ORDERS: Different Property Numbers or Property Names = SEPARATE DOCUMENTS (even if same owner/operator)
  Example: Page 1 has "Property #: 112295, Property Name: Holdings 25-36-1XH"
           Page 2 has "Property #: 112294, Property Name: Holdings 24-25-1XH"
           This is TWO separate division orders, not one!

CRITICAL: If you see DIFFERENT document types on different pages (Assignment, Quit Claim Deed, Mineral Deed, etc.), this is DEFINITELY a multi-document PDF. Set is_multi_document: true and count the pages.

If you see evidence of multiple documents, set is_multi_document: true and estimate the count.

DOCUMENT TYPES (if not one of these, return "other"):
- mineral_deed, royalty_deed, lease, division_order, assignment
- pooling_order, increased_density_order, change_of_operator_order, multi_unit_horizontal_order, unitization_order
- drilling_and_spacing_order, horizontal_drilling_and_spacing_order, location_exception_order
- drilling_permit, completion_report, well_transfer, title_opinion
- check_stub, occ_order, suspense_notice, joa
- affidavit_of_heirship, death_certificate, trust_funding, limited_partnership, assignment_of_lease, quit_claim_deed, ownership_entity, legal_document, correspondence
- tax_record, map

TRUST FUNDING DETECTION:
- trust_funding: Look for "GENERAL ASSIGNMENT" or "ASSIGNMENT" that transfers property from an individual to a TRUST. Key indicators: same person appears as both assignor (individual) AND assignee (as trustee), trust name mentioned (e.g., "Virginia K. Price Trust"), language about transferring "all property" or specific categories to a trust. Often includes nominal consideration ($10.00 and other good and valuable consideration). This is an estate planning document, NOT a sale.

LIMITED PARTNERSHIP DETECTION:
- limited_partnership: Look for "CERTIFICATE OF LIMITED PARTNERSHIP" or "LIMITED PARTNERSHIP AGREEMENT". Contains formation date, term/duration, general partners with management authority, limited partners with capital contributions, percentage interests. Key indicators: "General Partner", "Limited Partner", Article structures defining rights/duties, capital contribution amounts, profit/loss sharing percentages. May include succession provisions for what happens when GP dies (interest converts to LP interest).

ASSIGNMENT OF LEASE DETECTION:
- assignment_of_lease: Look for "ASSIGNMENT OF OIL AND GAS LEASE", "ASSIGNMENT OF LEASEHOLD INTEREST", "PARTIAL ASSIGNMENT OF LEASE", or "ASSIGNMENT OF OPERATING RIGHTS". Key indicators: references an underlying lease (date, lessor, lessee), transfers working interest/operating rights from assignor to assignee, may retain an overriding royalty (ORRI). Contains legal description, consideration, warranty language. NOT trust_funding (which transfers to a trust where assignor is trustee).

QUIT CLAIM DEED DETECTION:
- quit_claim_deed: Look for "QUIT CLAIM DEED", "QUITCLAIM DEED", "CORRECTION QUIT CLAIM DEED", or "CORRECTIVE QUIT CLAIM DEED". Key indicators: language like "quitclaim, grant, bargain", "remise, release, quitclaim", or "without warranty". Transfers whatever interest grantor MAY have with NO WARRANTY. Common uses: trust funding (individual → own trust), clearing title defects, correction of prior errors, divorce/family transfers. If same person is grantor (individual) AND grantee (trustee of their trust), this is trust funding but still classify as quit_claim_deed due to deed type. NOT mineral_deed (which has warranty). Look for "Correction" in title for correction deeds.

AFFIDAVIT OF HEIRSHIP DETECTION:
- affidavit_of_heirship: Look for "AFFIDAVIT OF HEIRSHIP" title. Contains decedent (deceased person) name, list of heirs/children/spouses, legal description of mineral property, notarized. Establishes who inherits mineral rights.

DEATH CERTIFICATE DETECTION:
- death_certificate: Look for "CERTIFICATE OF DEATH", "DEATH CERTIFICATE", "STANDARD CERTIFICATE OF DEATH", "CONSULAR REPORT OF DEATH". Key indicators: state/county health department or vital records header, certificate number, cause of death, date of death, place of death, decedent personal information (birth date, occupation, SSN), informant details, funeral home/disposition info. Also includes "REPORT OF DEATH OF AN AMERICAN CITIZEN ABROAD" (consular reports). NOT affidavit_of_heirship (which lists heirs and establishes inheritance). Death certificates document the death itself, not who inherits.

DRILLING PERMIT VS COMPLETION REPORT DETECTION (CRITICAL - these are different documents):
- drilling_permit: Look for "FORM 1000", "NOTICE OF INTENT TO DRILL", "PERMIT TO DRILL", "APPLICATION TO DRILL", "INTENT TO DRILL". This is submitted BEFORE drilling begins. CRITICAL DISTINGUISHING FEATURES: (1) NO production data - well hasn't been drilled yet, (2) NO spud date or completion date in the data fields, (3) NO perforated intervals or formation tops with depths, (4) Contains "Zones of Significance" table showing target formations, (5) Shows proposed well location and planned depths, (6) OCC permit/application number. This is NOT completion_report - drilling permits are filed BEFORE drilling, completion reports are filed AFTER.

- completion_report: Look for "FORM 1002A", "1002-A", "COMPLETION REPORT", "WELL COMPLETION REPORT", "REPORT OF COMPLETION". This is submitted AFTER drilling is FINISHED. CRITICAL DISTINGUISHING FEATURES: (1) HAS initial production test data (oil BOPD, gas MCFD, water BWPD), (2) HAS spud date AND completion date (past dates - drilling already happened), (3) HAS perforated intervals with measured depths, (4) HAS formation tops with actual drilled depths, (5) Status field showing "Accepted", "Pending", or "Rejected", (6) Contains OTC Production Unit Number (PUN) for multiunit wells. This is NOT drilling_permit - completion reports document FINISHED wells with actual production results.

OCC ORDER TYPE DETECTION - be specific:
- horizontal_drilling_and_spacing_order: Look for "HORIZONTAL DRILLING AND SPACING" or "HORIZONTAL WELL" in the relief/order title. Contains lateral setbacks, completion interval requirements, often 640-acre units.
- drilling_and_spacing_order: Look for "DRILLING AND SPACING" without "HORIZONTAL". Establishes vertical well units with setback distances (like 660ft from boundary). Often 160-acre or 640-acre units for vertical wells.
- location_exception_order: Look for "LOCATION EXCEPTION" - allows wells closer to boundaries than standard setbacks. Shows specific footage from boundary lines.
- unitization_order: PRIORITY CHECK - Look for "UNITIZATION", "UNIT ORDER", "OPERATING UNIT", "ENHANCED RECOVERY", "SECONDARY RECOVERY", "WATERFLOOD UNIT", or "PRESSURE MAINTENANCE UNIT" in the title or order text. CRITICAL DISTINGUISHING FEATURES: (1) Creates a NAMED unit (e.g., "Carter Knox Subthrusted Morrow Operating Unit"), (2) Contains TRACT PARTICIPATION PERCENTAGES like "Tract 1: 0.99004430%", (3) Lists MULTIPLE TRACTS with percentage allocations, (4) Authorizes EOR/IOR operations (waterflooding, nitrogen injection, CO2 injection, pressure maintenance), (5) Often SUPERSEDES prior spacing orders, (6) Has ALLOCATION FORMULA with weighted factors (surface acreage, cumulative production, net acre-feet). This is NOT a pooling_order - pooling orders have ELECTION OPTIONS for mineral owners, unitization orders have PARTICIPATION PERCENTAGES for tracts.
- pooling_order: Contains ELECTION OPTIONS for mineral owners to choose: participate (go working interest), cash bonus, royalty conversion, or accept non-consent penalties. Look for election deadline, bonus amounts per acre, and penalty provisions. Does NOT have tract participation percentages or enhanced recovery authorization. NOT unitization_order (which has participation percentages, not election options).
- increased_density_order: Look for "INCREASED DENSITY" or "INCREASED WELL DENSITY" - authorizes additional wells in existing units.
- change_of_operator_order: Look for "CHANGE OF OPERATOR" or "TRANSFER OF OPERATORSHIP" in the title. Key indicators: identifies previous operator and new operator, transfers operational responsibility, may modify prior orders to reflect new operator. NOT a pooling order (which creates new drilling units).

WELL TRANSFER DETECTION:
- well_transfer: Look for "WELL TRANSFER", "FORM 1073", "1073MW", "CHANGE OF OPERATOR" (form, not order), "Notice of transfer of multiple oil or gas well ownership". Key indicators: former operator, new operator, API numbers list, transfer effective date, wells transferred count, operator OCC/OTC numbers. Contains list of wells with locations. NOT change_of_operator_order (which is an OCC ORDER authorizing operator change, not the transfer FORM itself). Well transfers are administrative forms filed AFTER the OCC approves the operator change.
- multi_unit_horizontal_order: Look for "MULTIUNIT HORIZONTAL" or "MULTI-UNIT HORIZONTAL" or "MULTIUNIT WELL" in the title. Key indicators: horizontal well crossing multiple section boundaries, allocation percentages per section, completion interval lengths, production split between units. Contains tables showing section-by-section allocation factors. NOT horizontal_drilling_and_spacing_order (which establishes spacing rules, not production allocation).
- occ_order: ONLY use this for OCC orders that don't fit the specific types above.

Examples of "other" documents (oil and gas docs that don't fit defined categories):
- Farmout agreements, surface use agreements, pipeline agreements
- AFEs, payout statements, salt water disposal agreements
- Seismic permits, general operator correspondence
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

        # Log raw response details for debugging
        logger.info(f"Raw response length: {len(json_str)}, first 100 chars: {repr(json_str[:100])}")

        # Try to find JSON in the response - multiple strategies
        # Strategy 1: Look for ```json blocks
        if "```json" in json_str:
            start = json_str.find("```json") + 7
            end = json_str.find("```", start)
            logger.info(f"Strategy 1: found ```json at 0, searching for closing ``` from pos {start}, found at {end}")
            if end != -1:
                json_str = json_str[start:end].strip()
                logger.info(f"Extracted JSON from ```json block, length: {len(json_str)}, first 100 chars: {repr(json_str[:100])}")
        # Strategy 2: Look for ``` blocks (without json specifier)
        elif json_str.startswith("```"):
            lines = json_str.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]  # Remove opening fence
            # Find and remove closing fence
            for i, line in enumerate(lines):
                if line.strip() == "```":
                    lines = lines[:i]
                    break
            json_str = "\n".join(lines).strip()
            logger.debug(f"Extracted JSON from ``` block, length: {len(json_str)}")

        # Strategy 3: Find the JSON object by matching braces
        if "{" in json_str and "}" in json_str:
            # Find the first {
            start = json_str.find("{")
            # Find matching closing } by counting braces
            brace_count = 0
            end = start
            for i, char in enumerate(json_str[start:], start):
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        end = i + 1
                        break
            if end > start:
                json_str = json_str[start:end]
                logger.debug(f"Extracted JSON by brace matching, length: {len(json_str)}")
        
        try:
            logger.info(f"Attempting to parse JSON, length: {len(json_str)}, first 200 chars: {repr(json_str[:200])}")
            extracted_data = json.loads(json_str.strip())
            logger.info(f"Successfully parsed JSON, doc_type: {extracted_data.get('doc_type')}")

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
            logger.error(f"Error at position {e.pos}, line {e.lineno}, col {e.colno}")
            logger.error(f"JSON string being parsed (first 500 chars): {repr(json_str[:500])}")
            logger.error(f"Full response was: {response_text}")
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
        # Use higher token limit for first batch to handle complex documents like unitization orders
        async def make_batch_call():
            return client.messages.create(
                model=CONFIG.CLAUDE_MODEL,
                max_tokens=16384 if batch_num == 0 else 4096,
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
            else:
                # Truncated response - no closing ```, try to extract JSON by braces
                logger.warning("Response appears truncated (no closing ```), attempting brace extraction")
                if "{" in json_str:
                    brace_start = json_str.find("{")
                    brace_end = json_str.rfind("}") + 1
                    if brace_start != -1 and brace_end > brace_start:
                        json_str = json_str[brace_start:brace_end]
                    else:
                        # Really truncated - no closing brace either
                        logger.error("Response severely truncated - no closing brace found")
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
            logger.error(f"Raw response_text (first 2000 chars): {response_text[:2000] if response_text else 'EMPTY'}")
            logger.error(f"Extracted json_str (first 500 chars): {json_str[:500] if json_str else 'EMPTY'}")
        
        # Add delay between batches to avoid rate limits
        if i + PAGES_PER_BATCH < total_pages:
            logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next batch...")
            await asyncio.sleep(BATCH_DELAY_SECONDS)
    
    return extracted_data or {"error": "Failed to extract data from document"}


async def extract_document_data(image_paths: list[str], _rotation_attempted: bool = False, pdf_path: str = None) -> dict:
    """
    Main entry point for document extraction.
    Uses two-stage pipeline: Stage 1 (page-level classification + splitting) and Stage 2 (per-document extraction).

    Args:
        image_paths: List of paths to page images
        _rotation_attempted: Internal flag to prevent infinite rotation loops
        pdf_path: Optional path to original PDF for deterministic text-based splitting

    Returns:
        Combined extraction results
    """
    logger.info(f"Starting extraction for {len(image_paths)}-page document")

    # Step 0: For single-page docs, use quick classification path
    if len(image_paths) == 1:
        logger.info("Single page document - using quick classification")
        classification = await quick_classify_document(image_paths)

        # Handle rotation for single page
        rotation_needed = classification.get("rotation_needed", 0)
        if rotation_needed and rotation_needed != 0 and not _rotation_attempted:
            logger.info(f"Document needs {rotation_needed}° rotation - applying correction")
            from .main import rotate_image
            try:
                rotated_path = rotate_image(image_paths[0], rotation_needed)
                result = await extract_document_data([rotated_path], _rotation_attempted=True, pdf_path=pdf_path)
                result["rotation_applied"] = rotation_needed
                return result
            except Exception as e:
                logger.error(f"Failed to rotate image: {e}")

        # If "other", skip extraction
        if classification.get("doc_type") == "other":
            logger.info(f"Document classified as 'other', skipping extraction")
            return {
                "doc_type": "other",
                "category": "other",
                "document_confidence": classification.get("confidence", "high"),
                "classification_model": CONFIG.CLAUDE_MODEL,
                "page_count": 1,
                "skip_extraction": True,
                "ai_observations": classification.get("reasoning", "Document type not recognized for automatic extraction.")
            }

        # Single page, known type - extract it
        return await extract_single_document(image_paths)

    # Step 1: Quick classification on first page for rotation detection
    classification = await quick_classify_document(image_paths[:1])

    # Handle rotation if needed
    rotation_needed = classification.get("rotation_needed", 0)
    if rotation_needed and rotation_needed != 0 and not _rotation_attempted:
        logger.info(f"Document needs {rotation_needed}° rotation - applying correction")
        from .main import rotate_image

        rotated_paths = []
        for img_path in image_paths:
            try:
                rotated_path = rotate_image(img_path, rotation_needed)
                rotated_paths.append(rotated_path)
            except Exception as e:
                logger.error(f"Failed to rotate image {img_path}: {e}")
                rotated_paths.append(img_path)

        logger.info(f"Re-running extraction with {len(rotated_paths)} rotated image(s)")
        result = await extract_document_data(rotated_paths, _rotation_attempted=True, pdf_path=pdf_path)
        result["rotation_applied"] = rotation_needed
        return result

    # =========================================================================
    # STAGE 1: Page-level classification and splitting (Two-Stage Pipeline)
    # =========================================================================
    logger.info(f"Stage 1: Running page-level classification for {len(image_paths)} pages")

    # Extract text from PDF for heuristic checks (continuation patterns, etc.)
    # This is critical for detecting "FORMATION RECORD" on page 2 of Form 1002A
    page_texts = extract_text_from_pdf(pdf_path) if pdf_path else None

    # Log extracted text info
    if page_texts:
        logger.info(f"Extracted text from {len(page_texts)} pages")
        for i, text in enumerate(page_texts):
            logger.info(f"Page {i}: text length = {len(text)} chars")
            # Log FULL text for debugging (temporarily)
            logger.info(f"Page {i}: FULL TEXT START ===")
            logger.info(text if text else "(empty)")
            logger.info(f"Page {i}: FULL TEXT END ===")
    else:
        logger.warning(f"NO page_texts extracted from PDF - heuristics will not run!")

    # Get page-level classifications using heuristics first, then Haiku if needed
    page_classifications = await classify_pages(image_paths, page_texts)

    # Log final page classifications before splitting
    logger.info(f"Final page classifications before split:")
    for pc in page_classifications:
        logger.info(f"  Page {pc.get('page_index')}: is_document_start={pc.get('is_document_start')}, "
                   f"start_confidence={pc.get('start_confidence')}, coarse_type={pc.get('coarse_type')}, "
                   f"is_continuation={pc.get('is_continuation')}, method={pc.get('classification_method')}")

    # Split into logical documents
    split_result = split_pages_into_documents(page_classifications)

    logger.info(f"Stage 1 complete: Found {split_result['document_count']} document(s)")

    # =========================================================================
    # STAGE 2: Per-document classification and extraction
    # =========================================================================

    # If single document detected, extract it directly
    if not split_result["is_multi_document"]:
        chunk = split_result["chunks"][0]
        coarse_type = chunk.get("coarse_type", "other")

        logger.info(f"Single document detected (coarse_type: {coarse_type})")

        # If all pages classified as "other", skip extraction
        if coarse_type == "other":
            logger.info(f"Document classified as 'other', skipping extraction")
            return {
                "doc_type": "other",
                "category": "other",
                "document_confidence": "medium",
                "classification_model": "claude-3-5-haiku-20241022",
                "page_count": len(image_paths),
                "skip_extraction": True,
                "ai_observations": "Document type not recognized for automatic extraction.",
                "split_metadata": split_result.get("split_metadata")
            }

        # Extract the single document
        result = await extract_single_document(
            image_paths,
            chunk["page_start"] + 1,  # Convert to 1-based
            chunk["page_end"] + 1
        )
        result["_coarse_type"] = coarse_type
        result["_split_metadata"] = split_result.get("split_metadata")
        return result

    # Multiple documents detected - process each chunk
    logger.info(f"Multi-document PDF: Processing {split_result['document_count']} documents")

    results = {
        "is_multi_document": True,
        "document_count": split_result["document_count"],
        "split_method": "two_stage_pipeline",
        "split_metadata": split_result.get("split_metadata"),
        "documents": []
    }

    for i, chunk in enumerate(split_result["chunks"]):
        chunk_idx = chunk["chunk_index"]
        page_start = chunk["page_start"]
        page_end = chunk["page_end"]
        coarse_type = chunk.get("coarse_type", "other")
        detected_title = chunk.get("detected_title")

        logger.info(f"Stage 2: Extracting document {i+1}/{split_result['document_count']} "
                   f"(pages {page_start+1}-{page_end+1}, coarse_type: {coarse_type})")

        # Skip extraction for "other" type chunks
        if coarse_type == "other":
            logger.info(f"Document {i+1} classified as 'other', skipping extraction")
            doc_data = {
                "doc_type": "other",
                "category": "other",
                "skip_extraction": True,
                "page_count": page_end - page_start + 1,
                "_start_page": page_start + 1,
                "_end_page": page_end + 1,
                "_coarse_type": coarse_type,
                "_detected_title": detected_title,
                "_split_reason": chunk.get("split_reason")
            }
        else:
            # Extract the document
            doc_data = await extract_single_document(
                image_paths,
                page_start + 1,  # Convert to 1-based
                page_end + 1
            )

            # Add metadata from splitting
            doc_data["_start_page"] = page_start + 1
            doc_data["_end_page"] = page_end + 1
            doc_data["_coarse_type"] = coarse_type
            doc_data["_detected_title"] = detected_title
            doc_data["_split_reason"] = chunk.get("split_reason")

            # Include attachment pages if any
            if chunk.get("attachment_pages"):
                doc_data["_attachment_pages"] = [p + 1 for p in chunk["attachment_pages"]]

        results["documents"].append(doc_data)

        # Add delay between documents to avoid rate limits
        if i < len(split_result["chunks"]) - 1:
            logger.info(f"Waiting {BATCH_DELAY_SECONDS} seconds before next document...")
            await asyncio.sleep(BATCH_DELAY_SECONDS)

    logger.info(f"Multi-document extraction complete: {len(results['documents'])} documents extracted")
    return results


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