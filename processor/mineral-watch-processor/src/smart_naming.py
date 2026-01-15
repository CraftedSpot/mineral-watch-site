"""
Smart Document Naming Module for Mineral Watch
Generates intelligent display names from extracted document data.

Key principles:
- Include parties (grantor/grantee) to reduce duplicates
- Use context-appropriate metadata for each document type
- Standardize formats for consistency and sorting
- Graceful fallbacks when data is missing
"""

import re
from typing import Optional, Dict, Any
from datetime import datetime


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def format_legal_description(section: str = None, township: str = None, range_val: str = None) -> Optional[str]:
    """Format legal description as S{section}-T{township}-R{range}"""
    if not any([section, township, range_val]):
        return None
    
    parts = []
    if section:
        parts.append(f"S{str(section).strip()}")
    if township:
        parts.append(f"T{str(township).strip().upper()}")
    if range_val:
        parts.append(f"R{str(range_val).strip().upper()}")
    
    return "-".join(parts) if parts else None


def extract_last_name(full_name: str) -> str:
    """Extract last name from a full name string, or shortened company name."""
    if not full_name:
        return ""
    
    name = str(full_name).strip()
    
    # Company indicators that suggest this is a business, not a person
    company_suffixes = ['LLC', 'L.L.C.', 'Inc', 'Inc.', 'Corp', 'Corp.', 'Corporation', 
                        'Company', 'Co.', 'Co', 'Ltd', 'Ltd.', 'LP', 'L.P.', 'LLP', 
                        'L.L.P.', 'Trust', 'Estate', 'Partners', 'Partnership', 
                        'Associates', 'Group', 'Holdings', 'Energy', 'Resources',
                        'Oil', 'Gas', 'Petroleum', 'Operating', 'Production']
    
    name_lower = name.lower()
    is_company = any(suffix.lower() in name_lower for suffix in company_suffixes)
    
    # Also check for "&" which often indicates law firms or partnerships
    if ' & ' in name or ' and ' in name.lower():
        is_company = True
    
    if is_company:
        # For companies, take meaningful first word(s)
        words = name.split()
        
        # Skip common prefixes
        skip_words = ['the', 'a', 'an']
        meaningful_words = [w for w in words if w.lower() not in skip_words]
        
        if not meaningful_words:
            return name[:20]
        
        # For short company names (1-2 meaningful words before suffix), use first word
        # For longer names, might want first two words
        first_word = meaningful_words[0]
        
        # If first word is very short (like initials), include second word
        if len(first_word) <= 3 and len(meaningful_words) > 1:
            return f"{first_word} {meaningful_words[1]}"
        
        return first_word
    
    # For individuals, get last name
    parts = name.split()
    if parts:
        last = parts[-1]
        # Handle suffixes like Jr., Sr., III
        if last.lower() in ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'] and len(parts) > 1:
            return parts[-2]
        return last
    
    return name


def format_party_transfer(grantor: str, grantee: str, use_last_names: bool = True) -> Optional[str]:
    """Format 'Grantor to Grantee' string, optionally using last names only."""
    if not grantor and not grantee:
        return None
    
    if use_last_names:
        grantor_name = extract_last_name(grantor) if grantor else "Unknown"
        grantee_name = extract_last_name(grantee) if grantee else "Unknown"
    else:
        grantor_name = grantor or "Unknown"
        grantee_name = grantee or "Unknown"
    
    return f"{grantor_name} to {grantee_name}"


def format_period(date_str: str = None, month: str = None, year: str = None) -> Optional[str]:
    """Format period as 'MMM YYYY' for consistency and sorting."""
    if date_str:
        try:
            # Try parsing various date formats
            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%B %Y', '%b %Y']:
                try:
                    dt = datetime.strptime(str(date_str), fmt)
                    return dt.strftime('%b %Y')
                except ValueError:
                    continue
        except:
            pass
    
    if month and year:
        try:
            # Handle numeric month
            if str(month).isdigit():
                dt = datetime(int(year), int(month), 1)
                return dt.strftime('%b %Y')
            else:
                return f"{str(month)[:3]} {year}"
        except:
            pass
    
    if year:
        return str(year)
    
    return None


