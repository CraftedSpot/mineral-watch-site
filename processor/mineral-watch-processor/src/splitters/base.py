"""
Base Splitter Class

Provides common functionality for all document splitters.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class SplitResult:
    """Result of a document split operation."""

    # Page ranges for each document (1-indexed, inclusive)
    # e.g., [(1, 1), (2, 2)] means doc 1 is page 1, doc 2 is page 2
    page_ranges: list[tuple[int, int]]

    # Number of documents found
    document_count: int

    # Whether splitting was successful
    success: bool

    # Optional metadata for each document (e.g., property numbers)
    document_metadata: Optional[list[dict]] = None

    # Reason if splitting failed or was skipped
    reason: Optional[str] = None

    @classmethod
    def single_document(cls, total_pages: int) -> 'SplitResult':
        """Return a result indicating a single document (no split needed)."""
        return cls(
            page_ranges=[(1, total_pages)],
            document_count=1,
            success=True,
            reason="Single document detected"
        )

    @classmethod
    def failed(cls, reason: str, total_pages: int) -> 'SplitResult':
        """Return a result indicating splitting failed."""
        return cls(
            page_ranges=[(1, total_pages)],
            document_count=1,
            success=False,
            reason=reason
        )

    @classmethod
    def no_text(cls, total_pages: int) -> 'SplitResult':
        """Return a result indicating PDF has no extractable text (scanned/image PDF)."""
        return cls(
            page_ranges=[(1, total_pages)],
            document_count=1,
            success=False,
            reason="no_extractable_text"
        )


class BaseSplitter(ABC):
    """
    Abstract base class for document splitters.

    Each document type (division_order, check_stub, occ_order, etc.)
    should have its own splitter subclass with family-specific patterns.
    """

    # Document type this splitter handles
    doc_type: str = "unknown"

    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")

    @abstractmethod
    def split(self, text_by_page: list[str]) -> SplitResult:
        """
        Split a multi-page document into individual documents.

        Args:
            text_by_page: List of text content, one string per page (0-indexed)

        Returns:
            SplitResult with page ranges for each document
        """
        pass

    @abstractmethod
    def validate_segment(self, text: str) -> tuple[bool, Optional[str]]:
        """
        Validate that a document segment is valid (invariant check).

        Args:
            text: The text content of the segment

        Returns:
            Tuple of (is_valid, error_message)
        """
        pass

    def extract_text_from_pdf(self, pdf_path: str) -> list[str]:
        """
        Extract text from each page of a PDF.

        Args:
            pdf_path: Path to the PDF file

        Returns:
            List of text strings, one per page
        """
        try:
            import fitz  # PyMuPDF

            text_by_page = []
            doc = fitz.open(pdf_path)

            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                text_by_page.append(text)

            doc.close()
            return text_by_page

        except ImportError:
            self.logger.error("PyMuPDF (fitz) not installed. Cannot extract text.")
            return []
        except Exception as e:
            self.logger.error(f"Failed to extract text from PDF: {e}")
            return []

    def get_page_count(self, pdf_path: str) -> int:
        """Get the number of pages in a PDF."""
        try:
            import fitz
            doc = fitz.open(pdf_path)
            count = len(doc)
            doc.close()
            return count
        except Exception as e:
            self.logger.error(f"Failed to get page count: {e}")
            return 0
