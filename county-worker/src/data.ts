// All 77 Oklahoma counties: slug → { name, upper }
export interface CountyInfo {
  name: string;
  upper: string;
}

export const COUNTIES: Record<string, CountyInfo> = {
  'adair-county': { name: 'Adair', upper: 'ADAIR' },
  'alfalfa-county': { name: 'Alfalfa', upper: 'ALFALFA' },
  'atoka-county': { name: 'Atoka', upper: 'ATOKA' },
  'beaver-county': { name: 'Beaver', upper: 'BEAVER' },
  'beckham-county': { name: 'Beckham', upper: 'BECKHAM' },
  'blaine-county': { name: 'Blaine', upper: 'BLAINE' },
  'bryan-county': { name: 'Bryan', upper: 'BRYAN' },
  'caddo-county': { name: 'Caddo', upper: 'CADDO' },
  'canadian-county': { name: 'Canadian', upper: 'CANADIAN' },
  'carter-county': { name: 'Carter', upper: 'CARTER' },
  'cherokee-county': { name: 'Cherokee', upper: 'CHEROKEE' },
  'choctaw-county': { name: 'Choctaw', upper: 'CHOCTAW' },
  'cimarron-county': { name: 'Cimarron', upper: 'CIMARRON' },
  'cleveland-county': { name: 'Cleveland', upper: 'CLEVELAND' },
  'coal-county': { name: 'Coal', upper: 'COAL' },
  'comanche-county': { name: 'Comanche', upper: 'COMANCHE' },
  'cotton-county': { name: 'Cotton', upper: 'COTTON' },
  'craig-county': { name: 'Craig', upper: 'CRAIG' },
  'creek-county': { name: 'Creek', upper: 'CREEK' },
  'custer-county': { name: 'Custer', upper: 'CUSTER' },
  'delaware-county': { name: 'Delaware', upper: 'DELAWARE' },
  'dewey-county': { name: 'Dewey', upper: 'DEWEY' },
  'ellis-county': { name: 'Ellis', upper: 'ELLIS' },
  'garfield-county': { name: 'Garfield', upper: 'GARFIELD' },
  'garvin-county': { name: 'Garvin', upper: 'GARVIN' },
  'grady-county': { name: 'Grady', upper: 'GRADY' },
  'grant-county': { name: 'Grant', upper: 'GRANT' },
  'greer-county': { name: 'Greer', upper: 'GREER' },
  'harmon-county': { name: 'Harmon', upper: 'HARMON' },
  'harper-county': { name: 'Harper', upper: 'HARPER' },
  'haskell-county': { name: 'Haskell', upper: 'HASKELL' },
  'hughes-county': { name: 'Hughes', upper: 'HUGHES' },
  'jackson-county': { name: 'Jackson', upper: 'JACKSON' },
  'jefferson-county': { name: 'Jefferson', upper: 'JEFFERSON' },
  'johnston-county': { name: 'Johnston', upper: 'JOHNSTON' },
  'kay-county': { name: 'Kay', upper: 'KAY' },
  'kingfisher-county': { name: 'Kingfisher', upper: 'KINGFISHER' },
  'kiowa-county': { name: 'Kiowa', upper: 'KIOWA' },
  'latimer-county': { name: 'Latimer', upper: 'LATIMER' },
  'le-flore-county': { name: 'Le Flore', upper: 'LE FLORE' },
  'lincoln-county': { name: 'Lincoln', upper: 'LINCOLN' },
  'logan-county': { name: 'Logan', upper: 'LOGAN' },
  'love-county': { name: 'Love', upper: 'LOVE' },
  'major-county': { name: 'Major', upper: 'MAJOR' },
  'marshall-county': { name: 'Marshall', upper: 'MARSHALL' },
  'mayes-county': { name: 'Mayes', upper: 'MAYES' },
  'mcclain-county': { name: 'McClain', upper: 'MCCLAIN' },
  'mccurtain-county': { name: 'McCurtain', upper: 'MCCURTAIN' },
  'mcintosh-county': { name: 'McIntosh', upper: 'MCINTOSH' },
  'murray-county': { name: 'Murray', upper: 'MURRAY' },
  'muskogee-county': { name: 'Muskogee', upper: 'MUSKOGEE' },
  'noble-county': { name: 'Noble', upper: 'NOBLE' },
  'nowata-county': { name: 'Nowata', upper: 'NOWATA' },
  'okfuskee-county': { name: 'Okfuskee', upper: 'OKFUSKEE' },
  'oklahoma-county': { name: 'Oklahoma', upper: 'OKLAHOMA' },
  'okmulgee-county': { name: 'Okmulgee', upper: 'OKMULGEE' },
  'osage-county': { name: 'Osage', upper: 'OSAGE' },
  'ottawa-county': { name: 'Ottawa', upper: 'OTTAWA' },
  'pawnee-county': { name: 'Pawnee', upper: 'PAWNEE' },
  'payne-county': { name: 'Payne', upper: 'PAYNE' },
  'pittsburg-county': { name: 'Pittsburg', upper: 'PITTSBURG' },
  'pontotoc-county': { name: 'Pontotoc', upper: 'PONTOTOC' },
  'pottawatomie-county': { name: 'Pottawatomie', upper: 'POTTAWATOMIE' },
  'pushmataha-county': { name: 'Pushmataha', upper: 'PUSHMATAHA' },
  'roger-mills-county': { name: 'Roger Mills', upper: 'ROGER MILLS' },
  'rogers-county': { name: 'Rogers', upper: 'ROGERS' },
  'seminole-county': { name: 'Seminole', upper: 'SEMINOLE' },
  'sequoyah-county': { name: 'Sequoyah', upper: 'SEQUOYAH' },
  'stephens-county': { name: 'Stephens', upper: 'STEPHENS' },
  'texas-county': { name: 'Texas', upper: 'TEXAS' },
  'tillman-county': { name: 'Tillman', upper: 'TILLMAN' },
  'tulsa-county': { name: 'Tulsa', upper: 'TULSA' },
  'wagoner-county': { name: 'Wagoner', upper: 'WAGONER' },
  'washington-county': { name: 'Washington', upper: 'WASHINGTON' },
  'washita-county': { name: 'Washita', upper: 'WASHITA' },
  'woods-county': { name: 'Woods', upper: 'WOODS' },
  'woodward-county': { name: 'Woodward', upper: 'WOODWARD' },
};