def format_date(date_str: str = None, year: str = None) -> Optional[str]:
    """Format date as YYYY-MM-DD for correspondence, or just year."""
    if date_str:
        try:
            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%B %d, %Y', '%b %d, %Y']:
                try:
                    dt = datetime.strptime(str(date_str), fmt)
                    return dt.strftime('%Y-%m-%d')
                except ValueError:
                    continue
        except:
            pass
    
    return str(year) if year else None


def truncate_name(name: str, max_length: int = 30) -> str:
    """Truncate a name to max length, preserving meaningful content."""
    if not name or len(name) <= max_length:
        return name or ""
    return name[:max_length-3] + "..."


def clean_cd_number(cd_number: str) -> str:
    """Clean and format CD number, removing 'CD' prefix if present."""
    if not cd_number:
        return ""
    # Remove common prefixes
    cleaned = re.sub(r'^(CD|cd|Cd)\s*', '', str(cd_number).strip())
    # Extract numeric part if present
    nums = re.findall(r'\d+', cleaned)
    if nums:
        return nums[0]
    return cleaned


def get_year_from_dates(extraction: dict) -> Optional[str]:
    """Extract year from execution_date, recording_date, or other date fields."""
    # Try execution date first
    exec_date = extraction.get('execution_date', '')
    if exec_date and len(str(exec_date)) >= 4:
        year = str(exec_date)[:4]
        if year.isdigit():
            return year
    
    # Try recording date
    rec_date = extraction.get('recording_date', '')
    if rec_date and len(str(rec_date)) >= 4:
        year = str(rec_date)[:4]
        if year.isdigit():
            return year
    
    # Try other date fields
    for field in ['date', 'effective_date', 'dated', 'check_date']:
        date_val = extraction.get(field, '')
        if date_val and len(str(date_val)) >= 4:
            year = str(date_val)[:4]
            if year.isdigit():
                return year
    
    return None


# ============================================================================
# CATEGORY-SPECIFIC NAMING FUNCTIONS
# ============================================================================

