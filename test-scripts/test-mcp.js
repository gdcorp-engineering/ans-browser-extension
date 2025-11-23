/**
 * Test MCP Server Call
 *
 * This script tests calling the MCP server directly to verify it works
 */

const https = require('https');

// Read ANS API token from Chrome storage
const chrome = require('chrome-storage-local');

async function testMCPCall() {
  console.log('🧪 Testing MCP Server Call...\n');

  // You need to replace this with your actual ANS API token
  const ANS_API_TOKEN = process.env.ANS_API_TOKEN || 'YOUR_TOKEN_HERE';

  if (ANS_API_TOKEN === 'YOUR_TOKEN_HERE') {
    console.error('❌ Please set ANS_API_TOKEN environment variable');
    console.error('   Run: export ANS_API_TOKEN="your-token-here"');
    process.exit(1);
  }

  const serverUrl = 'https://cuzu3hqrxnfig.agenth.godaddy.com/mcp';
  const sessionId = Date.now().toString();

  const requestBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'get_site_name',
      arguments: {
        operation: 'get'
      }
    }
  });

  console.log('📍 Server URL:', serverUrl);
  console.log('📍 Session ID:', sessionId);
  console.log('📤 Request body:', requestBody);
  console.log();

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${ANS_API_TOKEN}`,
      'mcp-session-id': sessionId,
      'Content-Length': Buffer.byteLength(requestBody)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(serverUrl, options, (res) => {
      console.log('📥 Response Status:', res.statusCode);
      console.log('📥 Response Headers:', JSON.stringify(res.headers, null, 2));
      console.log();

      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('📥 Response Body:', data);
        console.log();

        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            console.log('✅ Success!');
            console.log('📊 Parsed result:', JSON.stringify(result, null, 2));
            resolve(result);
          } catch (e) {
            console.log('⚠️  Response is not JSON');
            resolve(data);
          }
        } else {
          console.error('❌ Request failed with status:', res.statusCode);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error);
      reject(error);
    });

    req.write(requestBody);
    req.end();
  });
}

// Run the test
testMCPCall()
  .then(() => {
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
