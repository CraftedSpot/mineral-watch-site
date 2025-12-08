// Test token generation and validation
async function generateTrackToken(userId, apiNumber, expiration, secret) {
  const payload = `${userId}:${apiNumber}:${expiration}:${secret}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function testToken() {
  const userId = 'recEpgbS88AbuzAH8';
  const apiNumber = '3501726026';
  const expiration = 1765344256;
  const secret = 'test-secret-123'; // Replace with actual secret
  
  const token = await generateTrackToken(userId, apiNumber, expiration, secret);
  
  console.log('Test Token Generation:');
  console.log('User ID:', userId);
  console.log('API Number:', apiNumber);
  console.log('Expiration:', expiration);
  console.log('Token:', token);
  console.log('Token first 8 chars:', token.substring(0, 8));
  
  // Test with the actual token from the URL
  const actualToken = '8a9145f5ac566ff522dc02155a387421e52e5eee0ed5bebbd135af2450a20e29';
  console.log('\nActual token first 8 chars:', actualToken.substring(0, 8));
  console.log('Tokens match:', token === actualToken);
}

testToken();