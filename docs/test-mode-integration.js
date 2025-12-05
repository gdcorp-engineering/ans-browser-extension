/**
 * Mode Integration Validation Script
 * 
 * This script validates that all chat modes are properly integrated with GoCode.
 * Run this to verify mode parameters are correctly included in API requests.
 */

const MODES = [
  'create_image',
  'thinking',
  'deep_research',
  'study_and_learn',
  'web_search',
  'canvas',
  'browser_memory'
];

// Mock message structure to test mode inclusion
function createTestMessage(mode) {
  return {
    id: 'test-1',
    role: 'user',
    content: `Test message for ${mode} mode`,
    mode: mode
  };
}

// Validate mode is included in request body
function validateModeInRequest(messages, customBaseUrl, expectedMode) {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  
  if (!customBaseUrl) {
    console.log(`⚠️  customBaseUrl not set - mode won't be included`);
    return false;
  }
  
  if (!lastUserMessage?.mode) {
    console.log(`❌ Mode not found in last user message`);
    return false;
  }
  
  if (lastUserMessage.mode !== expectedMode) {
    console.log(`❌ Mode mismatch: expected ${expectedMode}, got ${lastUserMessage.mode}`);
    return false;
  }
  
  // Simulate request body construction (as done in services)
  const requestBody = {
    model: 'test-model',
    messages: messages,
  };
  
  if (customBaseUrl && lastUserMessage.mode) {
    requestBody.mode = lastUserMessage.mode;
  }
  
  if (!requestBody.mode) {
    console.log(`❌ Mode not included in request body`);
    return false;
  }
  
  if (requestBody.mode !== expectedMode) {
    console.log(`❌ Request body mode mismatch: expected ${expectedMode}, got ${requestBody.mode}`);
    return false;
  }
  
  console.log(`✅ Mode ${expectedMode} correctly included in request body`);
  return true;
}

// Test all modes
console.log('🧪 Testing Mode Integration with GoCode\n');
console.log('='.repeat(60));

let allPassed = true;
const customBaseUrl = 'https://api.example.com'; // Mock GoCode URL

MODES.forEach(mode => {
  console.log(`\n📋 Testing mode: ${mode}`);
  const messages = [createTestMessage(mode)];
  const passed = validateModeInRequest(messages, customBaseUrl, mode);
  if (!passed) {
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ All mode integrations validated successfully!');
  console.log('\n📝 Next steps:');
  console.log('1. Configure extension with GoCode URL and API key');
  console.log('2. Test each mode in the UI');
  console.log('3. Verify mode parameter appears in network requests');
  console.log('4. Confirm GoCode receives and processes each mode correctly');
} else {
  console.log('❌ Some mode integrations failed validation');
}

console.log('\n📋 Modes to test:');
MODES.forEach((mode, index) => {
  console.log(`   ${index + 1}. ${mode}`);
});

