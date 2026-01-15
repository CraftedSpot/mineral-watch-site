"""
Document Splitters Module

Provides deterministic, pattern-based splitting for multi-document PDFs.
Each document type has its own splitter with family-specific rules.
"""

from .base import BaseSplitter, SplitResult
from .division_order import DivisionOrderSplitter

__all__ = [
    'BaseSplitter',
    'SplitResult',
    'DivisionOrderSplitter',
]
