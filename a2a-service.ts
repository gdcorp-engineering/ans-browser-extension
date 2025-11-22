/**
 * A2A Service - Handles Agent-to-Agent Protocol calls
 *
 * Supports two modes:
 * 1. Task-based: Makes POST requests to A2A endpoints with task parameters
 * 2. SDK-based: Uses A2A SDK for conversational messaging
 */

import type { MCPServerConfig } from './types';
import { A2AClient } from '@a2a-js/sdk/client';
import type { Message, TextPart } from '@a2a-js/sdk';

/**
 * A2A Service Class - manages A2A agent connections
 */
export class A2AService {
  private connections: Map<string, { serverId: string; serverName: string; url: string; enabled: boolean }> = new Map();
  private sdkClients: Map<string, A2AClient> = new Map(); // SDK clients for conversational mode

  /**
   * Register all enabled A2A servers
   * Note: A2A uses simple HTTP POST - no persistent connection needed
   */
  async connectToServers(servers: MCPServerConfig[]): Promise<void> {
    const enabledA2AServers = servers.filter(s => s.enabled && s.protocol === 'a2a');

    console.log(`🔌 Registering ${enabledA2AServers.length} A2A agent(s)...`);

    enabledA2AServers.forEach((server) => {
      console.log(`📝 Registering A2A agent "${server.name}":`);
      console.log(`   - ID: ${server.id}`);
      console.log(`   - URL: ${server.url}`);
      console.log(`   - URL type: ${typeof server.url}`);
      console.log(`   - Protocol: ${server.protocol}`);

      this.connections.set(server.id, {
        serverId: server.id,
        serverName: server.name,
        url: server.url,
        enabled: true,
      });
      console.log(`✅ Registered A2A agent "${server.name}" at ${server.url}`);
    });

    console.log(`✅ Registered ${this.connections.size} A2A agent(s)`);
  }

  /**
   * Get connection status for all servers
   */
  getConnectionStatus(): Array<{
    serverId: string;
    serverName: string;
    connected: boolean;
    protocol: string;
  }> {
    return Array.from(this.connections.values()).map((conn) => ({
      serverId: conn.serverId,
      serverName: conn.serverName,
      connected: conn.enabled,
      protocol: 'a2a',
    }));
  }

