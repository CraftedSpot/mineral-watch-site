/**
 * Test script to verify KV completion data lookup
 */

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const KV_NAMESPACE_ID = 'd39109ffa98d4f4d999ee37098d0c13e';

async function testKVLookup(apiNumber) {
  console.log(`🔍 Testing KV lookup for API: ${apiNumber}`);
  
  const cacheKey = `well:${apiNumber}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${cacheKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Found completion data:`);
      console.log(`   📍 Well: ${data.wellName || 'Unknown'}`);
      console.log(`   🏔️  Formation: ${data.formationName || 'Unknown'}`);
      console.log(`   ⛽ IP Gas: ${data.ipGas || 0} MCF/day`);
      console.log(`   🛢️  IP Oil: ${data.ipOil || 0} BBL/day`);
      console.log(`   📅 Completion: ${data.completionDate || 'Unknown'}`);
      console.log(`   📊 Source: ${data.source}`);
      return data;
    } else {
      console.log(`❌ API ${apiNumber} not found in KV cache`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error looking up API ${apiNumber}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🧪 Testing COMPLETIONS_CACHE KV lookup functionality\n');
  
  // Test APIs
  const testAPIs = [
    '3515322352', // The requested API (should not be found)
    '3500120022', // Known API from CSV (should be found)
    '3500300099', // Another known API
  ];
  
  for (const api of testAPIs) {
    await testKVLookup(api);
    console.log(''); // Empty line for readability
  }
}

if (require.main === module) {
  main();
}