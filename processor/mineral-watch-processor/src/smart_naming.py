"""Generate smart display names from extracted document data."""


# Document type display names
DOC_TYPE_NAMES = {
    'mineral_deed': 'Mineral Deed',
    'royalty_deed': 'Royalty Deed',
    'division_order': 'Division Order',
    'lease': 'Oil & Gas Lease',
    'lease_assignment': 'Lease Assignment',
    'pooling_order': 'Pooling Order',
    'spacing_order': 'Spacing Order',
    'ratification': 'Ratification',
    'affidavit_of_heirship': 'Affidavit of Heirship',
    'probate_document': 'Probate Document',
    'other': 'Document'
}


def generate_display_name(extraction: dict) -> str:
    """
    Generate a human-readable display name from extracted data.
    
    Format: "{Type} - {County} County - S{Section}-T{Township}-R{Range} - {Year}"
    
    Examples:
        "Mineral Deed - Beaver County - S11-T6N-R27E - 1980"
        "Division Order - Blaine County - S22-T18N-R11W - 2015"
        "Document - 2020" (fallback for 'other' with minimal data)
    
    Args:
        extraction: Dictionary of extracted document data
    
    Returns:
        Formatted display name string
    """
    parts = []
    
    # Document type
    doc_type = extraction.get('doc_type', 'other')
    formatted_type = DOC_TYPE_NAMES.get(doc_type, 'Document')
    parts.append(formatted_type)
    
    # Legal description components
    legal = extraction.get('legal_description', {})
    
    # County
    county = legal.get('county')
    if county:
        # Clean up county name
        county = county.strip()
        if not county.lower().endswith('county'):
            parts.append(f"{county} County")
        else:
            parts.append(county)
    
    # Section-Township-Range
    section = legal.get('section')
    township = legal.get('township')
    range_val = legal.get('range')
    
    if section and township and range_val:
        # Ensure section is a string and clean
        section_str = str(section).strip()
        township_str = str(township).strip().upper()
        range_str = str(range_val).strip().upper()
        
        parts.append(f"S{section_str}-T{township_str}-R{range_str}")
    
    # Year from execution date
    exec_date = extraction.get('execution_date', '')
    if exec_date and len(str(exec_date)) >= 4:
        year = str(exec_date)[:4]
        if year.isdigit():
            parts.append(year)
    
    # Join parts
    display_name = " - ".join(parts)
    
    # Fallback if we only have the type
    if len(parts) == 1:
        display_name = formatted_type
    
    return display_name


def generate_display_name_for_child(extraction: dict, page_start: int, page_end: int) -> str:
    """
    Generate display name for a child document from a multi-doc PDF.
    Includes page range in the name.
    
    Args:
        extraction: Dictionary of extracted document data for this child
        page_start: First page of this document in the parent PDF
        page_end: Last page of this document in the parent PDF
    
    Returns:
        Formatted display name string with page range
    """
    base_name = generate_display_name(extraction)
    
    if page_start == page_end:
        return f"{base_name} (p.{page_start})"
    else:
        return f"{base_name} (pp.{page_start}-{page_end})"
