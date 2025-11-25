/**
 * Test URL extraction logic for A2A agents
 * Run with: node test-url-extraction.mjs
 */

// Simulate the ANS API response you provided earlier
const mockAgent = {
  "ansName": "a2a://www-godaddy-com.Airo.Godaddy.v1.0.0.ans-testing1.com",
  "agentName": "www-godaddy-com",
  "agentCapability": "Airo",
  "protocol": "a2a",
  "provider": "Godaddy",
  "version": "1.0.0",
  "extension": "ans-testing1.com",
  "endpoint": "a2a://www-godaddy-com.Airo.Godaddy.v1.0.0.ans-testing1.com",
  "links": [
    {
      "rel": "agent-details",
      "href": "https://api.ote-godaddy.com/v1/agents/a2a/www-godaddy-com.Airo.Godaddy.v1.0.0.ans-testing1.com"
    },
    {
      "rel": "server-certificates",
      "href": "https://api.ote-godaddy.com/v1/agents/a2a/www-godaddy-com.Airo.Godaddy.v1.0.0.ans-testing1.com/certificates/server"
    },
    {
      "rel": "identity-certificates",
      "href": "https://api.ote-godaddy.com/v1/agents/a2a/www-godaddy-com.Airo.Godaddy.v1.0.0.ans-testing1.com/certificates/identity"
    }
  ],
  "ttl": 300,
  "registrationTimestamp": "2025-11-13T19:19:19.109645Z",
  "protocolExtensions": {
    "a2a": {
      "url": "https://www-godaddy-com.ans-testing1.com/agent",
      "remotes": [
        {
          "url": "http://localhost:8080/invoke"
        }
      ]
    }
  }
};

console.log('🧪 Testing URL Extraction Logic\n');
console.log('📦 Mock Agent Data:', JSON.stringify(mockAgent, null, 2));
console.log('\n');

// Test the extraction logic (same as in trusted-business-service.ts)
let url = '';
let protocol;

try {
  console.log(`🔍 Extracting URL for agent "${mockAgent.agentName}":`);
  console.log(`   hasMcpRemotes: ${!!mockAgent.protocolExtensions?.mcp?.remotes?.[0]?.url}`);
  console.log(`   hasA2aRemotes: ${!!mockAgent.protocolExtensions?.a2a?.remotes?.[0]?.url}`);
  console.log(`   hasA2aUrl: ${!!mockAgent.protocolExtensions?.a2a?.url}`);
  console.log(`   a2aRemotesUrl: ${mockAgent.protocolExtensions?.a2a?.remotes?.[0]?.url}`);
  console.log(`   a2aUrl: ${mockAgent.protocolExtensions?.a2a?.url}`);
  console.log('');

  // Check for MCP protocol: protocolExtensions.mcp.remotes[0].url
  if (mockAgent.protocolExtensions?.mcp?.remotes?.[0]?.url) {
    url = mockAgent.protocolExtensions.mcp.remotes[0].url;
    protocol = 'mcp';
    console.log(`   ✓ Using MCP remote URL: ${url}`);
  }
  // Check for A2A protocol: protocolExtensions.a2a.remotes[0].url
  else if (mockAgent.protocolExtensions?.a2a?.remotes?.[0]?.url) {
    url = mockAgent.protocolExtensions.a2a.remotes[0].url;
    protocol = 'a2a';
    console.log(`   ✓ Using A2A remote URL: ${url}`);
  }
  // Fallback to old path for backwards compatibility
  else if (mockAgent.protocolExtensions?.acp?.url) {
    url = mockAgent.protocolExtensions.acp.url;
    protocol = 'mcp';
    console.log(`   ✓ Using legacy ACP URL: ${url}`);
  }
  // Last resort fallback
  else if (mockAgent.endpoint) {
    url = mockAgent.endpoint;
    protocol = 'mcp';
    console.log(`   ✓ Using endpoint fallback: ${url}`);
  } else {
    console.warn(`   ⚠️  No URL found for agent`);
  }
} catch (error) {
  console.warn(`⚠️  Error extracting URL:`, error);
  url = '';
}

console.log('');
console.log('📍 Final Results:');
console.log(`   Protocol: ${protocol}`);
console.log(`   URL: ${url}`);
console.log('');

// Verify the result
const expectedUrl = 'http://localhost:8080/invoke';
const expectedProtocol = 'a2a';

if (url === expectedUrl && protocol === expectedProtocol) {
  console.log('✅ SUCCESS! Extracted correct URL and protocol');
  console.log(`   Expected: ${expectedProtocol}://${expectedUrl}`);
  console.log(`   Got: ${protocol}://${url}`);
} else {
  console.log('❌ FAILED! Extracted wrong URL or protocol');
  console.log(`   Expected: ${expectedProtocol} protocol with URL ${expectedUrl}`);
  console.log(`   Got: ${protocol} protocol with URL ${url}`);
}
