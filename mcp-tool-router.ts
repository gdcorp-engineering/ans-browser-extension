/**
 * MCP Tool Router - Helper utilities for routing and formatting MCP tool calls
 *
 * Provides utilities for:
 * - Formatting tool definitions for different providers
 * - Parsing tool call results
 * - Error handling and logging
 */

import type { MCPToolWithOrigin } from './types';

/**
 * Format MCP tools for Anthropic Claude
 * Anthropic uses a specific tool schema format
 */
export function formatToolsForAnthropic(tools: Record<string, any>): any[] {
  return Object.entries(tools).map(([name, tool]) => {
    console.log(`🔧 Formatting MCP tool "${name}":`, JSON.stringify(tool, null, 2));

    // Extract input schema - check multiple possible locations
    let inputSchema = tool.inputSchema || tool.input_schema || tool.parameters || tool.schema;

    // MCP tools often wrap the schema in a 'jsonSchema' field - unwrap it
    if (inputSchema?.jsonSchema) {
      console.log(`   Unwrapping jsonSchema field...`);
      inputSchema = inputSchema.jsonSchema;
    }

    // If inputSchema doesn't have 'type', add it
    if (inputSchema && !inputSchema.type) {
      inputSchema = {
        type: 'object',
        ...inputSchema,
      };
    }

    // Default schema if nothing found
    if (!inputSchema) {
      inputSchema = {
        type: 'object',
        properties: {},
      };
    }

    const formattedTool = {
      name,
      description: tool.description || `Tool: ${name}`,
      input_schema: inputSchema,
    };

    console.log(`✅ Formatted tool:`, JSON.stringify(formattedTool, null, 2));

    return formattedTool;
  });
}

/**
 * Format MCP tools for Google Gemini
 * Gemini uses function declarations
 */
export function formatToolsForGoogle(tools: Record<string, any>): any[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description || `Tool: ${name}`,
    parameters: tool.inputSchema || tool.parameters || {
      type: 'object',
      properties: {},
    },
  }));
}

/**
 * Format MCP tools for OpenAI
 * OpenAI uses a function calling format
 */
export function formatToolsForOpenAI(tools: Record<string, any>): any[] {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description || `Tool: ${name}`,
      parameters: tool.inputSchema || tool.parameters || {
        type: 'object',
        properties: {},
      },
    },
  }));
}

/**
 * Format tools based on provider type
 */
export function formatToolsForProvider(
  tools: Record<string, any>,
  provider: 'google' | 'anthropic' | 'openai'
): any[] {
  switch (provider) {
    case 'anthropic':
      return formatToolsForAnthropic(tools);
    case 'google':
      return formatToolsForGoogle(tools);
    case 'openai':
      return formatToolsForOpenAI(tools);
    default:
      return formatToolsForGoogle(tools); // Default fallback
  }
}

/**
 * Log tool execution info
 */
export function logToolExecution(
  toolName: string,
  serverName: string,
  parameters: any,
  success: boolean,
  error?: string
): void {
  if (success) {
    console.log(`✅ MCP Tool "${toolName}" executed successfully on "${serverName}"`);
    console.log('Parameters:', parameters);
  } else {
    console.error(`❌ MCP Tool "${toolName}" failed on "${serverName}"`);
    console.error('Parameters:', parameters);
    console.error('Error:', error);
  }
}

/**
 * Validate tool parameters against schema
 */
export function validateToolParameters(
  toolName: string,
  parameters: any,
  schema: any
): { valid: boolean; error?: string } {
  // Basic validation - check required fields
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (!(field in parameters)) {
        return {
          valid: false,
          error: `Missing required parameter: ${field}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Get human-readable tool description
 */
export function getToolDescription(toolsWithOrigin: MCPToolWithOrigin[]): string {
  if (toolsWithOrigin.length === 0) {
    return 'No MCP tools available';
  }

  const byServer: Record<string, string[]> = {};

  for (const tool of toolsWithOrigin) {
    if (!byServer[tool.serverName]) {
      byServer[tool.serverName] = [];
    }
    byServer[tool.serverName].push(tool.toolDefinition.name);
  }

  const lines: string[] = ['Available MCP Tools:'];

  for (const [serverName, toolNames] of Object.entries(byServer)) {
    lines.push(`  ${serverName}: ${toolNames.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Parse tool call result and format for display
 */
export function formatToolResult(result: any): string {
  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    // Handle common MCP result formats
    if (result.content) {
      if (Array.isArray(result.content)) {
        return result.content
          .map((item: any) => item.text || JSON.stringify(item))
          .join('\n');
      }
      return String(result.content);
    }

    if (result.text) {
      return result.text;
    }

    // Fallback to JSON
    return JSON.stringify(result, null, 2);
  }

  return String(result);
}

/**
 * Create error message for tool execution failure
 */
export function createToolErrorMessage(
  toolName: string,
  serverName: string,
  error: any
): string {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return `Tool "${toolName}" failed on MCP server "${serverName}": ${errorMsg}`;
}

/**
 * Check if a tool name belongs to MCP (vs browser tools)
 */
export function isMCPTool(toolName: string, mcpToolNames: Set<string>): boolean {
  return mcpToolNames.has(toolName);
}

/**
 * Merge MCP tools with browser tools
 * Returns combined tool definitions
 */
export function mergeToolDefinitions(
  mcpTools: Record<string, any>,
  browserTools: any[],
  provider: 'google' | 'anthropic' | 'openai'
): any[] {
  const formattedMCPTools = formatToolsForProvider(mcpTools, provider);
  return [...browserTools, ...formattedMCPTools];
}

/**
 * Format A2A agents as Anthropic tools
 * Each A2A agent becomes a tool that accepts a "task" parameter
 */
export function formatA2AToolsForAnthropic(
  a2aConnections: Array<{ serverId: string; serverName: string; connected: boolean }>
): any[] {
  return a2aConnections.map((conn) => {
    // Create a tool name based on the agent name (sanitized)
    const toolName = `a2a_${conn.serverName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

    return {
      name: toolName,
      description: `Execute a task on the ${conn.serverName} agent (A2A protocol). Provide a natural language task description.`,
      input_schema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task to execute on the agent in natural language',
          },
        },
        required: ['task'],
      },
    };
  });
}
