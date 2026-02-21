#!/usr/bin/env python3
"""
Generate SQL to seed the formation_normalization table.
Maps all 1,147 raw OCC formation names to canonical groups.

Groups are ordered by well count and geological significance for Oklahoma:
  1. Woodford (~7,000 wells) - Major SCOOP/STACK shale play
  2. Mississippian (~9,500 wells) - Miss Lime play (Meramec, Osage, Chester, Sycamore)
  3. Hunton (~1,700 wells) - Silurian-Devonian carbonate (includes Misener)
  4. Cleveland (~1,250 wells) - Pennsylvanian sand
  5. Viola (~1,050 wells) - Ordovician carbonate
  6. Bartlesville (~1,020 wells) - Cherokee Group sand
  7. Oswego (~950 wells) - Missourian lime (Big Lime)
  8. Deese (~850 wells) - Desmoinesian
  9. Tonkawa (~700 wells) - Missourian sand
  10. Marmaton (~650 wells) - Des Moines
  11. Red Fork (~620 wells) - Cherokee Group sand
  12. Permian (~700 wells) - Wolfcamp, Chase, Council Grove, etc.
  13. Springer (~500 wells) - Late Mississippian / Early Pennsylvanian
  14. Hoxbar (~550 wells) - Missourian
  15. Cherokee (~500 wells) - Cherokee Group catch-all (Skinner, Prue, Booch, etc.)
  16. Morrow (~500 wells) - Early Pennsylvanian
  17. Atoka (~350 wells) - Atokan (Spiro, Red Oak)
  18. Hartshorne (~350 wells) - Penn coal/sand
  19. Des Moines (~400 wells) - Des Moines catch-all
  20. Arbuckle (~400 wells) - Deep Cambrian-Ordovician carbonate
  21. Simpson (~350 wells) - Ordovician sands (Wilcox, Oil Creek, McLish, Bromide)
  22. Granite Wash (~200 wells) - Various ages, horizontal play
  23. Cromwell (~200 wells) - Penn sand
  24. Cottage Grove (~260 wells) - Missourian
  25. Other - Everything else
"""

import re

