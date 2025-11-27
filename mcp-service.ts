/**
 * MCP Service - Manages Model Context Protocol client connections
 *
 * Handles:
 * - Connecting to multiple MCP servers via Streamable HTTP
 * - Aggregating tools from all servers
 * - Routing tool execution to the correct server
 * - Connection lifecycle management
 */

import { experimental_createMCPClient } from 'ai';
import type { MCPServerConfig, MCPConnection, MCPToolWithOrigin } from './types';

/**
 * MCP Service Class - manages all MCP server connections
 */
export class MCPService {
  private connections: Map<string, MCPConnection> = new Map();
  private toolMap: Map<string, string> = new Map(); // tool name -> server ID

  /**
   * Connect to all enabled MCP servers
   */
  async connectToServers(servers: MCPServerConfig[]): Promise<void> {
    console.log(`🔌 [connectToServers] Called at ${new Date().toISOString()}`);
    console.log(`🔌 [connectToServers] Input servers: ${servers.length} server(s)`);
    console.log(`🔌 [connectToServers] Call stack:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));
    
    // Filter to only MCP servers (exclude A2A servers)
    const enabledServers = servers.filter(s => s.enabled && (!s.protocol || s.protocol === 'mcp'));

    // Deduplicate by server ID (in case same server appears multiple times)
    const uniqueServers = new Map<string, MCPServerConfig>();
    enabledServers.forEach(server => {
      if (uniqueServers.has(server.id)) {
        console.warn(`⚠️  [connectToServers] Duplicate server ID "${server.id}" detected - keeping first occurrence`);
      } else {
        uniqueServers.set(server.id, server);
      }
    });
    const deduplicatedServers = Array.from(uniqueServers.values());
    
    if (deduplicatedServers.length !== enabledServers.length) {
      console.log(`🔌 [connectToServers] Deduplicated from ${enabledServers.length} to ${deduplicatedServers.length} unique server(s)`);
    }

    console.log(`🔌 [connectToServers] Filtered to ${deduplicatedServers.length} enabled MCP server(s):`);
    deduplicatedServers.forEach(s => {
      console.log(`   - "${s.name}" (ID: ${s.id}) at ${s.url}`);
    });

    // Filter out servers that are already connected OR connecting (in progress)
    const serversToConnect = deduplicatedServers.filter(server => {
      const existingConnection = this.connections.get(server.id);
      if (existingConnection) {
        if (existingConnection.connected) {
          console.log(`⏭️  [connectToServers] Skipping "${server.name}" (ID: ${server.id}) - already connected`);
          return false;
        }
        if (existingConnection.connecting) {
          console.log(`⏭️  [connectToServers] Skipping "${server.name}" (ID: ${server.id}) - connection in progress`);
          return false;
        }
      }
      return true;
    });

    console.log(`🔌 [connectToServers] ${serversToConnect.length} server(s) need connection (${deduplicatedServers.length - serversToConnect.length} already connected)`);
    console.log(`🔌 [connectToServers] Starting parallel connections at ${new Date().toISOString()}`);

    const connectionPromises = serversToConnect.map(async (server) => {
      const serverStartTime = Date.now();
      console.log(`🔌 [connectToServers] Starting connection to "${server.name}" at ${new Date().toISOString()}`);
      try {
        await this.connectToServer(server);
        const serverTime = Date.now() - serverStartTime;
        console.log(`✅ [connectToServers] Successfully connected to "${server.name}" (took ${serverTime}ms)`);
      } catch (error) {
        const serverTime = Date.now() - serverStartTime;
        console.error(`❌ [connectToServers] Failed to connect to MCP server "${server.name}" after ${serverTime}ms:`, error);
        console.error(`❌ [connectToServers] HTTP Endpoint that failed: ${server.url}`);
        console.error(`❌ [connectToServers] Server: "${server.name}" | URL: ${server.url}`);
        console.error(`❌ [connectToServers] Error details:`, error instanceof Error ? error.stack : error);
      }
    });

    console.log(`🔌 [connectToServers] Waiting for all connections to complete (Promise.allSettled) at ${new Date().toISOString()}`);
    const allStartTime = Date.now();
    await Promise.allSettled(connectionPromises);
    const allTime = Date.now() - allStartTime;
    console.log(`🔌 [connectToServers] All connections completed (took ${allTime}ms) at ${new Date().toISOString()}`);

    console.log(`✅ [connectToServers] Connected to ${this.connections.size} MCP server(s) total`);
  }

  /**
   * Connect to a single MCP server
   */
  private async connectToServer(config: MCPServerConfig): Promise<void> {
    // Check if already connected OR connecting (in progress)
    const existingConnection = this.connections.get(config.id);
    if (existingConnection) {
      if (existingConnection.connected) {
        console.log(`⏭️  [connectToServer] Skipping connection to "${config.name}" (ID: ${config.id}) - already connected`);
        console.log(`⏭️  [connectToServer] Existing connection URL: ${existingConnection.serverUrl}`);
        console.log(`⏭️  [connectToServer] Requested URL: ${config.url}`);
        if (existingConnection.serverUrl !== config.url) {
          console.warn(`⚠️  [connectToServer] URL mismatch! Existing: ${existingConnection.serverUrl}, Requested: ${config.url}`);
        }
        return; // Already connected, skip
      }
      if (existingConnection.connecting) {
        console.log(`⏭️  [connectToServer] Skipping connection to "${config.name}" (ID: ${config.id}) - connection already in progress`);
        console.log(`⏭️  [connectToServer] Waiting for existing connection attempt to complete...`);
        // Wait for the existing connection attempt to complete
        // Poll until it's either connected or failed
        let attempts = 0;
        const maxWaitAttempts = 60; // Wait up to 30 seconds (60 * 500ms)
        while (attempts < maxWaitAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const updatedConnection = this.connections.get(config.id);
          if (!updatedConnection) {
            // Connection was removed (failed), we can proceed
            break;
          }
          if (updatedConnection.connected) {
            console.log(`✅ [connectToServer] Existing connection completed successfully`);
            return; // Connection succeeded, skip
          }
          if (!updatedConnection.connecting) {
            // Connection attempt finished but failed, we can retry
            console.log(`⚠️  [connectToServer] Previous connection attempt failed, retrying...`);
            break;
          }
          attempts++;
        }
        if (attempts >= maxWaitAttempts) {
          console.warn(`⚠️  [connectToServer] Timeout waiting for existing connection, proceeding anyway`);
        }
      }
    }

    // Log connection attempt with URL
    console.log(`🔗 Attempting MCP connection to "${config.name}" at ${config.url}`);
    console.log(`🔗 HTTP Endpoint: ${config.url}`);
    console.log(`🔗 Server ID: ${config.id}`);

    // Log trust status
    if (config.isTrusted) {
      console.log(`   ✓ Verified business`);
    } else if (config.isCustom) {
      console.warn(`   ⚠️  Custom (unverified) server - use only services you trust`);
    }

    // Store original fetch outside try block so it's accessible in catch
    const originalFetch = globalThis.fetch;
    let fetchInterceptActive = false;
    // Store SSE response data for fallback parsing if SDK times out (declared outside try for catch access)
    let sseResponseData: string | null = null;
    let isToolsListRequest = false;

    try {
      console.log(`📦 Step 1: Importing StreamableHTTPClientTransport...`);
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );
      console.log(`✅ Step 1: Import complete`);

      const transportOptions: any = {};
      if (config.apiKey) {
        transportOptions.headers = { 'Authorization': `Bearer ${config.apiKey}` };
      }

      console.log(`📦 Step 2: Creating MCP client...`);
      console.log(`📦 Step 2: HTTP Endpoint: ${config.url}`);
      console.log(`📦 Step 2: Transport Type: StreamableHTTPClientTransport (matches MCP Inspector)`);
      console.log(`📦 Step 2: Transport options:`, JSON.stringify(transportOptions, null, 2));
      
      // Parse URL to verify format
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(config.url);
        console.log(`📦 Step 2: Parsed URL details:`);
        console.log(`   Protocol: ${parsedUrl.protocol}`);
        console.log(`   Host: ${parsedUrl.host}`);
        console.log(`   Pathname: ${parsedUrl.pathname}`);
        console.log(`   Full URL: ${parsedUrl.href}`);
      } catch (urlError) {
        console.error(`❌ Invalid URL format: ${config.url}`, urlError);
        throw new Error(`Invalid MCP server URL: ${config.url}`);
      }

      // Intercept fetch to log the actual HTTP request and capture SSE data
      const fetchIntercept = (...args: Parameters<typeof fetch>) => {
        const [url, options] = args;
        const requestUrl = typeof url === 'string' ? url : url.toString();
        const requestBody = options?.body;
        
        // Check if this is a tools/list request
        if (requestBody && typeof requestBody === 'string') {
          try {
            const parsed = JSON.parse(requestBody);
            isToolsListRequest = parsed.method === 'tools/list';
          } catch {
            isToolsListRequest = false;
          }
        }
        
        console.log(`🌐 [FETCH INTERCEPT] ========================================`);
        console.log(`🌐 [FETCH INTERCEPT] HTTP Request Details:`);
        console.log(`   Method: ${options?.method || 'GET'}`);
        console.log(`   URL: ${requestUrl}`);
        console.log(`   Is MCP endpoint: ${requestUrl.includes('agent.tuneify.ai/mcp') ? 'YES' : 'NO'}`);
        console.log(`   Is tools/list request: ${isToolsListRequest}`);
        console.log(`   Headers:`, JSON.stringify(options?.headers || {}, null, 2));
        if (requestBody) {
          if (typeof requestBody === 'string') {
            try {
              const parsed = JSON.parse(requestBody);
              console.log(`   Body (parsed):`, JSON.stringify(parsed, null, 2));
            } catch {
              console.log(`   Body (raw):`, requestBody.substring(0, 500));
            }
          } else {
            console.log(`   Body type: ${requestBody.constructor.name}`);
            console.log(`   Body: [Stream/Blob/FormData - not string]`);
          }
        } else {
          console.log(`   Body: none`);
        }
        console.log(`   Request timestamp: ${new Date().toISOString()}`);
        console.log(`🌐 [FETCH INTERCEPT] ========================================`);
        
        const fetchStartTime = Date.now();
        const fetchPromise = originalFetch(...args);
        fetchPromise.then(
          async (response) => {
            const fetchDuration = Date.now() - fetchStartTime;
            console.log(`✅ [FETCH INTERCEPT] ========================================`);
            console.log(`✅ [FETCH INTERCEPT] Response received (after ${fetchDuration}ms):`);
            console.log(`   Status: ${response.status} ${response.statusText}`);
            console.log(`   OK: ${response.ok}`);
            console.log(`   Headers:`, JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
            
            // If this is a tools/list request with SSE response, capture the data for fallback parsing
            if (isToolsListRequest && response.headers.get('content-type')?.includes('text/event-stream')) {
              console.log(`   📥 [FETCH INTERCEPT] Detected SSE response for tools/list - capturing for fallback parsing`);
              try {
                const responseClone = response.clone();
                const text = await responseClone.text();
                sseResponseData = text;
                console.log(`   📥 [FETCH INTERCEPT] Captured SSE data (${text.length} chars) for fallback parsing`);
                console.log(`   📥 [FETCH INTERCEPT] SSE data preview (first 500 chars):`, text.substring(0, 500));
              } catch (bodyError) {
                console.log(`   ⚠️  [FETCH INTERCEPT] Could not capture SSE data:`, bodyError);
              }
            } else {
              // Try to read response body (for debugging)
              try {
                const responseClone = response.clone();
                const text = await responseClone.text();
                console.log(`   Response body preview (first 500 chars):`, text.substring(0, 500));
                if (text.length > 500) {
                  console.log(`   Response body length: ${text.length} characters`);
                }
              } catch (bodyError) {
                console.log(`   Could not read response body:`, bodyError);
              }
            }
            
            console.log(`   Response timestamp: ${new Date().toISOString()}`);
            console.log(`✅ [FETCH INTERCEPT] ========================================`);
          },
          (error) => {
            const fetchDuration = Date.now() - fetchStartTime;
            console.error(`❌ [FETCH INTERCEPT] ========================================`);
            console.error(`❌ [FETCH INTERCEPT] Request failed (after ${fetchDuration}ms):`);
            console.error(`   Error type: ${error?.constructor?.name}`);
            console.error(`   Error message: ${error?.message}`);
            console.error(`   Error stack:`, error?.stack);
            console.error(`❌ [FETCH INTERCEPT] ========================================`);
          }
        );
        return fetchPromise;
      };
      
      // Temporarily replace fetch
      (globalThis as any).fetch = fetchIntercept;
      fetchInterceptActive = true;
      
      // Create the transport instance
      console.log(`📦 Step 2a: Creating StreamableHTTPClientTransport...`);
      const transport = new StreamableHTTPClientTransport(
        parsedUrl,
        transportOptions
      );
      console.log(`✅ Step 2a: Transport created`);
      console.log(`   Transport URL: ${parsedUrl.href}`);
      console.log(`   Transport options:`, JSON.stringify(transportOptions, null, 2));
      
      // Create the MCP client
      console.log(`📦 Step 2b: Creating MCP client with transport...`);
      const client = await experimental_createMCPClient({
        transport: transport,
      });
      console.log(`✅ Step 2: MCP client created`);
      console.log(`   Client transport type: ${transport.constructor.name}`);

      console.log(`📦 Step 3: Fetching tools from MCP server...`);
      console.log(`   🔵 [client.tools()] About to call client.tools() for "${config.name}" at ${new Date().toISOString()}`);
      console.log(`   🔵 [client.tools()] HTTP Endpoint: ${config.url}`);
      console.log(`   🔵 [client.tools()] Fetch intercept is ACTIVE - will log actual HTTP request`);
      
      // CRITICAL: Mark connection as "connecting" BEFORE the async call to prevent race conditions
      // This prevents duplicate connection attempts while client.tools() is in progress
      const connectingConnection: MCPConnection = {
        serverId: config.id,
        serverName: config.name,
        serverUrl: config.url,
        client: client as any, // Client created but tools() not called yet
        tools: {},
        connected: false,
        connecting: true, // Mark as in-progress
      };
      this.connections.set(config.id, connectingConnection);
      console.log(`   🔒 [connectToServer] Marked connection as "connecting" to prevent duplicate attempts`);
      
      // Add timeout to prevent hanging (3 seconds)
      const toolsPromise = client.tools();
      console.log(`   🔵 [client.tools()] Promise created for "${config.name}" at ${new Date().toISOString()}`);
      console.log(`   🔵 [client.tools()] Promise state: pending (waiting for response)`);
      
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          console.error(`   🔴 [client.tools()] TIMEOUT for "${config.name}" after 3 seconds at ${new Date().toISOString()}`);
          console.error(`   🔴 [client.tools()] HTTP Endpoint that timed out: ${config.url}`);
          console.error(`   🔴 [client.tools()] The client.tools() call never resolved - this indicates a hang`);
          console.error(`   🔴 [client.tools()] Server: "${config.name}" | URL: ${config.url}`);
          reject(new Error(`MCP tools() call timed out after 3 seconds for endpoint: ${config.url}`));
        }, 3000);
        console.log(`   🔵 [client.tools()] Timeout timer set for "${config.name}" (3 seconds)`);
      });
      
      console.log(`   🔵 [client.tools()] Starting Promise.race() for "${config.name}" at ${new Date().toISOString()}`);
      
      let tools;
      try {
        tools = await Promise.race([toolsPromise, timeoutPromise]);
        // Clear timeout since promise resolved successfully
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
          console.log(`   ✅ [client.tools()] Cleared timeout - promise resolved successfully`);
        }
        console.log(`   🟢 [client.tools()] SUCCESS for "${config.name}" at ${new Date().toISOString()}`);
        console.log(`   🟢 [client.tools()] HTTP Endpoint: ${config.url}`);
        console.log(`   🟢 [client.tools()] Tools received: ${Object.keys(tools).length} tool(s)`);
      } catch (error: any) {
        console.error(`   🔴 [client.tools()] ERROR for "${config.name}" at ${new Date().toISOString()}`);
        console.error(`   🔴 [client.tools()] HTTP Endpoint that failed: ${config.url}`);
        console.error(`   🔴 [client.tools()] Error type: ${error?.constructor?.name}`);
        console.error(`   🔴 [client.tools()] Error message: ${error?.message}`);
        console.error(`   🔴 [client.tools()] Error stack:`, error?.stack);
        
        // FALLBACK: If timeout occurred but we captured SSE data, try to parse it manually
        if (error?.message?.includes('timed out') && sseResponseData) {
          console.log(`   🔄 [FALLBACK] Attempting to parse captured SSE data as fallback...`);
          try {
            // Parse SSE format: lines starting with "data: " contain JSON
            // TypeScript type narrowing: sseResponseData is string here due to the && check above
            const sseData: string = sseResponseData;
            const lines = sseData.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6); // Remove "data: " prefix
                try {
                  const json = JSON.parse(jsonStr);
                  // Check if this is the tools/list response
                  if (json.jsonrpc === '2.0' && json.result?.tools) {
                    console.log(`   ✅ [FALLBACK] Successfully parsed tools from SSE data!`);
                    // Convert array of tools to object format expected by SDK
                    const toolsObj: Record<string, any> = {};
                    for (const tool of json.result.tools) {
                      toolsObj[tool.name] = tool;
                    }
                    tools = toolsObj;
                    console.log(`   ✅ [FALLBACK] Extracted ${Object.keys(tools).length} tool(s) from SSE response`);
                    break; // Success - exit loop
                  }
                } catch (parseError) {
                  // Not valid JSON or not the right message, continue
                  continue;
                }
              }
            }
            
            if (tools) {
              console.log(`   ✅ [FALLBACK] Using parsed tools from SSE data (SDK timeout workaround)`);
              // Clear timeout since we successfully parsed the tools
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
                console.log(`   ✅ [FALLBACK] Cleared timeout - fallback parsing succeeded`);
              }
              // Don't throw error - we successfully parsed the tools
            } else {
              console.error(`   ❌ [FALLBACK] Could not extract tools from SSE data`);
              throw error; // Re-throw original error
            }
          } catch (fallbackError) {
            console.error(`   ❌ [FALLBACK] Error parsing SSE data:`, fallbackError);
            throw error; // Re-throw original error
          }
        } else {
          // No SSE data captured or not a timeout - re-throw original error
          throw error;
        }
      } finally {
        // Always clear timeout and restore original fetch after tools() call completes
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
          console.log(`   🔄 [client.tools()] Cleared timeout in finally block`);
        }
        if (fetchInterceptActive) {
          globalThis.fetch = originalFetch;
          fetchInterceptActive = false;
          console.log(`   🔄 [FETCH INTERCEPT] Restored original fetch`);
        }
      }
      
      // Ensure tools is defined (should be set either by SDK or fallback parsing)
      if (!tools) {
        throw new Error(`Failed to fetch tools from "${config.name}" - SDK timed out and no SSE data available for fallback parsing`);
      }
      
      console.log(`✅ Step 3: Tools fetched successfully`);
      const toolCount = Object.keys(tools).length;

      if (toolCount === 0) {
        console.warn(`⚠️  MCP server "${config.name}" has no tools available`);
        await client.close();
        // Clear the connecting state since connection failed (no tools)
        this.connections.delete(config.id);
        return;
      }

      console.log(`✅ Connected to "${config.name}" - ${toolCount} tool(s) available`);

      // Update connection state: mark as connected and clear connecting flag
      const connection: MCPConnection = {
        serverId: config.id,
        serverName: config.name,
        serverUrl: config.url,
        client,
        tools,
        connected: true,
        connecting: false, // Clear connecting flag - connection completed successfully
      };

      this.connections.set(config.id, connection);
      console.log(`   🔓 [connectToServer] Updated connection state: connected=true, connecting=false`);

      // Map tool names to server ID for routing
      Object.keys(tools).forEach((toolName) => {
        if (this.toolMap.has(toolName)) {
          console.warn(`⚠️  Tool name conflict: "${toolName}" from "${config.name}" already exists`);
        }
        this.toolMap.set(toolName, config.id);
      });

    } catch (error) {
      // Restore fetch in case of error
      if (fetchInterceptActive) {
        globalThis.fetch = originalFetch;
        fetchInterceptActive = false;
        console.log(`   🔄 [FETCH INTERCEPT] Restored original fetch (error path)`);
      }
      
      console.error(`❌ Error connecting to "${config.name}" at ${config.url}:`, error);
      console.error(`❌ HTTP Endpoint that failed: ${config.url}`);
      console.error(`❌ Server: "${config.name}" | URL: ${config.url}`);

      // Clear connecting flag and mark as failed
      const errorConnection: MCPConnection = {
        serverId: config.id,
        serverName: config.name,
        serverUrl: config.url,
        client: null as any,
        tools: {},
        connected: false,
        connecting: false, // Clear connecting flag - connection attempt failed
        error: error instanceof Error ? error.message : String(error),
      };

      this.connections.set(config.id, errorConnection);
      console.log(`   🔓 [connectToServer] Updated connection state: connected=false, connecting=false (error)`);
    }
  }

  /**
   * Get all tools from all connected servers, aggregated
   */
  getAggregatedTools(): Record<string, any> {
    const allTools: Record<string, any> = {};

    for (const connection of this.connections.values()) {
      if (connection.connected && connection.tools) {
        Object.assign(allTools, connection.tools);
      }
    }

    return allTools;
  }

  /**
   * Get tools with origin metadata for debugging
   */
  getToolsWithOrigin(): MCPToolWithOrigin[] {
    const toolsWithOrigin: MCPToolWithOrigin[] = [];

    for (const connection of this.connections.values()) {
      if (connection.connected && connection.tools) {
        Object.entries(connection.tools).forEach(([toolName, toolDefinition]) => {
          toolsWithOrigin.push({
            serverId: connection.serverId,
            serverName: connection.serverName,
            serverUrl: connection.serverUrl,
            toolDefinition: { name: toolName, ...toolDefinition },
          });
        });
      }
    }

    return toolsWithOrigin;
  }

  /**
   * Get the server ID that owns a particular tool
   */
  getServerIdForTool(toolName: string): string | undefined {
    return this.toolMap.get(toolName);
  }

  /**
   * Get connection status for all servers
   */
  getConnectionStatus(): Array<{
    serverId: string;
    serverName: string;
    connected: boolean;
    toolCount: number;
    error?: string;
  }> {
    return Array.from(this.connections.values()).map((conn) => ({
      serverId: conn.serverId,
      serverName: conn.serverName,
      connected: conn.connected,
      toolCount: Object.keys(conn.tools || {}).length,
      error: conn.error,
    }));
  }

  /**
   * Execute a tool call on the appropriate MCP server
   */
  async executeToolCall(toolName: string, parameters: any): Promise<any> {
    const serverId = this.toolMap.get(toolName);

    if (!serverId) {
      throw new Error(`Tool "${toolName}" not found in any connected MCP server`);
    }

    const connection = this.connections.get(serverId);

    if (!connection || !connection.connected) {
      throw new Error(`MCP server for tool "${toolName}" is not connected`);
    }

    console.log(`🔧 Executing MCP tool "${toolName}" on server "${connection.serverName}"`);
    console.log(`📤 Tool parameters:`, JSON.stringify(parameters, null, 2));

    try {
      const client = connection.client as any;
      const transport = client.transport;

      if (!transport || typeof transport.send !== 'function') {
        throw new Error('MCP transport is not available or does not support send()');
      }

      // Create JSON-RPC request
      const requestId = Date.now();
      const jsonRpcRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: parameters
        }
      };

      console.log(`📤 JSON-RPC Request:`, JSON.stringify(jsonRpcRequest, null, 2));

      // Set up a promise to wait for the response
      const responsePromise = new Promise<any>((resolve, reject) => {
        const originalOnMessage = transport.onmessage;
        let responseReceived = false;

        // Set up message handler
        transport.onmessage = (message: any) => {
          console.log(`📥 Received message:`, JSON.stringify(message, null, 2));

          // Check if this is the response to our request
          if (message.id === requestId) {
            responseReceived = true;
            resolve(message);

            // Restore original handler
            if (originalOnMessage) {
              transport.onmessage = originalOnMessage;
            }
          } else {
            // Call original handler for other messages
            if (originalOnMessage) {
              originalOnMessage(message);
            }
          }
        };

        // Timeout after 2.5 minutes
        setTimeout(() => {
          if (!responseReceived) {
            // Restore original handler
            if (originalOnMessage) {
              transport.onmessage = originalOnMessage;
            }
            reject(new Error('I\'m sorry, the request took too long and timed out. Please try again later.'));
          }
        }, 150000);
      });

      // Send the request
      await transport.send(jsonRpcRequest);
      console.log(`✅ Request sent, waiting for response...`);

      // Wait for response
      const response = await responsePromise;

      console.log(`✅ Tool "${toolName}" executed successfully`);
      console.log(`📊 RAW RESPONSE (full):`, JSON.stringify(response, null, 2));
      console.log(`🔍 RAW response.result:`, JSON.stringify(response.result, null, 2));
      console.log(`🔍 response.result keys:`, response.result ? Object.keys(response.result) : 'null');

      // Log the ENTIRE response object structure
      console.log(`🔍 DEEP INSPECTION - response type:`, typeof response);
      console.log(`🔍 DEEP INSPECTION - response keys:`, Object.keys(response));
      if (response.result) {
        console.log(`🔍 DEEP INSPECTION - response.result type:`, typeof response.result);
        console.log(`🔍 DEEP INSPECTION - response.result keys:`, Object.keys(response.result));
      }

      // Extract result from MCP response
      if (response.result) {
        if (response.result.content && Array.isArray(response.result.content)) {
          console.log(`🔍 Content array has ${response.result.content.length} items`);
          response.result.content.forEach((item: any, idx: number) => {
            console.log(`🔍 Content[${idx}]:`, JSON.stringify(item, null, 2));
          });

          // Return the text from content array
          const textContent = response.result.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');

          // Preserve additional fields like audioLink, audio_link, audioUrl
          const resultObj: any = { result: textContent };

          // Check for audio link fields in response.result
          let audioLinkFound = false;
          if (response.result.audioLink) {
            resultObj.audioLink = response.result.audioLink;
            console.log(`🎵 Found audioLink in response.result: ${response.result.audioLink}`);
            audioLinkFound = true;
          } else if (response.result.audio_link) {
            resultObj.audioLink = response.result.audio_link;
            console.log(`🎵 Found audio_link in response.result: ${response.result.audio_link}`);
            audioLinkFound = true;
          } else if (response.result.audioUrl) {
            resultObj.audioLink = response.result.audioUrl;
            console.log(`🎵 Found audioUrl in response.result: ${response.result.audioUrl}`);
            audioLinkFound = true;
          }

          // Also check inside content array items for audioLink
          if (!audioLinkFound) {
            for (const item of response.result.content) {
              // First check direct fields
              if (item.audioLink) {
                resultObj.audioLink = item.audioLink;
                console.log(`🎵 Found audioLink in content item: ${item.audioLink}`);
                audioLinkFound = true;
                break;
              } else if (item.audio_link) {
                resultObj.audioLink = item.audio_link;
                console.log(`🎵 Found audio_link in content item: ${item.audio_link}`);
                audioLinkFound = true;
                break;
              } else if (item.audioUrl) {
                resultObj.audioLink = item.audioUrl;
                console.log(`🎵 Found audioUrl in content item: ${item.audioUrl}`);
                audioLinkFound = true;
                break;
              }

              // If item has text field, try parsing it as JSON
              if (item.text && typeof item.text === 'string') {
                try {
                  const parsed = JSON.parse(item.text);
                  if (parsed.audioLink) {
                    resultObj.audioLink = parsed.audioLink;
                    console.log(`🎵 Found audioLink in parsed JSON text: ${parsed.audioLink}`);
                    audioLinkFound = true;
                    break;
                  } else if (parsed.audio_link) {
                    resultObj.audioLink = parsed.audio_link;
                    console.log(`🎵 Found audio_link in parsed JSON text: ${parsed.audio_link}`);
                    audioLinkFound = true;
                    break;
                  } else if (parsed.audioUrl) {
                    resultObj.audioLink = parsed.audioUrl;
                    console.log(`🎵 Found audioUrl in parsed JSON text: ${parsed.audioUrl}`);
                    audioLinkFound = true;
                    break;
                  }
                } catch (e) {
                  // Not JSON, skip
                }
              }
            }
          }

          if (!audioLinkFound) {
            console.log(`⚠️ No audioLink found in response.result or content items`);
          }

          console.log(`🎯 FINAL RESULT OBJECT TO RETURN:`, JSON.stringify(resultObj, null, 2));
          return resultObj;
        }
        console.log(`🎯 FINAL RESULT (no content array):`, JSON.stringify({ result: response.result }, null, 2));
        return { result: response.result };
      }

      if (response.error) {
        throw new Error(`MCP tool error: ${response.error.message || JSON.stringify(response.error)}`);
      }

      return response;

    } catch (error: any) {
      console.error(`❌ Error executing tool "${toolName}":`, error);
      console.error(`   Error type:`, error?.constructor?.name);
      console.error(`   Error message:`, error?.message);
      throw error;
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    console.log(`🔌 Disconnecting from ${this.connections.size} MCP server(s)...`);

    const disconnectPromises = Array.from(this.connections.values()).map(async (conn) => {
      if (conn.connected && conn.client) {
        try {
          await conn.client.close();
          console.log(`✅ Disconnected from "${conn.serverName}"`);
        } catch (error) {
          console.error(`❌ Error disconnecting from "${conn.serverName}":`, error);
        }
      }
    });

    await Promise.allSettled(disconnectPromises);

    this.connections.clear();
    this.toolMap.clear();

    console.log('✅ All MCP connections closed');
  }

  /**
   * Check if any servers are connected
   */
  hasConnections(): boolean {
    return Array.from(this.connections.values()).some(conn => conn.connected);
  }

  /**
   * Check if any servers are currently connecting (in progress)
   */
  hasConnectingConnections(): boolean {
    return Array.from(this.connections.values()).some(conn => conn.connecting === true);
  }

  /**
   * Get total number of available tools
   */
  getTotalToolCount(): number {
    return this.toolMap.size;
  }
}

/**
 * Singleton instance for the extension
 */
let mcpServiceInstance: MCPService | null = null;

export function getMCPService(): MCPService {
  if (!mcpServiceInstance) {
    mcpServiceInstance = new MCPService();
  }
  return mcpServiceInstance;
}

export function resetMCPService(): void {
  if (mcpServiceInstance) {
    mcpServiceInstance.disconnectAll().catch(console.error);
    mcpServiceInstance = null;
  }
}