// Reverse lookup: UPPERCASE name → slug
export const UPPER_TO_SLUG: Record<string, string> = {};
for (const [slug, info] of Object.entries(COUNTIES)) {
  UPPER_TO_SLUG[info.upper] = slug;
}

// Rich data for top 10 counties
export interface CountyDetail {
  seat: string;
  area: string;
  play: string;
  formations: string;
  townshipRange: string;
  latitude: number;
  longitude: number;
  neighbors: string[]; // slug references
  heroDescription: string;
  overviewHtml: string;
}

export const COUNTY_DETAILS: Record<string, CountyDetail> = {
  'canadian-county': {
    seat: 'El Reno',
    area: '900 sq mi',
    play: 'STACK',
    formations: 'Woodford, Meramec',
    townshipRange: '11N–14N, 6W–9W',
    latitude: 35.5417,
    longitude: -97.9828,
    neighbors: ['kingfisher-county', 'blaine-county', 'caddo-county', 'grady-county', 'cleveland-county', 'oklahoma-county', 'logan-county'],
    heroDescription: 'Canadian County sits at the heart of Oklahoma\'s STACK play, making it one of the most actively drilled counties in the state. Mineral Watch gives Canadian County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — all in one platform.',
    overviewHtml: `
      <p>Canadian County, located in central Oklahoma just west of Oklahoma City, is one of the most prolific oil and gas producing counties in the state. The county seat is El Reno, and the county covers approximately 900 square miles of prime drilling territory within the STACK play (Sooner Trend, Anadarko, Canadian, and Kingfisher).</p>
      <p>Mineral rights owners in Canadian County benefit from significant horizontal drilling activity targeting the Woodford Shale, Meramec, and Mississippian Lime formations. Multi-unit horizontal wells with 2-mile laterals have become standard, meaning a single well can affect multiple sections — making it critical for mineral owners to stay informed about OCC filings beyond just the sections where they own interests.</p>
      <h3>Common OCC Filings in Canadian County</h3>
      <p>The most frequent filings affecting Canadian County mineral owners are pooling orders (where the OCC forces unleased mineral owners into a drilling unit), spacing applications (establishing the boundaries for horizontal wells that may cross multiple sections), and increased density applications (allowing additional wells in an already-spaced unit). If you receive a pooling order, understanding your options and the associated bonus rates is critical to protecting your mineral interests.</p>
      <h3>What Mineral Watch Does for Canadian County Owners</h3>
      <p>Beyond automated OCC filing alerts, Mineral Watch gives you production tracking and decline curves for every well, AI-powered document extraction for pooling orders and division orders, operator profiles with deduction analysis, pooling bonus benchmarking across comparable sections, and interactive mapping with drilling activity heat maps — the complete mineral intelligence platform for Canadian County.</p>`,
  },
  'grady-county': {
    seat: 'Chickasha',
    area: '1,101 sq mi',
    play: 'SCOOP',
    formations: 'Woodford, Springer',
    townshipRange: '3N–7N, 4W–8W',
    latitude: 34.9917,
    longitude: -97.8892,
    neighbors: ['canadian-county', 'caddo-county', 'comanche-county', 'stephens-county', 'garvin-county', 'mcclain-county', 'cleveland-county'],
    heroDescription: 'Grady County is the epicenter of Oklahoma\'s SCOOP play with intense horizontal drilling in the Woodford and Springer formations. Mineral Watch gives Grady County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping.',
    overviewHtml: `
      <p>Grady County, with its county seat in Chickasha, covers over 1,100 square miles in south-central Oklahoma and is one of the most active drilling counties in the state. It sits squarely in the SCOOP play (South Central Oklahoma Oil Province), a world-class unconventional resource play.</p>
      <p>Horizontal drilling targeting the Woodford Shale and Springer Formation has transformed Grady County into a high-activity area for mineral owners. Multi-unit wells with extended laterals routinely cross section lines, making adjacent section awareness essential.</p>
      <h3>Key Formations and Activity</h3>
      <p>The Woodford Shale and Springer Formation are the primary targets, with wells producing both oil and natural gas. Operators have reported strong initial production rates, and the county consistently ranks among the top in new drilling permits statewide.</p>
      <h3>What Mineral Watch Does for Grady County Owners</h3>
      <p>Beyond automated OCC filing alerts, Mineral Watch gives you production tracking and decline curves for every well, AI-powered document extraction for pooling orders and division orders, operator profiles with deduction analysis, pooling bonus benchmarking across comparable sections, and interactive mapping with drilling activity heat maps — the complete mineral intelligence platform for Grady County.</p>`,
  },
  'blaine-county': {
    seat: 'Watonga',
    area: '928 sq mi',
    play: 'STACK',
    formations: 'Woodford, Meramec, Miss Lime',
    townshipRange: '15N–19N, 10W–13W',
    latitude: 35.8750,
    longitude: -98.4333,
    neighbors: ['major-county', 'dewey-county', 'custer-county', 'caddo-county', 'canadian-county', 'kingfisher-county'],
    heroDescription: 'Blaine County is a core STACK play county with aggressive horizontal drilling in the Woodford, Meramec, and Mississippian Lime. Mineral Watch gives Blaine County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping.',
    overviewHtml: `
      <p>Blaine County, centered around the county seat of Watonga, occupies nearly 930 square miles in northwest-central Oklahoma. It is a core county within the STACK play, with operators targeting multiple prolific formations.</p>
      <p>The Woodford Shale, Meramec, and Mississippian Lime formations are all active targets in Blaine County. The stacked pay zones give operators multiple completion targets, which increases both drilling activity and the complexity of OCC filings affecting mineral owners.</p>
      <h3>Multi-Formation Drilling</h3>
      <p>Operators in Blaine County often drill multiple wells in the same section targeting different formations. This results in frequent spacing and increased density applications at the OCC, as well as pooling orders for each new drilling unit.</p>
      <h3>What Mineral Watch Does for Blaine County Owners</h3>
      <p>Beyond automated OCC filing alerts, Mineral Watch gives you production tracking and decline curves for every well, AI-powered document extraction for pooling orders and division orders, operator profiles with deduction analysis, pooling bonus benchmarking across comparable sections, and interactive mapping with drilling activity heat maps — the complete mineral intelligence platform for Blaine County.</p>`,
  },
  'kingfisher-county': {
    seat: 'Kingfisher',
    area: '905 sq mi',
    play: 'STACK',
    formations: 'Miss Lime, Meramec',
    townshipRange: '15N–19N, 6W–9W',
    latitude: 35.9167,
    longitude: -97.9333,
    neighbors: ['garfield-county', 'blaine-county', 'canadian-county', 'logan-county', 'major-county'],
    heroDescription: 'Kingfisher County is a northern STACK play powerhouse with prolific Mississippian Lime and Meramec wells. Mineral Watch gives Kingfisher County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping.',
    overviewHtml: `
      <p>Kingfisher County, with its county seat in the city of Kingfisher, covers approximately 905 square miles in north-central Oklahoma. It is one of the core counties in the STACK play, known for high-producing Mississippian Lime and Meramec wells.</p>
      <p>The county has seen sustained horizontal drilling activity with operators consistently filing new permits and spacing applications. The Mississippian Lime formation in particular has been a prolific producer in the northern townships.</p>
      <h3>Drilling Trends</h3>
      <p>Extended-reach laterals and multi-well pad development are common in Kingfisher County. Operators frequently file increased density applications to develop additional wells within existing spacing units, creating ongoing filing activity for mineral owners to track.</p>
      <h3>What Mineral Watch Does for Kingfisher County Owners</h3>
      <p>Beyond automated OCC filing alerts, Mineral Watch gives you production tracking and decline curves for every well, AI-powered document extraction for pooling orders and division orders, operator profiles with deduction analysis, pooling bonus benchmarking across comparable sections, and interactive mapping with drilling activity heat maps — the complete mineral intelligence platform for Kingfisher County.</p>`,
  },
  'garfield-county': {
    seat: 'Enid',
    area: '1,058 sq mi',
    play: 'Mississippi Lime',
    formations: 'Miss Lime, Garber-Wellington',
    townshipRange: '20N–24N, 3W–8W',
    latitude: 36.3833,
    longitude: -97.7833,
    neighbors: ['grant-county', 'kay-county', 'noble-county', 'logan-county', 'kingfisher-county', 'major-county'],
    heroDescription: 'Mineral Watch gives Garfield County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering Mississippi Lime, Garber-Wellington, and every other active formation.',
    overviewHtml: `
      <p>Garfield County, with Enid as its county seat, covers over 1,050 square miles in north-central Oklahoma. It has a long and storied history of oil and gas production, with the Mississippi Lime formation being the primary development target in recent decades.</p>
      <p>While newer horizontal plays like the STACK have drawn attention, Garfield County continues to see steady activity in both the Mississippi Lime and the shallower Garber-Wellington formation. Enid serves as a major oil service hub for the region.</p>
      <h3>Production History</h3>
      <p>Garfield County's oil production dates back to the early 1900s, and thousands of wells have been drilled across the county. Both vertical and horizontal wells are active, with newer horizontal completions in the Mississippi Lime revitalizing interest in the area.</p>
      <h3>What Mineral Watch Does for Garfield County Owners</h3>
      <p>Whether you hold minerals in the Miss Lime or Garber-Wellington, Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
  'stephens-county': {
    seat: 'Duncan',
    area: '871 sq mi',
    play: 'Anadarko Basin',
    formations: 'Arbuckle, Sycamore, Springer',
    townshipRange: '1N–4N, 4W–8W',
    latitude: 34.4667,
    longitude: -97.8333,
    neighbors: ['caddo-county', 'grady-county', 'garvin-county', 'carter-county', 'comanche-county', 'cotton-county', 'jefferson-county'],
    heroDescription: 'Mineral Watch gives Stephens County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering the Arbuckle, Sycamore, Springer, and every active formation.',
    overviewHtml: `
      <p>Stephens County, home to the city of Duncan, covers approximately 871 square miles in south-central Oklahoma. The county sits in the southern portion of the Anadarko Basin and has been a significant producer of oil and gas for over a century.</p>
      <p>Key formations include the Arbuckle, Sycamore, and Springer. Both conventional vertical wells and newer horizontal development target these formations, with operators increasingly applying modern completion techniques to legacy fields.</p>
      <h3>Historical Significance</h3>
      <p>Duncan has long been a center for the oil and gas industry, serving as the headquarters for Halliburton. The county's mineral owners have benefited from decades of production, and staying current on new activity is essential as operators continue development.</p>
      <h3>What Mineral Watch Does for Stephens County Owners</h3>
      <p>From legacy Arbuckle wells to new horizontal Springer targets, Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
  'carter-county': {
    seat: 'Ardmore',
    area: '824 sq mi',
    play: 'Ardmore Basin',
    formations: 'Arbuckle, Sycamore, Springer',
    townshipRange: '1S–4S, 1E–4W',
    latitude: 34.2500,
    longitude: -97.2833,
    neighbors: ['stephens-county', 'garvin-county', 'murray-county', 'johnston-county', 'love-county', 'jefferson-county'],
    heroDescription: 'Mineral Watch gives Carter County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering the Arbuckle, Sycamore, Springer, and every active Ardmore Basin formation.',
    overviewHtml: `
      <p>Carter County, with Ardmore as its county seat, covers approximately 824 square miles in southern Oklahoma. The county sits within the Ardmore Basin, a geologically complex area with multiple producing formations.</p>
      <p>The Arbuckle formation, Sycamore, and Springer are primary targets, with both vertical legacy wells and newer horizontal development. The structural geology of the Ardmore Basin creates unique drilling and production patterns.</p>
      <h3>Basin Geology</h3>
      <p>The Ardmore Basin's complex faulting and folding has created numerous trapping mechanisms for oil and gas. While this geology makes development more challenging, it also means mineral interests can be affected by diverse types of OCC filings.</p>
      <h3>What Mineral Watch Does for Carter County Owners</h3>
      <p>Carter County's complex geology means diverse filing types across stacked formations. Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
  'mcclain-county': {
    seat: 'Purcell',
    area: '571 sq mi',
    play: 'SCOOP',
    formations: 'Woodford, Springer',
    townshipRange: '5N–8N, 1W–4W',
    latitude: 35.0117,
    longitude: -97.4500,
    neighbors: ['cleveland-county', 'grady-county', 'garvin-county', 'pontotoc-county', 'pottawatomie-county'],
    heroDescription: 'Mineral Watch gives McClain County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering SCOOP Woodford, Springer, and every active formation.',
    overviewHtml: `
      <p>McClain County, centered around the county seat of Purcell, covers approximately 571 square miles south of Oklahoma City. The county sits in the northern transition zone of the SCOOP play, benefiting from its proximity to both the SCOOP and STACK development areas.</p>
      <p>Horizontal drilling targeting the Woodford Shale and Springer Formation has increased significantly in recent years. The county's position between the more established STACK and SCOOP core areas means new development continues to expand into McClain County.</p>
      <h3>Growing Activity</h3>
      <p>As operators extend their development programs outward from core SCOOP areas, McClain County has seen growing permit and drilling activity. This expanding development means more frequent OCC filings for mineral owners.</p>
      <h3>What Mineral Watch Does for McClain County Owners</h3>
      <p>With SCOOP development expanding into McClain County, new filings are increasing rapidly. Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
  'caddo-county': {
    seat: 'Anadarko',
    area: '1,278 sq mi',
    play: 'Anadarko Basin',
    formations: 'Woodford, Hunton, Springer',
    townshipRange: '6N–12N, 9W–14W',
    latitude: 35.1667,
    longitude: -98.3667,
    neighbors: ['blaine-county', 'custer-county', 'washita-county', 'kiowa-county', 'comanche-county', 'grady-county', 'canadian-county'],
    heroDescription: 'Mineral Watch gives Caddo County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering Woodford, Hunton, Springer, and every active Anadarko Basin formation.',
    overviewHtml: `
      <p>Caddo County, with Anadarko as its county seat, is one of Oklahoma's largest counties at nearly 1,280 square miles. It sits centrally within the Anadarko Basin, one of the deepest sedimentary basins in North America, with a diverse range of producing formations.</p>
      <p>Production comes from multiple horizons including the Woodford Shale, Hunton Lime, Springer Formation, and various other targets. The county bridges the gap between the STACK play to the north and conventional production areas to the south and west.</p>
      <h3>Diverse Production</h3>
      <p>Caddo County's geology supports both conventional vertical wells and modern horizontal completions. The variety of producing formations means OCC filings can involve many different types of drilling units and spacing configurations.</p>
      <h3>What Mineral Watch Does for Caddo County Owners</h3>
      <p>With diverse drilling across multiple formations, Caddo County generates a steady flow of OCC activity. Mineral Watch delivers instant filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
  'custer-county': {
    seat: 'Arapaho',
    area: '990 sq mi',
    play: 'Western STACK',
    formations: 'Woodford, Meramec',
    townshipRange: '12N–16N, 14W–18W',
    latitude: 35.6333,
    longitude: -98.9833,
    neighbors: ['roger-mills-county', 'dewey-county', 'blaine-county', 'caddo-county', 'washita-county', 'beckham-county'],
    heroDescription: 'Mineral Watch gives Custer County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — covering western STACK Woodford, Meramec, and every active formation.',
    overviewHtml: `
      <p>Custer County, with Arapaho as its county seat (Clinton being the largest city), covers approximately 990 square miles in western Oklahoma. The county is part of the western extension of the STACK play, with operators increasingly targeting the Woodford and Meramec formations.</p>
      <p>While traditionally known for conventional production, Custer County has seen growing horizontal drilling activity as operators extend STACK development westward. This expansion brings new opportunities and new OCC filings for mineral owners.</p>
      <h3>Western STACK Expansion</h3>
      <p>As horizontal drilling technology improves and operators delineate the western extent of the STACK play, Custer County has become a growing area of interest. New permits and spacing applications reflect this expanding development frontier.</p>
      <h3>What Mineral Watch Does for Custer County Owners</h3>
      <p>As STACK development expands westward into Custer County, filing activity is growing. Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your sections.</p>`,
  },
};

// Generic description template for counties without custom prose
export function genericOverview(countyName: string): string {
  return `
    <p>${countyName} County is one of Oklahoma's 77 counties with a history of oil and gas production. Mineral rights owners in ${countyName} County should stay informed about OCC filings, drilling permits, and completions that may affect their interests.</p>
    <p>The Oklahoma Corporation Commission regularly processes filings that affect mineral owners throughout the state, including pooling orders, spacing applications, and increased density applications. When a pooling order is issued for your section, you typically have just 20 days to respond — making timely awareness essential.</p>
    <h3>Common OCC Filings</h3>
    <p>Mineral owners in ${countyName} County may encounter pooling orders (forcing unleased owners into drilling units), spacing applications (establishing well unit boundaries), and increased density filings (allowing additional wells). Each filing type can affect your mineral rights and may require a timely response.</p>
    <h3>What Mineral Watch Does for ${countyName} County Owners</h3>
    <p>Mineral Watch delivers instant OCC filing alerts, monthly production tracking, AI-powered document extraction from completion reports and drilling permits, and an interactive county map — so you always know what's happening on your ${countyName} County sections.</p>`;
}

// Generic hero description
export function genericHero(countyName: string): string {
  return `Mineral Watch gives ${countyName} County owners automated OCC alerts, production intelligence, AI document extraction, and interactive mapping — everything you need to manage your mineral interests.`;
}
