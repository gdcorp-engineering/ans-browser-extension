/**
 * Test script to verify A2A agent connection
 * Run with: node test-a2a-connection.mjs
 * 
 * For local testing with HTTP, set environment variable:
 *   A2A_BASE_URL=http://localhost:8080 node test-a2a-connection.mjs
 */

// Use HTTPS by default, allow HTTP override for local dev via env var
// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
const BASE_URL = process.env.A2A_BASE_URL || 'https://localhost:8080';
const AGENT_CARD_URL = `${BASE_URL}/.well-known/agent-card.json`;
const INVOKE_URL = `${BASE_URL}/invoke`;

async function testAgentCard() {
  console.log('🧪 Testing A2A Agent Connection\n');

  // Test 1: Check if agent card exists (optional)
  console.log('📡 Test 1: Fetching agent card...');
  try {
    const response = await fetch(AGENT_CARD_URL);
    if (!response.ok) {
      console.warn(`⚠️  Agent card not available: ${response.status} ${response.statusText}`);
      console.warn('   This is OK - we can use the /invoke endpoint directly\n');
    } else {
      const agentCard = await response.json();
      console.log('✅ Agent card fetched successfully');
      console.log('📄 Agent Card:', JSON.stringify(agentCard, null, 2));
      console.log('');
    }
  } catch (error) {
    console.warn(`⚠️  Agent card not available:`, error.message);
    console.warn('   This is OK - we can use the /invoke endpoint directly\n');
  }

  // Test 2: Send a test message to /invoke
  console.log('📡 Test 2: Sending test message to /invoke endpoint...');
  console.log('   (Skipping agent card since it returned 404)\n');
  try {
    const testMessage = {
      kind: 'message',
      messageId: `msg_test_${Date.now()}`,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'Hello, this is a test message',
        },
      ],
    };

    console.log('📤 Sending message:', JSON.stringify(testMessage, null, 2));

    const response = await fetch(INVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testMessage),
    });

    if (!response.ok) {
      console.error(`❌ Invoke request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('   Error response:', errorText);
      return false;
    }

    const result = await response.json();
    console.log('✅ Message sent successfully');
    console.log('📥 Response:', JSON.stringify(result, null, 2));
    console.log('');

    return true;
  } catch (error) {
    console.error(`❌ Failed to send message:`, error.message);
    console.error('   Full error:', error);
    return false;
  }
}

// Run the test
testAgentCard()
  .then((success) => {
    if (success) {
      console.log('✅ All tests passed! A2A agent is working correctly.');
    } else {
      console.log('❌ Tests failed. Please check the errors above.');
    }
  })
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
  });
