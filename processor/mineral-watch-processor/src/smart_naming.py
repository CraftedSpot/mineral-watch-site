"""Generate smart display names from extracted document data."""

import re


# Document type display names
DOC_TYPE_NAMES = {
    'mineral_deed': 'Mineral Deed',
    'royalty_deed': 'Royalty Deed',
    'division_order': 'Division Order',
    'lease': 'Lease',
    'assignment': 'Assignment',
    'lease_assignment': 'Lease Assignment',
    'pooling_order': 'Pooling Order',
    'spacing_order': 'Spacing Order',
    'ratification': 'Ratification',
    'affidavit_of_heirship': 'Affidavit of Heirship',
    'probate_document': 'Probate Document',
    'other': 'Document'
}


def get_last_name(name: str) -> str:
    """Extract last name from a full name string."""
    if not name:
        return None
    
    name = name.strip()
    # Check if it's a company (has common suffixes)
    company_suffixes = ['LLC', 'L.L.C.', 'Inc', 'Inc.', 'Ltd', 'Ltd.', 'LP', 'L.P.', 
                       'Corporation', 'Corp.', 'Company', 'Co.']
    
    for suffix in company_suffixes:
        if name.endswith(suffix):
            # Return first word for companies
            return name.split()[0] if name.split() else name
    
    # For individuals, return last word (assumed to be last name)
    parts = name.split()
    return parts[-1] if parts else name


def get_year_from_dates(extraction: dict) -> str:
    """Extract year from execution_date or recording_date."""
    # Try execution date first
    exec_date = extraction.get('execution_date', '')
    if exec_date and len(str(exec_date)) >= 4:
        year = str(exec_date)[:4]
        if year.isdigit():
            return year
    
    # Try recording date as fallback
    recording = extraction.get('recording_info', {})
    rec_date = recording.get('recording_date', '')
    if rec_date and len(str(rec_date)) >= 4:
        year = str(rec_date)[:4]
        if year.isdigit():
            return year
    
    return None


def generate_display_name(extraction: dict) -> str:
    """
    Generate a human-readable display name from extracted data.
    
    Custom formats by document type:
    - mineral_deed: "Mineral Deed - {County} - {Legal} - {Year}"
    - lease: "Lease - {County} - {Legal} - {Lessor} - {Year}"
    - division_order: "Division Order - {Well Name} - {Year}"
    - assignment: "Assignment - {County} - {Legal} - {Year}"
    - pooling_order: "Pooling Order - CD {Number} - {County} - {Year}"
    - royalty_deed: "Royalty Deed - {County} - {Legal} - {Year}"
    - ratification: "Ratification - {County} - {Legal} - {Year}"
    
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
    
    # Get common fields
    legal = extraction.get('legal_description', {})
    county = legal.get('county')
    year = get_year_from_dates(extraction)
    
    # Format legal description if available
    section = legal.get('section')
    township = legal.get('township')
    range_val = legal.get('range')
    
    legal_desc = None
    if section and township and range_val:
        section_str = str(section).strip()
        township_str = str(township).strip().upper()
        range_str = str(range_val).strip().upper()
        legal_desc = f"S{section_str}-T{township_str}-R{range_str}"
    
    # Clean up county name if present
    if county:
        county = county.strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
    
    # Build name based on document type
    if doc_type == 'lease':
        # "Lease - {County} - {Legal} - {Lessor} - {Year}"
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        
        # Try to get lessor name
        grantor = extraction.get('grantor', {})
        lessor_name = grantor.get('name', '')
        last_name = get_last_name(lessor_name)
        if last_name:
            parts.append(last_name)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'division_order':
        # "Division Order - {Well Name} - {Year}"
        # Try to find well name in the document
        well_name = extraction.get('well_name', '')
        if not well_name:
            # Look in other possible locations
            property_info = extraction.get('property_info', {})
            well_name = property_info.get('well_name', '')
        
        if well_name:
            parts.append(well_name.strip())
        elif county:
            # Fallback to county if no well name
            parts.append(county)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'pooling_order':
        # "Pooling Order - CD {Number} - {County} - {Year}"
        # Look for cause/docket number
        cd_number = extraction.get('cause_number', '')
        if not cd_number:
            cd_number = extraction.get('docket_number', '')
        
        if cd_number:
            # Clean CD number - extract just the numeric part if possible
            nums = re.findall(r'\d+', str(cd_number))
            if nums:
                parts.append(f"CD {nums[0]}")
        
        if county:
            parts.append(county)
        
        if year:
            parts.append(year)
    
    elif doc_type in ['mineral_deed', 'royalty_deed', 'assignment', 'ratification']:
        # Standard format: "{Type} - {County} - {Legal} - {Year}"
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        if year:
            parts.append(year)
    
    else:
        # Default format for other types
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        if year:
            parts.append(year)
    
    # Join parts
    display_name = " - ".join(parts)
    
    # Fallback if we only have the type
    if len(parts) == 1:
        # Try to at least add county or year
        if county:
            display_name = f"{formatted_type} - {county}"
        elif year:
            display_name = f"{formatted_type} - {year}"
        else:
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