# Read the raw formation names from the exported file
formations = []
with open('/tmp/all_formations.txt', 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t', 1)
        if len(parts) == 2:
            count = int(parts[0].strip())
            name = parts[1].strip()
            formations.append((name, count))

def classify(name):
    """Classify a raw formation name into (canonical_name, formation_group)."""
    upper = name.upper().strip()

    # === WOODFORD === (Devonian-Mississippian shale)
    if any(w in upper for w in ['WOODFORD', 'WDFD', 'WODFORD', 'WOOFORD', 'WOODORD', 'WOODWORD', 'WOODFROD', 'WOODWARD']):
        # WOODWARD is a typo for Woodford based on context
        if upper == 'WOODWARD':
            return ('Woodford', 'Woodford')
        return ('Woodford', 'Woodford')

    # === SYCAMORE === (Late Devonian - Early Mississippian)
    if 'SYCAMORE' in upper:
        return ('Sycamore', 'Mississippian')

    # === MERAMEC === (Mississippian subunit)
    if 'MERAMEC' in upper or 'MERAMAC' in upper:
        return ('Meramec', 'Mississippian')

    # === CHESTER === (Upper Mississippian)
    # Must check before general Mississippian since some Chester entries don't say "MISS"
    if re.match(r'^CHESTER\b', upper) or upper.startswith('UNCONFORMITY CHESTER') or upper.startswith('UNCON-CHESTER'):
        return ('Chester', 'Mississippian')

    # === MISSISSIPPIAN === (huge family - 30+ variants, 9,500 wells)
    # Check for MISSOURIAN first to exclude it
    if 'MISSOURI' in upper and 'MISSISSIP' not in upper and 'MISS ' not in upper and "MISS'" not in upper:
        # Missourian = Pennsylvanian age, not Mississippian
        if 'GRANITE WASH' in upper:
            return ('Granite Wash', 'Granite Wash')
        if 'PENNSYLVANIAN MISSOURI' in upper:
            return ('Pennsylvanian', 'Other Penn')
        return ('Missourian', 'Other Penn')

    if any(m in upper for m in ['MISSISSIP', 'MISS\'AN', 'MSSP', 'MISSIPPIAN']):
        return ('Mississippian', 'Mississippian')
    if re.match(r'^MISS[\s(]', upper) or re.match(r'^MISS$', upper):
        return ('Mississippian', 'Mississippian')
    if upper.startswith('MISS LM') or upper.startswith('MISS LIME') or upper.startswith('MISS SOLID'):
        return ('Mississippian', 'Mississippian')
    if upper.startswith('MISS CHAT') or upper.startswith('MISS OSAGE') or upper.startswith('MISS SAND'):
        return ('Mississippian', 'Mississippian')
    if upper.startswith('MISS REEF') or upper.startswith('MISS UNCONF') or upper.startswith('MISS MERAMEC'):
        return ('Mississippian', 'Mississippian')
    if upper == 'CANEY':  # Caney Shale = Mississippian age in Oklahoma
        return ('Caney', 'Mississippian')
    if upper == 'ST LOUIS' or upper == 'ST GENEVIEVE':
        return ('Mississippian', 'Mississippian')

    # === HUNTON === (Silurian-Devonian)
    if 'HUNTON' in upper or 'CHIMNEY HILL' in upper or upper.startswith('BOIS D'):
        if 'MISENER' in upper or 'MISNER' in upper or 'MEISNER' in upper:
            return ('Misener-Hunton', 'Hunton')
        return ('Hunton', 'Hunton')

    # === MISENER === (Devonian - base of Woodford)
    if 'MISENER' in upper or 'MISNER' in upper or 'MEISNER' in upper:
        return ('Misener', 'Hunton')

    # === VIOLA === (Ordovician)
    if upper.startswith('VIOLA') or upper == 'VILA':
        return ('Viola', 'Viola')

    # === SYLVAN === (Ordovician shale, above Viola)
    if upper.startswith('SYLVAN'):
        return ('Sylvan', 'Viola')

    # === SIMPSON GROUP === (Ordovician sands)
    if upper.startswith('SIMPSON'):
        return ('Simpson', 'Simpson')
    if upper.startswith('WILCOX') or upper.endswith('WILCOX') or 'WILCOX' in upper:
        return ('Wilcox', 'Simpson')
    if '1ST WILCOX' in upper or '2ND WILCOX' in upper or 'FIRST WILCOX' in upper or 'SECOND WILCOX' in upper:
        return ('Wilcox', 'Simpson')
    if 'OIL CREEK' in upper:
        return ('Oil Creek', 'Simpson')
    if upper.startswith('MCLISH') or upper.startswith('MCLISH') or upper == 'BASIL MCLISH':
        return ('McLish', 'Simpson')
    if upper.startswith('BROMIDE') or re.match(r'^\dST BROMIDE', upper) or re.match(r'^\d(ND|RD) BROMIDE', upper):
        return ('Bromide', 'Simpson')
    if upper.startswith('1ST BROMIDE') or upper.startswith('2ND BROMIDE') or upper.startswith('3RD BROMIDE'):
        return ('Bromide', 'Simpson')
    if 'TULIP CREEK' in upper:
        return ('Tulip Creek', 'Simpson')
    if upper == 'KINDBLADE UPPER':
        return ('Simpson', 'Simpson')
    if upper.startswith('JOHNSON (SIMPSON)'):
        return ('Simpson', 'Simpson')

    # === ARBUCKLE === (Cambrian-Ordovician)
    if 'ARBUCKLE' in upper:
        return ('Arbuckle', 'Arbuckle')
    if upper == 'BROWN DOLOMITE' or upper == 'Brown Dolomite':
        return ('Arbuckle', 'Arbuckle')
    if upper == 'WEST SPRING CREEK   /OF THE ARBUCKLE/' or 'SPRING CREEK' in upper:
        return ('Arbuckle', 'Arbuckle')

    # === CLEVELAND === (Penn - Des Moines)
    if 'CLEVELAND' in upper or upper == 'CLEVLEAND':
        return ('Cleveland', 'Cleveland')

    # === TONKAWA === (Missourian sand)
    if 'TONKAWA' in upper or upper in ('TONIKAWA', 'TOKAWA'):
        return ('Tonkawa', 'Tonkawa')

    # === OSWEGO / BIG LIME === (Missourian)
    if 'OSWEGO' in upper:
        return ('Oswego', 'Oswego')
    if 'BIG LIME' in upper:
        return ('Oswego', 'Oswego')

    # === MARMATON === (Des Moines)
    if 'MARMATON' in upper or 'MARMOTON' in upper:
        return ('Marmaton', 'Marmaton')

    # === COTTAGE GROVE === (Missourian)
    if 'COTTAGE GROVE' in upper or 'COTT GRVE' in upper:
        return ('Cottage Grove', 'Cottage Grove')

    # === RED FORK === (Cherokee)
    if 'RED FORK' in upper or 'REDFORK' in upper:
        return ('Red Fork', 'Red Fork')

    # === BARTLESVILLE === (Cherokee)
    if 'BARTLESVILLE' in upper or 'BARTLESVILE' in upper:
        return ('Bartlesville', 'Bartlesville')
    if 'BLUEJACKET' in upper:
        return ('Bartlesville', 'Bartlesville')

    # === SKINNER === (Cherokee)
    if 'SKINNER' in upper:
        return ('Skinner', 'Cherokee')

    # === PRUE === (Cherokee)
    if upper.startswith('PRUE'):
        return ('Prue', 'Cherokee')

    # === BOOCH === (Cherokee)
    if 'BOOCH' in upper:
        return ('Booch', 'Cherokee')

    # === CHEROKEE === (catch-all Cherokee Group)
    if 'CHEROKEE' in upper:
        return ('Cherokee', 'Cherokee')
    if upper.startswith('VERDIGRIS'):
        return ('Cherokee', 'Cherokee')
    if upper.startswith('INOLA'):
        return ('Cherokee', 'Cherokee')

    # === GRANITE WASH === (various ages - distinct horizontal play)
    if 'GRANITE WASH' in upper:
        return ('Granite Wash', 'Granite Wash')

    # === DES MOINES === (catch-all Des Moines)
    if 'DES MOINES' in upper or 'DES MO' in upper or 'DESMOINES' in upper or 'DESMOINESIAN' in upper:
        return ('Des Moines', 'Des Moines')

    # === DEESE === (Desmoinesian)
    if 'DEESE' in upper:
        return ('Deese', 'Deese')
    if upper.startswith('HART') and ('DEESE' in upper or 'GOLDEN TREND' in upper):
        return ('Deese', 'Deese')
    if upper in ('HART', 'HART UP', 'HART B'):
        return ('Hart', 'Deese')
    if upper in ('GIBSON', 'GILCREASE', 'GILCREASE UP', 'GILCREASE LOW', 'GILCREASE SAND'):
        return ('Deese', 'Deese')
    if upper in ('MARCHAND', 'MARCHAND UP', 'MARCHAND LOW', 'MARCHAND UPPER', 'MARCHAND SUBTHRUST',
                 'MARCHAND(VERDEN)', 'MARCHAND (VERDEN)', 'MARCHAND-HOXBAR', 'MARCHAND (HOXBAR)',
                 'UPPER MARCHAND'):
        return ('Marchand', 'Deese')
    if upper.startswith('MARCHAND'):
        return ('Marchand', 'Deese')

    # === HOXBAR === (Missourian)
    if 'HOXBAR' in upper:
        return ('Hoxbar', 'Hoxbar')
    if upper.startswith('WADE') or upper.startswith('DOWNTHROWN WADE'):
        return ('Hoxbar', 'Hoxbar')
    if upper.startswith('DYKEMAN'):
        return ('Hoxbar', 'Hoxbar')
    if upper.startswith('MEDRANO'):
        return ('Hoxbar', 'Hoxbar')

    # === SPRINGER === (Late Miss / Early Penn)
    if 'SPRINGER' in upper or upper == 'SPRINGR' or upper == 'SPINGER' or upper == 'SPRING':
        return ('Springer', 'Springer')
    if upper.startswith('GODDARD'):
        return ('Springer', 'Springer')
    if upper.startswith('SIMS') or upper.startswith('2ND SIMS') or upper.startswith('3RD SIMS'):
        return ('Springer', 'Springer')
    if upper == 'CUNNINGHAM' or upper.startswith('CUNNINGHAM'):
        return ('Springer', 'Springer')
    if upper == 'BRITT':
        return ('Springer', 'Springer')
    if upper.startswith('BOATWRIGHT'):
        return ('Springer', 'Springer')
    if upper.startswith('TUSSY'):
        return ('Tussy', 'Springer')
    if upper.startswith('DORNICK HILLS'):
        return ('Springer', 'Springer')
    if upper == 'WAPANUCKA' or upper.startswith('WAPANUCKA'):
        return ('Springer', 'Springer')

    # === MORROW === (Early Penn)
    if 'MORROW' in upper or upper == 'MORROWA':
        return ('Morrow', 'Morrow')
    if upper.startswith('PURDY'):
        return ('Morrow', 'Morrow')

    # === ATOKA === (Atokan)
    if 'ATOKA' in upper:
        return ('Atoka', 'Atoka')
    if 'SPIRO' in upper:
        return ('Spiro', 'Atoka')
    if 'RED OAK' in upper:
        return ('Red Oak', 'Atoka')
    if 'FANSHAWE' in upper:
        return ('Atoka', 'Atoka')
    if upper.startswith('SAVANNA') or upper.startswith('SAVANNAH'):
        return ('Atoka', 'Atoka')
    if upper.startswith('PANOLA'):
        return ('Atoka', 'Atoka')
    if upper == 'DIRTY CREEK (MID ATOKA)':
        return ('Atoka', 'Atoka')

    # === HARTSHORNE === (Penn coal/sand)
    if 'HARTSHORNE' in upper:
        return ('Hartshorne', 'Hartshorne')
    if upper.startswith('ROWE') or upper == 'ROWE COAL':
        return ('Hartshorne', 'Hartshorne')

    # === CROMWELL === (Penn sand)
    if 'CROMWELL' in upper:
        return ('Cromwell', 'Cromwell')

    # === PERMIAN === (various)
    if 'PERMIAN' in upper or 'PERMAIN' in upper or upper == 'PEMIAN':
        return ('Permian', 'Permian')
    if 'WOLFCAMP' in upper or 'WOLFCAMPIAN' in upper:
        return ('Wolfcamp', 'Permian')
    if upper.startswith('CHASE') or upper.startswith('COUNCIL GROVE'):
        return ('Permian', 'Permian')
    if upper.startswith('GARBER') or upper == 'GARBER-WELLINGTON':
        return ('Permian', 'Permian')
    if upper.startswith('WELLINGTON') or upper == 'Wellington':
        return ('Permian', 'Permian')
    if upper.startswith('NOBLE') and ('OLSON' in upper or 'OLSEN' in upper):
        return ('Permian', 'Permian')
    if upper.startswith('FORT RILEY'):
        return ('Permian', 'Permian')
    if upper.startswith('HERINGTON'):
        return ('Permian', 'Permian')
    if upper.startswith('NEVA') or upper == 'WREFORD':
        return ('Permian', 'Permian')
    if upper.startswith('ADMIRE') or upper.startswith('WABAUNSEE'):
        return ('Permian', 'Permian')
    if upper.startswith('SHAWNEE') or upper == 'Shawnee':
        return ('Permian', 'Permian')
    if upper.startswith('TOPEKA') or upper.startswith('OREAD'):
        return ('Permian', 'Permian')
    if upper.startswith('RED BEDS'):
        return ('Permian', 'Permian')
    if upper == 'HENNESSY' or upper.startswith('GLORIETA'):
        return ('Permian', 'Permian')
    if upper.startswith('PONTOTOC') or upper == 'POTOTOC':
        return ('Pontotoc', 'Permian')

    # === VIRGILIAN === (Late Penn)
    if 'VIRGIL' in upper:
        return ('Virgilian', 'Other Penn')

    # === CISCO === (Penn)
    if upper.startswith('CISCO'):
        return ('Cisco', 'Other Penn')

    # === STRAWN === (Des Moines equivalent)
    if upper.startswith('STRAWN'):
        return ('Strawn', 'Des Moines')

    # === CANYON === (Missourian equivalent)
    if upper.startswith('CANYON'):
        return ('Canyon', 'Other Penn')

    # === DOUGLAS === (Missourian)
    if upper.startswith('DOUGLAS'):
        return ('Douglas', 'Other Penn')

    # === LOCO === (Springer age)
    if upper.startswith('LOCO'):
        return ('Loco', 'Springer')

    # === DUTCHER === (Cherokee age)
    if upper.startswith('DUTCHER'):
        return ('Dutcher', 'Cherokee')

    # === LAYTON === (Missourian)
    if upper.startswith('LAYTON') or upper == 'UP. LAYTON':
        return ('Layton', 'Other Penn')
    if upper.startswith('OSAGE LAYTON'):
        return ('Layton', 'Other Penn')

    # === HEALDTON === (south Oklahoma)
    if 'HEALDTON' in upper or 'HEALDON' in upper or 'HEALSTON' in upper:
        return ('Healdton', 'Other')

    # === EARLSBORO === (Hunton age, south-central OK)
    if 'EARLSBORO' in upper:
        return ('Earlsboro', 'Hunton')

    # === PENN SANDS (generic) ===
    if upper.startswith('PENN ') or upper == 'PENNSYLVANIAN' or upper.startswith('PENNSYLVANIAN') or upper == 'PENNSYLVANIA':
        return ('Pennsylvanian', 'Other Penn')

    # === GUYMON-HUGOTON === (Permian - panhandle gas)
    if 'GUYMON' in upper or 'HUGOTON' in upper or 'HYGOTON' in upper:
        return ('Guymon-Hugoton', 'Permian')

    # === KANSAS CITY / LANSING === (Missourian)
    if 'KANSAS CITY' in upper or 'LANSING' in upper or 'KAN CITY' in upper:
        return ('Kansas City-Lansing', 'Other Penn')

    # === HOGSHOOTER === (Missourian)
    if upper.startswith('HOGSHOOTER'):
        return ('Hogshooter', 'Other Penn')

    # === ALLEN === (Simpson age)
    if upper.startswith('ALLEN'):
        return ('Allen', 'Simpson')
    if upper.startswith('SENORA'):
        return ('Senora', 'Simpson')

    # === CHESTER that got through ===
    if 'CHESTER' in upper:
        return ('Chester', 'Mississippian')

    # === Known formations with small counts ===
    known_map = {
        'FORTUNA': ('Fortuna', 'Permian'),
        'Fortuna': ('Fortuna', 'Permian'),
        'BURGESS': ('Burgess', 'Cherokee'),
        'Burgen': ('Burgess', 'Cherokee'),
        'BURGEN': ('Burgess', 'Cherokee'),
        'CALVIN': ('Calvin', 'Atoka'),
        'CALVIN LOW': ('Calvin', 'Atoka'),
        'CALVIN MID': ('Calvin', 'Atoka'),
        'CALVIN UPPER': ('Calvin', 'Atoka'),
        'CALVIN UP': ('Calvin', 'Atoka'),
        'LOWER CALVIN': ('Calvin', 'Atoka'),
        'GLENN': ('Glenn', 'Bartlesville'),
        'GLENN (BARTLESVILLE) SAND': ('Glenn', 'Bartlesville'),
        'TUCKER': ('Tucker', 'Cherokee'),
        'TANEHA': ('Taneha', 'Cherokee'),
        'ROBBERSON': ('Robberson', 'Cherokee'),
        'THURMAN': ('Thurman', 'Springer'),
        'THURMAN 3': ('Thurman', 'Springer'),
        'GOODWIN': ('Goodwin', 'Springer'),
        'GOODWIN MID': ('Goodwin', 'Springer'),
        'GOODWIN 2': ('Goodwin', 'Springer'),
        'HOOVER': ('Hoover', 'Cherokee'),
        'HOOVER UP': ('Hoover', 'Cherokee'),
        'HOOVER LOW          /BASAL/': ('Hoover', 'Cherokee'),
        'HOOVER 2': ('Hoover', 'Cherokee'),
        'PERU': ('Peru', 'Cherokee'),
        'OSBORN': ('Osborn', 'Deese'),
        'OSBORN (5 DEESE)': ('Osborn', 'Deese'),
        'OSBORNE': ('Osborn', 'Deese'),
        'WAYSIDE': ('Wayside', 'Cherokee'),
        'PAWHUSKA': ('Pawhuska', 'Other Penn'),
        'HUMPHREYS': ('Humphreys', 'Cherokee'),
        'HUMPHREY': ('Humphreys', 'Cherokee'),
        'HUMPHRY': ('Humphreys', 'Cherokee'),
        'DEWEY': ('Dewey', 'Other Penn'),
        'MANNING': ('Manning', 'Mississippian'),
        'Manning': ('Manning', 'Mississippian'),
        'MORRIS': ('Morris', 'Des Moines'),
        'HEWITT': ('Hewitt', 'Other'),
        'HEWITT 1': ('Hewitt', 'Other'),
        'TATUMS': ('Tatums', 'Springer'),
        'TATUMS 1': ('Tatums', 'Springer'),
        'TATUMS 2': ('Tatums', 'Springer'),
        'TATUMS UP': ('Tatums', 'Springer'),
        'SAND': ('Unknown Sand', 'Other'),
        'STRAY': ('Stray Sand', 'Other'),
        'STRAY SANDS': ('Stray Sand', 'Other'),
        'STRAY ATOKA': ('Atoka', 'Atoka'),
        'DOLOMITE': ('Dolomite', 'Other'),
        'DOLOMITE WASH': ('Dolomite', 'Other'),
        'SALT SD': ('Salt Sand', 'Other'),
        'NONE': ('Unknown', 'Other'),
        'N/A': ('Unknown', 'Other'),
        'NA': ('Unknown', 'Other'),
        'UNKNOWN FORMATION': ('Unknown', 'Other'),
        'COMMINGLED': ('Unknown', 'Other'),
        'Disposal Formation': ('Disposal', 'Other'),
        'Lime, Shale & Sand': ('Unknown', 'Other'),
        'JACKFORK': ('Jackfork', 'Other'),
        'JACKFORK UP': ('Jackfork', 'Other'),
        'JACKFORK LOW': ('Jackfork', 'Other'),
        'JACKFORK SERIES': ('Jackfork', 'Other'),
        'JACKFORK OVERTHRUST': ('Jackfork', 'Other'),
        'JACKFORK SERIES (SUBTHRUSTED)': ('Jackfork', 'Other'),
        'BIG FORK': ('Big Fork', 'Other'),
        'BIG FORK OVTHRST': ('Big Fork', 'Other'),
        'BIG FORK CHERT': ('Big Fork', 'Other'),
        'BIG FORK CHERT  1ST REPEATED': ('Big Fork', 'Other'),
        'STANLEY': ('Stanley', 'Other'),
        'STANLEY (OVERTHRUSTED)': ('Stanley', 'Other'),
        'ARKANSAS NOVACULITE': ('Novaculite', 'Other'),
        'OGALLALA': ('Ogallala', 'Other'),
        'CRETACEOUS': ('Cretaceous', 'Other'),
        'PRECAMBRIAN': ('Precambrian', 'Other'),
        'BAYOU': ('Bayou', 'Springer'),
        'BAYOU UPPER': ('Bayou', 'Springer'),
        'PITKIN': ('Pitkin', 'Mississippian'),
        'MCALESTER': ('McAlester', 'Atoka'),
        'MCALISTER': ('McAlester', 'Atoka'),
        'MCALASTER': ('McAlester', 'Atoka'),
        'WEWOKA': ('Wewoka', 'Des Moines'),
        'BOGGY': ('Boggy', 'Atoka'),
        'BOGGY LOW (BARTLESVILLE)': ('Boggy', 'Atoka'),
        'SANDERS': ('Sanders', 'Cherokee'),
        'SANDERS 7': ('Sanders', 'Cherokee'),
        'SANDERS 6': ('Sanders', 'Cherokee'),
        'SANDERS 3': ('Sanders', 'Cherokee'),
        'SANDERS7': ('Sanders', 'Cherokee'),
        '7TH SANDERS': ('Sanders', 'Cherokee'),
        'RIVERTON': ('Riverton', 'Cherokee'),
        'SUMMIT': ('Summit', 'Other Penn'),
        'SUMMITT': ('Summit', 'Other Penn'),
        'HOTSON': ('Hotson', 'Cherokee'),
        'ENDICOTT': ('Endicott', 'Other Penn'),
        'Endicott': ('Endicott', 'Other Penn'),
        'LOVELL': ('Lovell', 'Other Penn'),
        'NORRIS': ('Norris', 'Cherokee'),
        'FUSULINID': ('Fusulinid', 'Des Moines'),
        'FUSULINID LOW': ('Fusulinid', 'Des Moines'),
        'Fusulinid Low': ('Fusulinid', 'Des Moines'),
        'FUSILINA': ('Fusulinid', 'Des Moines'),
        'FUSILINA LOW': ('Fusulinid', 'Des Moines'),
        'Fusilina Low': ('Fusulinid', 'Des Moines'),
        'FUSILINID LOW': ('Fusulinid', 'Des Moines'),
        'LOWER FUSULINID': ('Fusulinid', 'Des Moines'),
        'LOWER FUSILINID': ('Fusulinid', 'Des Moines'),
        'UPPER FUSULINID': ('Fusulinid', 'Des Moines'),
        'CHECKERBOARD': ('Checkerboard', 'Cherokee'),
        'PERRY': ('Perry', 'Other Penn'),
        'LONE GROVE': ('Lone Grove', 'Simpson'),
        'LONE GROVE MID': ('Lone Grove', 'Simpson'),
        'LONE GROVE 9': ('Lone Grove', 'Simpson'),
        'LONE GROVE 12': ('Lone Grove', 'Simpson'),
        'TRENTON': ('Trenton', 'Simpson'),
        'TRENTON DOLO': ('Trenton', 'Simpson'),
        'TRENTON (SIMP) DOLO': ('Trenton', 'Simpson'),
        'PRIDDY': ('Priddy', 'Cherokee'),
        'HOTSON': ('Hotson', 'Cherokee'),
        'UNION VALLEY': ('Union Valley', 'Simpson'),
        'UNION VALLEY-CROMWELL': ('Union Valley', 'Simpson'),
        'ASHALINTUBBI': ('Ashalintubbi', 'Other'),
        'PHARAOH': ('Pharaoh', 'Deese'),
        'PICKENS': ('Pickens', 'Other'),
        'PRIMROSE': ('Primrose', 'Other'),
        'ADA': ('Ada', 'Permian'),
        'ADA C': ('Ada', 'Permian'),
        'OSAGE': ('Osage', 'Mississippian'),
        'OSAGE LM': ('Osage', 'Mississippian'),
        'UPPER OSAGE MISSISSIPPI LIME': ('Osage', 'Mississippian'),
        'U MISS\'AN LIME': ('Mississippian', 'Mississippian'),
        'COMMA': ('Unknown', 'Other'),
    }

    if name in known_map:
        return known_map[name]

    # === COAL (Penn) ===
    if 'COAL' in upper and 'HARTSHORNE' not in upper:
        return ('Coal', 'Other Penn')

    # === Catch remaining MISS variants ===
    if 'MISS' in upper:
        return ('Mississippian', 'Mississippian')

    # === Catch remaining OSAGE ===
    if 'OSAGE' in upper:
        return ('Osage', 'Mississippian')

    # === GENERAL CATCHALL ===
    # If we haven't matched, put in Other
    return (name.title() if len(name) > 3 else name, 'Other')


# Generate the mappings
mappings = []
group_counts = {}
for raw_name, count in formations:
    canonical, group = classify(raw_name)
    mappings.append((raw_name, canonical, group))
    group_counts[group] = group_counts.get(group, 0) + count

# Print summary
print("-- Formation Normalization Seed Data")
print(f"-- Generated from {len(formations)} distinct raw formation names")
print(f"-- Mapping to {len(set(m[2] for m in mappings))} formation groups")
print()
print("-- Group summary (by well count):")
for group, count in sorted(group_counts.items(), key=lambda x: -x[1]):
    num_raw = sum(1 for m in mappings if m[2] == group)
    print(f"--   {group:20s}: {count:>6} wells ({num_raw} raw names)")
print()

# Generate SQL in batches (D1 limit: 500 statements per batch)
BATCH_SIZE = 100  # INSERT OR REPLACE per batch
batch_num = 0
batch_stmts = []

for raw_name, canonical, group in mappings:
    escaped_raw = raw_name.replace("'", "''")
    escaped_canonical = canonical.replace("'", "''")
    escaped_group = group.replace("'", "''")
    batch_stmts.append(
        f"INSERT OR REPLACE INTO formation_normalization (raw_name, canonical_name, formation_group) "
        f"VALUES ('{escaped_raw}', '{escaped_canonical}', '{escaped_group}');"
    )

    if len(batch_stmts) >= BATCH_SIZE:
        batch_num += 1
        filename = f"formation-seed-{batch_num:03d}.sql"
        with open(filename, 'w') as f:
            f.write('\n'.join(batch_stmts))
        print(f"-- Wrote {filename} ({len(batch_stmts)} statements)")
        batch_stmts = []

if batch_stmts:
    batch_num += 1
    filename = f"formation-seed-{batch_num:03d}.sql"
    with open(filename, 'w') as f:
        f.write('\n'.join(batch_stmts))
    print(f"-- Wrote {filename} ({len(batch_stmts)} statements)")

print(f"\n-- Total: {batch_num} batch files, {len(mappings)} mappings")

# Also generate the backfill UPDATE
with open('formation-backfill.sql', 'w') as f:
    f.write("-- Backfill wells.formation_group from formation_normalization\n")
    f.write("UPDATE wells SET formation_group = (\n")
    f.write("  SELECT fn.formation_group FROM formation_normalization fn\n")
    f.write("  WHERE fn.raw_name = wells.formation_name\n")
    f.write(") WHERE formation_name IS NOT NULL AND formation_name != '';\n")

print("-- Wrote formation-backfill.sql")
