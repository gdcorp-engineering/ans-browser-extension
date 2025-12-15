// Shared types for the extension
import { z } from 'zod';

export type ToolMode = 'tool-router';
export type Provider = 'anthropic';

export type ProtocolType = 'mcp' | 'a2a';

export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
  enabled: boolean;
  protocol?: ProtocolType; // Protocol type: 'mcp' or 'a2a'
  isTrusted?: boolean; // From ANS marketplace
  isCustom?: boolean; // User-added custom server
  protocolExtension?: {
    mcp?: {
      remotes?: Array<{ url: string }>;
    };
    mcp1?: {
      url?: string;
      remotes?: Array<{ url: string }>;
    };
  };
  businessInfo?: {
    description?: string;
    category?: string;
    location?: string;
    website?: string;
    rating?: number;
  };
}

export interface SiteInstruction {
  id: string;
  domainPattern: string; // e.g., "*.atlassian.net" or "confluence.company.com"
  instructions: string; // Custom instructions for this site
  enabled: boolean;
}

export interface ServiceMapping {
  id: string;
  urlPattern: string;        // e.g., "*.jira.atlassian.net" or "jira.atlassian.net"
  serviceType: 'mcp' | 'a2a';
  serviceId: string;         // Server/Agent ID from discovery
  serviceName: string;       // Display name
  serviceUrl: string;        // MCP/A2A endpoint URL
  enabled: boolean;          // Active checkbox
  createdAt: number;
}

export interface Settings {
  provider: Provider;
  apiKey: string;
  model: string;
  toolMode?: ToolMode;
  enableScreenshots?: boolean;
  customBaseUrl?: string; // Custom provider URL
  customModelName?: string; // Custom model name when model is 'custom'
  mcpEnabled?: boolean; // Enable custom MCP servers
  mcpServers?: MCPServerConfig[]; // List of MCP servers to connect to
  ansApiToken?: string; // ANS API authentication token (optional)
  siteInstructions?: SiteInstruction[]; // Site-specific custom instructions
  autoSaveScreenshots?: boolean; // Automatically save screenshots to Downloads folder
  serviceMappings?: ServiceMapping[]; // Site-specific service mappings (MCP/A2A)

  // Conversation History Settings
  enableConversationPersistence?: boolean; // Save conversations to chrome.storage (default: true)
  enableSmartSummarization?: boolean; // Automatically summarize old messages (default: true)

  // Page Context History Settings
  pageContextHistoryLength?: number; // Number of recent page contexts to keep full content (default: 2)
  enableSeparateHistoryManagement?: boolean; // Enable page context stripping for older messages (default: true)
}

export interface ChatState {
  phase: 'loading' | 'ready' | 'streaming' | 'error';
  settings: Settings | null;
  messages: Message[];
  error: string | null;
  isLoading: boolean;
  browserToolsEnabled: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: GeminiFunctionCall[];
  audioLink?: string; // URL to audio file (e.g., MP3 from music generation)
}

export interface PageContext {
  url: string;
  title: string;
  textContent: string;
  links: Array<{ text: string; href: string }>;
  images: Array<{ alt: string; src: string }>;
  forms: Array<{
    id: string;
    action: string;
    inputs: Array<{ name: string; type: string }>
  }>;
  metadata: {
    description?: string;
    keywords?: string;
    author?: string;
  };
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
}

export interface BrowserMemory {
  recentPages: Array<{
    url: string;
    title: string;
    timestamp: number;
    context?: any
  }>;
  userPreferences: Record<string, any>;
  sessionData: Record<string, any>;
}

export interface MessageRequest {
  type: string;
  [key: string]: any;
}

export interface MessageResponse {
  success?: boolean;
  error?: string;
  [key: string]: any;
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

/**
 * MCP Client type for managing Model Context Protocol connections
 * Matches the AI SDK experimental_createMCPClient return type
 */
export interface MCPClient {
  tools(): Promise<Record<string, any>>;
  close(): Promise<void>;
}

/**
 * MCP Connection tracking - maps server ID to client instance
 */
export interface MCPConnection {
  serverId: string;
  serverName: string;
  serverUrl: string;
  client: MCPClient;
  tools: Record<string, any>;
  connected: boolean;
  connecting?: boolean; // True when connection is in progress (before client.tools() completes)
  error?: string;
}

/**
 * MCP Tool metadata with origin tracking
 */
export interface MCPToolWithOrigin {
  serverId: string;
  serverName: string;
  serverUrl: string;
  toolDefinition: any;
}

/**
 * Browser action function parameters
 */
export interface BrowserActionParams {
  x?: number;
  y?: number;
  text?: string;
  selector?: string;
  target?: string;
  value?: string;
  direction?: string;
  amount?: number;
  key?: string;
  keys?: string[];
  destination_x?: number;
  destination_y?: number;
  coordinate?: { x: number; y: number };
  address?: string;
  uri?: string;
  content?: string;
  seconds?: number;
  milliseconds?: number;
  press_enter?: boolean;
  clear_before_typing?: boolean;
  magnitude?: number;
}

/**
 * Gemini API function call
 */
export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * Extended viewport info
 */
export interface ViewportInfo {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

// ============================================
// Zod Validation Schemas (for runtime validation)
// ============================================

/**
 * Validates page context from content script
 */
export const PageContextSchema = z.object({
  url: z.string().url().or(z.string().startsWith('data:')),
  title: z.string(),
  textContent: z.string(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
  })).default([]),
  images: z.array(z.object({
    alt: z.string(),
    src: z.string(),
  })).default([]),
  forms: z.array(z.object({
    id: z.string(),
    action: z.string(),
    inputs: z.array(z.object({
      name: z.string(),
      type: z.string(),
    })),
  })).default([]),
  metadata: z.object({
    description: z.string().optional(),
    keywords: z.string().optional(),
    author: z.string().optional(),
  }).optional(),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    scrollX: z.number(),
    scrollY: z.number(),
    devicePixelRatio: z.number().positive(),
  }).optional(),
});

/**
 * Validates action response from content script
 */
export const ActionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  data: z.any().optional(),
  element: z.string().optional(),
  elementBounds: z.object({
    left: z.number(),
    top: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  text: z.string().optional(),
  screenshot: z.string().optional(),
});

/**
 * Validates screenshot response
 */
export const ScreenshotResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  screenshot: z.string().optional(), // data URL
});
