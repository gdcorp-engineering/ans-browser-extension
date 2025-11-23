/**
 * Test MCP Client Connection
 *
 * This uses the same AI SDK that the extension uses
 * to prove we can connect and call tools
 */

import { experimental_createMCPClient } from 'ai';

async function testMCPConnection() {
  console.log('🧪 Testing MCP Client Connection...\n');

  const serverUrl = 'https://cuzu3hqrxnfig.agenth.godaddy.com/mcp';

  console.log('📍 Server URL:', serverUrl);
  console.log('🔑 Auth: None (public endpoint)');
  console.log();

  try {
    // Import the Streamable HTTP transport - same as extension uses
    console.log('📦 Importing StreamableHTTPClientTransport...');
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );

    console.log('✅ Transport imported\n');

    // Create transport without auth (public endpoint)
    console.log('🔌 Creating transport...');
    const transport = new StreamableHTTPClientTransport(
      new URL(serverUrl)
    );

    console.log('✅ Transport created\n');

    // Create MCP client - exactly like the extension does
    console.log('🔌 Creating MCP client...');
    const client = await experimental_createMCPClient({
      transport
    });

    console.log('✅ MCP client created\n');

    // List available tools
    console.log('📋 Listing tools...');
    const tools = await client.tools();
    const toolCount = Object.keys(tools).length;

    console.log(`✅ Connected! Found ${toolCount} tool(s):`);
    Object.keys(tools).forEach(toolName => {
      console.log(`   - ${toolName}: ${tools[toolName].description}`);
    });
    console.log();

    // Try Method 2: Access transport directly with message handler
    console.log('🔧 Attempting Method 2: transport.send() with onmessage handler...');
    console.log();

    const startTime2 = Date.now();

    try {
      // Access the transport directly
      const transport = client.transport;

      if (!transport || typeof transport.send !== 'function') {
        console.error('❌ Transport or transport.send() not available');
        console.log('   Available on client:', Object.keys(client));
        console.log('   Available on transport:', transport ? Object.keys(transport) : 'N/A');
        throw new Error('Transport.send() not available');
      }

      console.log('✅ Transport found, setting up message handler...');

      // Create JSON-RPC request (as object, not string)
      const requestId = Date.now();
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: 'get_site_name',
          arguments: { operation: 'get' }
        }
      };

      console.log('📤 JSON-RPC Request:', JSON.stringify(jsonRpcRequest, null, 2));
      console.log();

      // Set up a promise to wait for the response
      const responsePromise = new Promise((resolve, reject) => {
        const originalOnMessage = transport.onmessage;

        // Set up message handler
        transport.onmessage = (message) => {
          console.log('📥 Received message:', JSON.stringify(message, null, 2));

          // Check if this is the response to our request
          if (message.id === requestId) {
            resolve(message);
          }

          // Call original handler if exists
          if (originalOnMessage) {
            originalOnMessage(message);
          }
        };

        // Timeout after 10s
        setTimeout(() => reject(new Error('Timeout after 10s')), 10000);
      });

      // Send the request
      console.log('📤 Sending request...');
      await transport.send(jsonRpcRequest);
      console.log('✅ Request sent, waiting for response...');

      // Wait for response
      const response = await responsePromise;

      const elapsed2 = Date.now() - startTime2;
      console.log(`✅ Method 2 succeeded in ${elapsed2}ms\n`);
      console.log('📊 Response:', JSON.stringify(response, null, 2));
      console.log();

      // Extract result
      if (response.result) {
        console.log('📝 Tool result:', response.result);

        if (response.result.content && Array.isArray(response.result.content)) {
          const textContent = response.result.content
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join('\n');

          console.log('📝 Extracted text:');
          console.log(textContent);
          console.log();
        }
      }

      // Close connection
      console.log('🔌 Closing connection...');
      await client.close();
      console.log('✅ Connection closed\n');

      console.log('🎉 Test completed successfully!');
      process.exit(0);

    } catch (error2) {
      const elapsed2 = Date.now() - startTime2;
      console.error(`❌ Method 2 failed after ${elapsed2}ms:`, error2.message);
      console.error('   Error type:', error2.constructor.name);
      if (error2.stack) {
        console.error('\n   Stack trace:');
        console.error(error2.stack);
      }
    }

    // All methods failed
    console.error('\n❌ All methods failed');
    process.exit(1);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('   Error type:', error.constructor.name);
    if (error.stack) {
      console.error('\n   Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testMCPConnection();