  /**
   * Execute a task on an A2A agent
   */
  async executeTask(serverId: string, task: string): Promise<{ result: unknown; agent?: string; status?: string }> {
    const connection = this.connections.get(serverId);

    if (!connection || !connection.enabled) {
      throw new Error(`A2A server with ID "${serverId}" is not connected`);
    }

    console.log('🔧 Executing A2A task on server:', connection.serverName);
    console.log('📤 Task:', task);
    console.log('📍 URL:', connection.url);

    try {
      const response = await fetch(connection.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task }),
      });

      if (!response.ok) {
        throw new Error(`A2A request failed with status ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      console.log(`✅ Task executed successfully`);
      console.log(`📊 Response:`, JSON.stringify(result, null, 2));

      return {
        result: result.response || result,
        agent: result.agent,
        status: result.status,
      };

    } catch (error) {
      console.error(`❌ Error executing A2A task:`, error);
      if (error instanceof Error) {
        console.error(`   Error type:`, error.constructor.name);
        console.error(`   Error message:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Unregister all A2A agents
   */
  async disconnectAll(): Promise<void> {
    console.log(`🔌 Unregistering ${this.connections.size} A2A agent(s)...`);

    // Close all SDK clients first
    await this.closeSDKClients();

    this.connections.clear();
    console.log('✅ All A2A agents unregistered');
  }

  /**
   * Check if any servers are connected
   */
  hasConnections(): boolean {
    return this.connections.size > 0;
  }

  /**
   * Get server by ID
   */
  getServerById(serverId: string) {
    return this.connections.get(serverId);
  }

  /**
   * Get agent card URL from invoke URL
   * e.g., "http://localhost:8080/invoke" -> "http://localhost:8080/.well-known/agent-card.json"
   */
  private getAgentCardUrl(invokeUrl: string): string {
    try {
      const url = new URL(invokeUrl);
      // Remove the path and just use the origin
      return `${url.origin}/.well-known/agent-card.json`;
    } catch (error) {
      console.error('Error parsing invoke URL:', error);
      throw new Error(`Invalid invoke URL: ${invokeUrl}`);
    }
  }

  /**
   * Get or create SDK client for a server
   */
  private async getSDKClient(serverId: string): Promise<A2AClient> {
    // Return cached client if exists
    if (this.sdkClients.has(serverId)) {
      return this.sdkClients.get(serverId)!;
    }

    const connection = this.connections.get(serverId);
    if (!connection || !connection.enabled) {
      throw new Error(`A2A server with ID "${serverId}" is not connected`);
    }

    console.log(`🔌 Creating A2A SDK client for "${connection.serverName}"...`);

    const agentCardUrl = this.getAgentCardUrl(connection.url);
    console.log(`📍 Agent card URL: ${agentCardUrl}`);

    try {
      console.log(`📡 Fetching agent card from ${agentCardUrl}...`);
      const client = await A2AClient.fromCardUrl(agentCardUrl);
      console.log(`✅ Connected to A2A agent: ${client.agentCard.name}`);

      // Cache the client
      this.sdkClients.set(serverId, client);

      return client;
    } catch (error: any) {
      console.error(`❌ Failed to create A2A SDK client:`, error);
      console.error(`   Error details:`, {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      });
      throw new Error(`Failed to connect to A2A agent at ${agentCardUrl}: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Send a conversational message to an A2A agent
   * Uses direct HTTP POST to /invoke endpoint
   */
  async sendMessage(serverId: string, messageText: string): Promise<string> {
    const connection = this.connections.get(serverId);

    if (!connection || !connection.enabled) {
      throw new Error(`A2A server with ID "${serverId}" is not connected`);
    }

    console.log('💬 Sending message to A2A agent:', connection.serverName);
    console.log('📤 Message:', messageText);
    console.log('📍 Endpoint:', connection.url);
    console.log('📍 Endpoint type:', typeof connection.url);
    console.log('📍 Endpoint length:', connection.url?.length);
    console.log(`📍 Connection object:`, JSON.stringify(connection, null, 2));

    try {
      // Validate URL
      let urlToUse = connection.url;
      try {
        new URL(urlToUse);
        console.log(`✅ URL is valid: ${urlToUse}`);
      } catch (urlError) {
        console.error(`❌ Invalid URL:`, urlToUse);
        throw new Error(`Invalid URL format: ${urlToUse}`);
      }

      // Create the message in A2A format
      const userMessage: Message = {
        kind: 'message',
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        parts: [
          {
            kind: 'text',
            text: messageText,
          } as TextPart,
        ],
      };

      console.log(`📡 Sending HTTP POST to ${urlToUse}...`);

      // Send message directly to invoke endpoint
      const response = await fetch(urlToUse, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userMessage),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText}. ${errorText}`);
      }

      const responseData = await response.json();
      console.log(`✅ Received response:`, responseData);

      // Extract text from response
      let responseText = '';

      // Check if response has A2A message format
      if (responseData.parts && Array.isArray(responseData.parts)) {
        responseText = responseData.parts
          .filter((part: { kind: string; text?: string }) => part.kind === 'text')
          .map((part: { kind: string; text?: string }) => part.text)
          .join('\n');
      }
      // Check if response has simple text format
      else if (responseData.response) {
        responseText = String(responseData.response);
      }
      // Fallback to JSON string
      else {
        responseText = JSON.stringify(responseData);
      }

      console.log(`✅ Extracted response text: ${responseText}`);

      return responseText;
    } catch (error) {
      console.error(`❌ Error sending message to A2A agent:`, error);
      if (error instanceof Error) {
        console.error(`   Error type:`, error.constructor.name);
        console.error(`   Error message:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Close all SDK clients
   */
  private async closeSDKClients(): Promise<void> {
    console.log(`🔌 Closing ${this.sdkClients.size} A2A SDK client(s)...`);

    // A2AClient doesn't have a close() method, just clear the clients
    this.sdkClients.clear();

    console.log('✅ All A2A SDK clients closed');
  }
}

/**
 * Singleton instance for the extension
 */
let a2aServiceInstance: A2AService | null = null;

export function getA2AService(): A2AService {
  if (!a2aServiceInstance) {
    a2aServiceInstance = new A2AService();
  }
  return a2aServiceInstance;
}

export function resetA2AService(): void {
  if (a2aServiceInstance) {
    a2aServiceInstance.disconnectAll().catch(console.error);
    a2aServiceInstance = null;
  }
}
