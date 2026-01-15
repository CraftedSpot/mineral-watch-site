"""
Division Order Splitter

Deterministic splitting for Division Order PDFs based on:
- Header pattern: DIVISION ORDER + Property #
- Footer pattern: PLEASE SIGN AND RETURN
- Invariant: One Property # per document
"""

import re
import logging
from typing import Optional

from .base import BaseSplitter, SplitResult

logger = logging.getLogger(__name__)


class DivisionOrderSplitter(BaseSplitter):
    """
    Splitter for Division Order documents.

    Division Orders follow a predictable pattern:
    - Header: "DIVISION ORDER" title + "Property #:" field
    - Footer: "PLEASE SIGN AND RETURN TO [OPERATOR]"
    - Each logical document has exactly one Property # value
    """

    doc_type = "division_order"

    # Patterns for detecting document boundaries
    # Header patterns - indicate start of a new Division Order
    HEADER_PATTERNS = [
        # "DIVISION ORDER" as a title/header
        r'DIVISION\s+ORDER',
        # Property # field (captures the number)
        r'Property\s*#\s*[:\s]*(\d+)',
        # Property Name field
        r'Property\s+Name\s*[:\s]*([^\n]+)',
    ]

    # Footer patterns - indicate end of a Division Order
    FOOTER_PATTERNS = [
        r'PLEASE\s+SIGN\s+AND\s+RETURN\s+TO',
        r'Owner\(s\)\s+Signature\(s\)',
        r'Owner\s+Signature',
    ]

    # Pattern to extract Property # (the key identifier)
    PROPERTY_NUMBER_PATTERN = r'Property\s*#\s*[:\s]*(\d+)'

    # Pattern to extract Property Name
    PROPERTY_NAME_PATTERN = r'Property\s+Name\s*[:\s]*([^\n,]+)'

    def split(self, text_by_page: list[str]) -> SplitResult:
        """
        Split Division Order PDF into individual documents.

        Strategy:
        1. Extract Property # from each page
        2. Group consecutive pages with the same Property #
        3. Validate that page boundaries align with header/footer patterns
        """
        if not text_by_page:
            return SplitResult.failed("No text content provided", 0)

        total_pages = len(text_by_page)

        if total_pages == 1:
            # Single page - check if it's a valid DO
            property_numbers = self._extract_property_numbers(text_by_page[0])
            if len(property_numbers) <= 1:
                return SplitResult.single_document(1)
            else:
                # Multiple Property #s on one page is unusual - flag it
                logger.warning(f"Single page with multiple Property #s: {property_numbers}")
                return SplitResult.single_document(1)

        # Extract Property # from each page
        page_property_numbers = []
        for i, page_text in enumerate(text_by_page):
            prop_nums = self._extract_property_numbers(page_text)
            page_property_numbers.append(prop_nums)
            logger.debug(f"Page {i + 1}: Property #s found: {prop_nums}")

        # Detect document boundaries based on Property # changes
        documents = []
        current_doc_start = 0
        current_property_num = None

        for i, prop_nums in enumerate(page_property_numbers):
            # Get the primary Property # for this page (first one found)
            page_prop_num = prop_nums[0] if prop_nums else None

            # Check if this is a new document
            if page_prop_num and page_prop_num != current_property_num:
                # If we have a current document, close it
                if current_property_num is not None:
                    documents.append({
                        'start_page': current_doc_start + 1,  # 1-indexed
                        'end_page': i,  # Previous page (1-indexed)
                        'property_number': current_property_num,
                    })

                # Start new document
                current_doc_start = i
                current_property_num = page_prop_num

            # Also check for header pattern as secondary signal
            elif self._has_header_pattern(text_by_page[i]) and i > 0:
                # Header on non-first page might indicate new doc even without Property # change
                if self._has_footer_pattern(text_by_page[i - 1]):
                    # Previous page had footer, this page has header - likely new doc
                    if current_property_num is not None:
                        documents.append({
                            'start_page': current_doc_start + 1,
                            'end_page': i,
                            'property_number': current_property_num,
                        })
                    current_doc_start = i
                    current_property_num = page_prop_num

        # Close the last document
        if current_property_num is not None or current_doc_start == 0:
            documents.append({
                'start_page': current_doc_start + 1,
                'end_page': total_pages,
                'property_number': current_property_num,
            })

        # If only one document found, return single document result
        if len(documents) <= 1:
            return SplitResult.single_document(total_pages)

        # Build result
        page_ranges = [(doc['start_page'], doc['end_page']) for doc in documents]
        metadata = [{'property_number': doc['property_number']} for doc in documents]

        logger.info(f"Split Division Order PDF into {len(documents)} documents: {page_ranges}")

        return SplitResult(
            page_ranges=page_ranges,
            document_count=len(documents),
            success=True,
            document_metadata=metadata,
            reason=f"Split by Property #: {[doc['property_number'] for doc in documents]}"
        )

    def _extract_property_numbers(self, text: str) -> list[str]:
        """Extract all Property # values from text."""
        matches = re.findall(self.PROPERTY_NUMBER_PATTERN, text, re.IGNORECASE)
        return list(dict.fromkeys(matches))  # Remove duplicates, preserve order

    def _extract_property_name(self, text: str) -> Optional[str]:
        """Extract Property Name from text."""
        match = re.search(self.PROPERTY_NAME_PATTERN, text, re.IGNORECASE)
        return match.group(1).strip() if match else None

    def _has_header_pattern(self, text: str) -> bool:
        """Check if text contains Division Order header patterns."""
        # Must have "DIVISION ORDER" and "Property #"
        has_title = bool(re.search(r'DIVISION\s+ORDER', text, re.IGNORECASE))
        has_property = bool(re.search(self.PROPERTY_NUMBER_PATTERN, text, re.IGNORECASE))
        return has_title and has_property

    def _has_footer_pattern(self, text: str) -> bool:
        """Check if text contains Division Order footer patterns."""
        for pattern in self.FOOTER_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                return True
        return False

    def validate_segment(self, text: str) -> tuple[bool, Optional[str]]:
        """
        Validate a Division Order segment.

        Invariants:
        - Must have exactly one Property # (or all Property #s must be the same)
        - Must have "DIVISION ORDER" header
        """
        property_numbers = self._extract_property_numbers(text)

        # Check for Property # invariant
        unique_property_numbers = set(property_numbers)
        if len(unique_property_numbers) > 1:
            return False, f"Multiple Property #s in segment: {unique_property_numbers}"

        # Check for header
        if not re.search(r'DIVISION\s+ORDER', text, re.IGNORECASE):
            return False, "Missing DIVISION ORDER header"

        return True, None


def split_division_order_pdf(pdf_path: str) -> SplitResult:
    """
    Convenience function to split a Division Order PDF.

    Args:
        pdf_path: Path to the PDF file

    Returns:
        SplitResult with page ranges for each document
    """
    splitter = DivisionOrderSplitter()
    text_by_page = splitter.extract_text_from_pdf(pdf_path)

    if not text_by_page:
        return SplitResult.failed("Failed to extract text from PDF", 0)

    return splitter.split(text_by_page)
