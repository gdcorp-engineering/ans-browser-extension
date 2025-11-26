import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Settings, MCPClient, Message, SiteInstruction, ServiceMapping } from './types';
import { GeminiResponseSchema } from './types';
import { experimental_createMCPClient, stepCountIs } from 'ai';
import { streamAnthropic } from './anthropic-service';
import { streamAnthropicWithBrowserTools } from './anthropic-browser-tools';
import { getMCPService, resetMCPService, MCPService } from './mcp-service';
import { getA2AService, resetA2AService, A2AService } from './a2a-service';
import { getToolDescription, mergeToolDefinitions } from './mcp-tool-router';
import { findAgentForCurrentSite, agentNameToDomain } from './site-detector';
import { DEFAULT_SITE_INSTRUCTIONS } from './default-site-instructions';
import { matchesUrlPattern } from './utils';

// Model ID to display name mapping
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Google Models
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  'gemini-2.5-computer-use-preview-10-2025': 'Gemini 2.5 Computer Use Preview',
  // Anthropic Models
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  // OpenAI Models
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4-turbo': 'GPT-4 Turbo',
};

const getModelDisplayName = (modelId: string | undefined): string => {
  if (!modelId) return 'No model';
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
};

const BROWSER_TOOL_NAMES = new Set([
  'navigate',
  'clickElement',
  'click',
  'type',
  'scroll',
  'getPageContext',
  'screenshot',
  'pressKey',
]);