def name_mineral_deed(data: Dict[str, Any]) -> str:
    """Mineral Deed - {County} - {Legal} - {Grantor to Grantee} - {Year}"""
    parts = ["Mineral Deed"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    # Handle array of names
    grantor = data.get('grantor')
    if isinstance(grantor, list) and grantor:
        grantor = grantor[0]
    elif isinstance(grantor, dict):
        grantor = grantor.get('name', '')
    
    grantee = data.get('grantee')
    if isinstance(grantee, list) and grantee:
        grantee = grantee[0]
    elif isinstance(grantee, dict):
        grantee = grantee.get('name', '')
    
    # Also check plural forms
    if not grantor:
        grantors = data.get('grantor_names', [])
        if grantors and isinstance(grantors, list):
            grantor = grantors[0]
    
    if not grantee:
        grantees = data.get('grantee_names', [])
        if grantees and isinstance(grantees, list):
            grantee = grantees[0]
    
    party_transfer = format_party_transfer(grantor, grantee)
    if party_transfer:
        parts.append(party_transfer)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_royalty_deed(data: Dict[str, Any]) -> str:
    """Royalty Deed - {County} - {Legal} - {Grantor to Grantee} - {Year}"""
    # Same logic as mineral deed but with different prefix
    parts = ["Royalty Deed"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    # Handle array of names
    grantor = data.get('grantor')
    if isinstance(grantor, list) and grantor:
        grantor = grantor[0]
    elif isinstance(grantor, dict):
        grantor = grantor.get('name', '')
    
    grantee = data.get('grantee')
    if isinstance(grantee, list) and grantee:
        grantee = grantee[0]
    elif isinstance(grantee, dict):
        grantee = grantee.get('name', '')
    
    # Also check plural forms
    if not grantor:
        grantors = data.get('grantor_names', [])
        if grantors and isinstance(grantors, list):
            grantor = grantors[0]
    
    if not grantee:
        grantees = data.get('grantee_names', [])
        if grantees and isinstance(grantees, list):
            grantee = grantees[0]
    
    party_transfer = format_party_transfer(grantor, grantee)
    if party_transfer:
        parts.append(party_transfer)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_lease(data: Dict[str, Any]) -> str:
    """Lease - {County} - {Legal} - {Lessor to Lessee} - {Year}"""
    parts = ["Lease"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    # Handle lessor/lessee
    lessor = data.get('lessor') or data.get('lessor_name')
    lessee = data.get('lessee') or data.get('lessee_name')
    
    # Check for array forms
    if not lessor:
        lessors = data.get('lessor_names', [])
        if lessors and isinstance(lessors, list):
            lessor = lessors[0]
    
    party_transfer = format_party_transfer(lessor, lessee)
    if party_transfer:
        parts.append(party_transfer)
    elif lessor:
        parts.append(extract_last_name(lessor))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_division_order(data: Dict[str, Any]) -> str:
    """Division Order - {Well Name} - {Operator} - {Year}"""
    parts = ["Division Order"]
    
    well_name = data.get('well_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 40))
    
    operator = data.get('operator') or data.get('operator_name')
    if operator:
        parts.append(extract_last_name(operator))
    elif not well_name and data.get('county'):
        # Fallback to county if no well name or operator
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_assignment(data: Dict[str, Any]) -> str:
    """Assignment - {County} - {Legal} - {Assignor to Assignee} - {Year}"""
    parts = ["Assignment"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    assignor = data.get('assignor') or data.get('assignor_name') or data.get('grantor')
    assignee = data.get('assignee') or data.get('assignee_name') or data.get('grantee')
    
    party_transfer = format_party_transfer(assignor, assignee)
    if party_transfer:
        parts.append(party_transfer)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_pooling_order(data: Dict[str, Any]) -> str:
    """Pooling Order - CD {Number} - {Well Name or County} - {Operator} - {Formation} - {Year}"""
    parts = ["Pooling Order"]

    # Case/CD number
    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    # Well name (preferred) or county as location identifier
    well_name = data.get('proposed_well_name') or data.get('well_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 30))
    elif data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    # Operator (use short name)
    operator = data.get('operator') or data.get('applicant')
    if operator:
        parts.append(extract_last_name(operator))

    # Primary formation (if available)
    formations = data.get('formations')
    if formations and isinstance(formations, list) and len(formations) > 0:
        first_formation = formations[0]
        if isinstance(first_formation, dict):
            formation_name = first_formation.get('name', '')
        else:
            formation_name = str(first_formation)
        if formation_name:
            parts.append(formation_name)

    # Year
    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_spacing_order(data: Dict[str, Any]) -> str:
    """Spacing Order - CD {Number} - {County} - {Legal} - {Year}"""
    parts = ["Spacing Order"]

    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    legal = format_legal_description(
        data.get('section'),
        data.get('township'),
        data.get('range')
    )
    if legal:
        parts.append(legal)

    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_drilling_and_spacing_order(data: Dict[str, Any]) -> str:
    """Drilling & Spacing Order - CD {Number} - {County} - {Legal} - {Unit Size} - {Formation} - {Year}"""
    parts = ["Drilling & Spacing Order"]

    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    legal = format_legal_description(
        data.get('section'),
        data.get('township'),
        data.get('range')
    )
    if legal:
        parts.append(legal)

    # Unit size
    unit_size = data.get('unit_size_acres')
    if unit_size:
        parts.append(f"{unit_size}-acre")

    # Primary formation
    formations = data.get('formations')
    if formations and isinstance(formations, list) and len(formations) > 0:
        first_formation = formations[0]
        if isinstance(first_formation, dict):
            formation_name = first_formation.get('name', '')
        else:
            formation_name = str(first_formation)
        if formation_name:
            parts.append(formation_name)

    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_horizontal_drilling_and_spacing_order(data: Dict[str, Any]) -> str:
    """Horizontal Drilling & Spacing - CD {Number} - {County} - {Legal} - {Unit Size} - {Formation} - {Year}"""
    parts = ["Horizontal Drilling & Spacing"]

    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    legal = format_legal_description(
        data.get('section'),
        data.get('township'),
        data.get('range')
    )
    if legal:
        parts.append(legal)

    # Unit size
    unit_size = data.get('unit_size_acres')
    if unit_size:
        parts.append(f"{unit_size}-acre")

    # Primary formation (or multiple if present)
    formations = data.get('formations')
    if formations and isinstance(formations, list):
        if len(formations) == 1:
            first_formation = formations[0]
            if isinstance(first_formation, dict):
                formation_name = first_formation.get('name', '')
            else:
                formation_name = str(first_formation)
            if formation_name:
                parts.append(formation_name)
        elif len(formations) > 1:
            # Multiple formations - show count
            parts.append(f"{len(formations)} formations")

    # Operator
    operator = data.get('operator') or data.get('applicant')
    if operator:
        parts.append(extract_last_name(operator))

    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_location_exception_order(data: Dict[str, Any]) -> str:
    """Location Exception - CD {Number} - {Well Name} - {County} - {Formation} - {Year}"""
    parts = ["Location Exception"]

    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    # Well name is important for location exceptions
    well_name = data.get('well_name') or data.get('proposed_well_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 30))

    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    # Primary formation
    formations = data.get('formations')
    if formations and isinstance(formations, list) and len(formations) > 0:
        first_formation = formations[0]
        if isinstance(first_formation, dict):
            formation_name = first_formation.get('name', '')
        else:
            formation_name = str(first_formation)
        if formation_name:
            parts.append(formation_name)

    # Operator
    operator = data.get('operator') or data.get('applicant')
    if operator:
        parts.append(extract_last_name(operator))

    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_increased_density_order(data: Dict[str, Any]) -> str:
    """Increased Density Order - CD {Number} - {Well Name or County} - {Operator} - {Formation} - {Year}"""
    parts = ["Increased Density Order"]

    # Case/CD number
    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    # Well name (preferred) or county as location identifier
    well_name = data.get('proposed_well_name') or data.get('well_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 30))
    elif data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    # Operator (use short name)
    operator = data.get('operator') or data.get('applicant')
    if operator:
        parts.append(extract_last_name(operator))

    # Primary formation (if available)
    formations = data.get('formations')
    if formations and isinstance(formations, list) and len(formations) > 0:
        first_formation = formations[0]
        if isinstance(first_formation, dict):
            formation_name = first_formation.get('name', '')
        else:
            formation_name = str(first_formation)
        if formation_name:
            parts.append(formation_name)

    # Additional wells authorized
    additional = data.get('additional_wells_authorized')
    if additional:
        parts.append(f"+{additional} well{'s' if additional > 1 else ''}")

    # Year
    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_change_of_operator_order(data: Dict[str, Any]) -> str:
    """Change of Operator - CD {Number} - {County} - {Current Operator} to {New Operator} - {# Wells} - {Year}"""
    parts = ["Change of Operator"]

    # Case/CD number
    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    # County
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    # Operator transfer
    current_op = data.get('current_operator')
    new_op = data.get('new_operator')
    if current_op and new_op:
        parts.append(f"{extract_last_name(current_op)} to {extract_last_name(new_op)}")
    elif new_op:
        parts.append(f"to {extract_last_name(new_op)}")

    # Number of wells transferred
    total_wells = data.get('total_wells_transferred')
    if total_wells:
        parts.append(f"{total_wells} wells")

    # Year
    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_multi_unit_horizontal_order(data: Dict[str, Any]) -> str:
    """Multi-Unit Horizontal - CD {Number} - {County} - {Sections} - {Formation} - {Operator} - {Year}"""
    parts = ["Multi-Unit Horizontal"]

    # Case/CD number
    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number') or data.get('case_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")

    # County
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)

    # Sections involved (from unit_sections array)
    unit_sections = data.get('unit_sections')
    if unit_sections and isinstance(unit_sections, list) and len(unit_sections) > 0:
        # Extract section numbers and create clear format: S17 & S20 - 11N-12W
        section_nums = []
        first_twp = None
        first_rng = None
        for unit in unit_sections:
            if isinstance(unit, dict):
                sec = unit.get('section')
                if sec:
                    section_nums.append(str(sec))
                if not first_twp:
                    first_twp = unit.get('township')
                if not first_rng:
                    first_rng = unit.get('range')

        if section_nums:
            # Use "S17 & S20" format to clearly show these are separate sections
            sections_str = " & ".join([f"S{s}" for s in section_nums])
            if first_twp and first_rng:
                sections_str += f" - {first_twp}-{first_rng}"
            parts.append(sections_str)

    # Primary formation (if available)
    formations = data.get('formations')
    if formations and isinstance(formations, list) and len(formations) > 0:
        first_formation = formations[0]
        if isinstance(first_formation, dict):
            formation_name = first_formation.get('name', '')
        else:
            formation_name = str(first_formation)
        if formation_name:
            parts.append(formation_name)

    # Operator (use short name)
    operator = data.get('operator') or data.get('applicant')
    if operator:
        parts.append(extract_last_name(operator))

    # Year
    if data.get('year'):
        parts.append(str(data['year']))

    return " - ".join(parts)


def name_lease_amendment(data: Dict[str, Any]) -> str:
    """Lease Amendment - {County} - {Legal} - {Operator/Lessee} - {Year}"""
    parts = ["Lease Amendment"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    operator = data.get('operator') or data.get('lessee') or data.get('lessee_name')
    if operator:
        parts.append(extract_last_name(operator))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_lease_extension(data: Dict[str, Any]) -> str:
    """Lease Extension - {County} - {Legal} - {Operator/Lessee} - {Year}"""
    parts = ["Lease Extension"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    operator = data.get('operator') or data.get('lessee') or data.get('lessee_name')
    if operator:
        parts.append(extract_last_name(operator))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_drilling_permit(data: Dict[str, Any]) -> str:
    """Drilling Permit - {Well Name} - Permit {#} - {Year}"""
    parts = ["Drilling Permit"]
    
    well_name = data.get('well_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 40))
    
    permit_num = data.get('permit_number') or data.get('permit_no') or data.get('api_number')
    if permit_num:
        parts.append(f"Permit {permit_num}")
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_title_opinion(data: Dict[str, Any]) -> str:
    """Title Opinion - {County} - {Legal} - {Attorney/Firm} - {Year}"""
    parts = ["Title Opinion"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    attorney = data.get('attorney') or data.get('law_firm') or data.get('examiner') or data.get('examining_attorney')
    if attorney:
        parts.append(extract_last_name(attorney))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_check_stub(data: Dict[str, Any]) -> str:
    """Check Stub - {Operator} - {Well Name} - {Period}"""
    parts = ["Check Stub"]
    
    operator = data.get('operator') or data.get('payor') or data.get('company')
    if operator:
        parts.append(extract_last_name(operator))
    
    well_name = data.get('well_name') or data.get('property_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 30))
    
    period = format_period(
        data.get('date') or data.get('check_date') or data.get('production_date'),
        data.get('month') or data.get('production_month'),
        data.get('year')
    )
    if period:
        parts.append(period)
    
    return " - ".join(parts)


def name_occ_order(data: Dict[str, Any]) -> str:
    """OCC Order - CD {Number} - {County} - {Year}"""
    parts = ["OCC Order"]
    
    cd_num = clean_cd_number(data.get('cd_number') or data.get('cause_number'))
    if cd_num:
        parts.append(f"CD {cd_num}")
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_suspense_notice(data: Dict[str, Any]) -> str:
    """Suspense Notice - {Operator} - {Well Name} - {Year}"""
    parts = ["Suspense Notice"]
    
    operator = data.get('operator') or data.get('company')
    if operator:
        parts.append(extract_last_name(operator))
    
    well_name = data.get('well_name') or data.get('property_name')
    if well_name:
        parts.append(truncate_name(str(well_name), 35))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_joa(data: Dict[str, Any]) -> str:
    """JOA - {Unit/Well Name} - {Operator} - {Year}"""
    parts = ["JOA"]
    
    unit_name = data.get('unit_name') or data.get('well_name')
    if unit_name:
        parts.append(truncate_name(str(unit_name), 35))
    
    operator = data.get('operator') or data.get('operator_name')
    if operator:
        parts.append(extract_last_name(operator))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_ownership_entity(data: Dict[str, Any]) -> str:
    """
    Detects entity type and formats accordingly:
    - LLC Operating Agreement - {Entity Name} - {State} - {Year}
    - Trust Agreement - {Trust Name} - {Year}
    - Partnership Agreement - {Entity Name} - {State} - {Year}
    - Articles of Incorporation - {Corp Name} - {State} - {Year}
    - Estate Documents - Estate of {Decedent} - {Year}
    """
    entity_name = data.get('entity_name') or data.get('name') or ""
    entity_type = str(data.get('entity_type', '')).lower()
    doc_type = str(data.get('document_type', '')).lower()
    
    # Detect entity type from name or explicit type
    if 'llc' in entity_name.lower() or 'llc' in entity_type or 'operating agreement' in doc_type:
        prefix = "LLC Operating Agreement"
    elif 'trust' in entity_name.lower() or 'trust' in entity_type or 'trust' in doc_type:
        prefix = "Trust Agreement"
        # Trust naming - don't include state
        parts = [prefix]
        if entity_name:
            parts.append(truncate_name(entity_name, 40))
        if data.get('year'):
            parts.append(str(data['year']))
        return " - ".join(parts)
    elif 'partnership' in entity_type or 'lp' in entity_name.lower() or 'partnership' in doc_type:
        prefix = "Partnership Agreement"
    elif 'inc' in entity_name.lower() or 'corp' in entity_name.lower() or 'incorporation' in doc_type:
        prefix = "Articles of Incorporation"
    elif 'estate' in entity_type or 'estate' in doc_type:
        prefix = "Estate Documents"
        decedent = data.get('decedent') or data.get('deceased') or data.get('decedent_name')
        parts = [prefix]
        if decedent:
            parts.append(f"Estate of {decedent}")
        elif entity_name:
            parts.append(entity_name)
        if data.get('year'):
            parts.append(str(data['year']))
        return " - ".join(parts)
    else:
        prefix = "Entity Document"
    
    parts = [prefix]
    
    if entity_name:
        parts.append(truncate_name(entity_name, 40))
    
    state = data.get('state') or data.get('formation_state')
    if state:
        parts.append(state)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_legal_document(data: Dict[str, Any]) -> str:
    """Legal Doc - {Parties} - {Matter Type} - {Year}"""
    parts = ["Legal Doc"]
    
    # Try to get parties
    party1 = data.get('plaintiff') or data.get('party1') or data.get('petitioner')
    party2 = data.get('defendant') or data.get('party2') or data.get('respondent')
    
    if party1 and party2:
        parts.append(f"{extract_last_name(party1)} v {extract_last_name(party2)}")
    elif party1:
        parts.append(extract_last_name(party1))
    
    matter_type = data.get('matter_type') or data.get('case_type') or data.get('document_subtype')
    if matter_type:
        parts.append(truncate_name(str(matter_type), 25))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_correspondence(data: Dict[str, Any]) -> str:
    """Letter - {From} to {To} - {Date}"""
    parts = ["Letter"]
    
    from_party = data.get('from') or data.get('sender')
    to_party = data.get('to') or data.get('recipient')
    
    if from_party and to_party:
        parts.append(f"{extract_last_name(from_party)} to {extract_last_name(to_party)}")
    elif from_party:
        parts.append(f"from {extract_last_name(from_party)}")
    elif to_party:
        parts.append(f"to {extract_last_name(to_party)}")
    
    # Use full date for correspondence
    date = format_date(data.get('date') or data.get('letter_date'), data.get('year'))
    if date:
        parts.append(date)
    
    return " - ".join(parts)


def name_tax_record(data: Dict[str, Any]) -> str:
    """Tax Record - {County} - {Legal} - {Tax Year}"""
    parts = ["Tax Record"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    # Prefer tax_year over document year
    tax_year = data.get('tax_year') or data.get('year')
    if tax_year:
        parts.append(str(tax_year))
    
    return " - ".join(parts)


def name_map(data: Dict[str, Any]) -> str:
    """Map - {County} - {Legal} - {Map Type}"""
    parts = ["Map"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    # Detect or use map type
    map_type = data.get('map_type')
    if not map_type:
        # Try to detect from content
        content = str(data).lower()
        if 'plat' in content:
            map_type = "Plat"
        elif 'survey' in content:
            map_type = "Survey"
        elif 'unit' in content:
            map_type = "Unit Map"
        elif 'well' in content or 'location' in content:
            map_type = "Well Location"
    
    if map_type:
        parts.append(map_type)
    
    return " - ".join(parts)


def name_multi_document(data: Dict[str, Any]) -> str:
    """Multi-Document PDF"""
    return "Multi-Document PDF"


def name_other(data: Dict[str, Any]) -> str:
    """Document - {County} - {Legal} - {Year} (default fallback)"""
    parts = ["Document"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


# Additional specialized naming functions that were in the old code
def name_ratification(data: Dict[str, Any]) -> str:
    """Ratification - {County} - {Legal} - {Ratifying Party} - {Year}"""
    parts = ["Ratification"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    ratifying = data.get('ratifying_party') or data.get('grantor')
    if ratifying:
        parts.append(extract_last_name(ratifying))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_affidavit_of_heirship(data: Dict[str, Any]) -> str:
    """Affidavit of Heirship - Estate of {Decedent} - {County} - {Year}"""
    parts = ["Affidavit of Heirship"]
    
    decedent = data.get('decedent') or data.get('deceased') or data.get('decedent_name')
    if decedent:
        parts.append(f"Estate of {extract_last_name(decedent)}")
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_probate_document(data: Dict[str, Any]) -> str:
    """Probate - Estate of {Decedent} - {County} - Case {#} - {Year}"""
    parts = ["Probate"]
    
    decedent = data.get('decedent') or data.get('deceased') or data.get('decedent_name')
    if decedent:
        parts.append(f"Estate of {extract_last_name(decedent)}")
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    case_num = data.get('case_number') or data.get('probate_number')
    if case_num:
        parts.append(f"Case {case_num}")
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_right_of_way(data: Dict[str, Any]) -> str:
    """Right of Way - {Purpose} - {County} - {Grantee} - {Year}"""
    parts = ["Right of Way"]
    
    purpose = data.get('purpose') or data.get('row_type')
    if purpose:
        parts.append(truncate_name(str(purpose).title(), 25))
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    grantee = data.get('grantee') or data.get('grantee_name') or data.get('company')
    if grantee:
        parts.append(extract_last_name(grantee))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_release_of_lease(data: Dict[str, Any]) -> str:
    """Release of Lease - {County} - {Legal} - {Releasor} - {Year}"""
    parts = ["Release of Lease"]
    
    if data.get('county'):
        county = str(data['county']).strip()
        if not county.lower().endswith('county'):
            county = f"{county} County"
        parts.append(county)
    
    legal = format_legal_description(
        data.get('section'), 
        data.get('township'), 
        data.get('range')
    )
    if legal:
        parts.append(legal)
    
    releasor = data.get('releasor') or data.get('operator') or data.get('lessee')
    if releasor:
        parts.append(extract_last_name(releasor))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_divorce_decree(data: Dict[str, Any]) -> str:
    """Divorce Decree - {Petitioner} v {Respondent} - {Year}"""
    parts = ["Divorce Decree"]
    
    petitioner = data.get('petitioner') or data.get('petitioner_name') or data.get('party1')
    respondent = data.get('respondent') or data.get('respondent_name') or data.get('party2')
    
    if petitioner and respondent:
        parts.append(f"{extract_last_name(petitioner)} v {extract_last_name(respondent)}")
    elif petitioner:
        parts.append(f"{extract_last_name(petitioner)} v [Unknown]")
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_death_certificate(data: Dict[str, Any]) -> str:
    """Death Certificate - {Decedent} - {Year}"""
    parts = ["Death Certificate"]
    
    decedent = data.get('decedent') or data.get('deceased') or data.get('decedent_name') or data.get('name')
    if decedent:
        parts.append(extract_last_name(decedent))
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


def name_power_of_attorney(data: Dict[str, Any]) -> str:
    """POA - {Principal} to {Agent} - {Year}"""
    parts = ["POA"]
    
    principal = data.get('principal') or data.get('principal_name') or data.get('grantor')
    agent = data.get('agent') or data.get('agent_name') or data.get('attorney_in_fact') or data.get('grantee')
    
    if principal and agent:
        parts.append(f"{extract_last_name(principal)} to {extract_last_name(agent)}")
    elif principal:
        parts.append(f"{extract_last_name(principal)} to [Agent]")
    
    if data.get('year'):
        parts.append(str(data['year']))
    
    return " - ".join(parts)


# ============================================================================
# MAIN DISPATCHER
# ============================================================================

# Map category names to their naming functions
NAMING_FUNCTIONS = {
    'mineral_deed': name_mineral_deed,
    'royalty_deed': name_royalty_deed,
    'lease': name_lease,
    'division_order': name_division_order,
    'assignment': name_assignment,
    'pooling_order': name_pooling_order,
    'increased_density_order': name_increased_density_order,
    'change_of_operator_order': name_change_of_operator_order,
    'multi_unit_horizontal_order': name_multi_unit_horizontal_order,
    'spacing_order': name_spacing_order,
    'drilling_and_spacing_order': name_drilling_and_spacing_order,
    'horizontal_drilling_and_spacing_order': name_horizontal_drilling_and_spacing_order,
    'location_exception_order': name_location_exception_order,
    'ratification': name_ratification,
    'affidavit_of_heirship': name_affidavit_of_heirship,
    'probate_document': name_probate_document,
    'right_of_way': name_right_of_way,
    'release_of_lease': name_release_of_lease,
    'lease_amendment': name_lease_amendment,
    'lease_extension': name_lease_extension,
    'divorce_decree': name_divorce_decree,
    'death_certificate': name_death_certificate,
    'power_of_attorney': name_power_of_attorney,
    'drilling_permit': name_drilling_permit,
    'title_opinion': name_title_opinion,
    'check_stub': name_check_stub,
    'occ_order': name_occ_order,
    'suspense_notice': name_suspense_notice,
    'joa': name_joa,
    'joint_operating_agreement': name_joa,
    'ownership_entity': name_ownership_entity,
    'legal_document': name_legal_document,
    'correspondence': name_correspondence,
    'tax_record': name_tax_record,
    'map': name_map,
    'multi_document': name_multi_document,
    'other': name_other,
}


def generate_display_name_new(category: str, extracted_data: Dict[str, Any]) -> str:
    """
    Generate a smart display name for a document based on its category and extracted data.
    
    Args:
        category: The document category (e.g., 'mineral_deed', 'lease', etc.)
        extracted_data: Dictionary containing extracted document metadata
        
    Returns:
        A formatted display name string
    """
    # Normalize category name
    normalized_category = category.lower().replace(' ', '_').replace('-', '_')
    
    # Get the appropriate naming function
    naming_func = NAMING_FUNCTIONS.get(normalized_category, name_other)
    
    # Generate the name
    display_name = naming_func(extracted_data)
    
    # Fallback if we only have the type
    if display_name == category or display_name == "Document":
        # Try to at least add county or year
        county = extracted_data.get('county')
        year = extracted_data.get('year')
        if county:
            display_name = f"{category} - {county}"
        elif year:
            display_name = f"{category} - {year}"
        else:
            display_name = category
    
    return display_name


# ============================================================================
# COMPATIBILITY WRAPPER
# ============================================================================

def generate_display_name(extraction: dict) -> str:
    """
    Wrapper to maintain compatibility with existing code.
    
    Args:
        extraction: Dictionary from document extraction containing doc_type and other fields
    
    Returns:
        Formatted display name string
    """
    category = extraction.get('doc_type', 'other')
    
    # Prepare flattened data structure
    data = {
        'year': get_year_from_dates(extraction),
    }
    
    # Handle legal_description separately since it's often nested
    legal = extraction.get('legal_description', {})
    if isinstance(legal, dict):
        data['county'] = legal.get('county')
        data['section'] = legal.get('section')
        data['township'] = legal.get('township')
        data['range'] = legal.get('range')
    
    # Add all other fields from extraction
    for key, value in extraction.items():
        if key not in ['legal_description', 'doc_type']:
            data[key] = value
    
    # Use the new system
    return generate_display_name_new(category, data)


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