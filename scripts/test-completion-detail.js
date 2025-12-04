/**
 * Test script to check detailed completion data
 */

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const KV_NAMESPACE_ID = 'd39109ffa98d4f4d999ee37098d0c13e';

async function getCompletionDetail(apiNumber) {
  console.log(`🔍 Getting detailed completion data for API: ${apiNumber}`);
  
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
      console.log('📊 Full completion data:');
      console.log(JSON.stringify(data, null, 2));
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
  console.log('🔍 Testing detailed completion data lookup\n');
  
  // Test the well that was working before
  await getCompletionDetail('3500300099');
}

if (require.main === module) {
  main();
}