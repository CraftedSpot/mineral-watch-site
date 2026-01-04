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
    'right_of_way': 'Right of Way',
    'release_of_lease': 'Release of Lease',
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
        well_name = extraction.get('well_name')
        operator = extraction.get('operator')
        year = get_year_from_dates(extraction)
        
        if well_name:
            # Clean up well name if needed (remove extra spaces, etc.)
            well_name = ' '.join(str(well_name).split())
            parts.append(well_name)
        elif operator:
            parts.append(operator)
        elif county:
            # Fallback to county if no well name or operator
            parts.append(county)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'pooling_order':
        # "Pooling Order - CD {Number} - {County} - {Year}"
        cd_number = None
        cause_number = extraction.get('cause_number', '') or ''
        
        # Try to extract CD number from cause_number (e.g., "CD 201500614-T" -> "201500614")
        if cause_number:
            cd_match = re.search(r'CD\s*(\d+)', str(cause_number), re.IGNORECASE)
            if cd_match:
                cd_number = cd_match.group(1)
        
        # Fallback to other fields
        if not cd_number:
            cd_number = extraction.get('cd_number') or extraction.get('order_number') or extraction.get('docket_number')
            if cd_number:
                # Extract numeric part if present
                nums = re.findall(r'\d+', str(cd_number))
                if nums:
                    cd_number = nums[0]
        
        if cd_number:
            parts.append(f"CD {cd_number}")
        
        if county:
            parts.append(county)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'assignment':
        # "Assignment - {County} - {Legal} - {Assignor to Assignee} - {Year}"
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        
        # Try to show assignor to assignee
        assignor = extraction.get('assignor_name', '')
        assignee = extraction.get('assignee_name', '')
        if assignor and assignee:
            assignor_last = get_last_name(assignor)
            assignee_last = get_last_name(assignee) 
            if assignor_last and assignee_last:
                parts.append(f"{assignor_last} to {assignee_last}")
        
        if year:
            parts.append(year)
    
    elif doc_type == 'ratification':
        # "Ratification - {County} - {Legal} - {Ratifying Party} - {Year}"
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        
        # Show who is ratifying
        ratifying_party = extraction.get('ratifying_party', '')
        if ratifying_party:
            last_name = get_last_name(ratifying_party)
            if last_name:
                parts.append(last_name)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'right_of_way':
        # "Right of Way - {Purpose} - {County} - {Grantee} - {Year}"
        purpose = extraction.get('purpose', '')
        grantee = extraction.get('grantee_name', '')
        
        if purpose:
            parts.append(purpose.title())
        if county:
            parts.append(county)
        if grantee:
            last_name = get_last_name(grantee)
            if last_name:
                parts.append(last_name)
        if year:
            parts.append(year)
    
    elif doc_type == 'release_of_lease':
        # "Release of Lease - {County} - {Legal} - {Releasor} - {Year}"
        if county:
            parts.append(county)
        if legal_desc:
            parts.append(legal_desc)
        
        releasor = extraction.get('releasor', '')
        if releasor:
            last_name = get_last_name(releasor)
            if last_name:
                parts.append(last_name)
        
        if year:
            parts.append(year)
    
    elif doc_type == 'affidavit_of_heirship':
        # "Affidavit of Heirship - {Decedent} - {County} - {Year}"
        decedent = extraction.get('decedent_name', '')
        
        if decedent:
            last_name = get_last_name(decedent)
            if last_name:
                parts.append(f"Estate of {last_name}")
        if county:
            parts.append(county)
        if year:
            parts.append(year)
    
    elif doc_type == 'probate_document':
        # "Probate - {Decedent} - {County} - {Case #} - {Year}"
        decedent = extraction.get('decedent_name', '')
        case_number = extraction.get('case_number', '')
        
        if decedent:
            last_name = get_last_name(decedent)
            if last_name:
                parts.append(f"Estate of {last_name}")
        if county:
            parts.append(county)
        if case_number:
            parts.append(f"Case {case_number}")
        if year:
            parts.append(year)
    
    elif doc_type in ['mineral_deed', 'royalty_deed']:
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
