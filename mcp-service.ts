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
    // Filter to only MCP servers (exclude A2A servers)
    const enabledServers = servers.filter(s => s.enabled && (!s.protocol || s.protocol === 'mcp'));

    console.log(`🔌 Connecting to ${enabledServers.length} MCP server(s)...`);

    const connectionPromises = enabledServers.map(async (server) => {
      try {
        await this.connectToServer(server);
      } catch (error) {
        console.error(`❌ Failed to connect to MCP server "${server.name}" at ${server.url}:`, error);
      }
    });

    await Promise.allSettled(connectionPromises);

    console.log(`✅ Connected to ${this.connections.size} MCP server(s)`);
  }

  /**
   * Connect to a single MCP server
   */
  private async connectToServer(config: MCPServerConfig): Promise<void> {
    // Log connection attempt with URL
    console.log(`🔗 Attempting MCP connection to "${config.name}" at ${config.url}`);

    // Log trust status
    if (config.isTrusted) {
      console.log(`   ✓ Verified business`);
    } else if (config.isCustom) {
      console.warn(`   ⚠️  Custom (unverified) server - use only services you trust`);
    }

    try {
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );

      const transportOptions: any = {};
      if (config.apiKey) {
        transportOptions.headers = { 'Authorization': `Bearer ${config.apiKey}` };
      }

      const client = await experimental_createMCPClient({
        transport: new StreamableHTTPClientTransport(
          new URL(config.url),
          transportOptions
        ),
      });

      const tools = await client.tools();
      const toolCount = Object.keys(tools).length;

      if (toolCount === 0) {
        console.warn(`⚠️  MCP server "${config.name}" has no tools available`);
        await client.close();
        return;
      }

      console.log(`✅ Connected to "${config.name}" - ${toolCount} tool(s) available`);

      const connection: MCPConnection = {
        serverId: config.id,
        serverName: config.name,
        serverUrl: config.url,
        client,
        tools,
        connected: true,
      };

      this.connections.set(config.id, connection);

      // Map tool names to server ID for routing
      Object.keys(tools).forEach((toolName) => {
        if (this.toolMap.has(toolName)) {
          console.warn(`⚠️  Tool name conflict: "${toolName}" from "${config.name}" already exists`);
        }
        this.toolMap.set(toolName, config.id);
      });

    } catch (error) {
      console.error(`❌ Error connecting to "${config.name}":`, error);

      const errorConnection: MCPConnection = {
        serverId: config.id,
        serverName: config.name,
        client: null as any,
        tools: {},
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };

      this.connections.set(config.id, errorConnection);
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

        // Timeout after 30s
        setTimeout(() => {
          if (!responseReceived) {
            // Restore original handler
            if (originalOnMessage) {
              transport.onmessage = originalOnMessage;
            }
            reject(new Error('Timeout after 30s'));
          }
        }, 30000);
      });

      // Send the request
      await transport.send(jsonRpcRequest);
      console.log(`✅ Request sent, waiting for response...`);

      // Wait for response
      const response = await responsePromise;

      console.log(`✅ Tool "${toolName}" executed successfully`);
      console.log(`📊 Response:`, JSON.stringify(response, null, 2));

      // Extract result from MCP response
      if (response.result) {
        if (response.result.content && Array.isArray(response.result.content)) {
          // Return the text from content array
          const textContent = response.result.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
          return { result: textContent };
        }
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