// Custom component to handle link clicks - opens in new tab
const LinkComponent = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
  const handleLinkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      chrome.tabs.create({ url: href });
    }
  };

  return (
    <a
      href={href}
      onClick={handleLinkClick}
      style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
      title={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
};

// Component to parse and display user messages with page context styling
const UserMessageParser = ({ content }: { content: string }) => {
  // Check if message contains page context
  const contextIndex = content.indexOf('[Current Page Context]');

  if (contextIndex === -1) {
    // No page context, display normally
    return <div>{content}</div>;
  }

  // Split into user input and page context
  const userInput = content.substring(0, contextIndex).trim();
  const pageContext = content.substring(contextIndex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* User's actual input */}
      <div>{userInput}</div>

      {/* Page context - styled differently and compact */}
      <div
        style={{
          padding: '6px 8px',
          backgroundColor: '#1a2332',
          borderLeft: '3px solid #4a7ba7',
          borderRadius: '4px',
          fontSize: '0.75em',
          color: '#88aacc',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          opacity: 0.7,
          maxHeight: '80px',
          overflowY: 'auto',
          lineHeight: '1.3',
        }}
      >
        {pageContext}
      </div>
    </div>
  );
};

// Component to parse and display assistant messages with better formatting
const MessageParser = ({ content }: { content: string }) => {
  // Helper function to detect if a line is a tool execution line
  const isToolExecution = (text: string) => {
    return text.startsWith('[Executing:') ||
           (text.startsWith('{') && text.endsWith('}') && text.includes(':')) ||
           (text.startsWith('{"') && text.includes('":'));
  };

  // Split by lines and group tool execution lines separately from regular text
  const lines = content.split('\n');
  const groups: Array<{ type: 'tool' | 'text', content: string }> = [];
  let currentTextGroup: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed && isToolExecution(trimmed)) {
      // Flush any accumulated text
      if (currentTextGroup.length > 0) {
        groups.push({ type: 'text', content: currentTextGroup.join('\n') });
        currentTextGroup = [];
      }
      // Add tool execution line
      groups.push({ type: 'tool', content: trimmed });
    } else {
      // Accumulate regular text
      currentTextGroup.push(line);
    }
  }

  // Flush remaining text
  if (currentTextGroup.length > 0) {
    groups.push({ type: 'text', content: currentTextGroup.join('\n') });
  }

  // Render groups
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {groups.map((group, idx) => {
        const isTool = group.type === 'tool';
        return (
          <div
            key={idx}
            style={{
              padding: isTool ? '4px 8px' : undefined,
              backgroundColor: isTool ? '#1a1a1a' : undefined,
              borderLeft: isTool ? '2px solid #555555' : undefined,
              borderRadius: isTool ? '3px' : undefined,
              opacity: isTool ? 0.6 : 1,
              fontFamily: isTool ? 'monospace' : 'inherit',
              fontSize: isTool ? '0.7em' : 'inherit',
              color: isTool ? '#888888' : 'inherit',
              lineHeight: isTool ? '1.2' : 'inherit',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent as any }}>
              {group.content}
            </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
};

function ChatSidebar() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [browserToolsEnabled, setBrowserToolsEnabled] = useState(false);
  const [showBrowserToolsWarning, setShowBrowserToolsWarning] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentTabUrl, setCurrentTabUrl] = useState<string | null>(null);
  const [trustedAgentOptIn, setTrustedAgentOptIn] = useState(true); // User opt-in for trusted agents
  const [currentSiteAgent, setCurrentSiteAgent] = useState<{ serverId: string; serverName: string } | null>(null);
  const [currentSiteMcpCount, setCurrentSiteMcpCount] = useState(0); // Number of MCP servers for current site
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [servicesUpdated, setServicesUpdated] = useState(0); // Increment to force re-render when services update
  const toolAudioLinksRef = useRef<string[]>([]); // Track audio links from tool results
  const [isToolExecuting, setIsToolExecuting] = useState(false); // Track when tools are executing

  // Load trustedAgentOptIn from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['trustedAgentOptIn'], (result) => {
      console.log('Loading trustedAgentOptIn from storage:', result.trustedAgentOptIn);
      if (result.trustedAgentOptIn !== undefined) {
        setTrustedAgentOptIn(result.trustedAgentOptIn);
      }
    });
  }, []);

  // Save trustedAgentOptIn to storage whenever it changes
  useEffect(() => {
    console.log('Saving trustedAgentOptIn to storage:', trustedAgentOptIn);
    chrome.storage.local.set({ trustedAgentOptIn });
  }, [trustedAgentOptIn]);

  // Tab-specific refs to allow concurrent conversations
  const tabAbortControllerRef = useRef<Record<number, AbortController | null>>({});
  const tabMcpClientRef = useRef<Record<number, MCPClient | null>>({});
  const tabMcpToolsRef = useRef<Record<number, Record<string, unknown> | null>>({});
  const tabCustomMCPToolsRef = useRef<Record<number, Record<string, unknown> | null>>({});
  const tabMcpInitPromiseRef = useRef<Record<number, Promise<void> | null>>({});
  const tabCustomMCPInitPromiseRef = useRef<Record<number, Promise<void> | null>>({});
  // Tab-specific service instances - each tab has its own MCP and A2A service connections
  const tabMcpServiceRef = useRef<Record<number, MCPService | null>>({});
  const tabA2AServiceRef = useRef<Record<number, A2AService | null>>({});
  
  // Legacy refs for backward compatibility (will be removed gradually)
  const abortControllerRef = useRef<AbortController | null>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);
  const mcpToolsRef = useRef<Record<string, unknown> | null>(null);
  const customMCPToolsRef = useRef<Record<string, unknown> | null>(null);
  const mcpInitPromiseRef = useRef<Promise<void> | null>(null);
  const customMCPInitPromiseRef = useRef<Promise<void> | null>(null);
  
  const listenerAttachedRef = useRef(false);
  const settingsHashRef = useRef('');
  const composioSessionRef = useRef<{ expiresAt: number } | null>(null);
  const tabMessagesRef = useRef<Record<number, Message[]>>({});
  const currentTabIdRef = useRef<number | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const lastTypedSelectorRef = useRef<string | null>(null); // Store last typed selector for Enter key

  // Helper functions to get/set tab-specific resources for concurrent conversations
  const getCurrentTabId = () => currentTabIdRef.current;
  const getTabAbortController = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabAbortControllerRef.current[tabId] || null : null;
  };
  const setTabAbortController = (controller: AbortController | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabAbortControllerRef.current[tabId] = controller;
      // Also update legacy ref for backward compatibility
      abortControllerRef.current = controller;
    }
  };
  const getTabMcpClient = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabMcpClientRef.current[tabId] || null : null;
  };
  const setTabMcpClient = (client: MCPClient | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabMcpClientRef.current[tabId] = client;
      // Also update legacy ref for backward compatibility
      mcpClientRef.current = client;
    }
  };
  const getTabMcpTools = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabMcpToolsRef.current[tabId] || null : null;
  };
  const setTabMcpTools = (tools: Record<string, unknown> | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabMcpToolsRef.current[tabId] = tools;
      // Also update legacy ref for backward compatibility
      mcpToolsRef.current = tools;
    }
  };
  const getTabCustomMCPTools = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabCustomMCPToolsRef.current[tabId] || null : null;
  };
  const setTabCustomMCPTools = (tools: Record<string, unknown> | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabCustomMCPToolsRef.current[tabId] = tools;
      // Also update legacy ref for backward compatibility
      customMCPToolsRef.current = tools;
    }
  };
  const getTabMcpInitPromise = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabMcpInitPromiseRef.current[tabId] || null : null;
  };
  const setTabMcpInitPromise = (promise: Promise<void> | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabMcpInitPromiseRef.current[tabId] = promise;
      // Also update legacy ref for backward compatibility
      mcpInitPromiseRef.current = promise;
    }
  };
  const getTabCustomMCPInitPromise = () => {
    const tabId = getCurrentTabId();
    return tabId !== null ? tabCustomMCPInitPromiseRef.current[tabId] || null : null;
  };
  const setTabCustomMCPInitPromise = (promise: Promise<void> | null) => {
    const tabId = getCurrentTabId();
    if (tabId !== null) {
      tabCustomMCPInitPromiseRef.current[tabId] = promise;
      // Also update legacy ref for backward compatibility
      customMCPInitPromiseRef.current = promise;
    }
  };
  // Helper functions to get or create tab-specific service instances
  const getTabMcpService = (): MCPService => {
    const tabId = getCurrentTabId();
    if (tabId === null) {
      // Fallback to singleton if no tab ID
      return getMCPService();
    }
    if (!tabMcpServiceRef.current[tabId]) {
      // Create new service instance for this tab
      tabMcpServiceRef.current[tabId] = new MCPService();
      console.log(`🆕 Created new MCP service instance for tab ${tabId}`);
    }
    return tabMcpServiceRef.current[tabId]!;
  };

  const getTabA2AService = (): A2AService => {
    const tabId = getCurrentTabId();
    if (tabId === null) {
      // Fallback to singleton if no tab ID
      return getA2AService();
    }
    if (!tabA2AServiceRef.current[tabId]) {
      // Create new service instance for this tab
      tabA2AServiceRef.current[tabId] = new A2AService();
      console.log(`🆕 Created new A2A service instance for tab ${tabId}`);
    }
    return tabA2AServiceRef.current[tabId]!;
  };

  const clearTabResources = (tabId: number) => {
    // Clear tab-specific resources when switching away from a tab
    if (tabAbortControllerRef.current[tabId]) {
      tabAbortControllerRef.current[tabId]?.abort();
      delete tabAbortControllerRef.current[tabId];
    }
    if (tabMcpClientRef.current[tabId]) {
      tabMcpClientRef.current[tabId]?.close().catch(() => {});
      delete tabMcpClientRef.current[tabId];
    }
    if (tabMcpServiceRef.current[tabId]) {
      // Disconnect all MCP connections for this tab
      tabMcpServiceRef.current[tabId]?.disconnectAll().catch(() => {});
      delete tabMcpServiceRef.current[tabId];
    }
    if (tabA2AServiceRef.current[tabId]) {
      // Disconnect all A2A connections for this tab
      tabA2AServiceRef.current[tabId]?.disconnectAll().catch(() => {});
      delete tabA2AServiceRef.current[tabId];
    }
    delete tabMcpToolsRef.current[tabId];
    delete tabCustomMCPToolsRef.current[tabId];
    delete tabMcpInitPromiseRef.current[tabId];
    delete tabCustomMCPInitPromiseRef.current[tabId];
  };

  // Helper function to match URL against domain patterns and get site instructions
  const getMatchingSiteInstructions = (url: string | null): string | null => {
    if (!url || !settings?.siteInstructions) return null;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Find matching site instructions
      for (const instruction of settings.siteInstructions) {
        if (!instruction.enabled) continue;

        const pattern = instruction.domainPattern;

        // Convert wildcard pattern to regex
        // *.atlassian.net -> ^.*\.atlassian\.net$
        // confluence.company.com -> ^confluence\.company\.com$
        const regexPattern = pattern
          .replace(/\./g, '\\.')  // Escape dots
          .replace(/\*/g, '.*');   // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`, 'i');

        if (regex.test(hostname)) {
          console.log(`📍 Matched site instructions for ${hostname}: ${pattern}`);
          return instruction.instructions;
        }
      }
    } catch (error) {
      console.error('Error matching site instructions:', error);
    }

    return null;
  };

  const executeTool = async (toolName: string, parameters: any, retryCount = 0): Promise<any> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1500; // 1.5 seconds to allow page to load
    
    return new Promise((resolve, reject) => {
      const handleResponse = (response: any) => {
        const errorMsg = response?.error || chrome.runtime.lastError?.message || '';
        const isConnectionError = errorMsg.includes('Receiving end does not exist') || 
                                 errorMsg.includes('Could not establish connection');
        
        if (isConnectionError && retryCount < MAX_RETRIES) {
          
          setTimeout(async () => {
            try {
              const result = await executeTool(toolName, parameters, retryCount + 1);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }, RETRY_DELAY);
        } else {
          // Return response as-is (could be success or error)
          resolve(response);
        }
      };
      
      if (toolName === 'screenshot') {
        chrome.runtime.sendMessage({ type: 'TAKE_SCREENSHOT' }, handleResponse);
      } else if (toolName === 'clickElement') {
        chrome.runtime.sendMessage({
          type: 'EXECUTE_ACTION',
          action: 'click',
          selector: parameters.selector,
          target: parameters.text // For text-based search
        }, handleResponse);
      } else if (toolName === 'click') {
        chrome.runtime.sendMessage({
          type: 'EXECUTE_ACTION',
          action: 'click',
          selector: parameters.selector,
          coordinates: parameters.x !== undefined ? { x: parameters.x, y: parameters.y } : undefined
        }, handleResponse);
      } else if (toolName === 'type') {
        // Store the selector for later use with pressKey
        lastTypedSelectorRef.current = parameters.selector;
        chrome.runtime.sendMessage({
          type: 'EXECUTE_ACTION',
          action: 'fill',
          target: parameters.selector,
          value: parameters.text
        }, handleResponse);
      } else if (toolName === 'scroll') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'scroll',
          direction: parameters.direction,
          target: parameters.selector,
          amount: parameters.amount
        }, handleResponse);
      } else if (toolName === 'getPageContext') {
        chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' }, handleResponse);
      } else if (toolName === 'navigate') {
        chrome.runtime.sendMessage({ type: 'NAVIGATE', url: parameters.url }, handleResponse);
      } else if (toolName === 'getBrowserHistory') {
        chrome.runtime.sendMessage({ 
          type: 'GET_HISTORY',
          query: parameters.query,
          maxResults: parameters.maxResults
        }, handleResponse);
      } else if (toolName === 'pressKey') {
        // Use provided selector or fall back to last typed selector
        const selectorToUse = parameters.selector || lastTypedSelectorRef.current;
        chrome.runtime.sendMessage({
          type: 'EXECUTE_ACTION',
          action: 'press_key',
          key: parameters.key,
          selector: selectorToUse // Pass selector to ensure correct element has focus
        }, handleResponse);
      } else if (toolName === 'clearInput') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'clear_input'
        }, handleResponse);
      } else if (toolName === 'keyCombo') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'key_combination',
          keys: parameters.keys
        }, handleResponse);
      } else if (toolName === 'hover') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'hover',
          coordinates: { x: parameters.x, y: parameters.y }
        }, handleResponse);
      } else if (toolName === 'dragDrop') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'drag_drop',
          coordinates: { x: parameters.x, y: parameters.y },
          destination: { x: parameters.destination_x, y: parameters.destination_y }
        }, handleResponse);
      } else {
        reject(new Error(`Unknown tool: ${toolName}`));
      }
    });
  };

  const loadSettings = async (forceRefresh = false) => {
    chrome.storage.local.get(['atlasSettings'], async (result) => {
      if (result.atlasSettings) {
        const loadedSettings = result.atlasSettings;

        // Merge default site instructions with user's custom ones
        const userInstructions = loadedSettings.siteInstructions || [];
        const userInstructionIds = new Set(userInstructions.map((i: SiteInstruction) => i.id));

        // Add default instructions that don't already exist
        const defaultsToAdd = DEFAULT_SITE_INSTRUCTIONS.filter(
          (defaultInst) => !userInstructionIds.has(defaultInst.id)
        );

        const mergedInstructions = [...defaultsToAdd, ...userInstructions];

        const mergedSettings = {
          ...loadedSettings,
          siteInstructions: mergedInstructions
        };

        setSettings(mergedSettings);

        const settingsHash = JSON.stringify(result.atlasSettings);
        const hasSettingsChanged = forceRefresh || settingsHash !== settingsHashRef.current;

        if (hasSettingsChanged && result.atlasSettings.composioApiKey) {
          settingsHashRef.current = settingsHash;

          try {
            const { initializeComposioToolRouter } = await import('./tools');
            const toolRouterSession = await initializeComposioToolRouter(
              result.atlasSettings.composioApiKey
            );

            composioSessionRef.current = { expiresAt: toolRouterSession.expiresAt };

            chrome.storage.local.set({
              composioSessionId: toolRouterSession.sessionId,
              composioChatMcpUrl: toolRouterSession.chatSessionMcpUrl,
              composioToolRouterMcpUrl: toolRouterSession.toolRouterMcpUrl,
            });
          } catch (error) {
            console.error('Failed to initialize Composio:', error);
          }
        }

        // Note: MCP and A2A services will be initialized on-demand based on site mappings
        // when messages are sent or when checking for tools on specific sites
        console.log('✅ Settings loaded. Services will connect based on site mappings.');
        // Note: checkForTrustedAgent() will be called automatically by the useEffect watching currentTabUrl and settings
      } else {
        setShowSettings(true);
      }
    });
  };

  // Check if current site has a trusted A2A agent
  const checkForTrustedAgent = async () => {
    console.log('🔍 Checking for trusted agent...');

    // Get current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tab?.url;
    console.log('📍 Current URL:', currentUrl);

    if (!currentUrl || currentUrl.startsWith('chrome://') || currentUrl.startsWith('chrome-extension://')) {
      console.log('⚠️  Not on a regular website, skipping agent check');
      setCurrentSiteAgent(null);
      setCurrentSiteMcpCount(0);
      return;
    }

    // Get settings to check for mappings
    const result = await chrome.storage.local.get(['atlasSettings']);
    const localSettings = result.atlasSettings;

    if (!localSettings?.mcpServers || localSettings.mcpServers.length === 0) {
      console.log('⚠️  No services configured');
      setCurrentSiteAgent(null);
      setCurrentSiteMcpCount(0);
      return;
    }

    console.log('📋 Service mappings:', localSettings.serviceMappings);
    console.log('📋 MCP servers:', localSettings.mcpServers.map((s: any) => ({ id: s.id, name: s.name, enabled: s.enabled })));

    // Check for service mappings for current site
    const { a2aMapping, mcpServerIds } = findMatchingMappings(currentUrl, localSettings.serviceMappings);
    console.log('🗺️  Mapping results:', { a2aMapping, mcpServerIds });

    // Initialize A2A service based on mappings (tab-specific)
    const a2aService = getTabA2AService();
    const mcpService = getTabMcpService();

    // Determine which servers to connect based on mappings
    let serversToConnect = localSettings.mcpServers.filter(s => s.enabled);

    if (localSettings.serviceMappings && localSettings.serviceMappings.length > 0) {
      // If mappings exist, only use mapped services
      const mappedServerIds = [...(a2aMapping ? [a2aMapping.serviceId] : []), ...mcpServerIds];

      if (mappedServerIds.length > 0) {
        console.log(`🗺️  Found ${mappedServerIds.length} service mapping(s) for current site`);
        console.log(`🗺️  Mapped server IDs:`, mappedServerIds);
        console.log(`🗺️  Available server IDs:`, localSettings.mcpServers.map((s: any) => s.id));

        serversToConnect = serversToConnect.filter(s => mappedServerIds.includes(s.id));

        // Check if mapped services exist in mcpServers
        const missingServerIds = mappedServerIds.filter(id => !localSettings.mcpServers.find((s: any) => s.id === id));
        if (missingServerIds.length > 0) {
          console.warn(`⚠️  Mapped services not found in configured services:`, missingServerIds);
          console.warn(`⚠️  These services will be auto-added from mappings`);

          // Auto-add servers from mappings if they don't exist
          const allMappings = [...(a2aMapping ? [a2aMapping] : []), ...localSettings.serviceMappings.filter((m: ServiceMapping) => mcpServerIds.includes(m.serviceId))];
          let serversWereAdded = false;
          for (const mapping of allMappings) {
            if (missingServerIds.includes(mapping.serviceId)) {
              console.log(`✅ Auto-adding server from mapping: ${mapping.serviceName}`);
              const newServer = {
                id: mapping.serviceId,
                name: mapping.serviceName,
                url: mapping.serviceUrl,
                enabled: true,
                protocol: mapping.serviceType,
                isTrusted: true,
                isCustom: false
              };
              localSettings.mcpServers.push(newServer);
              serversToConnect.push(newServer);
              serversWereAdded = true;
            }
          }

          // Save auto-added servers to storage so they persist
          if (serversWereAdded) {
            console.log(`💾 Saving auto-added servers to storage...`);
            await chrome.storage.local.set({ atlasSettings: localSettings });
            setSettings(localSettings);
            console.log(`✅ Auto-added servers saved to storage`);
          }
        }

        console.log(`🗺️  Servers to connect:`, serversToConnect.map((s: any) => s.name));
      } else {
        console.log('🗺️  No service mappings for current site');
        serversToConnect = [];
      }
    }

    // Reset services first to clear any previous connections
    console.log('🔄 Resetting services...');
    resetA2AService();
    resetMCPService();

    if (serversToConnect.length > 0) {
      console.log(`🚀 Connecting to ${serversToConnect.length} service(s) for current site...`);

      try {
        await a2aService.connectToServers(serversToConnect);
        await mcpService.connectToServers(serversToConnect);

        // Check for A2A agent
        if (a2aService.hasConnections()) {
          const connections = a2aService.getConnectionStatus();
          console.log('   Available A2A agents:', connections.map(c => c.serverName).join(', '));

          // If we have an explicit A2A mapping, use it directly
          if (a2aMapping) {
            const mappedAgent = connections.find(c => c.serverId === a2aMapping.serviceId);
            if (mappedAgent) {
              console.log(`✅ Using mapped A2A agent: "${mappedAgent.serverName}"`);
              setCurrentSiteAgent({ serverId: mappedAgent.serverId, serverName: mappedAgent.serverName });
            } else {
              console.log(`⚠️  Mapped A2A agent not found in connections`);
              setCurrentSiteAgent(null);
            }
          } else {
            // Fallback to automatic site detection (legacy behavior)
            const agent = await findAgentForCurrentSite(connections);
            setCurrentSiteAgent(agent);

            if (agent) {
              console.log(`✅ Trusted agent available (auto-detected): "${agent.serverName}"`);
            } else {
              console.log(`ℹ️  No trusted agent for this site`);
            }
          }
        } else {
          console.log('⚠️  A2A service has no connections');
          setCurrentSiteAgent(null);
        }

        // Check for MCP servers - only count tools from mapped servers
        if (mcpService.hasConnections() && mcpServerIds.length > 0) {
          const allTools = mcpService.getToolsWithOrigin();
          // Filter to only count tools from servers mapped to current site
          const filteredTools = allTools.filter(tool => mcpServerIds.includes(tool.serverId));
          const mcpCount = filteredTools.length;
          console.log(`✅ ${mcpCount} MCP tool(s) available for current site (from ${mcpServerIds.length} mapped server(s))`);
          console.log(`📊 MCP tool breakdown:`, filteredTools.map(t => ({ name: t.toolDefinition.name, serverId: t.serverId })));
          setCurrentSiteMcpCount(mcpCount);
        } else {
          console.log('⚠️  No MCP tools for current site');
          setCurrentSiteMcpCount(0);
        }

        // Trigger re-render of Available Tools panel
        setServicesUpdated(prev => prev + 1);
      } catch (error) {
        console.error('❌ Failed to connect services:', error);
        setCurrentSiteAgent(null);
        setCurrentSiteMcpCount(0);
        setServicesUpdated(prev => prev + 1);
      }
    } else {
      console.log('⚠️  No services to connect for current site');
      setCurrentSiteAgent(null);
      setCurrentSiteMcpCount(0);
      setServicesUpdated(prev => prev + 1);
    }
  };

  // Get current tab ID and load its messages
  useEffect(() => {
    const getCurrentTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        console.log('📍 Current tab ID:', tab.id);
        console.log('📍 Current tab URL:', tab.url);
        setCurrentTabId(tab.id);
        setCurrentTabUrl(tab.url || null);

        // Reset all chat-related states for initial load
        setIsLoading(false);
        setIsToolExecuting(false);
        setInput('');
        setShowBrowserToolsWarning(false);
        setIsUserScrolled(false);
        
        // Load messages for this tab
        if (tabMessagesRef.current[tab.id]) {
          setMessages(tabMessagesRef.current[tab.id]);
        } else {
          // Try to load persisted messages from chrome.storage
          try {
            const result = await chrome.storage.local.get([`conversations_tab_${tab.id}`]);
            const persistedMessages = result[`conversations_tab_${tab.id}`];
            if (persistedMessages && Array.isArray(persistedMessages) && persistedMessages.length > 0) {
              console.log(`📦 Loaded ${persistedMessages.length} persisted messages for tab ${tab.id}`);
              setMessages(persistedMessages);
              tabMessagesRef.current[tab.id] = persistedMessages;
            } else {
              // New tab - start with completely fresh chat
              console.log(`🆕 Starting fresh chat for new tab ${tab.id}`);
              setMessages([]);
              tabMessagesRef.current[tab.id] = [];
            }
          } catch (err) {
            console.error('Failed to load persisted messages:', err);
            setMessages([]);
            tabMessagesRef.current[tab.id] = [];
          }
        }
        // Note: checkForTrustedAgent() will be called automatically by the useEffect watching currentTabUrl
      }
    };

    getCurrentTab();

    // Listen for tab switches
    const handleTabChange = async (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('📍 Tab switched to:', activeInfo.tabId);

      // Save current tab's resources and messages before switching
      const currentId = currentTabIdRef.current;
      if (currentId !== null) {
        // Save messages
        tabMessagesRef.current[currentId] = messagesRef.current;
        // Save abort controller state (but don't abort - allow concurrent conversations)
        tabAbortControllerRef.current[currentId] = abortControllerRef.current;
        // Save MCP client and tools state
        tabMcpClientRef.current[currentId] = mcpClientRef.current;
        tabMcpToolsRef.current[currentId] = mcpToolsRef.current;
        tabCustomMCPToolsRef.current[currentId] = customMCPToolsRef.current;
        tabMcpInitPromiseRef.current[currentId] = mcpInitPromiseRef.current;
        tabCustomMCPInitPromiseRef.current[currentId] = customMCPInitPromiseRef.current;
      }

      // Hide browser automation overlay when switching tabs
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.id) {
          await chrome.tabs.sendMessage(currentTab.id, { type: 'HIDE_BROWSER_AUTOMATION_OVERLAY' });
        }
      } catch (error) {
        console.warn('Failed to hide browser automation overlay on tab switch:', error);
      }

      // Load new tab's resources (or initialize if new tab)
      const newTabId = activeInfo.tabId;
      currentTabIdRef.current = newTabId;
      
      // Restore abort controller for new tab (or create new one)
      abortControllerRef.current = tabAbortControllerRef.current[newTabId] || null;
      // Restore MCP client and tools for new tab
      mcpClientRef.current = tabMcpClientRef.current[newTabId] || null;
      mcpToolsRef.current = tabMcpToolsRef.current[newTabId] || null;
      customMCPToolsRef.current = tabCustomMCPToolsRef.current[newTabId] || null;
      mcpInitPromiseRef.current = tabMcpInitPromiseRef.current[newTabId] || null;
      customMCPInitPromiseRef.current = tabCustomMCPInitPromiseRef.current[newTabId] || null;

      // Get the new tab's URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('📍 New tab URL:', tab?.url);

      // Load new tab's messages
      setCurrentTabId(activeInfo.tabId);
      setCurrentTabUrl(tab?.url || null);
      
      // Reset all chat-related states for the new tab
      setIsLoading(false);
      setIsToolExecuting(false);
      setInput('');
      setShowBrowserToolsWarning(false);
      setIsUserScrolled(false);
      
      // Load messages for this tab (if any exist)
      if (tabMessagesRef.current[activeInfo.tabId]) {
        setMessages(tabMessagesRef.current[activeInfo.tabId]);
      } else {
        // Try to load persisted messages from chrome.storage
        try {
          const result = await chrome.storage.local.get([`conversations_tab_${activeInfo.tabId}`]);
          const persistedMessages = result[`conversations_tab_${activeInfo.tabId}`];
          if (persistedMessages && Array.isArray(persistedMessages) && persistedMessages.length > 0) {
            console.log(`📦 Loaded ${persistedMessages.length} persisted messages for tab ${activeInfo.tabId}`);
            setMessages(persistedMessages);
            tabMessagesRef.current[activeInfo.tabId] = persistedMessages;
          } else {
            // New tab - start with completely fresh chat
            console.log(`🆕 Starting fresh chat for new tab ${activeInfo.tabId}`);
            setMessages([]);
            tabMessagesRef.current[activeInfo.tabId] = [];
          }
        } catch (err) {
          console.error('Failed to load persisted messages:', err);
          setMessages([]);
          tabMessagesRef.current[activeInfo.tabId] = [];
        }
      }
      // Note: checkForTrustedAgent() will be called automatically by the useEffect watching currentTabUrl
    };

    chrome.tabs.onActivated.addListener(handleTabChange);

    // Listen for URL changes within the current tab (e.g., navigation via browser tools)
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Only react to URL changes on the current tab
      if (changeInfo.url && tabId === currentTabIdRef.current) {
        console.log('📍 Tab URL changed to:', changeInfo.url);
        setCurrentTabUrl(changeInfo.url);
        // Note: checkForTrustedAgent() will be called automatically by the useEffect watching currentTabUrl
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
    };
  }, []); // Empty array - only run once on mount

  // Keep refs in sync with state
  useEffect(() => {
    currentTabIdRef.current = currentTabId;
  }, [currentTabId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Re-check services whenever the current tab URL changes (but only if settings are loaded)
  useEffect(() => {
    if (currentTabUrl && settings) {
      console.log('🔄 Current tab URL changed, re-checking services...');
      checkForTrustedAgent();
    }
  }, [currentTabUrl, settings]);

  // Save messages whenever they change
  useEffect(() => {
    if (currentTabId !== null && messages.length > 0) {
      console.log(`💾 Saving ${messages.length} messages for tab ${currentTabId}`);
      tabMessagesRef.current[currentTabId] = messages;

      // Persist to chrome.storage if enabled
      if (settings?.enableConversationPersistence !== false) { // Default: true
        chrome.storage.local.set({
          [`conversations_tab_${currentTabId}`]: messages
        }).then(() => {
          console.log(`💾 Persisted ${messages.length} messages to storage for tab ${currentTabId}`);
        }).catch(err => {
          console.error('Failed to persist messages:', err);
        });
      }
    }
  }, [messages, currentTabId, settings?.enableConversationPersistence]);

  useEffect(() => {
    // Load settings on mount
    loadSettings();

    // Attach settings update listener only once to prevent duplicates
    if (!listenerAttachedRef.current) {
      const handleMessage = async (request: any) => {
        if (request.type === 'SETTINGS_UPDATED') {
          console.log('📨 Settings updated message received, action:', request.action);

          // If MCP settings changed, reset MCP and A2A connections
          if (request.action === 'mcp_changed') {
            console.log('🔄 MCP/A2A settings changed, resetting connections...');
            console.log('  - Current customMCPToolsRef:', !!customMCPToolsRef.current);
            console.log('  - Current customMCPInitPromiseRef:', !!customMCPInitPromiseRef.current);

            const { resetMCPService } = await import('./mcp-service');
            const { resetA2AService } = await import('./a2a-service');
            resetMCPService();
            resetA2AService();
            customMCPToolsRef.current = null;
            customMCPInitPromiseRef.current = null;

            console.log('✅ MCP/A2A refs cleared, will reinitialize on next message');
          }

          await loadSettings();
          console.log('✅ Settings reloaded');
        } else if (request.type === 'ABORT_BROWSER_AUTOMATION') {
          console.log('🛑 User requested to take over browser control');
          stop();
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);
      listenerAttachedRef.current = true;

      // Cleanup listener on unmount
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        listenerAttachedRef.current = false;
      };
    }
  }, []);

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  const isComposioSessionExpired = (): boolean => {
    if (!composioSessionRef.current) return true;
    return Date.now() > composioSessionRef.current.expiresAt;
  };

  const ensureApiKey = (): string => {
    if (!settings?.apiKey) {
      throw new Error('Google API key not configured. Please add it in Settings.');
    }
    return settings.apiKey;
  };

  const ensureModel = (): string => {
    if (!settings?.model) {
      throw new Error('AI model not configured. Please select a model in Settings.');
    }
    return settings.model;
  };

  const toggleBrowserTools = async () => {
    const newValue = !browserToolsEnabled;

    // Check if user has Google API key before enabling Browser Tools
    if (newValue) {
      if (!settings) {
        alert('⚠️ Please configure your settings first.');
        openSettings();
        return;
      }

      if (!settings.apiKey) {
        const confirmed = window.confirm(
          '🌐 Browser Tools requires an API key\n\n' +
          'Browser Tools provides browser automation capabilities.\n\n' +
          'Would you like to open Settings to add your API key?'
        );
        if (confirmed) {
          openSettings();
        }
        return;
      }

      if (settings.provider !== 'google' && settings.provider !== 'anthropic') {
        const confirmed = window.confirm(
          '🌐 Browser Tools not supported for ' + settings.provider + '\n\n' +
          'Browser Tools currently works with Google Gemini and Anthropic Claude.\n\n' +
          'Would you like to open Settings to change your provider?'
        );
        if (confirmed) {
          openSettings();
        }
        return;
      }
    }

    setBrowserToolsEnabled(newValue);

    if (newValue) {
      // Clear MCP cache when enabling browser tools
      if (mcpClientRef.current) {
        try {
          await mcpClientRef.current.close();
        } catch (error) {
          console.error('Error closing MCP client:', error);
        }
      }
      mcpClientRef.current = null;
      mcpToolsRef.current = null;
      setShowBrowserToolsWarning(false);
    }
  };

  const stop = () => {
    console.log('🛑 Stop called - aborting all browser operations');

    // Abort the AI API call
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }

    // Send message to background script to cancel any pending browser operations
    chrome.runtime.sendMessage({
      type: 'ABORT_ALL_BROWSER_OPERATIONS'
    }, () => {
      if (chrome.runtime.lastError) {
        console.log('Background script not responding (this is OK)');
      }
    });

    // Hide browser automation overlay when stopped
    hideBrowserAutomationOverlay();

    console.log('✅ All browser operations aborted');
  };

  // Show/hide browser automation overlay on current tab
  const showBrowserAutomationOverlay = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_BROWSER_AUTOMATION_OVERLAY' });
      }
    } catch (error) {
      console.warn('Failed to show browser automation overlay:', error);
    }
  };

  const hideBrowserAutomationOverlay = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'HIDE_BROWSER_AUTOMATION_OVERLAY' });
      }
    } catch (error) {
      console.warn('Failed to hide browser automation overlay:', error);
    }
  };

  const newChat = async () => {
    // Abort any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Hide browser automation overlay
    await hideBrowserAutomationOverlay();
    // Clear messages for current tab
    setMessages([]);
    setInput('');
    setShowBrowserToolsWarning(false);
    // Clear loading and tool executing states
    setIsLoading(false);
    setIsToolExecuting(false);

    // Clear messages storage for current tab
    if (currentTabId !== null) {
      tabMessagesRef.current[currentTabId] = [];

      // Also clear persisted messages
      chrome.storage.local.remove([`conversations_tab_${currentTabId}`]).catch(err => {
        console.error('Failed to clear persisted messages:', err);
      });
    }
    
    // Clear tab-specific MCP client (but keep service connections for concurrent conversations)
    const tabId = getCurrentTabId();
    if (tabId !== null && tabMcpClientRef.current[tabId]) {
      try {
        await tabMcpClientRef.current[tabId]?.close();
        console.log(`Closed MCP client for tab ${tabId}`);
      } catch (error) {
        console.error('Error closing MCP client:', error);
      }
      delete tabMcpClientRef.current[tabId];
    }
    // Also clear legacy refs
    if (mcpClientRef.current) {
      try {
        await mcpClientRef.current.close();
        console.log('Closed previous MCP client');
      } catch (error) {
        console.error('Error closing MCP client:', error);
      }
    }
    mcpClientRef.current = null;
    mcpToolsRef.current = null;
    
    
    // Reinitialize Composio session if API key present
    if (settings?.composioApiKey) {
      try {
        const { initializeComposioToolRouter } = await import('./tools');
        // Use unique, persistent user ID
        const toolRouterSession = await initializeComposioToolRouter(
          settings.composioApiKey
        );
        
        chrome.storage.local.set({ 
          composioSessionId: toolRouterSession.sessionId,
          composioChatMcpUrl: toolRouterSession.chatSessionMcpUrl,
          composioToolRouterMcpUrl: toolRouterSession.toolRouterMcpUrl,
        });
        
        console.log('New Composio session created');
        console.log('Session ID:', toolRouterSession.sessionId);
      } catch (error) {
        console.error('Failed to create new Composio session:', error);
      }
    }
  };

  const streamWithGeminiComputerUse = async (messages: Message[]) => {
    try {
      const apiKey = ensureApiKey();

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Get initial screenshot with retry logic
      let screenshot = await executeTool('screenshot', {});

      if (!screenshot?.screenshot) {
        const errorMsg = screenshot?.error || 'Unknown error capturing screenshot';
        console.error('❌ Screenshot failed. Full response:', JSON.stringify(screenshot, null, 2));
        throw new Error(`Failed to capture screenshot: ${errorMsg}`);
      }
      
      // Prepare conversation history
      const contents: any[] = [];
      
      // Add message history
      for (const msg of messages) {
        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }]
          });
        }
      }
      
      if (screenshot && screenshot.screenshot) {
        const lastUserContent = contents[contents.length - 1];
        if (lastUserContent && lastUserContent.role === 'user') {
          lastUserContent.parts.push({
            inline_data: {
              mime_type: 'image/png',
              data: screenshot.screenshot.split(',')[1]
            }
          });
        }
      }

      let responseText = '';
      const maxTurns = 30;

      const systemInstruction = `You are a browser automation assistant with ONLY browser control capabilities.

CRITICAL: You can ONLY use the computer_use tool functions for browser automation. DO NOT attempt to call any other functions like print, execute, or any programming functions.

AVAILABLE ACTIONS (computer_use tool only):
- click / click_at: Click at coordinates
- type_text_at: Type text (optionally with press_enter)
- scroll / scroll_down / scroll_up: Scroll the page
- navigate: Navigate to a URL
- wait / wait_5_seconds: Wait for page load

GUIDELINES:
1. NAVIGATION: Use 'navigate' function to go to websites
   Example: navigate({url: "https://www.reddit.com"})

2. INTERACTION: Use coordinates from the screenshot you see
   - Click at coordinates to interact with elements
   - Type text at coordinates to fill forms

3. NO HALLUCINATING: Only use the functions listed above. Do NOT invent or call functions like print(), execute(), or any code functions.

4. EFFICIENCY: Complete tasks in fewest steps possible.`;

      for (let turn = 0; turn < maxTurns; turn++) {
        if (abortControllerRef.current?.signal.aborted) {
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += '\n\n🛑 **Stopped by user**';
            }
            return updated;
          });
          return; // Exit the agent loop
        }

        console.log(`\n--- Turn ${turn + 1}/${maxTurns} ---`);

        const requestBody = {
          contents,
          tools: [{
            computer_use: {
              environment: 'ENVIRONMENT_BROWSER'
            }
          }],
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 1.0,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE'
            }
          ]
        };
        
        // Create abort controller with timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 60000); // 60 second timeout
        
        // Always use computer-use model for browser tools
        const computerUseModel = 'gemini-2.5-computer-use-preview-10-2025';

        const baseUrl = settings?.customBaseUrl || 'https://generativelanguage.googleapis.com';
        const isCustomProvider = !!settings?.customBaseUrl;

        // For custom providers, use Authorization header; for Google, use query param
        const url = isCustomProvider
          ? `${baseUrl}/v1beta/models/${computerUseModel}:generateContent`
          : `${baseUrl}/v1beta/models/${computerUseModel}:generateContent?key=${apiKey}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (isCustomProvider) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        let response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        
        if (!response.ok) {
          let errorDetails;
          try {
            errorDetails = await response.json();
            console.error('❌ Gemini API Error Response:', JSON.stringify(errorDetails, null, 2));
          } catch (e) {
            console.error('❌ Failed to parse error response:', e);
            errorDetails = { statusText: response.statusText };
          }

          const errorMessage = errorDetails?.error?.message || `API request failed with status ${response.status}: ${response.statusText}`;
          console.error('❌ Full error details:', errorDetails);

          throw new Error(errorMessage);
        }
        
        const data = await response.json();

        // Validate response structure with Zod
        let validatedData;
        try {
          validatedData = GeminiResponseSchema.parse(data);
        } catch (validationError) {
          console.error('❌ Gemini API response failed validation:', validationError);
          throw new Error(`Invalid Gemini API response format: ${(validationError as any).message}`);
        }

        // Check for safety blocks and prompt feedback
        if (validatedData.promptFeedback?.blockReason) {
          const blockReason = validatedData.promptFeedback.blockReason;
          console.error('🚫 Request blocked by safety filter:', blockReason);

          // Show detailed error to user
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `⚠️ **Safety Filter Blocked Request**\n\nReason: ${blockReason}\n\nThis request was blocked by Gemini's safety filters. Try:\n- Using a different webpage\n- Simplifying your request\n- Avoiding sensitive actions\n\nFull response:\n\`\`\`json\n${JSON.stringify(validatedData, null, 2)}\n\`\`\``;
            }
            return updated;
          });
          return; // Exit the loop
        }

        const candidate = validatedData.candidates?.[0];

        if (!candidate) {
          console.error('❌ No candidate in response. Full response:', JSON.stringify(data, null, 2));
          throw new Error(`No candidate in Gemini response. Finish reason: ${data.candidates?.[0]?.finishReason || 'unknown'}. Full response: ${JSON.stringify(data)}`);
        }

        // Check if candidate has safety response requiring confirmation
        const safetyResponse = candidate.safetyResponse;
        if (safetyResponse?.requireConfirmation) {
          // Show confirmation dialog to user
          const confirmMessage = safetyResponse.message || 'This action requires confirmation. Do you want to proceed?';
          const userConfirmed = window.confirm(`🔒 Human Confirmation Required\n\n${confirmMessage}\n\nProceed with this action?`);

          if (!userConfirmed) {
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content += '\n\n❌ Action cancelled by user.';
              }
              return updated;
            });
            return; // Exit the loop
          }

          // Add confirmation to conversation
          contents.push({
            role: 'user',
            parts: [{ text: 'CONFIRMED: User approved this action. Please proceed.' }]
          });

          // Continue to next iteration to re-run with confirmation
          continue;
        }

        // Add model response to conversation
        contents.push(candidate.content);

        // Check if there are function calls
        const parts = candidate.content?.parts || [];
        const hasFunctionCalls = parts.some((p: any) => 'functionCall' in p && p.functionCall);

        if (!hasFunctionCalls) {
          // No more actions - task complete
          for (const part of parts) {
            if ('text' in part && typeof part.text === 'string') {
              responseText += part.text;
            }
          }
          break;
        }

        // Execute function calls
        const functionResponses: any[] = [];

        for (const part of parts) {
          if ('text' in part && typeof part.text === 'string') {
            responseText += part.text + '\n';
            // Update message with current text
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = responseText;
              }
              return updated;
            });
          } else if ('functionCall' in part && part.functionCall) {
            // Check if user clicked stop button
            if (abortControllerRef.current?.signal.aborted) {
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content = responseText + '\n\n🛑 **Stopped by user**';
                }
                return updated;
              });
              return; // Exit the agent loop
            }

            const funcName = part.functionCall.name;
            const funcArgs = part.functionCall.args || {};

            responseText += `\n[Executing: ${funcName}]\n`;

            // Update message with current progress
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = responseText;
              }
              return updated;
            });

            // Show overlay before ANY browser action (ensures overlay is always visible)
            console.log(`🔵 Showing overlay for browser action: ${funcName}`);
            await showBrowserAutomationOverlay();

            // Execute the browser action
            const result = await executeBrowserAction(funcName, funcArgs);

            // Wait after action for any changes to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Re-show overlay after action (in case page navigation removed it)
            await showBrowserAutomationOverlay();
            
            screenshot = await executeTool('screenshot', {});
            
            if (!screenshot || !screenshot.screenshot) {
              console.warn('Failed to capture screenshot after action');
              screenshot = { screenshot: '' }; // Continue without screenshot
            }
            
            // Get current page URL and viewport dimensions (required by Gemini)
            let currentUrl = '';
            let viewportInfo = '';
            try {
              const pageInfo = await executeTool('getPageContext', {});
              currentUrl = pageInfo?.url || '';

              // Include viewport dimensions to help Gemini understand coordinate space
              if (pageInfo?.viewport) {
                viewportInfo = ` Viewport: ${pageInfo.viewport.width}x${pageInfo.viewport.height}`;
              }
            } catch (error) {
              console.warn('Failed to get page URL:', error);
            }

            // Build function response with URL and viewport info (required by Gemini)
            const functionResponse: any = {
              name: funcName,
              response: {
                ...result,
                url: currentUrl,  // Gemini requires this
                viewport_info: viewportInfo,
                success: result.success !== false
              }
            };
            
            functionResponses.push(functionResponse);
            
            // Update UI
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = responseText;
              }
              return updated;
            });
          }
        }
        
        // Add function responses back to conversation with new screenshot
        if (functionResponses.length > 0) {
          const userParts: any[] = functionResponses.map(fr => ({
            function_response: fr
          }));
          
          // Add new screenshot
          if (screenshot && screenshot.screenshot) {
            userParts.push({
              inline_data: {
                mime_type: 'image/png',
                data: screenshot.screenshot.split(',')[1]
              }
            });
          }
          
          contents.push({
            role: 'user',
            parts: userParts
          });
        }
      }
      
      // Final update
      setMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = responseText || 'Task completed';
        }
        return updated;
      });
      
    } catch (error: any) {
      console.error('❌ Error with Gemini Computer Use:');
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Full error object:', error);
      throw error;
    }
  };

  // Scale coordinates from Gemini's 1000x1000 grid to actual viewport
  const scaleCoordinates = async (x: number, y: number) => {
    try {
      // Get actual viewport dimensions
      const pageInfo = await executeTool('getPageContext', {});
      const viewportWidth = pageInfo?.viewport?.width || 1440;
      const viewportHeight = pageInfo?.viewport?.height || 900;

      // Gemini uses 1000x1000 normalized coordinates
      const scaledX = Math.round((x / 1000) * viewportWidth);
      const scaledY = Math.round((y / 1000) * viewportHeight);
      return { x: scaledX, y: scaledY };
    } catch (error) {
      console.error('Failed to scale coordinates:', error);
      // Fallback to original coordinates if scaling fails
      return { x, y };
    }
  };

  const requiresUserConfirmation = async (functionName: string, args: any): Promise<boolean> => {
    let pageContext: any = {};
    try {
      pageContext = await executeTool('getPageContext', {});
    } catch (e) {
      console.warn('Could not get page context');
    }

    const url = pageContext?.url?.toLowerCase() || '';
    const pageText = pageContext?.text?.toLowerCase() || '';

    const alwaysConfirm = ['key_combination'];

    const isSensitivePage =
      url.includes('checkout') ||
      url.includes('payment') ||
      url.includes('login') ||
      url.includes('signin') ||
      url.includes('admin') ||
      url.includes('delete') ||
      url.includes('remove') ||
      pageText.includes('checkout') ||
      pageText.includes('payment') ||
      pageText.includes('purchase') ||
      pageText.includes('confirm order') ||
      pageText.includes('delete') ||
      pageText.includes('remove account');

    const isSensitiveInput = functionName.includes('type') && (
      args.text?.toLowerCase().includes('password') ||
      args.text?.match(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/) ||
      pageText.includes('credit card') ||
      pageText.includes('cvv') ||
      pageText.includes('social security')
    );

    const isFormSubmission = functionName === 'type_text_at' && args.press_enter === true;

    if (alwaysConfirm.includes(functionName) || isSensitivePage || isSensitiveInput || isFormSubmission) {
      const confirmMessage = `🔒 Confirm Action\n\nAction: ${functionName}\nPage: ${url}` +
        `${isSensitivePage ? '\n⚠️ Sensitive page' : ''}` +
        `${isSensitiveInput ? '\n⚠️ Sensitive data' : ''}` +
        `${isFormSubmission ? '\n⚠️ Form submission' : ''}\n\nProceed?`;
      return window.confirm(confirmMessage);
    }

    return false;
  };

  const executeBrowserAction = async (functionName: string, args: any) => {
    const userConfirmed = await requiresUserConfirmation(functionName, args);

    if (!userConfirmed && (
      ['key_combination'].includes(functionName) ||
      functionName.includes('type') ||
      functionName === 'type_text_at'
    )) {
      return { success: false, error: 'Action cancelled by user', userCancelled: true };
    }

    switch (functionName) {
      case 'clickElement':
        return await executeTool('clickElement', {
          selector: args.selector,
          text: args.text
        });

      case 'click':
      case 'click_at':
      case 'mouse_click':
        // Scale coordinates from Gemini's 1000x1000 grid to actual viewport
        const clickCoords = await scaleCoordinates(
          args.x || args.coordinate?.x || 0,
          args.y || args.coordinate?.y || 0
        );
        return await executeTool('click', clickCoords);
      
      case 'type':
      case 'type_text':
      case 'keyboard_input':
      case 'input_text':
        const typeSelector = args.selector || 'input:focus, textarea:focus, [contenteditable="true"]:focus';
        const typeResult = await executeTool('type', {
          selector: typeSelector,
          text: args.text || args.input || args.content
        });

        // Note: Enter key is now automatically pressed immediately after typing
        // for search inputs (happens in content script without losing focus)

        return typeResult;
      
      case 'scroll':
      case 'scroll_down':
      case 'scroll_up':
      case 'mouse_scroll':
        const direction = functionName === 'scroll_up' ? 'up' : 
                         functionName === 'scroll_down' ? 'down' : 
                         args.direction || 'down';
        return await executeTool('scroll', { 
          direction,
          amount: args.amount || args.pixels || args.delta || 500
        });
      
      case 'navigate':
      case 'open_web_browser':
      case 'navigate_to':
      case 'go_to':
        return await executeTool('navigate', { 
          url: args.url || args.address || args.uri
        });
      
      case 'get_screenshot':
      case 'take_screenshot':
      case 'screenshot':
        return await executeTool('screenshot', {});
      
      case 'get_page_info':
      case 'get_url':
      case 'get_page_content':
        return await executeTool('getPageContext', {});
      
      case 'wait':
      case 'sleep':
      case 'delay':
        const waitTime = (args.seconds || args.milliseconds / 1000 || 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return { success: true, message: `Waited ${waitTime}ms` };
      
      case 'press_key':
      case 'key_press':
      case 'pressKey':
        // Handle special keys like Enter, Tab, etc.
        return await executeTool('pressKey', {
          key: args.key || args.keyCode || 'Enter'
        });
      
      case 'type_text_at':
        // Type text at coordinates (click first, then type)
        // This mimics Python's playwright keyboard.type() behavior
        if (args.x !== undefined && args.y !== undefined) {
          // Scale coordinates before clicking
          const typeCoords = await scaleCoordinates(args.x, args.y);
          await executeTool('click', typeCoords);
          // Wait for element to focus
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Clear existing text if requested
        if (args.clear_before_typing !== false) {
          // Use keyboard shortcuts to select all and delete (like Python implementation)
          const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
          if (isMac) {
            await executeTool('keyCombo', { keys: ['Meta', 'a'] });
          } else {
            await executeTool('keyCombo', { keys: ['Control', 'a'] });
          }
          await new Promise(resolve => setTimeout(resolve, 50));
          await executeTool('pressKey', { key: 'Delete' });
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Use keyboard_type action which simulates actual keyboard typing
        const keyboardTypeResult = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'EXECUTE_ACTION',
              action: 'keyboard_type',
              value: args.text || args.content
            },
            (response) => {
              resolve(response);
            }
          );
        });

        // If press_enter is requested, send Enter key
        if (args.press_enter) {
          await new Promise(resolve => setTimeout(resolve, 100));
          await executeTool('pressKey', { key: 'Enter' });
        }

        return keyboardTypeResult;
      
      case 'key_combination':
        // Press keyboard key combinations like ["Control", "A"] or ["Enter"]
        const keys = args.keys || [args.key] || ['Enter'];
        return await executeTool('keyCombo', { keys });
      
      case 'hover_at':
        // Hover mouse at coordinates
        const hoverCoords = await scaleCoordinates(args.x || 0, args.y || 0);
        return await executeTool('hover', hoverCoords);
      
      case 'scroll_document':
        // Scroll the entire page
        const scrollDir = args.direction || 'down';
        return await executeTool('scroll', { direction: scrollDir, amount: 800 });
      
      case 'scroll_at':
        // Scroll at specific coordinates
        return await executeTool('scroll', { 
          direction: args.direction || 'down', 
          amount: args.magnitude || 800 
        });
      
      case 'wait_5_seconds':
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { success: true, message: 'Waited 5 seconds' };
      
      case 'go_back':
      case 'back':
        // Go back in browser history - properly async
        return new Promise<any>((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.goBack(tabs[0].id);
              // Add small delay for navigation to register
              setTimeout(() => {
                resolve({ success: true, message: 'Navigated back' });
              }, 300);
            } else {
              resolve({ success: false, error: 'No active tab found' });
            }
          });
        });

      case 'go_forward':
      case 'forward':
        // Go forward in browser history - properly async
        return new Promise<any>((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.goForward(tabs[0].id);
              // Add small delay for navigation to register
              setTimeout(() => {
                resolve({ success: true, message: 'Navigated forward' });
              }, 300);
            } else {
              resolve({ success: false, error: 'No active tab found' });
            }
          });
        });
      
      case 'search':
        // Navigate to Google search
        return await executeTool('navigate', { url: 'https://www.google.com' });
      
      case 'drag_and_drop':
        return await executeTool('dragDrop', { 
          x: args.x, 
          y: args.y, 
          destination_x: args.destination_x, 
          destination_y: args.destination_y 
        });
      
      default:
        console.warn('⚠️ Unknown Gemini function:', functionName, args);
        return { success: false, error: `Unknown function: ${functionName}`, args };
    }
  };

  // Stream with AI SDK using MCP tools
  const streamWithAISDKAndMCP = async (messages: Message[], tools: any) => {
    try {
      // Import streamText and provider SDKs
      const { streamText } = await import('ai');
      const { z } = await import('zod');

      // Import the appropriate provider SDK (only Google is supported)
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const googleClient = createGoogleGenerativeAI({ apiKey: settings!.apiKey });
      const model = googleClient(settings!.model);

      // Convert messages to AI SDK format
      const aiMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Define browser history tool
      const browserHistoryTool = {
        getBrowserHistory: {
          description: 'Get browser history. Useful for finding recently visited pages.',
          parameters: z.object({
            query: z.string().optional().describe('Search term to filter history (e.g., "github", "reddit")'),
            maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
            daysBack: z.number().optional().describe('How many days back to search (default: 7)'),
          }),
          execute: async ({ query = '', maxResults = 20, daysBack = 7 }: { query?: string; maxResults?: number; daysBack?: number }) => {
            const startTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
            const result = await executeTool('getBrowserHistory', { query, maxResults, startTime });
            
            // Format the history results for better readability
            if (result && result.history && Array.isArray(result.history)) {
              const formatted = result.history.map((item: any) => {
                const lastVisit = item.lastVisitTime ? new Date(item.lastVisitTime).toLocaleString() : 'Unknown';
                return `• **${item.title || 'Untitled'}**\n  ${item.url}\n  Last visited: ${lastVisit}`;
              }).join('\n\n');
              
              return `Found ${result.history.length} recent pages:\n\n${formatted}`;
            }
            
            return result;
          },
        },
      };

      // Merge MCP tools with browser history tool
      const allTools = {
        ...tools,
        ...browserHistoryTool,
      };

        const result = streamText({
          model,
          tools: allTools,
          messages: aiMessages,
          stopWhen: stepCountIs(20),
          abortSignal: abortControllerRef.current?.signal,
        });

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Stream the response - collect full text without duplicates
      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            // Only update if we've accumulated new text
            lastMsg.content = fullText;
          }
          return updated;
        });
      }

    } catch (error) {
      console.error('❌ Error streaming with AI SDK:', error);
      throw error;
    }
  };

  const streamGoogle = async (messages: Message[], signal: AbortSignal) => {
    // Ensure API credentials are available
    const apiKey = ensureApiKey();
    const model = ensureModel();

    // Add initial assistant message
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
    };
    setMessages(prev => [...prev, assistantMessage]);

    if (!messages || messages.length === 0) {
      throw new Error('No messages provided to stream');
    }

    const baseUrl = settings?.customBaseUrl || 'https://generativelanguage.googleapis.com';
    const isCustomProvider = !!settings?.customBaseUrl;

    // For custom providers, use Authorization header; for Google, use query param
    const url = isCustomProvider
      ? `${baseUrl}/v1beta/models/${model}:streamGenerateContent`
      : `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isCustomProvider) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content || '' }],
        })),
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Google API request failed');
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let jsonBuffer = ''; // Accumulate all data for fallback parsing
    let parsedAnyChunk = false; // Track if we successfully parsed any chunk

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Fallback: If no chunks were parsed (formatted JSON response), try parsing the entire buffer
        if (!parsedAnyChunk && jsonBuffer.trim()) {
          try {
            let data = JSON.parse(jsonBuffer.trim());
            // Handle array response format
            if (Array.isArray(data) && data.length > 0) {
              data = data[0];
            }
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content = text;
                }
                return updated;
              });
            }
          } catch (e) {
            console.warn('Failed to parse accumulated JSON buffer:', e);
          }
        }
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      jsonBuffer += chunk; // Accumulate for fallback

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            parsedAnyChunk = true;
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content += text;
              }
              return updated;
            });
          }
        } catch (e) {
          // Skip invalid JSON (expected for formatted responses)
        }
      }
    }
  };

  /**
   * Find matching service mappings for the current URL
   * Returns matching A2A agent (first match) and all matching MCP server IDs
   */
  const findMatchingMappings = (url: string | null, mappings: ServiceMapping[] | undefined): {
    a2aMapping: ServiceMapping | null;
    mcpServerIds: string[];
  } => {
    console.log('🔍 findMatchingMappings called with:', { url, mappingsCount: mappings?.length });

    if (!url || !mappings || mappings.length === 0) {
      console.log('⚠️  No URL or mappings provided');
      return { a2aMapping: null, mcpServerIds: [] };
    }

    // Find all enabled mappings that match the current URL
    console.log('🔍 Checking each mapping for URL:', url);
    const matchingMappings = mappings
      .filter(m => {
        const matches = m.enabled && matchesUrlPattern(url, m.urlPattern);
        console.log(`   Pattern: "${m.urlPattern}" vs URL: "${url}" → ${matches ? '✓ MATCH' : '✗ no match'}`);
        if (!matches && m.enabled) {
          // Debug why it didn't match
          const normalizedUrl = url
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/.*$/, '');
          const normalizedPattern = m.urlPattern
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '');
          console.log(`     Debug: normalized URL="${normalizedUrl}", normalized pattern="${normalizedPattern}"`);
        }
        return matches;
      })
      .sort((a, b) => a.createdAt - b.createdAt); // First created wins

    console.log(`🗺️  Found ${matchingMappings.length} matching mapping(s)`);

    // Find first A2A mapping
    const a2aMapping = matchingMappings.find(m => m.serviceType === 'a2a') || null;

    // Get all MCP server IDs
    const mcpServerIds = matchingMappings
      .filter(m => m.serviceType === 'mcp')
      .map(m => m.serviceId);

    return { a2aMapping, mcpServerIds };
  };

  /**
   * Check if there's a trusted service mapping for the current site
   * Returns true if there's at least one enabled mapping (MCP or A2A) for the current URL
   */
  const hasTrustedMappingForCurrentSite = (): boolean => {
    if (!currentTabUrl || !settings?.serviceMappings) {
      return false;
    }

    // Skip chrome:// and chrome-extension:// URLs
    if (currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
      return false;
    }

    const { a2aMapping, mcpServerIds } = findMatchingMappings(currentTabUrl, settings.serviceMappings);
    return a2aMapping !== null || mcpServerIds.length > 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !settings) return;

    // Clear tool executing state at the start of each new message
    setIsToolExecuting(false);

    // Get page context to include with the message
    let pageContext = '';
    try {
      const context: any = await executeTool('getPageContext', {});
      if (context && context.url && context.title) {
        // Reduce page context size in browser tools mode to avoid hitting context limits
        const maxContentLength = browserToolsEnabled ? 300 : 3000; // Further reduced from 500 to 300
        pageContext = `\n\n[Current Page Context]\nURL: ${context.url}\nTitle: ${context.title}\nContent: ${context.textContent?.substring(0, maxContentLength) || 'No content available'}`;
      }
    } catch (error) {
      console.log('Could not get page context:', error);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input + pageContext,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setIsUserScrolled(false); // Reset scroll state when user sends message

    // Force immediate scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 0);

    // Create tab-specific abort controller for concurrent conversations
    const tabId = getCurrentTabId();
    const newAbortController = new AbortController();
    if (tabId !== null) {
      tabAbortControllerRef.current[tabId] = newAbortController;
    }
    abortControllerRef.current = newAbortController;

    try {
      // CHECK SERVICE MAPPINGS FIRST
      // Service mappings take precedence over automatic site detection
      const { a2aMapping, mcpServerIds } = findMatchingMappings(currentTabUrl, settings.serviceMappings);

      // PRIORITY: If MCP is enabled and has mappings, route to MCP (browser tools with MCP)
      // MCP takes priority over A2A when both are available
      if (settings.mcpEnabled && mcpServerIds.length > 0) {
        console.log(`🔧 MCP enabled with ${mcpServerIds.length} mapped server(s) - routing to MCP (priority over A2A)`);
        // Continue to browser tools section which will use MCP tools
      }
      // If there's a mapped A2A agent for this site AND no MCP priority, route to it
      // BUT ONLY if the A2A server is actually enabled in settings
      else if (a2aMapping) {
        // Check if the A2A server is enabled in settings
        const a2aServerConfig = settings.mcpServers?.find(s => s.id === a2aMapping.serviceId);
        
        // Only route to A2A if the server exists in settings AND is enabled
        if (!a2aServerConfig || !a2aServerConfig.enabled) {
          console.log(`🚫 A2A mapping found but server is not enabled - skipping A2A routing`);
          // Continue to browser tools section which will use MCP tools if available
        } else {
          console.log(`🗺️  Service mapping found: Routing to A2A agent "${a2aMapping.serviceName}" for URL pattern "${a2aMapping.urlPattern}"`);

          // Create assistant message placeholder with routing indicator
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `🗺️ **Routing via Site Mapping:** ${a2aMapping.serviceName}\n\n`,
          };
          setMessages(prev => [...prev, assistantMessage]);

          try {
            const a2aService = getTabA2AService();

            // Check if A2A service is connected, if not, connect it on-demand
            const connectionStatus = a2aService.getConnectionStatus();
            const isConnected = connectionStatus.some(c => c.serverId === a2aMapping.serviceId);

            if (!isConnected) {
              console.log(`🔌 A2A service not connected, connecting on-demand...`);

              // Use the enabled server config from settings
              const serviceConfig = a2aServerConfig;

            // Connect the A2A service
            await a2aService.connectToServers([serviceConfig]);
            console.log(`✅ A2A service connected on-demand`);
          }

          // Send message to A2A agent using SDK
          const response = await a2aService.sendMessage(a2aMapping.serviceId, input);

          // Update assistant message with response
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `🗺️ **Routing via Site Mapping:** ${a2aMapping.serviceName}\n\n${response.text}`;
              // Add audioLink if present
              if (response.audioLink) {
                lastMsg.audioLink = response.audioLink;
              }
            }
            return updated;
          });
        } catch (error: any) {
          console.error('A2A agent error:', error);
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `🗺️ **Routing via Site Mapping:** ${a2aMapping.serviceName}\n\n**Error:** ${error.message}`;
            }
            return updated;
          });
        }

        setIsLoading(false);
        return; // Exit early - message handled by mapped A2A agent
        }
      }

      // If there are MCP mappings, we'll filter MCPs later in the browser tools section
      if (mcpServerIds.length > 0) {
        console.log(`🗺️  Service mapping found: ${mcpServerIds.length} MCP server(s) mapped for current site`);
      }

      // CHECK FOR A2A AGENT FOR CURRENT SITE (Fallback to automatic detection)
      // Only route to A2A if MCP is not enabled or has no mappings (MCP takes priority)
      // If the current site has a registered A2A agent AND user is opted in AND there's a trusted mapping AND the A2A server is enabled, route messages directly to it
      if (!(settings.mcpEnabled && mcpServerIds.length > 0) && currentSiteAgent && trustedAgentOptIn && hasTrustedMappingForCurrentSite()) {
        // Check if the A2A server is enabled in settings
        const a2aServerConfig = settings.mcpServers?.find(s => s.id === currentSiteAgent.serverId);
        
        // Only route to A2A if the server exists in settings AND is enabled
        if (!a2aServerConfig || !a2aServerConfig.enabled) {
          console.log(`🚫 A2A agent detected but server is not enabled - skipping A2A routing`);
          // Continue to browser tools section which will use MCP tools if available
        } else {
          console.log(`🔀 Routing message to A2A agent "${currentSiteAgent.serverName}" for current site (user opted in, trusted mapping exists, server enabled)`);

        // Get info about other available tools (only from trusted mappings)
        const mcpService = getTabMcpService();
        const a2aService = getTabA2AService();
        
        // Only count MCP tools from mapped servers
        let mcpToolCount = 0;
        if (mcpService.hasConnections() && mcpServerIds.length > 0) {
          const allTools = mcpService.getToolsWithOrigin();
          const filteredTools = allTools.filter(tool => mcpServerIds.includes(tool.serverId));
          mcpToolCount = filteredTools.length;
        }
        
        const otherA2ACount = a2aService.getConnectionStatus().length - 1; // Minus current agent

        // Build availability message
        let availabilityNote = '';
        const otherTools: string[] = [];
        if (mcpToolCount > 0) otherTools.push(`${mcpToolCount} MCP tool(s)`);
        if (otherA2ACount > 0) otherTools.push(`${otherA2ACount} other A2A agent(s)`);
        if (browserToolsEnabled) otherTools.push('Browser Tools');

        if (otherTools.length > 0) {
          availabilityNote = `\n\n*Also available: ${otherTools.join(', ')}*`;
        }

        // Create assistant message placeholder with routing indicator
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `🤖 **Routing to A2A Agent:** ${currentSiteAgent.serverName}${availabilityNote}\n\n`,
        };
        setMessages(prev => [...prev, assistantMessage]);

        try {
          const a2aService = getTabA2AService();
          // Send message to A2A agent using SDK
          const response = await a2aService.sendMessage(currentSiteAgent.serverId, input);

          // Update assistant message with response
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `🤖 **Routing to A2A Agent:** ${currentSiteAgent.serverName}${availabilityNote}\n\n${response.text}`;
              // Add audioLink if present
              if (response.audioLink) {
                lastMsg.audioLink = response.audioLink;
              }
            }
            return updated;
          });
        } catch (error: any) {
          console.error('A2A agent error:', error);
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `🤖 **Routing to A2A Agent:** ${currentSiteAgent.serverName}${availabilityNote}\n\n**Error:** ${error.message}`;
            }
            return updated;
          });
        }

        setIsLoading(false);
        return; // Exit early - message handled by A2A agent
        }
      }

      // BROWSER TOOLS MODE
      if (browserToolsEnabled) {
        // Show browser automation overlay
        await showBrowserAutomationOverlay();

        // Close MCP client if active
        if (mcpClientRef.current) {
          try {
            await mcpClientRef.current.close();
          } catch (e) {
            // Silent fail
          }
          mcpClientRef.current = null;
          mcpToolsRef.current = null;
        }

        // Route to provider-specific browser tools
        if (settings.provider === 'google') {
          await streamWithGeminiComputerUse(newMessages);
        } else if (settings.provider === 'anthropic') {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
          };
          setMessages(prev => [...prev, assistantMessage]);

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          // Initialize custom MCP and A2A if not already initialized
          if (!customMCPToolsRef.current && settings.mcpServers && settings.mcpServers.length > 0) {
            console.log('🚀 Initializing custom MCP/A2A for browser tools...');
            // Only use MCPs if they're explicitly mapped to the current site
            let enabledServers: typeof settings.mcpServers = [];
            if (mcpServerIds.length > 0) {
              console.log(`🗺️  Using mapped MCP servers: ${mcpServerIds.join(', ')}`);
              enabledServers = settings.mcpServers.filter(s => s.enabled && mcpServerIds.includes(s.id));
            } else {
              console.log('🗺️  No MCP mappings for current site - MCPs disabled');
            }

            if (enabledServers.length > 0 && !customMCPInitPromiseRef.current) {
              customMCPInitPromiseRef.current = (async () => {
                try {
                  // Use tab-specific services
                  const mcpService = getTabMcpService();
                  const a2aService = getTabA2AService();

                  // Connect to MCP servers (using filtered enabledServers)
                  await mcpService.connectToServers(enabledServers);

                  // Connect to A2A servers (using filtered enabledServers)
                  await a2aService.connectToServers(enabledServers);

                  if (mcpService.hasConnections()) {
                    customMCPToolsRef.current = mcpService.getAggregatedTools();
                    console.log(`✅ Custom MCP ready - ${mcpService.getTotalToolCount()} tool(s) available`);
                    console.log(getToolDescription(mcpService.getToolsWithOrigin()));
                  } else {
                    console.warn('⚠️  No custom MCP servers connected');
                    customMCPToolsRef.current = null;
                  }

                  if (a2aService.hasConnections()) {
                    console.log(`✅ A2A ready - ${a2aService.getConnectionStatus().length} agent(s) registered`);
                  }
                } catch (error) {
                  console.error('❌ Custom MCP/A2A init failed:', error);
                  customMCPToolsRef.current = null;
                } finally {
                  customMCPInitPromiseRef.current = null;
                }
              })();

              await customMCPInitPromiseRef.current;
            } else if (customMCPInitPromiseRef.current) {
              await customMCPInitPromiseRef.current;
            }
          }

          // Prepare custom MCP and A2A tools if available AND there's a trusted mapping
          let mcpTools: any[] | undefined;
          let mcpToolNameSet: Set<string> | null = null;
          let mcpToolInvoked = false;
          let browserToolBlockCount = 0;
          const MAX_BROWSER_TOOL_BLOCKS = 1;
          // Only add MCP/A2A tools if there's a trusted mapping for the current site
          if (customMCPToolsRef.current && hasTrustedMappingForCurrentSite()) {
            const { formatToolsForAnthropic, formatA2AToolsForAnthropic } = await import('./mcp-tool-router');
            const { getA2AService } = await import('./a2a-service');

            // Format MCP tools
            const formattedMCPTools = formatToolsForAnthropic(customMCPToolsRef.current);

            // Format A2A tools
            const a2aService = getTabA2AService();
            const a2aTools = a2aService.hasConnections()
              ? formatA2AToolsForAnthropic(a2aService.getConnectionStatus())
              : [];

            // Combine MCP and A2A tools
            mcpTools = [...formattedMCPTools, ...a2aTools];
            mcpToolNameSet = new Set(mcpTools.map((tool) => tool.name));

            console.log(`🔌 Adding ${formattedMCPTools.length} MCP + ${a2aTools.length} A2A tools to Anthropic (with browser tools)`);

            // Log tool names and descriptions for debugging
            const toolNames = mcpTools.map(t => t.name).join(', ');
            console.log(`📋 Available tools: ${toolNames}`);

            // Log detailed tool info
            mcpTools.forEach(tool => {
              console.log(`  🔧 ${tool.name}: ${tool.description || 'No description'}`);
            });
          } else {
            // No trusted mapping - block MCP/A2A tools
            if (customMCPToolsRef.current) {
              console.log(`🚫 MCP/A2A tools blocked: No trusted service mapping for current site (${currentTabUrl})`);
            }
            mcpTools = undefined;
            mcpToolNameSet = null;
          }

          // Create a wrapped executeTool that handles browser, MCP, and A2A tools
          const wrappedExecuteTool = async (toolName: string, params: any) => {
            console.log(`🔧 Tool call: ${toolName}`, params);

            // Check if this is an A2A tool (starts with "a2a_")
            if (toolName.startsWith('a2a_')) {
              // Check if there's a trusted mapping for the current site
              if (!hasTrustedMappingForCurrentSite()) {
                console.warn(`🚫 A2A tool "${toolName}" blocked: No trusted service mapping for current site`);
                return { 
                  error: `A2A tools are not available for this site. Please configure a trusted service mapping in settings.`,
                  blocked: true
                };
              }

              try {
                const a2aService = getTabA2AService();

                // Extract server ID from tool name and find the corresponding server
                const connections = a2aService.getConnectionStatus();
                const serverName = toolName.replace('a2a_', '').replace(/_/g, ' ');

                // Find matching connection (case-insensitive)
                const connection = connections.find(c =>
                  c.serverName.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                  serverName.replace(/\s/g, '').toLowerCase()
                );

                if (connection) {
                  const result = await a2aService.executeTask(connection.serverId, params.task);
                  return result;
                } else {
                  throw new Error(`A2A agent not found for tool: ${toolName}`);
                }
              } catch (error: any) {
                console.error(`❌ A2A tool execution failed:`, error);
                return { error: error.message || 'A2A tool execution failed' };
              }
            }

            // Check if this is an MCP tool
            if (mcpTools && mcpToolNameSet?.has(toolName)) {
              mcpToolInvoked = true;

              // Check if there's a trusted mapping for the current site
              if (!hasTrustedMappingForCurrentSite()) {
                console.warn(`🚫 MCP tool "${toolName}" blocked: No trusted service mapping for current site`);
                setIsToolExecuting(false);
                return { 
                  error: `MCP tools are not available for this site. Please configure a trusted service mapping in settings.`,
                  blocked: true
                };
              }

              // Show typing indicator immediately when MCP tool is detected
              setIsToolExecuting(true);

              // Execute MCP tool
              try {
                const mcpService = getTabMcpService();
                const result = await mcpService.executeToolCall(toolName, params);
                // Hide typing indicator when tool completes
                setIsToolExecuting(false);

                // Check if result has audioLink (for music generation tools)
                if (result && typeof result === 'object') {
                  const audioLink = result.audioLink || result.audio_link || result.audioUrl;
                  if (audioLink) {
                    console.log(`🎵 MCP tool returned audio link: ${audioLink}`);
                    console.log(`🎵 Full result object:`, JSON.stringify(result, null, 2));
                    toolAudioLinksRef.current.push(audioLink);
                    
                    // Attach audioLink immediately to the last assistant message with retry logic
                    const attachAudioLink = (retryCount = 0, maxRetries = 5) => {
                      setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length === 0) {
                          if (retryCount < maxRetries) {
                            console.log(`⏳ No messages yet, retrying in 100ms (attempt ${retryCount + 1}/${maxRetries})`);
                            setTimeout(() => attachAudioLink(retryCount + 1, maxRetries), 100);
                          } else {
                            console.warn(`⚠️ No messages found after ${maxRetries} retries`);
                          }
                          return prev;
                        }
                        const lastMsg = updated[updated.length - 1];
                        console.log(`🔍 Last message when attaching audioLink (attempt ${retryCount + 1}):`, {
                          id: lastMsg?.id,
                          role: lastMsg?.role,
                          hasAudioLink: !!lastMsg?.audioLink,
                          contentLength: lastMsg?.content?.length
                        });
                        if (lastMsg && lastMsg.role === 'assistant') {
                          // Always create a new message object to ensure React detects the change
                          const newMessage = {
                            ...lastMsg,
                            audioLink: audioLink
                          };
                          updated[updated.length - 1] = newMessage;
                          console.log(`✅ Audio link attached immediately to message ${lastMsg.id}: ${audioLink}`);
                          console.log(`✅ Updated message object:`, newMessage);
                          // Clear typing indicator when audio link is attached
                          setIsToolExecuting(false);
                          return updated;
                        } else {
                          if (retryCount < maxRetries) {
                            console.log(`⏳ Last message not ready yet, retrying in 100ms (attempt ${retryCount + 1}/${maxRetries})`);
                            setTimeout(() => attachAudioLink(retryCount + 1, maxRetries), 100);
                          } else {
                            console.warn(`⚠️ Last message is not assistant or doesn't exist after ${maxRetries} retries:`, lastMsg);
                          }
                        }
                        return prev;
                      });
                    };
                    attachAudioLink();
                  } else {
                    console.log(`⚠️ No audioLink found in result object. Result keys:`, Object.keys(result));
                  }
                }

                return result;
              } catch (error: any) {
                console.error(`❌ MCP tool execution failed:`, error);
                setIsToolExecuting(false); // Hide indicator on error
                return { error: error.message || 'MCP tool execution failed' };
              }
            }

            const shouldGateBrowserTools =
              !!mcpToolNameSet && mcpToolNameSet.size > 0 && !mcpToolInvoked;

            if (
              shouldGateBrowserTools &&
              BROWSER_TOOL_NAMES.has(toolName) &&
              browserToolBlockCount < MAX_BROWSER_TOOL_BLOCKS
            ) {
              browserToolBlockCount += 1;
              const warning =
                'MCP or trusted agent tools are available. Please call one of them first before using browser automation.';
              console.warn(`⚠️ ${warning}`);
              return { success: false, error: warning };
            }

            // Show overlay before ANY browser tool execution
            // (ensures overlay is always visible during automation)
            console.log(`🔵 Showing overlay for browser tool: ${toolName}`);
            await showBrowserAutomationOverlay();

            // Execute browser tool
            const result = await executeTool(toolName, params);

            // Re-show overlay after tool execution (in case page navigation removed it)
            // Small delay to let any page changes settle
            setTimeout(async () => {
              await showBrowserAutomationOverlay();
            }, 500);

            return result;
          };

          // Get matching site instructions for current URL
          const matchedInstructions = getMatchingSiteInstructions(currentTabUrl);

          await streamAnthropicWithBrowserTools(
            newMessages,
            settings.apiKey,
            modelToUse,
            settings.customBaseUrl,
            (text: string) => {
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content += text;
                }
                return updated;
              });
              // Force scroll on each chunk - use setTimeout to ensure DOM updates first
              setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
              }, 0);
            },
            () => {
              // On complete - hide browser automation overlay
              hideBrowserAutomationOverlay();
              // Clear tool executing state
              setIsToolExecuting(false);

              // Attach audio links from MCP tools to the assistant message (fallback if not already attached)
              if (toolAudioLinksRef.current.length > 0) {
                console.log(`🎵 onComplete: Checking if audio link needs to be attached`);
                const audioLinkToAttach = toolAudioLinksRef.current[0];
                const attachInOnComplete = (retryCount = 0, maxRetries = 3) => {
                  setMessages(prev => {
                    const updated = [...prev];
                    if (updated.length === 0) {
                      if (retryCount < maxRetries) {
                        console.log(`⏳ onComplete: No messages yet, retrying in 200ms (attempt ${retryCount + 1}/${maxRetries})`);
                        setTimeout(() => attachInOnComplete(retryCount + 1, maxRetries), 200);
                      } else {
                        console.warn(`⚠️ onComplete: No messages found after ${maxRetries} retries`);
                      }
                      return prev;
                    }
                    const lastMsg = updated[updated.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.audioLink) {
                      // Only attach if not already attached (might have been attached during tool execution)
                      updated[updated.length - 1] = {
                        ...lastMsg,
                        audioLink: audioLinkToAttach
                      };
                      console.log(`✅ Audio link attached in onComplete: ${audioLinkToAttach}`);
                      // Clear typing indicator when audio link is attached
                      setIsToolExecuting(false);
                      return updated;
                    } else if (lastMsg?.audioLink) {
                      console.log(`ℹ️ Audio link already attached: ${lastMsg.audioLink}`);
                    } else if (retryCount < maxRetries) {
                      console.log(`⏳ onComplete: Message not ready, retrying in 200ms (attempt ${retryCount + 1}/${maxRetries})`);
                      setTimeout(() => attachInOnComplete(retryCount + 1, maxRetries), 200);
                      return prev;
                    }
                    return updated;
                  });
                };
                attachInOnComplete();
                // Clear for next message
                toolAudioLinksRef.current = [];
              }
            },
            wrappedExecuteTool,
            undefined, // Don't pass abort signal for now - causes issues
            mcpTools,
            currentTabUrl || undefined,
            matchedInstructions || undefined,
            settings, // Pass settings for conversation history and summarization
            (toolName: string, isMcpTool: boolean) => {
              // Show typing indicator when MCP tool starts executing
              if (isMcpTool) {
                setIsToolExecuting(true);
              }
            }
          );
        } else {
          throw new Error(`Browser Tools not supported for ${settings.provider}`);
        }
      } else if (settings.composioApiKey) {
        if (isComposioSessionExpired()) {
          console.warn('Composio session expired, reinitializing...');
          await loadSettings(true);
        }

        const isComputerUseModel = settings.model === 'gemini-2.5-computer-use-preview-10-2025';
        if (isComputerUseModel && settings.provider === 'google') {
          setSettings({ ...settings, model: 'gemini-2.5-pro' });
          console.warn('Switching to gemini-2.5-pro (incompatible with MCP)');
        }

        if (mcpClientRef.current && mcpToolsRef.current) {
          await streamWithAISDKAndMCP(newMessages, mcpToolsRef.current);
        } else if (mcpInitPromiseRef.current) {
          await mcpInitPromiseRef.current;
          if (mcpClientRef.current && mcpToolsRef.current) {
            await streamWithAISDKAndMCP(newMessages, mcpToolsRef.current);
          } else {
            await streamGoogle(newMessages, abortControllerRef.current.signal);
          }
        } else {
          mcpInitPromiseRef.current = (async () => {
            try {
              const storage = await chrome.storage.local.get(['composioToolRouterMcpUrl', 'composioSessionId', 'atlasSettings']);
              if (!storage.composioToolRouterMcpUrl || !storage.composioSessionId) return;

              const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
              const composioApiKey = storage.atlasSettings?.composioApiKey;

              const transportOptions: any = { sessionId: storage.composioSessionId };
              if (composioApiKey) {
                transportOptions.headers = { 'x-api-key': composioApiKey };
              }

              const mcpClient = await experimental_createMCPClient({
                transport: new StreamableHTTPClientTransport(
                  new URL(storage.composioToolRouterMcpUrl),
                  transportOptions
                ),
              });

              const mcpTools = await mcpClient.tools();
              if (Object.keys(mcpTools).length > 0) {
                mcpClientRef.current = mcpClient;
                mcpToolsRef.current = mcpTools;
              } else {
                await mcpClient.close();
              }
            } catch (error) {
              console.error('MCP init failed:', error);
            } finally {
              mcpInitPromiseRef.current = null;
            }
          })();

          await mcpInitPromiseRef.current;

          if (mcpClientRef.current && mcpToolsRef.current) {
            await streamWithAISDKAndMCP(newMessages, mcpToolsRef.current);
          } else {
            await streamGoogle(newMessages, abortControllerRef.current.signal);
          }
        }
      } else {
        // Initialize custom MCP and A2A servers if enabled
        if (settings.mcpEnabled && settings.mcpServers && settings.mcpServers.length > 0) {
          console.log(`🔍 MCP/A2A enabled with ${settings.mcpServers.length} configured server(s)`);
          console.log(`🔍 customMCPInitPromiseRef.current exists: ${!!customMCPInitPromiseRef.current}`);

          if (!customMCPInitPromiseRef.current) {
            console.log('🚀 Starting MCP/A2A initialization...');
            customMCPInitPromiseRef.current = (async () => {
              try {
                console.log('🔌 Initializing custom MCP/A2A servers...');

                // Only use MCPs if they're explicitly mapped to the current site
                let serversToConnect: typeof settings.mcpServers = [];
                if (mcpServerIds.length > 0) {
                  console.log(`🗺️  Using mapped MCP servers: ${mcpServerIds.join(', ')}`);
                  console.log(`🔍 DEBUG - mcpServerIds array:`, mcpServerIds);
                  console.log(`🔍 DEBUG - settings.mcpServers:`, settings.mcpServers.map(s => ({ id: s.id, name: s.name, enabled: s.enabled })));

                  serversToConnect = settings.mcpServers.filter(s => {
                    const isEnabled = s.enabled;
                    const isInMappedIds = mcpServerIds.includes(s.id);
                    console.log(`🔍 Checking server "${s.name}" (id: "${s.id}"): enabled=${isEnabled}, inMappedIds=${isInMappedIds}`);
                    return isEnabled && isInMappedIds;
                  });
                } else {
                  console.log('🗺️  No MCP mappings for current site - MCPs disabled');
                }

                console.log('📋 Servers to connect:', serversToConnect.map(s => `${s.name} (${s.enabled ? 'enabled' : 'disabled'}, ${s.protocol || 'mcp'})`));
                console.log('📋 Number of servers to connect:', serversToConnect.length);

                const mcpService = getTabMcpService();
                const a2aService = getTabA2AService();

                await mcpService.connectToServers(serversToConnect);
                await a2aService.connectToServers(serversToConnect);

                if (mcpService.hasConnections()) {
                  customMCPToolsRef.current = mcpService.getAggregatedTools();
                  console.log(`✅ Custom MCP ready - ${mcpService.getTotalToolCount()} tool(s) available`);
                  console.log(getToolDescription(mcpService.getToolsWithOrigin()));
                } else {
                  console.warn('⚠️  No custom MCP servers connected');
                  customMCPToolsRef.current = null;
                }

                if (a2aService.hasConnections()) {
                  console.log(`✅ A2A ready - ${a2aService.getConnectionStatus().length} agent(s) registered`);
                }
              } catch (error) {
                console.error('❌ Custom MCP/A2A init failed:', error);
                customMCPToolsRef.current = null;
              } finally {
                customMCPInitPromiseRef.current = null;
              }
            })();
          } else {
            console.log('⏳ MCP/A2A initialization already in progress, waiting...');
          }

          await customMCPInitPromiseRef.current;
        } else {
          console.log('ℹ️  MCP not enabled or no servers configured');
          console.log(`  - mcpEnabled: ${settings.mcpEnabled}`);
          console.log(`  - mcpServers count: ${settings.mcpServers?.length || 0}`);
        }

        // Route to appropriate provider
        if (settings.provider === 'anthropic') {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
          };
          setMessages(prev => [...prev, assistantMessage]);

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          // Check if we have custom MCP or A2A tools AND there's a trusted mapping
          let mcpTools: any[] | undefined = undefined;
          if (customMCPToolsRef.current && hasTrustedMappingForCurrentSite()) {
            const { formatToolsForAnthropic, formatA2AToolsForAnthropic } = await import('./mcp-tool-router');
            const { getA2AService } = await import('./a2a-service');

            // Format MCP tools
            const formattedMCPTools = formatToolsForAnthropic(customMCPToolsRef.current);

            // Format A2A tools
            const a2aService = getTabA2AService();
            const a2aTools = a2aService.hasConnections()
              ? formatA2AToolsForAnthropic(a2aService.getConnectionStatus())
              : [];

            // Combine tools
            mcpTools = [...formattedMCPTools, ...a2aTools];

            console.log(`🔌 Adding ${formattedMCPTools.length} MCP + ${a2aTools.length} A2A tools to Anthropic`);

            // Log tool names and descriptions for debugging
            const toolNames = mcpTools.map(t => t.name).join(', ');
            console.log(`📋 Available tools: ${toolNames}`);

            // Log detailed tool info
            mcpTools.forEach(tool => {
              console.log(`  🔧 ${tool.name}: ${tool.description || 'No description'}`);
            });
          } else {
            // No trusted mapping - MCP/A2A tools not available
            if (customMCPToolsRef.current) {
              console.log(`🚫 MCP/A2A tools blocked: No trusted service mapping for current site (${currentTabUrl})`);
            }
          }

          // Get matching site instructions for current URL
          const matchedInstructions = getMatchingSiteInstructions(currentTabUrl);

          await streamAnthropicWithBrowserTools(
              newMessages,
              settings.apiKey,
              modelToUse,
              settings.customBaseUrl,
              (text: string) => {
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content += text;
                  }
                  return updated;
                });
              },
              () => {
                // On complete - clear tool executing state
                setIsToolExecuting(false);
                // Attach audio links from MCP tools to the assistant message (fallback if not already attached)
                if (toolAudioLinksRef.current.length > 0) {
                  console.log(`🎵 onComplete: Checking if audio link needs to be attached`);
                  const audioLinkToAttach = toolAudioLinksRef.current[0];
                  const attachInOnComplete = (retryCount = 0, maxRetries = 3) => {
                    setMessages(prev => {
                      const updated = [...prev];
                      if (updated.length === 0) {
                        if (retryCount < maxRetries) {
                          console.log(`⏳ onComplete: No messages yet, retrying in 200ms (attempt ${retryCount + 1}/${maxRetries})`);
                          setTimeout(() => attachInOnComplete(retryCount + 1, maxRetries), 200);
                        } else {
                          console.warn(`⚠️ onComplete: No messages found after ${maxRetries} retries`);
                        }
                        return prev;
                      }
                      const lastMsg = updated[updated.length - 1];
                      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.audioLink) {
                        // Only attach if not already attached (might have been attached during tool execution)
                        updated[updated.length - 1] = {
                          ...lastMsg,
                          audioLink: audioLinkToAttach
                        };
                        console.log(`✅ Audio link attached in onComplete: ${audioLinkToAttach}`);
                        // Clear typing indicator when audio link is attached
                        setIsToolExecuting(false);
                        return updated;
                      } else if (lastMsg?.audioLink) {
                        console.log(`ℹ️ Audio link already attached: ${lastMsg.audioLink}`);
                      } else if (retryCount < maxRetries) {
                        console.log(`⏳ onComplete: Message not ready, retrying in 200ms (attempt ${retryCount + 1}/${maxRetries})`);
                        setTimeout(() => attachInOnComplete(retryCount + 1, maxRetries), 200);
                        return prev;
                      }
                      return updated;
                    });
                  };
                  attachInOnComplete();
                  // Clear for next message
                  toolAudioLinksRef.current = [];
                }
              },
              async (toolName: string, params: any) => {
                console.log(`🔧 Tool call: ${toolName}`, params);

                // Check if this is an A2A tool (starts with "a2a_")
                if (toolName.startsWith('a2a_')) {
                  // Check if there's a trusted mapping for the current site
                  if (!hasTrustedMappingForCurrentSite()) {
                    console.warn(`🚫 A2A tool "${toolName}" blocked: No trusted service mapping for current site`);
                    return { 
                      error: `A2A tools are not available for this site. Please configure a trusted service mapping in settings.`,
                      blocked: true
                    };
                  }

                  try {
                    const a2aService = getTabA2AService();

                    // Extract server ID from tool name and find the corresponding server
                    const connections = a2aService.getConnectionStatus();
                    const serverName = toolName.replace('a2a_', '').replace(/_/g, ' ');

                    // Find matching connection (case-insensitive)
                    const connection = connections.find(c =>
                      c.serverName.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                      serverName.replace(/\s/g, '').toLowerCase()
                    );

                    if (connection) {
                      const result = await a2aService.executeTask(connection.serverId, params.task);
                      return result;
                    } else {
                      throw new Error(`A2A agent not found for tool: ${toolName}`);
                    }
                  } catch (error: any) {
                    console.error(`❌ A2A tool execution failed:`, error);
                    return { error: error.message || 'A2A tool execution failed' };
                  }
                }

                // Check if this is an MCP tool
                const mcpService = getTabMcpService();
                const mcpTools = mcpService.getAggregatedTools();

                if (toolName in mcpTools) {
                  // Check if there's a trusted mapping for the current site
                  if (!hasTrustedMappingForCurrentSite()) {
                    console.warn(`🚫 MCP tool "${toolName}" blocked: No trusted service mapping for current site`);
                    setIsToolExecuting(false);
                    return { 
                      error: `MCP tools are not available for this site. Please configure a trusted service mapping in settings.`,
                      blocked: true
                    };
                  }

                  // Execute MCP tool
                  try {
                    // Show typing indicator while tool is executing
                    setIsToolExecuting(true);
                    const result = await mcpService.executeToolCall(toolName, params);
                    // Hide typing indicator when tool completes
                    setIsToolExecuting(false);

                    // Check if result has audioLink (for music generation tools)
                    if (result && typeof result === 'object') {
                      const audioLink = result.audioLink || result.audio_link || result.audioUrl;
                      if (audioLink) {
                        console.log(`🎵 MCP tool returned audio link: ${audioLink}`);
                        console.log(`🎵 Full result object:`, JSON.stringify(result, null, 2));
                        toolAudioLinksRef.current.push(audioLink);
                        
                        // Attach audioLink immediately to the last assistant message with retry logic
                        const attachAudioLink = (retryCount = 0, maxRetries = 5) => {
                          setMessages(prev => {
                            const updated = [...prev];
                            if (updated.length === 0) {
                              if (retryCount < maxRetries) {
                                console.log(`⏳ No messages yet, retrying in 100ms (attempt ${retryCount + 1}/${maxRetries})`);
                                setTimeout(() => attachAudioLink(retryCount + 1, maxRetries), 100);
                              } else {
                                console.warn(`⚠️ No messages found after ${maxRetries} retries`);
                              }
                              return prev;
                            }
                            const lastMsg = updated[updated.length - 1];
                            console.log(`🔍 Last message when attaching audioLink (attempt ${retryCount + 1}):`, {
                              id: lastMsg?.id,
                              role: lastMsg?.role,
                              hasAudioLink: !!lastMsg?.audioLink,
                              contentLength: lastMsg?.content?.length
                            });
                            if (lastMsg && lastMsg.role === 'assistant') {
                              // Always create a new message object to ensure React detects the change
                              const newMessage = {
                                ...lastMsg,
                                audioLink: audioLink
                              };
                              updated[updated.length - 1] = newMessage;
                              console.log(`✅ Audio link attached immediately to message ${lastMsg.id}: ${audioLink}`);
                              console.log(`✅ Updated message object:`, newMessage);
                              // Clear typing indicator when audio link is attached
                              setIsToolExecuting(false);
                              return updated;
                            } else {
                              if (retryCount < maxRetries) {
                                console.log(`⏳ Last message not ready yet, retrying in 100ms (attempt ${retryCount + 1}/${maxRetries})`);
                                setTimeout(() => attachAudioLink(retryCount + 1, maxRetries), 100);
                              } else {
                                console.warn(`⚠️ Last message is not assistant or doesn't exist after ${maxRetries} retries:`, lastMsg);
                              }
                            }
                            return prev;
                          });
                        };
                        attachAudioLink();
                      } else {
                        console.log(`⚠️ No audioLink found in result object. Result keys:`, Object.keys(result));
                      }
                    }

                    return result;
                  } catch (error: any) {
                    console.error(`❌ MCP tool execution failed:`, error);
                    setIsToolExecuting(false); // Hide indicator on error
                    return { error: error.message || 'MCP tool execution failed' };
                  }
                } else {
                  // Browser tool requested but browser tools not enabled
                  console.warn(`⚠️  Browser tool "${toolName}" requested but browser tools are not enabled`);
                  return { error: 'Browser tools not enabled. Please enable browser tools in settings to use navigation, clicking, and screenshot features.' };
                }
              },
              undefined, // Don't pass abort signal for now - causes issues
              mcpTools,  // Pass MCP tools
              currentTabUrl || undefined,
              matchedInstructions || undefined,
              settings, // Pass settings for conversation history and summarization
              (toolName: string, isMcpTool: boolean) => {
                // Show typing indicator when MCP tool starts executing
                if (isMcpTool) {
                  setIsToolExecuting(true);
                }
              }
            );
        } else if (settings.provider === 'google') {
          await streamGoogle(newMessages, abortControllerRef.current.signal);
        } else {
          throw new Error(`Provider ${settings.provider} not yet implemented`);
        }
      }

      // Hide browser automation overlay on completion
      await hideBrowserAutomationOverlay();
      setIsLoading(false);
    } catch (error: any) {
      console.error('❌ Chat error occurred:');
      console.error('Error type:', typeof error);
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Full error object:', error);

      if (error.name !== 'AbortError') {
        // Show detailed error message to user
        const errorDetails = error?.stack || JSON.stringify(error, null, 2);
        setMessages(prev => {
          const updated = prev.filter(m => m.content !== '');
          return [
            ...updated,
            {
              id: Date.now().toString(),
              role: 'assistant',
              content: `Error: ${error.message}\n\nDetails:\n\`\`\`\n${errorDetails}\n\`\`\``,
            },
          ];
        });
      }
      // Hide browser automation overlay on error
      await hideBrowserAutomationOverlay();
      setIsLoading(false);
      setIsToolExecuting(false); // Clear tool executing state on error
    }
  };

  // Check if user is scrolled to bottom
  const isAtBottom = () => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    const threshold = 200; // pixels from bottom - increased for more aggressive auto-scroll
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  };

  // Handle scroll detection
  const handleScroll = () => {
    setIsUserScrolled(!isAtBottom());
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    // Always auto-scroll during loading (includes browser automation)
    // Also scroll if user is near bottom (within threshold)
    if (isLoading || !isUserScrolled) {
      // Use instant scroll during loading for better UX
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages, isUserScrolled, isLoading]);

  // Attach scroll listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);

  // Check for trusted agent when settings change (but only if currentTabUrl is set)
  useEffect(() => {
    if (settings && currentTabUrl) {
      console.log('🔄 Settings loaded, checking for trusted agent...');
      checkForTrustedAgent();
    }
  }, [settings, currentTabUrl]);

  // Cleanup MCP connections on unmount
  useEffect(() => {
    return () => {
      resetMCPService();
    };
  }, []);

  if (showSettings && !settings) {
    return (
      <div className="chat-container">
        <div className="welcome-message" style={{ padding: '40px 20px' }}>
          <h2>Welcome to GoDaddy ANS</h2>
          <p style={{ marginBottom: '20px' }}>Please configure your AI provider to get started.</p>
          <button
            onClick={openSettings}
            className="settings-icon-btn"
            style={{ width: 'auto', padding: '12px 24px' }}
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container dark-mode">
      <div className="chat-header">
        <div style={{ flex: 1 }}>
          <h1>GoDaddy ANS</h1>
          <p>
            {(settings?.provider
              ? settings.provider.charAt(0).toUpperCase() + settings.provider.slice(1)
              : 'Unknown')} · {browserToolsEnabled
                ? (settings?.provider === 'google'
                  ? getModelDisplayName('gemini-2.5-computer-use-preview-10-2025')
                  : (settings?.model === 'custom' && settings?.customModelName
                    ? settings.customModelName
                    : getModelDisplayName(settings?.model)) + ' (Browser Tools)')
                : (settings?.model === 'custom' && settings?.customModelName
                  ? settings.customModelName
                  : getModelDisplayName(settings?.model))}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={toggleBrowserTools}
            className={`settings-icon-btn ${browserToolsEnabled ? 'active' : ''}`}
            title={browserToolsEnabled ? 'Disable Browser Tools' : 'Enable Browser Tools'}
            disabled={isLoading}
          >
            {browserToolsEnabled ? '◉' : '○'}
          </button>
          <button
            onClick={newChat}
            className="settings-icon-btn"
            title="New Chat"
            disabled={isLoading}
          >
            +
          </button>
          <button
            onClick={openSettings}
            className="settings-icon-btn"
            title="Settings"
          >
            ⋯
          </button>
        </div>
      </div>

      {showBrowserToolsWarning && (
        <div style={{
          padding: '12px 16px',
          background: '#fef3c7',
          borderBottom: '1px solid #fbbf24',
          fontSize: '13px',
          color: '#92400e',
        }}>
          <strong>Browser Tools Enabled!</strong> Now using {getModelDisplayName('gemini-2.5-computer-use-preview-10-2025')} (overrides your selected model).
          {!settings?.apiKey && (
            <span> Please <a href="#" onClick={(e) => { e.preventDefault(); openSettings(); }} style={{ color: '#2563eb', textDecoration: 'underline' }}>set your Google API key</a> in settings.</span>
          )}
        </div>
      )}

      {/* Trusted Services Badge - Show based on mappings */}
      {(() => {
        // Only check mappings when both currentTabUrl and settings are ready
        if (!currentTabUrl || !settings) {
          console.log('🔍 Badge: Waiting for currentTabUrl or settings', { currentTabUrl, hasSettings: !!settings });
          return null; // Don't show badge until both are loaded
        }

        // Skip chrome:// and chrome-extension:// URLs (not regular websites)
        if (currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
          console.log('🔍 Badge: Skipping chrome:// or chrome-extension:// URL');
          return null;
        }

        // Ensure serviceMappings exists and is an array
        const serviceMappings = settings.serviceMappings || [];
        
        console.log('🔍 Badge: Checking mappings', {
          currentTabUrl,
          mappingsCount: serviceMappings.length,
          mappings: serviceMappings.map((m: ServiceMapping) => ({
            urlPattern: m.urlPattern,
            serviceType: m.serviceType,
            serviceName: m.serviceName,
            enabled: m.enabled
          }))
        });

        // Get mapped services for current site
        const mappedServices = findMatchingMappings(currentTabUrl, serviceMappings);
        
        console.log('🔍 Badge: Mapping results', {
          currentTabUrl,
          mappedServices,
          hasMCPs: mappedServices.mcpServerIds.length > 0,
          hasA2A: !!mappedServices.a2aMapping,
          mcpServerIds: mappedServices.mcpServerIds
        });

        const hasMappedMCPs = mappedServices.mcpServerIds.length > 0;
        const hasMappedA2A = mappedServices.a2aMapping !== null;
        const hasServices = hasMappedMCPs || hasMappedA2A;

        const serviceText = (() => {
          if (hasMappedA2A && hasMappedMCPs) {
            return `Trusted services: ${mappedServices.a2aMapping!.serviceName} + ${mappedServices.mcpServerIds.length} ANS certified server(s)`;
          } else if (hasMappedA2A) {
            return `Trusted agent: ${mappedServices.a2aMapping!.serviceName}`;
          } else if (hasMappedMCPs) {
            return `ANS certified: ${mappedServices.mcpServerIds.length} mapped`;
          } else {
            return 'No trusted services for this site';
          }
        })();

        return (
          <div style={{
            padding: '8px 16px',
            background: hasServices ? '#dcfce7' : '#f3f4f6',
            borderBottom: hasServices ? '1px solid #86efac' : '1px solid #d1d5db',
            fontSize: '13px',
            color: hasServices ? '#166534' : '#6b7280',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>{hasServices ? '✓' : '○'}</span>
              <span>{serviceText}</span>
            </div>
            {hasMappedA2A && (
              <button
                onClick={() => {
                  console.log('Opt In button clicked. Current state:', trustedAgentOptIn);
                  const newState = !trustedAgentOptIn;
                  console.log('Setting new state:', newState);
                  setTrustedAgentOptIn(newState);
                }}
                style={{
                  padding: '4px 12px',
                  fontSize: '12px',
                  background: trustedAgentOptIn ? '#16a34a' : '#9ca3af',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
                title={trustedAgentOptIn ? 'Click to opt out and use Claude/Gemini instead' : 'Click to opt in and use trusted agent'}
              >
                {trustedAgentOptIn ? 'Opted In' : 'Opt In'}
              </button>
            )}
          </div>
        );
      })()}

      {/* Available Tools Panel - Show mapped services for current site */}
      {(() => {
        // Get mapped services for current site (from mappings, not live connections)
        const mappedServices = currentTabUrl
          ? findMatchingMappings(currentTabUrl, settings?.serviceMappings)
          : { a2aMapping: null, mcpServerIds: [] };

        const hasMappedMCPs = mappedServices.mcpServerIds.length > 0;
        const hasMappedA2A = mappedServices.a2aMapping !== null;
        const hasBrowserTools = browserToolsEnabled;

        console.log('📊 Available Tools Panel - Mapped services:', {
          mcpServerIds: mappedServices.mcpServerIds,
          a2aMapping: mappedServices.a2aMapping,
          hasBrowserTools,
          willShow: hasMappedMCPs || hasMappedA2A || hasBrowserTools
        });

        // Hide entire panel if no services mapped
        if (!hasMappedMCPs && !hasMappedA2A && !hasBrowserTools) {
          return null;
        }

        return (
          <div style={{
            borderBottom: '1px solid #d1d5db',
            background: '#fafafa',
          }}>
            <button
              onClick={() => setShowToolsPanel(!showToolsPanel)}
              style={{
                width: '100%',
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontSize: '13px',
                color: '#4b5563',
                fontWeight: '500',
              }}
            >
              <span>🔧 Available Tools</span>
              <span style={{ fontSize: '10px' }}>{showToolsPanel ? '▼' : '▶'}</span>
            </button>

            {showToolsPanel && (
              <div
                style={{
                  padding: '12px 16px',
                  fontSize: '12px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}>
                {(() => {
                  // Get mapped MCP servers from mappings (not live connections)
                  const mappedMcpServers = mappedServices.mcpServerIds
                    .map(serverId => {
                      // Find service details from settings or mappings
                      const server = settings?.mcpServers?.find((s: any) => s.id === serverId);
                      if (server) {
                        return { id: server.id, name: server.name, url: server.url };
                      }
                      // Fallback: find from mapping
                      const mapping = settings?.serviceMappings?.find((m: ServiceMapping) => m.serviceId === serverId);
                      if (mapping) {
                        return { id: serverId, name: mapping.serviceName, url: mapping.serviceUrl };
                      }
                      return null;
                    })
                    .filter((s): s is { id: string; name: string; url: string } => s !== null);

                  console.log('🔧 Available Tools Panel - Mapped MCP servers:', mappedMcpServers);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Browser Tools */}
                  {hasBrowserTools && (
                    <div>
                      <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '6px' }}>
                        🌐 Browser Tools ({browserToolsEnabled ? 'Enabled' : 'Disabled'})
                      </div>
                      <div style={{ paddingLeft: '12px', color: '#6b7280', fontSize: '11px' }}>
                        navigate, click, type, scroll, screenshot, getPageContext, pressKey
                      </div>
                    </div>
                  )}

                  {/* MCP Servers - Show mapped servers */}
                  {mappedMcpServers.length > 0 && (
                    <div>
                      <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '6px' }}>
                        🔌 MCP Servers ({mappedMcpServers.length})
                      </div>
                      {mappedMcpServers.map((server) => (
                        <div key={server.id} style={{ marginBottom: '8px' }}>
                          <div style={{ paddingLeft: '12px', fontSize: '11px', fontWeight: '500', color: '#2563eb' }}>
                            {server.name}
                          </div>
                          <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#6b7280' }}>
                            {server.url}
                          </div>
                          <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', marginTop: '2px' }}>
                            Mapped to this site
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* A2A Agents - Show mapped agent */}
                  {mappedServices.a2aMapping && (
                    <div>
                      <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '6px' }}>
                        🤖 A2A Agents (1)
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ paddingLeft: '12px', fontSize: '11px', fontWeight: '500', color: '#16a34a' }}>
                          {mappedServices.a2aMapping.serviceName}
                        </div>
                        <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#6b7280' }}>
                          {mappedServices.a2aMapping.serviceUrl}
                        </div>
                        <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', marginTop: '2px' }}>
                          Mapped to this site
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
          </div>
        );
      })()}

      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h2>How can I help you today?</h2>
            <p>I'm GoDaddy ANS, your AI assistant. I can help you browse the web, analyze content, and perform various tasks.</p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isLastAssistantMessage = message.role === 'assistant' && 
              index === messages.length - 1;
            return (
            <div
              key={`${message.id}-${message.audioLink || ''}`}
              className={`message ${message.role}`}
            >
              <div className="message-content">
                {message.content ? (
                  message.role === 'assistant' ? (
                    <>
                      <MessageParser content={message.content} />
                      {/* Show typing indicator while tools are executing (only on last assistant message, and not if audio player is shown) */}
                      {isToolExecuting && isLastAssistantMessage && !message.audioLink && (
                        <div className="typing-indicator" style={{ marginTop: '8px' }}>
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      )}
                      {/* Audio player for generated music/audio */}
                      {(() => {
                        const audioLink = message.audioLink;
                        if (audioLink && typeof audioLink === 'string' && audioLink.trim().length > 0) {
                          console.log(`🔍 Rendering audio player for message ${message.id}:`, audioLink);
                          return (
                            <div style={{
                              marginTop: '16px',
                              padding: '16px',
                              background: '#f5f5f5',
                              borderRadius: '12px',
                              border: '1px solid #e0e0e0'
                            }}>
                              <audio
                                controls
                                style={{
                                  width: '100%',
                                  height: '50px',
                                  outline: 'none'
                                }}
                                src={audioLink}
                                onError={(e) => {
                                  console.error('❌ Audio playback error:', e);
                                  console.error('   Audio source:', audioLink);
                                }}
                                onLoadedData={() => {
                                  console.log('✅ Audio loaded successfully:', audioLink);
                                }}
                              >
                                Your browser does not support the audio element.
                              </audio>
                            </div>
                          );
                        } else if (audioLink) {
                          console.warn(`⚠️ Invalid audioLink format for message ${message.id}:`, typeof audioLink, audioLink);
                        }
                        return null;
                      })()}
                    </>
                  ) : (
                    <UserMessageParser content={message.content} />
                  )
                ) : (
                  (isLoading || isToolExecuting) && message.role === 'assistant' && (
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  )
                )}
              </div>
            </div>
            );
          })
        )}
        {/* Loading indicator for tool execution */}
        {isLoading && (
          <div style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        {/* Scroll anchor - must be inside messages-container */}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={!settings ? "Loading settings..." : "Message GoDaddy ANS..."}
          disabled={isLoading || !settings}
          className="chat-input"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={stop}
            className="send-button stop-button"
          >
            ⬛
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || !settings}
            className="send-button"
          >
            ⏎
          </button>
        )}
      </form>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<ChatSidebar />);
