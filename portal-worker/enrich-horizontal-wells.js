// Script to enrich horizontal wells with BH location data from OCC
const API_KEY = 'patzzlRoOmcjnOiz3.5ae6cc8222787cc01a23b8f2f239e1d6a301321b1f0b9661e4406c02f24ca562';
const BASE_ID = 'app3j3X29Uvp5stza';
const WELL_LOCATIONS_TABLE = '📍 Well Locations';

// OCC API endpoints
const OCC_WELL_API = 'https://gis.occ.ok.gov/server/rest/services/Hosted/RBDMS_WELLS/FeatureServer/220/query';

async function getHorizontalWells() {
  console.log('Finding horizontal wells...');
  
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELL_LOCATIONS_TABLE)}`);
  url.searchParams.set('filterByFormula', '{Is Horizontal} = TRUE()');
  url.searchParams.set('fields[]', 'API Number');
  url.searchParams.set('pageSize', '100');
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': 'Bearer ' + API_KEY,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  console.log(`Found ${data.records.length} horizontal wells`);
  return data.records;
}

async function fetchWellDetailsFromOCC(apiNumber) {
  // Use the RBDMS_WELLS endpoint
  const wellUrl = new URL(OCC_WELL_API);
  wellUrl.searchParams.set('where', `api = '${apiNumber}'`); // Note: field is 'api' not 'api_number'
  wellUrl.searchParams.set('outFields', '*');
  wellUrl.searchParams.set('f', 'json');
  wellUrl.searchParams.set('resultRecordCount', '1');
  
  try {
    const response = await fetch(wellUrl.toString());
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const attrs = data.features[0].attributes;
      console.log(`Found well data for ${apiNumber}`);
      
      // Check all fields for BH data
      console.log(`Available fields:`, Object.keys(attrs).filter(k => k.toLowerCase().includes('bh') || k.toLowerCase().includes('pbh')));
      
      return {
        source: 'well',
        bhSection: attrs.pbhsection || attrs.pbh_sec || attrs.PBH_Section || attrs.bhsection,
        bhTownship: attrs.pbhtownship || attrs.pbh_twp || attrs.PBH_Township || attrs.bhtownship,
        bhRange: attrs.pbhrange || attrs.pbh_rng || attrs.PBH_Range || attrs.bhrange,
        bhPM: attrs.pbhmeridian || attrs.pbh_mer || attrs.PM || attrs.mer || 'IM',
        lateralLength: attrs.lateral_length,
        drillType: attrs.welltype || attrs.drill_type,
        formation: attrs.formation
      };
    }
  } catch (err) {
    console.error(`Error fetching well for ${apiNumber}:`, err.message);
  }
  
  return null;
}

async function updateWellLocation(recordId, bhData) {
  const updateFields = {};
  
  if (bhData.bhSection) updateFields['BH Section'] = bhData.bhSection.toString();
  if (bhData.bhTownship) updateFields['BH Township'] = bhData.bhTownship;
  if (bhData.bhRange) updateFields['BH Range'] = bhData.bhRange;
  if (bhData.bhPM) updateFields['BH PM'] = bhData.bhPM;
  if (bhData.lateralLength) updateFields['Lateral Length'] = bhData.lateralLength;
  if (bhData.formation) updateFields['Formation'] = bhData.formation;
  
  // Only update if we have BH data
  if (!bhData.bhSection) {
    return { success: false, error: 'No BH location data found' };
  }
  
  const response = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WELL_LOCATIONS_TABLE)}/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: updateFields })
    }
  );
  
  if (response.ok) {
    return { success: true, fields: updateFields };
  } else {
    const error = await response.text();
    return { success: false, error };
  }
}

async function enrichHorizontalWells() {
  console.log('Starting enrichment of horizontal wells...\n');
  
  const horizontalWells = await getHorizontalWells();
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  
  for (let i = 0; i < horizontalWells.length; i++) {
    const well = horizontalWells[i];
    const apiNumber = well.fields['API Number'];
    
    console.log(`\n[${i+1}/${horizontalWells.length}] Processing ${apiNumber}...`);
    
    // Fetch from OCC
    const bhData = await fetchWellDetailsFromOCC(apiNumber);
    
    if (!bhData || !bhData.bhSection) {
      console.log(`❌ No BH data found`);
      notFound++;
      continue;
    }
    
    console.log(`✓ Found ${bhData.source} data: BH at S${bhData.bhSection} T${bhData.bhTownship} R${bhData.bhRange}`);
    
    // Update the record
    const result = await updateWellLocation(well.id, bhData);
    
    if (result.success) {
      console.log(`✅ Updated with:`, Object.keys(result.fields).join(', '));
      updated++;
    } else {
      console.log(`❌ Update failed:`, result.error);
      errors++;
    }
    
    // Rate limit: wait 500ms between API calls
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n========== ENRICHMENT COMPLETE ==========`);
  console.log(`Updated: ${updated}`);
  console.log(`No BH data found: ${notFound}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total processed: ${horizontalWells.length}`);
}

enrichHorizontalWells();