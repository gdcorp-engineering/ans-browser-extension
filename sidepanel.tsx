import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Settings, MCPClient, Message, ChatHistory } from './types';
import { GeminiResponseSchema } from './types';
import { experimental_createMCPClient, stepCountIs } from 'ai';
import { streamAnthropic } from './anthropic-service';
import { streamAnthropicWithBrowserTools } from './anthropic-browser-tools';
import { streamOpenAI } from './openai-service';
import { getMCPService, resetMCPService } from './mcp-service';
import { getA2AService, resetA2AService } from './a2a-service';
import { getToolDescription, mergeToolDefinitions } from './mcp-tool-router';
import { findAgentForCurrentSite, agentNameToDomain } from './site-detector';

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

// Provider models configuration
const PROVIDER_MODELS = {
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '1M token context' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Optimized for speed' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Latest and most capable' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation' },
  ],
};

// Onboarding Step 3 message template with instructions for getting GoCode Key
// This template should be used when generating the Step 3 onboarding message
const ONBOARDING_STEP_3_MESSAGE = `Step 3: GoCode Key

Please provide your GoCode Key. This is your API key for the GoCode service.

**How to get your GoCode Key:**
Get your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))

Paste your GoCode Key here:`;

// Chat History Storage Configuration
const CHAT_HISTORY_KEY = 'atlasChatHistory';
const MAX_CHATS = 20;

// Generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate chat title from first user message
function generateChatTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (firstUserMessage) {
    const preview = firstUserMessage.content.slice(0, 50).trim();
    return preview || 'New Chat';
  }
  return 'New Chat';
}

// Load chat history from storage
async function loadChatHistory(): Promise<ChatHistory[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CHAT_HISTORY_KEY], (result) => {
      const chats = result[CHAT_HISTORY_KEY] || [];
      resolve(Array.isArray(chats) ? chats : []);
    });
  });
}

// Save chat history to storage with LRU cleanup
async function saveChatHistory(chat: ChatHistory): Promise<void> {
  const chats = await loadChatHistory();
  
  // Remove existing chat with same ID if it exists (update case)
  const filteredChats = chats.filter(c => c.id !== chat.id);
  
  // Add new/updated chat at the beginning (most recent first)
  filteredChats.unshift(chat);
  
  // LRU cleanup: remove oldest chats if over limit
  if (filteredChats.length > MAX_CHATS) {
    // Sort by updatedAt to ensure we keep most recently updated
    filteredChats.sort((a, b) => b.updatedAt - a.updatedAt);
    // Keep only the most recent MAX_CHATS
    const trimmedChats = filteredChats.slice(0, MAX_CHATS);
    
    chrome.storage.local.set({ [CHAT_HISTORY_KEY]: trimmedChats }, () => {
      console.log(`💾 Saved chat history (trimmed to ${MAX_CHATS} chats)`);
    });
  } else {
    chrome.storage.local.set({ [CHAT_HISTORY_KEY]: filteredChats }, () => {
      console.log(`💾 Saved chat history (${filteredChats.length} chats)`);
    });
  }
}

// Delete a chat from history
async function deleteChatHistory(chatId: string): Promise<void> {
  const chats = await loadChatHistory();
  const filteredChats = chats.filter(c => c.id !== chatId);
  chrome.storage.local.set({ [CHAT_HISTORY_KEY]: filteredChats }, () => {
    console.log(`🗑️ Deleted chat ${chatId}`);
  });
}

// Save current chat to history
async function saveCurrentChat(
  messages: Message[],
  tabId: number | null,
  url?: string,
  existingChatId?: string | null
): Promise<string | null> {
  if (messages.length === 0) {
    return null;
  }

  // Use existing chat ID if provided, otherwise generate new one
  const chatId = existingChatId || generateUUID();
  const now = Date.now();
  const title = generateChatTitle(messages);
  const firstUserMessage = messages.find(m => m.role === 'user');
  const preview = firstUserMessage?.content.slice(0, 100) || 'New Chat';

  // If updating existing chat, preserve original createdAt
  let createdAt = now;
  if (existingChatId) {
    const existingChats = await loadChatHistory();
    const existingChat = existingChats.find(c => c.id === existingChatId);
    if (existingChat) {
      createdAt = existingChat.createdAt;
    }
  }

  const chat: ChatHistory = {
    id: chatId,
    title,
    createdAt,
    updatedAt: now,
    tabId: tabId || undefined,
    url: url || undefined,
    messageCount: messages.length,
    preview,
    messages: [...messages] // Copy messages array
  };

  await saveChatHistory(chat);
  return chatId;
}

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
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  
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

      {/* Page context - collapsible */}
      <div
        style={{
          backgroundColor: '#1a2332',
          borderLeft: '3px solid #4a7ba7',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {/* Clickable header to toggle */}
        <div
          onClick={() => setIsContextExpanded(!isContextExpanded)}
          style={{
            padding: '6px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.75em',
            color: '#88aacc',
            fontFamily: 'monospace',
            userSelect: 'none',
          }}
        >
          <span>[Current Page Context]</span>
          <span style={{ fontSize: '0.9em', marginLeft: '8px' }}>
            {isContextExpanded ? '▼' : '▶'}
          </span>
        </div>

        {/* Collapsible content */}
        {isContextExpanded && (
          <div
            style={{
              padding: '6px 8px',
              paddingTop: '0',
              fontSize: '0.75em',
              color: '#88aacc',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.3',
              maxHeight: '400px',
              overflowY: 'auto',
            }}
          >
            {pageContext.replace('[Current Page Context]', '').trim()}
          </div>
        )}
      </div>
    </div>
  );
};

// Component to parse and display assistant messages with better formatting
const MessageParser = ({ content }: { content: string }) => {
  // Helper function to clean up XML-like tool descriptions
  const cleanToolDescription = (text: string): string => {
    // Match patterns like <click_element>...</click_element> with nested tags
    // This handles both single-line and multi-line XML-like tool descriptions
    const xmlToolPattern = /<(\w+)>[\s\S]*?<description>(.*?)<\/description>[\s\S]*?<\/\1>/gi;
    
    let cleaned = text.replace(xmlToolPattern, (match, toolName, description) => {
      // Extract and clean the description
      if (description && description.trim()) {
        return description.trim();
      }
      // Fallback: try to extract selector if no description
      const selectorMatch = match.match(/<selector>(.*?)<\/selector>/i);
      if (selectorMatch && selectorMatch[1]) {
        const selector = selectorMatch[1].trim();
        // Make selector more readable
        const readableSelector = selector
          .replace(/button:has-text\(["'](.*?)["']\)/i, '$1 button')
          .replace(/:/g, ' ')
          .replace(/#/g, 'ID: ')
          .replace(/\./g, ' class: ');
        return `Clicking the ${readableSelector}`;
      }
      // Last resort: use tool name
      const friendlyName = toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `Executing ${friendlyName}`;
    });
    
    // Also handle cases without description tag
    cleaned = cleaned.replace(/<(\w+)>[\s\S]*?<selector>(.*?)<\/selector>[\s\S]*?<\/\1>/gi, (match, toolName, selector) => {
      const readableSelector = selector.trim()
        .replace(/button:has-text\(["'](.*?)["']\)/i, '$1 button')
        .replace(/:/g, ' ')
        .replace(/#/g, 'ID: ')
        .replace(/\./g, ' class: ');
      return `Clicking the ${readableSelector}`;
    });
    
    return cleaned;
  };

  // Helper function to detect if a line is a tool execution line
  const isToolExecution = (text: string) => {
    return text.startsWith('[Executing:') ||
           (text.startsWith('{') && text.endsWith('}') && text.includes(':')) ||
           (text.startsWith('{"') && text.includes('":')) ||
           /<\w+>.*?<\/\w+>/.test(text); // Also detect XML-like tool descriptions
  };

  // Clean the content first to remove XML-like tool descriptions
  const cleanedContent = cleanToolDescription(content);

  // Split by lines and group tool execution lines separately from regular text
  const lines = cleanedContent.split('\n');
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
      // Add tool execution line (clean it if it's XML-like)
      const cleanedLine = cleanToolDescription(trimmed);
      groups.push({ type: 'tool', content: cleanedLine });
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
  const [showMenu, setShowMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [onboardingState, setOnboardingState] = useState<{
    active: boolean;
    step: 'provider' | 'gocodeUrl' | 'apiKey' | 'optional' | 'complete';
    tempSettings: Partial<Settings>;
    waitingFor?: 'businessServices' | 'ans' | 'customMCP';
  } | null>(null);
  
  // Use ref to track latest onboarding state for async operations
  const onboardingStateRef = useRef(onboardingState);
  useEffect(() => {
    onboardingStateRef.current = onboardingState;
  }, [onboardingState]);
  const [trustedAgentOptIn, setTrustedAgentOptIn] = useState(true); // User opt-in for trusted agents
  const [currentSiteAgent, setCurrentSiteAgent] = useState<{ serverId: string; serverName: string } | null>(null);
  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);
  const mcpToolsRef = useRef<Record<string, unknown> | null>(null);
  const customMCPToolsRef = useRef<Record<string, unknown> | null>(null); // Custom MCP servers
  const listenerAttachedRef = useRef(false);
  const settingsHashRef = useRef('');
  const mcpInitPromiseRef = useRef<Promise<void> | null>(null);
  const customMCPInitPromiseRef = useRef<Promise<void> | null>(null); // Custom MCP init
  const composioSessionRef = useRef<{ expiresAt: number } | null>(null);
  const tabMessagesRef = useRef<Record<number, Message[]>>({});
  const currentTabIdRef = useRef<number | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [persistedChatHistory, setPersistedChatHistory] = useState<ChatHistory[]>([]);
  const currentChatIdRef = useRef<string | null>(null); // Track current chat ID for updates
  const activeStreamTabIdRef = useRef<number | null>(null); // Track which tab has an active stream
  const streamMessagesRef = useRef<Message[]>([]); // Track messages during streaming
  const streamAbortControllerRef = useRef<Record<number, AbortController>>({}); // Track abort controllers per tab

  // Helper function to notify background script about agent mode status
  const notifyAgentModeStatus = (isActive: boolean, tabId: number | null) => {
    if (tabId !== null) {
      chrome.runtime.sendMessage({
        type: isActive ? 'AGENT_MODE_START' : 'AGENT_MODE_STOP',
        tabId: tabId
      }).catch((error) => {
        // Silently fail if background script is not available
        console.debug('Could not notify agent mode status:', error);
      });
    }
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
        chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' }, (response) => {
          // Handle Chrome extension API errors
          if (chrome.runtime.lastError) {
            console.error('❌ getPageContext error:', chrome.runtime.lastError.message);
            handleResponse({ error: chrome.runtime.lastError.message, success: false });
            return;
          }
          
          // Check if response is valid
          if (!response) {
            // No response received - might be timing issue
            console.warn('⚠️ getPageContext: No response received');
            handleResponse({ error: 'No response from background script', success: false });
            return;
          }
          
          // Response received - process it
          handleResponse(response);
        });
      } else if (toolName === 'navigate') {
        chrome.runtime.sendMessage({ type: 'NAVIGATE', url: parameters.url }, handleResponse);
      } else if (toolName === 'getBrowserHistory') {
        chrome.runtime.sendMessage({ 
          type: 'GET_HISTORY',
          query: parameters.query,
          maxResults: parameters.maxResults
        }, handleResponse);
      } else if (toolName === 'pressKey') {
        chrome.runtime.sendMessage({ 
          type: 'EXECUTE_ACTION', 
          action: 'press_key',
          key: parameters.key
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
      } else if (toolName === 'waitForModal') {
        chrome.runtime.sendMessage({ 
          type: 'WAIT_FOR_MODAL',
          timeout: parameters.timeout || 5000
        }, handleResponse);
      } else if (toolName === 'closeModal') {
        chrome.runtime.sendMessage({ 
          type: 'CLOSE_MODAL'
        }, handleResponse);
      } else {
        reject(new Error(`Unknown tool: ${toolName}`));
      }
    });
  };

  const loadSettings = async (forceRefresh = false) => {
    chrome.storage.local.get(['atlasSettings'], async (result) => {
      if (result.atlasSettings) {
        setSettings(result.atlasSettings);

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

        // Initialize A2A service with settings
        if (result.atlasSettings.mcpServers && result.atlasSettings.mcpServers.length > 0) {
          console.log('🚀 Initializing A2A service...');
          try {
            const a2aService = getA2AService();
            await a2aService.connectToServers(result.atlasSettings.mcpServers);
            console.log('✅ A2A service initialized');

            // Check for trusted agent after initialization
            setTimeout(() => checkForTrustedAgent(), 500);
          } catch (error) {
            console.error('❌ Failed to initialize A2A service:', error);
          }
        }
      } else {
        setShowSettings(true);
      }
    });
  };

  // Check if current site has a trusted A2A agent
  const checkForTrustedAgent = async () => {
    const a2aService = getA2AService();
    console.log('🔍 Checking for trusted agent...');
    console.log('   A2A service has connections:', a2aService.hasConnections());

    if (a2aService.hasConnections()) {
      const connections = a2aService.getConnectionStatus();
      console.log('   Available A2A agents:', connections.map(c => c.serverName).join(', '));

      const agent = await findAgentForCurrentSite(connections);
      setCurrentSiteAgent(agent);

      if (agent) {
        console.log(`✅ Trusted agent available: "${agent.serverName}"`);
      } else {
        console.log(`ℹ️  No trusted agent for this site`);
      }
    } else {
      console.log('⚠️  A2A service has no connections');
      setCurrentSiteAgent(null);
    }
  };

  // Comprehensive page analysis based on content, structure, and semantic HTML
  const analyzePageCharacteristics = (context: any) => {
    const title = context.title || '';
    const url = (context.url || '').toLowerCase();
    const textContent = context.textContent || '';
    const lowerContent = textContent.toLowerCase();
    const links = context.links || [];
    const forms = context.forms || [];
    const interactiveElements = context.interactiveElements || [];
    const metadata = context.metadata || {};
    const images = context.images || [];
    const structure = context.structure || {};

    // Analyze content structure (semantic HTML is most reliable)
    const hasArticleTag = structure.hasArticleStructure || false;
    const hasMainTag = structure.hasMainStructure || false;
    const paragraphCount = structure.paragraphCount || 0;
    const sectionCount = structure.sectionCount || 0;
    const mainContentRatio = structure.mainContentRatio || 0;
    const hasStructuredContent = paragraphCount > 3 || sectionCount > 1;

    // Content density analysis
    const contentLength = textContent.length;
    const wordsPerParagraph = paragraphCount > 0 ? contentLength / paragraphCount : 0;
    // Dense content: either high words per paragraph OR many paragraphs with substantial content
    const isContentDense = wordsPerParagraph > 100 || (paragraphCount > 10 && contentLength > 2000);

    // Analyze interactive elements for purpose
    const buttonTexts = interactiveElements
      .filter((el: any) => el.tag === 'button')
      .map((el: any) => (el.text || el.ariaLabel || '').toLowerCase())
      .join(' ');
    
    const hasCartButtons = /\b(add to cart|add to bag|checkout|view cart|shopping cart)\b/i.test(buttonTexts);
    const hasPurchaseButtons = /\b(buy now|purchase|order now|add to cart)\b/i.test(buttonTexts);

    const characteristics = {
      // Content characteristics
      contentLength,
      hasLongContent: contentLength > 2000,
      hasMediumContent: contentLength > 500 && contentLength <= 2000,
      hasShortContent: contentLength < 500,
      
      // Structural characteristics (most reliable indicators)
      hasArticleTag,
      hasMainTag,
      hasStructuredContent,
      paragraphCount,
      sectionCount,
      mainContentRatio,
      isContentDense,
      
      // Link and media analysis
      linkCount: links.length,
      formCount: forms.length,
      imageCount: images.length,
      hasManyLinks: links.length > 10,
      hasManyImages: images.length > 5,
      
      // URL and title for detection
      url,
      title: title.toLowerCase(),
      
      // E-commerce detection (very specific patterns)
      hasCartButtons,
      hasPurchaseButtons,
      hasStrongEcommerceIndicators: hasCartButtons || hasPurchaseButtons,
      hasPriceKeywords: /\$\d+\.?\d*|\d+\.?\d*\s*(dollars?|euros?|pounds?|USD|EUR|GBP|per month|per year)\b/i.test(textContent),
      urlHasProduct: /\/product\/|\/item\/|\/shop\/|\/buy\/|\/cart\//i.test(url),
      
      // Content type patterns (less reliable, used as secondary indicators)
      hasArticleKeywords: /\b(article|story|news|report|analysis|opinion|editorial|published|byline)\b/i.test(title + ' ' + textContent),
      hasDocumentationKeywords: /\b(guide|tutorial|documentation|api|reference|docs|getting started|how to)\b/i.test(title + ' ' + textContent),
      hasSearchKeywords: /\b(search|results|query|find)\b/i.test(title + ' ' + url),
      hasSocialKeywords: /\b(profile|follow|like|share|comment|post)\b/i.test(title + ' ' + url),
      hasVideoKeywords: /\b(video|watch|play|stream|youtube|vimeo)\b/i.test(title + ' ' + url + ' ' + textContent),
      
      // URL patterns (secondary indicators)
      urlHasArticle: /\/article\/|\/post\/|\/blog\/|\/news\/|\/story\//i.test(url),
      urlHasSearch: /\/search\/|\/results\//i.test(url),
      urlHasProfile: /\/profile\/|\/user\/|\/account\//i.test(url),
      
      // Form analysis
      hasPrimaryForms: forms.some((f: any) => 
        f.action?.match(/(contact|register|signup|submit|apply)/i) ||
        f.inputs?.some((input: any) => 
          input.name?.match(/(name|email|phone|message|subject)/i)
        )
      ),
      hasSecondaryForms: forms.some((f: any) => 
        f.action?.match(/(newsletter|subscribe|search)/i) ||
        f.inputs?.length === 1 && f.inputs[0]?.type === 'search'
      ),
      
      // Interactive elements
      hasSearchBox: interactiveElements.some((el: any) => 
        el.type === 'search' || 
        el.text?.toLowerCase().includes('search') || 
        el.ariaLabel?.toLowerCase().includes('search')
      ),
      hasManyButtons: interactiveElements.filter((el: any) => 
        el.tag === 'button' || el.tag === 'a'
      ).length > 5,
      
      // Metadata
      hasDescription: !!metadata.description,
      hasKeywords: !!metadata.keywords,
      hasAuthor: !!metadata.author,
      ogType: metadata.ogType,
    };

    return characteristics;
  };

  // Determine page type based on comprehensive analysis
  // Priority: URL patterns > Article > Documentation > Video > Search > E-commerce > Generic
  const detectPageType = (characteristics: any, context?: any): string => {
    const url = characteristics.url || (context?.url || '').toLowerCase();
    const title = characteristics.title || (context?.title || '').toLowerCase();
    
    // Check URL patterns first (most reliable)
    const urlHasDocs = /\/docs\/|\/documentation\/|\/guide\/|\/tutorial\//i.test(url) ||
                      /developer\.|docs\.|documentation\./i.test(url) ||
                      /react\.dev|vuejs\.org|developer\.mozilla/i.test(url);
    const urlHasVideo = /youtube\.com|vimeo\.com|twitch\.tv/i.test(url);
    const urlHasSearch = /\/search\/|\/results\//i.test(url) || /google\.com\/search|bing\.com\/search/i.test(url);
    const urlHasArticle = /\/article\/|\/post\/|\/blog\/|\/news\/|\/story\//i.test(url);
    const urlHasBlog = /medium\.com|dev\.to|wordpress\.com/i.test(url);
    const urlIsHomepage = /^https?:\/\/(www\.)?[^\/]+\/?$/.test(url) || /^https?:\/\/(www\.)?[^\/]+\/index\.(html|php)?$/.test(url);
    const urlHasForm = /\/contact|\/signup|\/register|\/apply|\/form\//i.test(url);
    const urlHasProduct = /\/product\/|\/item\/|\/shop\/|\/buy\/|\/cart\/|\/dp\//i.test(url);
    
    // Priority order: Form (URL) > Search > Video (domain) > Documentation (URL) > Article (URL) > Blog > News > Article (structure) > E-commerce > Generic
    
    // 1. Form pages (check URL FIRST - forms are very specific)
    // If URL pattern matches, trust it even if form detection fails
    if (urlHasForm) {
      // Prefer form if primary forms detected, but also accept if it's a form URL with short content
      if (characteristics.hasPrimaryForms || 
          (characteristics.hasShortContent && !characteristics.hasLongContent)) {
        return 'form';
      }
    }
    
    // 2. Search results (URL pattern is most reliable)
    if (urlHasSearch) {
      return 'search';
    }
    
    // 3. Video sites (ONLY on video domains - avoid false positives)
    if (urlHasVideo) {
      return 'video';
    }
    
    // 4. Documentation (check URL BEFORE article tags - docs often use article tags)
    if (urlHasDocs) {
      return 'documentation';
    }
    
    // 5. Article URL patterns (blog posts, news articles)
    if (urlHasArticle) {
      return 'article';
    }
    
    // 6. Blog platforms (Medium, Dev.to) - even if content is minimal
    if (urlHasBlog) {
      return 'article';
    }
    
    // 7. News site detection - detect by domain and content structure
    const isNewsDomain = /(cnn|bbc|nytimes|washingtonpost|theguardian|reuters|npr|ap|wsj|bloomberg)\.(com|org)/i.test(url);
    if (isNewsDomain && 
        characteristics.hasStructuredContent &&
        (characteristics.hasLongContent || characteristics.paragraphCount > 5) &&
        !characteristics.hasStrongEcommerceIndicators) {
      return 'article';
    }
    
    // 8. Documentation by keywords (but NOT if it has article tags - docs use article tags)
    if (characteristics.hasDocumentationKeywords &&
        !characteristics.hasArticleTag &&
        !urlIsHomepage &&
        characteristics.hasStructuredContent && 
        characteristics.hasManyLinks && 
        (characteristics.isContentDense || characteristics.hasLongContent)) {
      return 'documentation';
    }
    
    // 9. Article detection by structure (but exclude homepages, docs URLs, and form URLs)
    if (!urlIsHomepage && !urlHasDocs && !urlHasForm &&
        characteristics.hasArticleTag &&
        (characteristics.hasLongContent || characteristics.paragraphCount > 5)) {
      return 'article';
    }
    
    // 10. Strong content structure indicators for articles (but not homepages, docs, or forms)
    // Also handle Wikipedia and educational sites
    const isWikipedia = /wikipedia\.org/i.test(url);
    const isEducational = /khanacademy|wikipedia|edu/i.test(url);
    
    if (!urlIsHomepage && !urlHasDocs && !urlHasForm &&
        characteristics.hasStructuredContent && 
        (characteristics.isContentDense || characteristics.paragraphCount > 10) && 
        !characteristics.hasStrongEcommerceIndicators &&
        (characteristics.hasLongContent || characteristics.paragraphCount > 5) &&
        (characteristics.hasArticleKeywords || !characteristics.hasDocumentationKeywords)) {
      return 'article';
    }
    
    // Wikipedia and educational sites with structured content
    if ((isWikipedia || isEducational) && 
        characteristics.hasStructuredContent &&
        (characteristics.hasLongContent || characteristics.paragraphCount > 5)) {
      if (isEducational && characteristics.hasDocumentationKeywords) {
        return 'documentation';
      }
      return 'article';
    }
    
    // 11. E-commerce product pages (URL pattern is strongest signal)
    if (urlHasProduct && 
        (characteristics.hasStrongEcommerceIndicators || characteristics.hasPriceKeywords) &&
        !characteristics.hasArticleTag) {
      return 'ecommerce';
    }
    
    // 12. E-commerce by cart buttons + price keywords (but not content pages)
    const hasEcommerceEvidence = characteristics.hasStrongEcommerceIndicators && (
      characteristics.urlHasProduct || 
      characteristics.hasPriceKeywords
    );
    const isContentPage = characteristics.hasArticleTag || 
                         (characteristics.hasStructuredContent && characteristics.isContentDense && characteristics.mainContentRatio > 0.5);
    if (hasEcommerceEvidence && !isContentPage && !urlIsHomepage) {
      return 'ecommerce';
    }
    
    // 13. Form pages by form detection (if URL pattern didn't match)
    if (characteristics.hasPrimaryForms && 
        characteristics.hasShortContent &&
        !characteristics.hasLongContent &&
        !urlIsHomepage) {
      return 'form';
    }
    
    // 14. Social / Profile pages
    if (characteristics.hasSocialKeywords || characteristics.urlHasProfile) {
      return 'social';
    }
    
    return 'generic';
  };

  // Helper function to find original capitalization of a word in text
  const findOriginalCapitalization = (word: string, textContent: string): string => {
    if (!word || !textContent) return word;
    const lowerWord = word.toLowerCase();
    
    // Try to find the word in the original text with its original capitalization
    const regex = new RegExp(`\\b${lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = textContent.match(regex);
    
    if (matches && matches.length > 0) {
      // Return the most common capitalization, or first match if all different
      const capitalizations: Record<string, number> = {};
      matches.forEach(match => {
        capitalizations[match] = (capitalizations[match] || 0) + 1;
      });
      
      // Find most common capitalization
      const mostCommon = Object.entries(capitalizations)
        .sort(([, a], [, b]) => b - a)[0]?.[0];
      
      if (mostCommon) return mostCommon;
    }
    
    // Fallback: capitalize first letter if not found
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  };

  // Helper function to format nouns/topics properly (preserve original capitalization)
  const formatNoun = (word: string, textContent: string): string => {
    if (!word) return word;
    // Try to find original capitalization in the text
    return findOriginalCapitalization(word, textContent);
  };

  // Helper function to extract main topics from text content
  const extractMainTopics = (textContent: string): string[] => {
    if (!textContent || textContent.length < 50) return [];
    
    // Extract words that appear frequently (simple approach)
    const words = textContent.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 4);
    
    const wordCount: Record<string, number> = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    // Get top words (excluding common stop words)
    const stopWords = new Set(['about', 'after', 'before', 'could', 'every', 'first', 'might', 'never', 'other', 'should', 'their', 'there', 'these', 'those', 'which', 'would']);
    const topWords = Object.entries(wordCount)
      .filter(([word]) => !stopWords.has(word))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([word]) => formatNoun(word, textContent)); // Format nouns with original capitalization

    return topWords;
  };

  // Generate sample prompts based on comprehensive page analysis
  const generateSamplePrompts = async () => {
    try {
      console.log('🎯 Generating sample prompts...');
      
      // Get current tab info first to check URL
      let currentTab: chrome.tabs.Tab | null = null;
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tabs[0] || null;
        
        // Check if we're on a restricted URL
        if (currentTab?.url && (
          currentTab.url.startsWith('chrome://') || 
          currentTab.url.startsWith('chrome-extension://') || 
          currentTab.url.startsWith('edge://') ||
          currentTab.url.startsWith('about:')
        )) {
          console.warn('⚠️ Restricted URL, showing generic prompts');
          setSamplePrompts([
            'What is the purpose of this page?',
            'Summarize the main content',
            'Help me understand this page better'
          ]);
          return;
        }
      } catch (e) {
        console.warn('⚠️ Could not get current tab:', e);
        // Continue anyway - might still work
      }
      
      // Wait a bit for page to be ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const context: any = await executeTool('getPageContext', {});
      
      console.log('📄 Raw context received:', context);
      
      if (!context) {
        console.warn('⚠️ No page context returned');
        setSamplePrompts([
          'What is the purpose of this page?',
          'Summarize the main content',
          'Help me understand this page better'
        ]);
        return;
      }

      // Check if context has error - must check this FIRST before using context properties
      // A valid context from content script will have url, title, textContent properties
      // An error response will have error or success: false
      if (context.error || context.success === false) {
        const errorMsg = context.error || 'Unknown error';
        console.warn('⚠️ Page context error:', errorMsg);
        
        // If it's a chrome:// URL error, that's expected - show generic prompts
        if (errorMsg.includes('chrome://') || errorMsg.includes('Cannot access')) {
          setSamplePrompts([
            'What is the purpose of this page?',
            'Summarize the main content',
            'Help me understand this page better'
          ]);
          return;
        }
        
        // For other errors, retry once after a delay
        console.log('🔄 Retrying page context after delay...');
        setTimeout(async () => {
          try {
            const retryContext: any = await executeTool('getPageContext', {});
            console.log('📄 Retry context received:', retryContext);
            if (retryContext && !retryContext.error && retryContext.success !== false && retryContext.url !== undefined) {
              // Success on retry - regenerate prompts with the context
              await generateSamplePromptsWithContext(retryContext);
            } else {
              // Still failed - show generic prompts
              setSamplePrompts([
                'What is the purpose of this page?',
                'Summarize the main content',
                'Help me understand this page better'
              ]);
            }
          } catch (retryError) {
            console.error('❌ Retry failed:', retryError);
            setSamplePrompts([
              'What is the purpose of this page?',
              'Summarize the main content',
              'Help me understand this page better'
            ]);
          }
        }, 2000);
        return;
      }
      
      // Success - generate prompts with context
      // If we got here, context should be valid (no error, no success: false)
      // Even if url is empty or undefined, try to use the context
      await generateSamplePromptsWithContext(context);
    } catch (error) {
      console.error('❌ Error generating sample prompts:', error);
      setSamplePrompts([
        'What is the purpose of this page?',
        'Summarize the main content',
        'Help me understand this page better'
      ]);
    }
  };
  
  // Helper function to generate prompts once we have context
  const generateSamplePromptsWithContext = async (context: any) => {
    try {
      const prompts: string[] = [];
      const textContent = context.textContent || '';
      const mainTopics = extractMainTopics(textContent);
      
      // Comprehensive page analysis
      const characteristics = analyzePageCharacteristics(context);
      const pageType = detectPageType(characteristics, context);

      // Debug logging for page analysis
      console.log('🔍 Page analysis:', {
        pageType,
        url: context.url,
        title: context.title,
        hasArticleTag: characteristics.hasArticleTag,
        hasMainTag: characteristics.hasMainTag,
        hasStructuredContent: characteristics.hasStructuredContent,
        isContentDense: characteristics.isContentDense,
        paragraphCount: characteristics.paragraphCount,
        hasStrongEcommerceIndicators: characteristics.hasStrongEcommerceIndicators,
        urlHasProduct: characteristics.urlHasProduct,
        hasPriceKeywords: characteristics.hasPriceKeywords,
        contentLength: characteristics.contentLength,
        hasLongContent: characteristics.hasLongContent,
        hasManyLinks: characteristics.hasManyLinks,
        hasManyImages: characteristics.hasManyImages,
        hasSearchBox: characteristics.hasSearchBox,
        mainTopicsCount: mainTopics.length,
        mainTopics: mainTopics.slice(0, 3),
      });

      // Generate prompts based on page type and characteristics
      switch (pageType) {
        case 'ecommerce':
          prompts.push(`What products or services are available on this page?`);
          if (characteristics.hasManyImages) {
            prompts.push(`Show me product details and pricing information`);
          }
          prompts.push(`Help me find the best deals or offers`);
          break;

        case 'article':
          // Content-focused prompts for articles (even if they have forms)
          prompts.push(`Summarize the main points of this article`);
          prompts.push(`What are the key takeaways from this content?`);
          if (mainTopics.length > 0) {
            prompts.push(`Tell me more about ${mainTopics[0]}`);
          } else if (characteristics.hasManyLinks) {
            prompts.push(`Find related topics or links on this page`);
          } else {
            prompts.push(`What is the main topic or theme?`);
          }
          break;

        case 'documentation':
          prompts.push(`Explain the main concepts on this page`);
          prompts.push(`What are the key features or APIs documented here?`);
          if (characteristics.hasManyLinks) {
            prompts.push(`Show me related documentation or examples`);
          } else {
            prompts.push(`Help me understand how to use this`);
          }
          break;

        case 'search':
          prompts.push(`What search results are shown on this page?`);
          prompts.push(`Help me refine or improve my search`);
          prompts.push(`What are the most relevant results here?`);
          break;

        case 'social':
          prompts.push(`What information is available on this profile?`);
          prompts.push(`Show me recent activity or posts`);
          prompts.push(`What can I learn about this user or page?`);
          break;

        case 'video':
          prompts.push(`What is this video about?`);
          prompts.push(`Summarize the key points or topics`);
          prompts.push(`What information is available about this content?`);
          break;

        case 'form':
          // Only show form prompts if forms are the primary purpose
          prompts.push(`Help me fill out the form on this page`);
          prompts.push(`What information is required in this form?`);
          prompts.push(`Guide me through submitting this form`);
          break;

        default: // generic
          // Generate prompts based on content characteristics
          // Prioritize main topics even for generic pages
          if (mainTopics.length > 0) {
            const topic = mainTopics[0]; // Already formatted with original capitalization
            prompts.push(`Tell me more about ${topic}`);
            prompts.push(`What information is available about ${topic}?`);
            if (mainTopics.length > 1) {
              prompts.push(`What can you tell me about ${mainTopics[1]}?`);
            } else {
              prompts.push(`Help me understand ${topic} on this page`);
            }
          } else if (characteristics.hasLongContent) {
            prompts.push(`Summarize the main content of this page`);
            prompts.push(`What are the key points or takeaways?`);
            prompts.push(`What is the main purpose of this page?`);
          } else if (characteristics.hasManyLinks) {
            prompts.push(`What links or resources are available on this page?`);
            prompts.push(`Help me navigate to relevant sections`);
            prompts.push(`What is the main purpose of this page?`);
          } else if (characteristics.hasSearchBox) {
            prompts.push(`Help me search for something on this page`);
            prompts.push(`What can I search for here?`);
            prompts.push(`Guide me to use the search functionality`);
          } else if (characteristics.hasManyImages) {
            prompts.push(`What images or media are on this page?`);
            prompts.push(`Describe the visual content`);
            prompts.push(`What is the purpose of this page?`);
          } else if (context.title && context.title.length > 10) {
            // Use page title if available
            const pageTitle = context.title.length > 50 ? context.title.substring(0, 50) + '...' : context.title;
            prompts.push(`Tell me more about "${pageTitle}"`);
            prompts.push(`What is this page about?`);
            prompts.push(`Help me understand this page better`);
          } else {
            // Generic fallback prompts
            prompts.push(`What is the purpose of this page?`);
            prompts.push(`Summarize the main content`);
            prompts.push(`Help me understand this page better`);
          }
          break;
      }

      // Ensure we have exactly 3 prompts (pad with generic ones if needed)
      while (prompts.length < 3) {
        prompts.push(`Help me understand this page better`);
      }

      const finalPrompts = prompts.slice(0, 3);
      console.log('✅ Generated sample prompts:', finalPrompts);
      setSamplePrompts(finalPrompts);
    } catch (error) {
      console.error('❌ Error in generateSamplePromptsWithContext:', error);
      setSamplePrompts([
        'What is the purpose of this page?',
        'Summarize the main content',
        'Help me understand this page better'
      ]);
    }
  };

  // Load persisted chat history on mount
  useEffect(() => {
    const loadHistory = async () => {
      const chats = await loadChatHistory();
      setPersistedChatHistory(chats);
      console.log(`📚 Loaded ${chats.length} persisted chats`);
    };
    loadHistory();
  }, []);

  // Continuously sync messages from streamMessagesRef to UI when on active stream tab
  useEffect(() => {
    const interval = setInterval(() => {
      const activeStreamTabId = activeStreamTabIdRef.current;
      const currentTabId = currentTabIdRef.current;
      
      // If we're on the tab with an active stream, sync messages
      if (activeStreamTabId !== null && activeStreamTabId === currentTabId && streamMessagesRef.current.length > 0) {
        // Only update if messages have changed (avoid unnecessary re-renders)
        const currentMessages = messages;
        const streamMessages = streamMessagesRef.current;
        
        // Check if messages are different (compare by length and last message content)
        const lastCurrentContent = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1]?.content : '';
        const lastStreamContent = streamMessages.length > 0 ? streamMessages[streamMessages.length - 1]?.content : '';
        
        if (currentMessages.length !== streamMessages.length || lastCurrentContent !== lastStreamContent) {
          console.log('🔄 Syncing stream messages to UI:', streamMessages.length, 'messages', 'last content length:', lastStreamContent.length);
          setMessages([...streamMessages]);
          messagesRef.current = [...streamMessages];
          // Also update tabMessagesRef
          if (currentTabId !== null) {
            tabMessagesRef.current[currentTabId] = [...streamMessages];
          }
        }
      }
    }, 200); // Check every 200ms for more responsive updates
    
    return () => clearInterval(interval);
  }, [messages]); // Include messages in dependencies to ensure we compare against latest state

  // Get current tab ID and load its messages
  useEffect(() => {
    const getCurrentTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        console.log('📍 Current tab ID:', tab.id);
        setCurrentTabId(tab.id);
        currentTabIdRef.current = tab.id; // Sync ref immediately

        // Check if this tab has an active stream
        const hasActiveStream = activeStreamTabIdRef.current === tab.id;
        
        // First check in-memory storage (only if it has messages)
        let inMemoryMessages = tabMessagesRef.current[tab.id];
        
        // If there's an active stream for this tab, use the stream messages (they're more up-to-date)
        if (hasActiveStream && streamMessagesRef.current.length > 0) {
          inMemoryMessages = streamMessagesRef.current;
          console.log('🔄 Using active stream messages for tab:', tab.id, `${streamMessagesRef.current.length} messages`);
          // Also sync tabMessagesRef with stream messages
          tabMessagesRef.current[tab.id] = streamMessagesRef.current;
        }
        
        if (inMemoryMessages && inMemoryMessages.length > 0) {
          console.log('📂 Loading from in-memory storage for tab:', tab.id, `${inMemoryMessages.length} messages`);
          setMessages(inMemoryMessages);
          // If this tab has an active stream, restore loading state and overlay
          if (hasActiveStream) {
            setIsLoading(true);
            console.log('🔄 Restoring active stream for tab:', tab.id);
            // Immediately sync messages from streamMessagesRef (they're the most up-to-date)
            if (streamMessagesRef.current.length > 0) {
              setMessages([...streamMessagesRef.current]);
              messagesRef.current = [...streamMessagesRef.current];
              tabMessagesRef.current[tab.id] = [...streamMessagesRef.current];
            }
            // Show overlay for this tab since it has active stream
            await showBrowserAutomationOverlay(tab.id);
            // Notify background script that agent mode is active for this tab
            notifyAgentModeStatus(true, tab.id);
          } else {
            // Hide overlay if no active stream
            await hideBrowserAutomationOverlay(tab.id);
          }
          // Try to find the persisted chat ID for this tab
          const chats = await loadChatHistory();
          const tabChat = chats.find(c => c.tabId === tab.id);
          currentChatIdRef.current = tabChat?.id || null;
        } else {
          // Check persisted storage for this tab
          try {
            const chats = await loadChatHistory();
            console.log('🔍 Looking for chats for tab:', tab.id, `Found ${chats.length} total chats`);
            // Find the most recent chat for this tab
            const tabChats = chats.filter(c => c.tabId === tab.id);
            console.log('🔍 Tab-specific chats:', tabChats.length, tabChats.map(c => ({ id: c.id, messages: c.messageCount, updated: new Date(c.updatedAt).toLocaleString() })));
            
            if (tabChats.length > 0) {
              // Sort by updatedAt, get most recent
              const mostRecentChat = tabChats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
              console.log('📚 Loading persisted chat for tab:', tab.id, mostRecentChat.id, `${mostRecentChat.messageCount} messages`);
              setMessages(mostRecentChat.messages);
              currentChatIdRef.current = mostRecentChat.id;
              // Also update in-memory storage for quick access
              tabMessagesRef.current[tab.id] = mostRecentChat.messages;
              // Check if this tab has an active stream
              if (activeStreamTabIdRef.current === tab.id) {
                setIsLoading(true);
                console.log('🔄 Restoring active stream for tab:', tab.id);
                // Restore stream messages if available (they're more up-to-date than persisted)
                if (streamMessagesRef.current.length > 0) {
                  setMessages(streamMessagesRef.current);
                  tabMessagesRef.current[tab.id] = [...streamMessagesRef.current];
                }
                // Show overlay for this tab since it has active stream
                await showBrowserAutomationOverlay(tab.id);
                // Notify background script that agent mode is active for this tab
                notifyAgentModeStatus(true, tab.id);
              } else {
                // Hide overlay if no active stream
                await hideBrowserAutomationOverlay(tab.id);
              }
            } else {
              // No chat history for this tab, start fresh
              console.log('🆕 Starting new chat for tab:', tab.id);
              setMessages([]);
              currentChatIdRef.current = null;
              // Clear in-memory storage for this tab
              tabMessagesRef.current[tab.id] = [];
            }
          } catch (error) {
            console.error('❌ Error loading chat on mount:', error);
            setMessages([]);
            currentChatIdRef.current = null;
          }
        }

        // Check for trusted agent on this site
        checkForTrustedAgent();
        
        // Generate sample prompts for current tab (with delay to ensure page is ready)
        setTimeout(() => {
          generateSamplePrompts();
        }, 500);
      }
    };

    getCurrentTab();

    // Listen for tab switches
    const handleTabChange = async (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('📍 Tab switched to:', activeInfo.tabId);

      // Save current tab's messages before switching (use refs to get current values)
      const currentId = currentTabIdRef.current;
      if (currentId !== null && currentId !== activeInfo.tabId) {
        // Only save if we're actually switching to a different tab
        // Check if there's an active stream for this tab - use stream messages if available
        const hasActiveStream = activeStreamTabIdRef.current === currentId;
        const messagesToSave = hasActiveStream && streamMessagesRef.current.length > 0 
          ? streamMessagesRef.current 
          : messagesRef.current;
        
        if (messagesToSave.length > 0) {
          // Save to in-memory storage
          tabMessagesRef.current[currentId] = messagesToSave;
          
          // Also save to persisted storage if we have messages
          try {
            const [tab] = await chrome.tabs.get(currentId).catch(() => [null]);
            const url = tab?.url;
            console.log('💾 Saving chat for tab:', currentId, `${messagesToSave.length} messages`, 'hasActiveStream:', hasActiveStream, 'existing chatId:', currentChatIdRef.current);
            const chatId = await saveCurrentChat(messagesToSave, currentId, url, currentChatIdRef.current);
            if (chatId) {
              console.log('✅ Saved chat with ID:', chatId, 'for tab:', currentId);
              // Update the persisted chat history state
              const chats = await loadChatHistory();
              setPersistedChatHistory(chats);
            }
          } catch (error) {
            console.error('❌ Error saving chat on tab switch:', error);
          }
        } else {
          // Even if no messages, save empty array to in-memory to clear it
          tabMessagesRef.current[currentId] = [];
        }
      }

      // Load new tab's messages
      setCurrentTabId(activeInfo.tabId);
      currentTabIdRef.current = activeInfo.tabId; // Sync ref immediately
      
      // Check if this tab has an active stream
      const hasActiveStream = activeStreamTabIdRef.current === activeInfo.tabId;
      
      // Hide overlay on previous tab (if it had one but no active stream)
      if (currentId !== null && currentId !== activeInfo.tabId && activeStreamTabIdRef.current !== currentId) {
        await hideBrowserAutomationOverlay(currentId);
      }
      
      // First check in-memory storage (only if it has messages)
      let inMemoryMessages = tabMessagesRef.current[activeInfo.tabId];
      
      // If there's an active stream for this tab, use the stream messages (they're more up-to-date)
      if (hasActiveStream && streamMessagesRef.current.length > 0) {
        inMemoryMessages = streamMessagesRef.current;
        console.log('🔄 Using active stream messages for tab:', activeInfo.tabId, `${streamMessagesRef.current.length} messages`);
        // Also sync tabMessagesRef with stream messages
        tabMessagesRef.current[activeInfo.tabId] = streamMessagesRef.current;
      }
      
      if (inMemoryMessages && inMemoryMessages.length > 0) {
        console.log('📂 Loading from in-memory storage for tab:', activeInfo.tabId, `${inMemoryMessages.length} messages`);
        setMessages(inMemoryMessages);
        // If this tab has an active stream, restore loading state and overlay
        if (hasActiveStream) {
          setIsLoading(true);
          console.log('🔄 Restoring active stream for tab:', activeInfo.tabId);
          // Immediately sync messages from streamMessagesRef (they're the most up-to-date)
          if (streamMessagesRef.current.length > 0) {
            setMessages([...streamMessagesRef.current]);
            messagesRef.current = [...streamMessagesRef.current];
            tabMessagesRef.current[activeInfo.tabId] = [...streamMessagesRef.current];
          }
          // Show overlay on this tab since it has active stream
          await showBrowserAutomationOverlay(activeInfo.tabId);
          // Notify background script that agent mode is active for this tab
          notifyAgentModeStatus(true, activeInfo.tabId);
        } else {
          // Hide overlay if no active stream
          await hideBrowserAutomationOverlay(activeInfo.tabId);
        }
        // Try to find the persisted chat ID for this tab
        const chats = await loadChatHistory();
        const tabChat = chats.find(c => c.tabId === activeInfo.tabId);
        currentChatIdRef.current = tabChat?.id || null;
      } else {
        // Check persisted storage for this tab
        try {
          const chats = await loadChatHistory();
          console.log('🔍 Looking for chats for tab:', activeInfo.tabId, `Found ${chats.length} total chats`);
          // Find the most recent chat for this tab
          const tabChats = chats.filter(c => c.tabId === activeInfo.tabId);
          console.log('🔍 Tab-specific chats:', tabChats.length, tabChats.map(c => ({ id: c.id, messages: c.messageCount, updated: new Date(c.updatedAt).toLocaleString() })));
          
          if (tabChats.length > 0) {
            // Sort by updatedAt, get most recent
            const mostRecentChat = tabChats.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            console.log('📚 Loading persisted chat for tab:', activeInfo.tabId, mostRecentChat.id, `${mostRecentChat.messageCount} messages`);
            setMessages(mostRecentChat.messages);
            currentChatIdRef.current = mostRecentChat.id;
            // Also update in-memory storage for quick access
            tabMessagesRef.current[activeInfo.tabId] = mostRecentChat.messages;
            // If this tab has an active stream, restore loading state and overlay
            if (hasActiveStream) {
              setIsLoading(true);
              console.log('🔄 Restoring active stream for tab:', activeInfo.tabId);
              // Immediately sync messages from streamMessagesRef (they're the most up-to-date)
              if (streamMessagesRef.current.length > 0) {
                setMessages([...streamMessagesRef.current]);
                messagesRef.current = [...streamMessagesRef.current];
                tabMessagesRef.current[activeInfo.tabId] = [...streamMessagesRef.current];
              }
              // Show overlay on this tab since it has active stream
              await showBrowserAutomationOverlay(activeInfo.tabId);
              // Notify background script that agent mode is active for this tab
              notifyAgentModeStatus(true, activeInfo.tabId);
            } else {
              // Hide overlay if no active stream
              await hideBrowserAutomationOverlay(activeInfo.tabId);
            }
          } else {
            // No chat history for this tab, start fresh
            console.log('🆕 Starting new chat for tab:', activeInfo.tabId);
            setMessages([]);
            messagesRef.current = [];
            currentChatIdRef.current = null;
            // Clear in-memory storage for this tab
            tabMessagesRef.current[activeInfo.tabId] = [];
            setIsLoading(false);
            // Hide overlay for new tab
            await hideBrowserAutomationOverlay(activeInfo.tabId);
          }
        } catch (error) {
          console.error('❌ Error loading chat on tab switch:', error);
          setMessages([]);
          currentChatIdRef.current = null;
        }
      }

      // Check for trusted agent on new tab
      checkForTrustedAgent();
      
      // Generate sample prompts for new tab (with delay to ensure page is ready)
      setTimeout(() => {
        generateSamplePrompts();
      }, 500);
    };

    chrome.tabs.onActivated.addListener(handleTabChange);

    // Listen for URL changes and page refreshes within the current tab
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Only react to changes on the current tab
      if (tabId === currentTabIdRef.current) {
        // Handle URL changes (navigation)
        if (changeInfo.url) {
          console.log('📍 Tab URL changed to:', changeInfo.url);
          // Check for trusted agent on the new URL
          checkForTrustedAgent();
          // Regenerate sample prompts for new URL
          generateSamplePrompts();
        }
        // Handle page refresh/load completion
        // status === 'complete' means the page has finished loading
        if (changeInfo.status === 'complete' && tab.url) {
          console.log('📍 Page finished loading:', tab.url);
          // Delay to ensure DOM is fully ready and content script is loaded
          setTimeout(() => {
            // Regenerate prompts when page loads/refreshes (UI will show/hide based on messages)
            if (tabId === currentTabIdRef.current) {
              generateSamplePrompts();
            }
          }, 800);
        }
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);

    // Listen for sidepanel visibility changes (when user opens/closes sidepanel)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Sidepanel became visible - regenerate prompts in case page changed
        console.log('📍 Sidepanel became visible, regenerating prompts');
        setTimeout(() => {
          generateSamplePrompts();
        }, 600);
        // Notify background script and content script that sidebar opened
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            // Update background script state
            chrome.runtime.sendMessage({ type: 'SIDEBAR_OPENED', tabId: tabs[0].id }).catch(() => {});
            // Notify content script
            chrome.tabs.sendMessage(tabs[0].id, { type: 'SIDEBAR_OPENED' }).catch(() => {
              // Content script might not be ready, ignore error
            });
          }
        });
      } else {
        // Sidepanel became hidden - save current chat before closing
        (async () => {
          // Check if there's an active stream - use stream messages if available
          const hasActiveStream = activeStreamTabIdRef.current === currentTabIdRef.current;
          const messagesToSave = hasActiveStream && streamMessagesRef.current.length > 0 
            ? streamMessagesRef.current 
            : messagesRef.current;
          
          if (messagesToSave.length > 0) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const url = tab?.url;
            console.log('💾 Saving chat before sidepanel close:', currentTabIdRef.current, `${messagesToSave.length} messages`, 'hasActiveStream:', hasActiveStream);
            const chatId = await saveCurrentChat(messagesToSave, currentTabIdRef.current, url, currentChatIdRef.current);
            if (chatId) {
              currentChatIdRef.current = chatId;
              // Reload chat history to include the updated chat
              const chats = await loadChatHistory();
              setPersistedChatHistory(chats);
            }
          }
        })();
        
        // Notify background script and content script
        console.log('📍 Sidepanel became hidden, showing floating button');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            // Update background script state
            chrome.runtime.sendMessage({ type: 'SIDEBAR_CLOSED', tabId: tabs[0].id }).catch(() => {});
            // Notify content script
            chrome.tabs.sendMessage(tabs[0].id, { type: 'SIDEBAR_CLOSED' }).catch(() => {
              // Content script might not be ready, ignore error
            });
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // Empty array - only run once on mount

  // Keep refs in sync with state
  useEffect(() => {
    currentTabIdRef.current = currentTabId;
  }, [currentTabId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) {
      setShowModelMenu(false);
      setShowChatMenu(false);
      return;
    }
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('#ans-menu-button') && !target.closest('#ans-menu-dropdown')) {
        setShowMenu(false);
        setShowModelMenu(false);
        setShowChatMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Save messages whenever they change
  useEffect(() => {
    if (currentTabId !== null && messages.length > 0) {
      console.log(`💾 Saving ${messages.length} messages for tab ${currentTabId}`);
      tabMessagesRef.current[currentTabId] = messages;
      
      // Debounced save to persisted storage (save after 2 seconds of no changes)
      const saveTimeout = setTimeout(async () => {
        try {
          const [tab] = await chrome.tabs.get(currentTabId).catch(() => [null]);
          const url = tab?.url;
          const chatId = await saveCurrentChat(messages, currentTabId, url, currentChatIdRef.current);
          if (chatId) {
            currentChatIdRef.current = chatId;
            // Update persisted chat history state
            const chats = await loadChatHistory();
            setPersistedChatHistory(chats);
          }
        } catch (error) {
          console.error('Error auto-saving chat:', error);
        }
      }, 2000); // Save 2 seconds after last message change
      
      return () => clearTimeout(saveTimeout);
    }
  }, [messages, currentTabId]);

  useEffect(() => {
    // Load settings on mount
    loadSettings();
    
    // Notify content script that sidebar opened
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SIDEBAR_OPENED' }).catch(() => {
          // Content script might not be ready, ignore error
        });
      }
    });

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

  const selectProvider = async (provider: Provider) => {
    if (!onboardingState || onboardingState.step !== 'provider') return;
    
    const providerName = provider === 'google' ? 'Google' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
    await processOnboardingInput(providerName);
  };

  const startOnboarding = () => {
    setOnboardingState({
      active: true,
      step: 'provider',
      tempSettings: {}
    });
    setShowSettings(false);
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: `Welcome! Let's get you set up. I'll guide you through the configuration.\n\n**Step 1: Choose your AI Provider**\n\nWhich AI provider would you like to use?\n\n• **Google** - Gemini models (recommended for browser automation)\n\n• **Anthropic** - Claude models\n\n• **OpenAI** - GPT models\n\nClick one of the options below or type "Google", "Anthropic", or "OpenAI" to continue.`
      }
    ]);
  };

  const processOnboardingInput = async (userInput: string) => {
    // Get latest state from ref to avoid stale closure issues
    const currentOnboardingState = onboardingStateRef.current;
    if (!currentOnboardingState) return;

    const input = userInput.trim().toLowerCase();
    const currentStep = currentOnboardingState.step;
    const tempSettings = { ...currentOnboardingState.tempSettings };

    if (currentStep === 'provider') {
      let provider: Provider | null = null;
      if (input.includes('google') || input === 'g') {
        provider = 'google';
      } else if (input.includes('anthropic') || input.includes('claude') || input === 'a') {
        provider = 'anthropic';
      } else if (input.includes('openai') || input.includes('gpt') || input === 'o') {
        provider = 'openai';
      }

      if (provider) {
        const defaultModel = PROVIDER_MODELS[provider][0].id;
        tempSettings.provider = provider;
        tempSettings.model = defaultModel;
        
        setOnboardingState({
          active: true,
          step: 'apiKey',
          tempSettings
        });

        const providerName = provider === 'google' ? 'Google' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI';

        setOnboardingState({
          active: true,
          step: 'gocodeUrl',
          tempSettings
        });

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Great! You've selected **${providerName}**.\n\n**Step 2: GoCode URL**\n\nPlease provide your GoCode URL. This is the endpoint for your GoCode service.\n\nDefault: \`https://caas-gocode-prod.caas-prod.prod.onkatana.net\`\n\nPaste your GoCode URL, or type **"Use Default"** to continue with the default:`
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `I didn't recognize that provider. Please type **"Google"**, **"Anthropic"**, or **"OpenAI"** to continue.`
        }]);
      }
    } else if (currentStep === 'gocodeUrl') {
      // Handle GoCode URL input
      let gocodeUrl = '';
      if (input.includes('use default') || input.includes('default')) {
        gocodeUrl = 'https://caas-gocode-prod.caas-prod.prod.onkatana.net';
      } else if (userInput.trim().length > 0) {
        gocodeUrl = userInput.trim();
        // Basic URL validation
        if (!gocodeUrl.startsWith('http://') && !gocodeUrl.startsWith('https://')) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Please enter a valid URL starting with http:// or https://, or type **"Use Default"** to use the default GoCode URL.`
          }]);
          return;
        }
      } else {
        // Empty input, use default
        gocodeUrl = 'https://caas-gocode-prod.caas-prod.prod.onkatana.net';
      }

      tempSettings.customBaseUrl = gocodeUrl;
      
      setOnboardingState({
        active: true,
        step: 'apiKey',
        tempSettings
      });

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'user',
        content: input.includes('use default') || input.includes('default') ? 'Use Default' : userInput
      }, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `GoCode URL saved! ✅\n\n**Step 3: GoCode Key**\n\nPlease provide your GoCode Key. This is your API key for the GoCode service.\n\nPaste your GoCode Key here:`
      }]);
    } else if (currentStep === 'apiKey') {
      if (input.length > 10) { // Basic validation - API keys are usually longer
        tempSettings.apiKey = userInput.trim();
        
        // Save required settings with GoCode URL
        const finalSettings: Settings = {
          provider: tempSettings.provider!,
          apiKey: tempSettings.apiKey,
          model: tempSettings.model!,
          customBaseUrl: tempSettings.customBaseUrl || 'https://caas-gocode-prod.caas-prod.prod.onkatana.net'
        };

        chrome.storage.local.set({ atlasSettings: finalSettings }, () => {
          setSettings(finalSettings);
          setOnboardingState({
            active: true,
            step: 'optional',
            tempSettings: finalSettings
          });

          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: '••••••••' // Hide the API key
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Perfect! Your GoCode Key has been saved. ✅\n\n**Step 4: Optional Configuration**\n\nWould you like to configure optional features now?\n\n• **Enable Business Services** - Access 115 Million verified GoDaddy customer services through AI chat (requires ANS API Token)\n\n• **Custom MCP Servers** - Add custom Model Context Protocol servers\n\nType **"Yes"** to configure these, or **"No"** to skip and start chatting.`
          }]);
        });
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `That doesn't look like a valid GoCode Key. Please paste your full GoCode Key.`
        }]);
      }
    } else if (currentStep === 'optional') {
      // Check waitingFor state first before general yes/no responses
      if (currentOnboardingState.waitingFor === 'businessServices') {
        if (input.includes('skip')) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Business Services skipped. ✅\n\n**Custom MCP Servers** (optional)\n\nAdd custom Model Context Protocol servers for additional integrations.\n\nWould you like to add a custom MCP server? Type **"Yes"** to add one, or **"Skip"** to finish:`
          }]);
          setOnboardingState({
            active: true,
            step: 'optional',
            tempSettings: { ...currentOnboardingState.tempSettings, mcpEnabled: false },
            waitingFor: 'customMCP'
          });
        } else if (input.includes('yes') || input.includes('y') || input === 'y') {
          // Enable Business Services
          const updatedTempSettings = { ...currentOnboardingState.tempSettings, mcpEnabled: true };
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Business Services enabled! ✅\n\n**ANS API Token** (required for Business Services)\n\n🔑 Required for ANS API access. Format: \`Authorization: Bearer eyJraWQiOi...\`\n\nPaste just the token part (without "Bearer"). Token typically starts with "eyJ".\n\nPaste your ANS token, or type **"Skip"** to continue without ANS token:`
          }]);
          setOnboardingState({
            active: true,
            step: 'optional',
            tempSettings: updatedTempSettings,
            waitingFor: 'ans'
          });
        } else {
          // User didn't say yes or skip, ask again
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Would you like to enable Business Services? Type **"Yes"** to enable, or **"Skip"** to continue:`
          }]);
        }
      } else if (currentOnboardingState.waitingFor === 'ans') {
        if (input.includes('skip')) {
          // Save settings with Business Services enabled but no ANS token
          const updatedSettings = { ...currentOnboardingState.tempSettings, mcpEnabled: true, ansApiToken: undefined };
          chrome.storage.local.set({ atlasSettings: updatedSettings }, () => {
            setSettings(updatedSettings as Settings);
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'user',
              content: userInput
            }, {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `ANS token skipped. Business Services enabled without ANS token. ✅\n\n**Custom MCP Servers** (optional)\n\nAdd custom Model Context Protocol servers for additional integrations.\n\nWould you like to add a custom MCP server? Type **"Yes"** to add one, or **"Skip"** to finish:`
            }]);
            setOnboardingState({
              active: true,
              step: 'optional',
              tempSettings: updatedSettings,
              waitingFor: 'customMCP'
            });
          });
        } else if (input.length > 5) {
          // Remove "Bearer " prefix if present
          let token = userInput.trim();
          if (token.startsWith('Bearer ')) {
            token = token.substring(7);
          }
          const updatedSettings = { ...currentOnboardingState.tempSettings, mcpEnabled: true, ansApiToken: token };
          chrome.storage.local.set({ atlasSettings: updatedSettings }, () => {
            setSettings(updatedSettings as Settings);
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'user',
              content: '••••••••'
            }, {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `ANS token saved! ✅\n\n**Custom MCP Servers** (optional)\n\nAdd custom Model Context Protocol servers for additional integrations.\n\nWould you like to add a custom MCP server? Type **"Yes"** to add one, or **"Skip"** to finish:`
            }]);
            setOnboardingState({
              active: true,
              step: 'optional',
              tempSettings: updatedSettings,
              waitingFor: 'customMCP'
            });
          });
        } else {
          // User didn't provide valid token or skip, ask again
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Please paste your ANS token (starts with "eyJ"), or type **"Skip"** to continue without ANS token:`
          }]);
        }
      } else if (currentOnboardingState.waitingFor === 'customMCP') {
        if (input.includes('skip') || input.includes('no') || input === 'n') {
          // Save final settings and complete onboarding
          chrome.storage.local.set({ atlasSettings: currentOnboardingState.tempSettings }, () => {
            setSettings(currentOnboardingState.tempSettings as Settings);
            setOnboardingState(null);
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'user',
              content: userInput
            }, {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `Setup complete! 🎉\n\nYou're all set to start using the extension. You can configure custom MCP servers anytime from the Settings menu (accessible from the menu ⋯ button).\n\nWhat would you like to do?`
            }]);
          });
        } else if (input.includes('yes') || input.includes('y') || input === 'y') {
          // Direct user to Settings for custom MCP server configuration
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Great! To add custom MCP servers, you'll need to use the Settings menu. Here's how:\n\n1. Click the menu button (⋯) in the top right\n2. Select "Settings"\n3. Enable "Business Services" if not already enabled\n4. Go to the "Custom" tab\n5. Add your custom MCP server details\n\nFor now, let's complete the basic setup.\n\nSetup complete! 🎉\n\nYou're all set to start using the extension. What would you like to do?`
          }]);
          // Save final settings and complete onboarding
          chrome.storage.local.set({ atlasSettings: currentOnboardingState.tempSettings }, () => {
            setSettings(currentOnboardingState.tempSettings as Settings);
            setOnboardingState(null);
          });
        } else {
          // User didn't say yes or skip, ask again
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            content: userInput
          }, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Would you like to add a custom MCP server? Type **"Yes"** to learn how, or **"Skip"** to finish setup:`
          }]);
        }
      } else if (input.includes('yes') || input.includes('y') || input === 'y') {
        // Initial yes to configure optional features
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Great! Let's set up optional features.\n\n**Enable Business Services**\n\n🌐 Access 115 Million verified GoDaddy customer services through AI chat. Book appointments, place orders, and interact with businesses naturally.\n\nWould you like to enable Business Services? Type **"Yes"** to enable, or **"Skip"** to continue:`
        }]);
        setOnboardingState({
          active: true,
          step: 'optional',
          tempSettings: { ...currentOnboardingState.tempSettings },
          waitingFor: 'businessServices'
        });
      } else if (input.includes('no') || input === 'n') {
        // Complete onboarding
        setOnboardingState(null);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Perfect! You're all set. 🎉\n\nYou can start chatting now. If you want to configure optional features later, you can access Settings from the menu (⋯) button.\n\nWhat would you like to do?`
        }]);
      }
    }
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

    // Abort the AI API call - check both the current abort controller and any active stream's controller
    const activeStreamTabId = activeStreamTabIdRef.current;
    
    // First, try to abort the active stream's controller (if different from current tab)
    if (activeStreamTabId !== null && streamAbortControllerRef.current[activeStreamTabId]) {
      console.log('🛑 Aborting active stream for tab:', activeStreamTabId);
      streamAbortControllerRef.current[activeStreamTabId].abort();
      delete streamAbortControllerRef.current[activeStreamTabId];
    }
    
    // Also abort the current abort controller (for backwards compatibility)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    setIsLoading(false);
    
    // Clear stream tracking and notify background script
    if (activeStreamTabId !== null) {
      activeStreamTabIdRef.current = null;
      // Notify background script that agent mode has stopped
      notifyAgentModeStatus(false, activeStreamTabId);
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

  // Show/hide browser automation overlay on specific tab
  const showBrowserAutomationOverlay = async (tabId?: number | null) => {
    try {
      const targetTabId = tabId || currentTabId;
      if (targetTabId !== null) {
        await chrome.tabs.sendMessage(targetTabId, { type: 'SHOW_BROWSER_AUTOMATION_OVERLAY' });
      }
    } catch (error) {
      console.warn('Failed to show browser automation overlay:', error);
    }
  };

  const hideBrowserAutomationOverlay = async (tabId?: number | null) => {
    try {
      const targetTabId = tabId || currentTabId;
      if (targetTabId !== null) {
        await chrome.tabs.sendMessage(targetTabId, { type: 'HIDE_BROWSER_AUTOMATION_OVERLAY' });
      }
    } catch (error) {
      console.warn('Failed to hide browser automation overlay:', error);
    }
  };

  const switchModel = async (modelId: string) => {
    if (!settings) return;
    const updatedSettings = { ...settings, model: modelId };
    setSettings(updatedSettings);
    chrome.storage.local.set({ atlasSettings: updatedSettings });
    setShowModelMenu(false);
    setShowMenu(false);
  };

  const switchChat = async (chatIdOrTabId: string | number) => {
    console.log('🔄 Switching chat:', chatIdOrTabId, typeof chatIdOrTabId);
    
    // Handle in-memory tab chats (IDs like "tab-123")
    if (typeof chatIdOrTabId === 'string' && chatIdOrTabId.startsWith('tab-')) {
      const tabId = parseInt(chatIdOrTabId.replace('tab-', ''));
      if (!isNaN(tabId) && tabMessagesRef.current[tabId]) {
        setMessages(tabMessagesRef.current[tabId]);
        setCurrentTabId(tabId);
        currentChatIdRef.current = null; // In-memory chat, no persisted ID
        setShowChatMenu(false);
        setShowMenu(false);
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return;
      }
    }
    
    // Try to find in persisted chat history
    if (typeof chatIdOrTabId === 'string' && !chatIdOrTabId.startsWith('tab-')) {
      // First check in state
      let chat = persistedChatHistory.find(c => c.id === chatIdOrTabId);
      
      // If not found in state, reload from storage (in case state is stale)
      if (!chat) {
        console.log('🔄 Chat not in state, reloading from storage...');
        const chats = await loadChatHistory();
        chat = chats.find(c => c.id === chatIdOrTabId);
        // Update state with latest chats
        if (chats.length !== persistedChatHistory.length) {
          setPersistedChatHistory(chats);
        }
      }
      
      if (chat) {
        console.log('✅ Found persisted chat:', chat.id, chat.messageCount, 'messages');
        setMessages(chat.messages);
        setCurrentTabId(chat.tabId || null);
        currentTabIdRef.current = chat.tabId || null;
        currentChatIdRef.current = chat.id;
        setShowChatMenu(false);
        setShowMenu(false);
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        return;
      } else {
        console.warn('⚠️ Chat not found in persisted history:', chatIdOrTabId);
      }
    }
    
    // Fallback to in-memory tab messages (when passed as number)
    if (typeof chatIdOrTabId === 'number') {
      const tabId = chatIdOrTabId;
      if (tabMessagesRef.current[tabId]) {
        console.log('✅ Found in-memory tab chat:', tabId);
        setMessages(tabMessagesRef.current[tabId]);
        setCurrentTabId(tabId);
        currentTabIdRef.current = tabId;
        currentChatIdRef.current = null; // In-memory chat, no persisted ID
        setShowChatMenu(false);
        setShowMenu(false);
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        console.warn('⚠️ Tab messages not found for tab:', tabId);
      }
    }
  };

  const getChatHistory = () => {
    const history: Array<{ id: string; tabId?: number; title: string; preview: string; messageCount: number; updatedAt: number }> = [];
    
    // Add persisted chats
    persistedChatHistory.forEach(chat => {
      history.push({
        id: chat.id,
        tabId: chat.tabId,
        title: chat.title,
        preview: chat.preview,
        messageCount: chat.messageCount,
        updatedAt: chat.updatedAt
      });
    });
    
    // Add in-memory tab chats (only if not already in persisted history)
    Object.entries(tabMessagesRef.current).forEach(([tabIdStr, msgs]) => {
      const tabId = parseInt(tabIdStr);
      if (msgs && msgs.length > 0) {
        // Check if this tab's chat is already in persisted history
        const alreadyPersisted = persistedChatHistory.some(c => c.tabId === tabId);
        if (!alreadyPersisted) {
          const firstUserMessage = msgs.find(m => m.role === 'user');
          const preview = firstUserMessage?.content?.slice(0, 50) || 'New chat';
          history.push({
            id: `tab-${tabId}`, // Temporary ID for in-memory chats
            tabId,
            title: `Chat ${tabId}`,
            preview,
            messageCount: msgs.length,
            updatedAt: Date.now()
          });
        }
      }
    });
    
    // Sort by updatedAt, most recent first
    return history.sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const newChat = async () => {
    // Save current chat before clearing (if there are messages)
    if (messages.length > 0) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url;
      const chatId = await saveCurrentChat(messages, currentTabId, url, currentChatIdRef.current);
      if (chatId) {
        currentChatIdRef.current = chatId;
        // Reload chat history to include the newly saved chat
        const chats = await loadChatHistory();
        setPersistedChatHistory(chats);
      }
    }
    
    // Clear messages for current tab
    setMessages([]);
    setInput('');
    setShowBrowserToolsWarning(false);
    currentChatIdRef.current = null;

    // Clear messages storage for current tab
    if (currentTabId !== null) {
      tabMessagesRef.current[currentTabId] = [];
    }
    
    // Force close and clear ALL cached state
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
      const streamTabId = activeStreamTabIdRef.current;

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      setMessages(prev => [...prev, assistantMessage]);
      // Update streamMessagesRef
      if (streamTabId !== null) {
        streamMessagesRef.current = [...streamMessagesRef.current, assistantMessage];
        tabMessagesRef.current[streamTabId] = [...streamMessagesRef.current];
      }

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

TASK COMPLETION REQUIREMENTS:
1. COMPLETE THE FULL TASK: Do not stop until you have:
   - Completed all requested actions
   - Verified the task is done (e.g., form submitted, item created, action confirmed)
   - OR clearly communicated why you cannot complete it

2. MODAL AWARENESS:
   - When a modal/dialog appears, you are INSIDE the modal - focus on modal elements
   - Use getPageContext to check if modals are present - modals have priority
   - Elements inside modals are marked with "inModal: true" in page context
   - Do NOT click outside the modal - stay focused on modal interactions
   - If modal closes unexpectedly, use waitForModal to wait for it to reopen

3. ERROR HANDLING:
   - If an action fails, try alternative approaches (different selector, coordinates, etc.)
   - If you cannot complete the task after multiple attempts, clearly explain:
     * What you tried
     * What prevented completion
     * What the user needs to do (if anything)
   - NEVER silently stop - always communicate the status

4. VERIFICATION:
   - After completing actions, verify success (check for confirmation messages, updated UI, etc.)
   - If verification shows the task isn't complete, continue working until it is

5. GUIDELINES:
   - NAVIGATION: Use 'navigate' function to go to websites
   - INTERACTION: Use coordinates from the screenshot you see
   - NO HALLUCINATING: Only use the functions listed above
   - PERSISTENCE: Keep trying different approaches if initial attempts fail
   - CLARITY: Always explain what you're doing and why`;

      let lastSaveTime = Date.now();
      const SAVE_INTERVAL = 3000; // Save every 3 seconds during streaming
      
      for (let turn = 0; turn < maxTurns; turn++) {
        // Check if we're approaching max turns and communicate status
        if (turn === maxTurns - 1) {
          responseText += '\n\n⚠️ Approaching maximum turns. ';
          const updated = [...streamMessagesRef.current];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = responseText;
          }
          streamMessagesRef.current = updated;
          if (streamTabId !== null) {
            tabMessagesRef.current[streamTabId] = updated;
          }
          setMessages(updated);
        }
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
          // No more actions - check if task is actually complete
          let finalText = '';
          for (const part of parts) {
            if ('text' in part && typeof part.text === 'string') {
              finalText += part.text;
            }
          }
          responseText += finalText;
          
          // If no text was provided and we're stopping, add a completion message
          if (!finalText.trim() && turn > 0) {
            responseText += '\n\n✅ Task completed. If you requested something specific, please verify it was completed correctly.';
          }
          
          // Update final message
          const updated = [...streamMessagesRef.current];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = responseText;
          }
          streamMessagesRef.current = updated;
          if (streamTabId !== null) {
            tabMessagesRef.current[streamTabId] = updated;
            // Final save when task completes
            (async () => {
              try {
                const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                const url = tab?.url;
                const chatId = await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                if (chatId) {
                  currentChatIdRef.current = chatId;
                  const chats = await loadChatHistory();
                  setPersistedChatHistory(chats);
                }
              } catch (error) {
                console.debug('Error saving on task completion:', error);
              }
            })();
          }
          setMessages(updated);
          break;
        }
        
        // If we've reached max turns, communicate this clearly
        if (turn === maxTurns - 1) {
          responseText += `\n\n⚠️ Reached maximum turns (${maxTurns}). `;
          responseText += 'If the task is not complete, please try breaking it into smaller steps or provide more specific instructions.';
          const updated = [...streamMessagesRef.current];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = responseText;
          }
          streamMessagesRef.current = updated;
          if (streamTabId !== null) {
            tabMessagesRef.current[streamTabId] = updated;
            // Final save when max turns reached
            (async () => {
              try {
                const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                const url = tab?.url;
                const chatId = await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                if (chatId) {
                  currentChatIdRef.current = chatId;
                  const chats = await loadChatHistory();
                  setPersistedChatHistory(chats);
                }
              } catch (error) {
                console.debug('Error saving on max turns:', error);
              }
            })();
          }
          setMessages(updated);
          break;
        }

        // Execute function calls
        const functionResponses: any[] = [];

        for (const part of parts) {
          if ('text' in part && typeof part.text === 'string') {
            responseText += part.text + '\n';
            // Update message with current text
            const updated = [...streamMessagesRef.current];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = responseText;
            }
            streamMessagesRef.current = updated;
            if (streamTabId !== null) {
              tabMessagesRef.current[streamTabId] = updated;
              
              // Periodically save to persisted storage during streaming
              const now = Date.now();
              if (now - lastSaveTime > SAVE_INTERVAL) {
                lastSaveTime = now;
                // Save in background without blocking
                (async () => {
                  try {
                    const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                    const url = tab?.url;
                    await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                    const chats = await loadChatHistory();
                    setPersistedChatHistory(chats);
                  } catch (error) {
                    console.debug('Error auto-saving during stream:', error);
                  }
                })();
              }
            }
            // Always update the UI messages state if we're viewing the tab with the active stream
            // Use functional update to ensure we get the latest state
            if (streamTabId !== null && streamTabId === currentTabIdRef.current) {
              setMessages(() => updated);
              messagesRef.current = updated; // Keep messagesRef in sync
            }
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
            const updated = [...streamMessagesRef.current];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = responseText;
            }
            streamMessagesRef.current = updated;
            if (streamTabId !== null) {
              tabMessagesRef.current[streamTabId] = updated;
            }
            // Always update the UI messages state if we're viewing the tab with the active stream
            // Use functional update to ensure we get the latest state
            if (streamTabId !== null && streamTabId === currentTabIdRef.current) {
              setMessages(() => updated);
              messagesRef.current = updated; // Keep messagesRef in sync
            }

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
            
            // Messages already updated above at line 2648-2658, no need to update again here
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
      
      // Final update - update streamMessagesRef first
      const finalUpdated = [...streamMessagesRef.current];
      const lastMsg = finalUpdated[finalUpdated.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = responseText || 'Task completed';
      }
      streamMessagesRef.current = finalUpdated;
      if (streamTabId !== null) {
        tabMessagesRef.current[streamTabId] = finalUpdated;
      }
      
      // Only update UI if we're on the active stream tab
      if (streamTabId !== null && streamTabId === currentTabIdRef.current) {
        setMessages(finalUpdated);
        messagesRef.current = finalUpdated;
      }
      
    } catch (error: any) {
      console.error('❌ Error with Gemini Computer Use:');
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Full error object:', error);
      
      // Clean up stream tracking on error
      if (activeStreamTabIdRef.current === streamTabId) {
        activeStreamTabIdRef.current = null;
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
      }
      
      throw error;
    } finally {
      // Clean up stream tracking when function completes (success or error)
      if (activeStreamTabIdRef.current === streamTabId) {
        activeStreamTabIdRef.current = null;
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
      }
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
        return await executeTool('type', { 
          selector: 'input:focus, textarea:focus, [contenteditable="true"]:focus', 
          text: args.text || args.input || args.content
        });
      
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
      
      case 'waitForModal':
      case 'wait_for_modal':
        return await executeTool('waitForModal', { timeout: args.timeout || 5000 });
      
      case 'closeModal':
      case 'close_modal':
      case 'dismiss_modal':
        return await executeTool('closeModal', {});
      
      case 'wait':
      case 'sleep':
      case 'delay':
        const waitTime = (args.seconds || args.milliseconds / 1000 || 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return { success: true, message: `Waited ${waitTime}ms` };
      
      case 'press_key':
      case 'key_press':
        // Handle special keys like Enter, Tab, etc.
        return await executeTool('type', { 
          selector: 'input:focus, textarea:focus, [contenteditable="true"]:focus', 
          text: args.key || args.keyCode
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
        const typeResult = await new Promise<any>((resolve) => {
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

        return typeResult;
      
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
          stopWhen: stepCountIs(50), // Increased from 20 to 50 for complex tasks
          abortSignal: abortControllerRef.current?.signal,
        });

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      setMessages(prev => [...prev, assistantMessage]);
      
      // Update refs for tab synchronization
      const streamTabId = activeStreamTabIdRef.current;
      streamMessagesRef.current = [...messages, assistantMessage];
      if (streamTabId !== null) {
        tabMessagesRef.current[streamTabId] = [...messages, assistantMessage];
      }

      // Stream the response - collect full text without duplicates
      let fullText = '';
      let lastSaveTime = Date.now();
      const SAVE_INTERVAL = 3000; // Save every 3 seconds during streaming
      
      for await (const chunk of result.textStream) {
        fullText += chunk;
        
        // Always update the stream messages ref (for the tab that started the stream)
        const updated = [...streamMessagesRef.current];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = fullText;
        }
        streamMessagesRef.current = updated;
        
        // Update that tab's in-memory storage
        if (streamTabId !== null) {
          tabMessagesRef.current[streamTabId] = updated;
          
          // Periodically save to persisted storage during streaming
          const now = Date.now();
          if (now - lastSaveTime > SAVE_INTERVAL) {
            lastSaveTime = now;
            // Save in background without blocking
            (async () => {
              try {
                const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                const url = tab?.url;
                await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                const chats = await loadChatHistory();
                setPersistedChatHistory(chats);
              } catch (error) {
                console.debug('Error auto-saving during stream:', error);
              }
            })();
          }
        }
        
        // Always update the UI messages state if we're viewing the tab with the active stream
        // This ensures messages are visible even if user switched tabs and came back
        if (streamTabId !== null && streamTabId === currentTabIdRef.current) {
          setMessages(updated);
          messagesRef.current = updated; // Keep messagesRef in sync
        }
      }
      
      // Check if we got any content - if not, show error
      const finalMessages = streamMessagesRef.current;
      const lastMessage = finalMessages[finalMessages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
        console.warn('⚠️ Stream completed with no content');
        const updated = [...finalMessages];
        updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
        streamMessagesRef.current = updated;
        if (streamTabId !== null) {
          tabMessagesRef.current[streamTabId] = updated;
          if (streamTabId === currentTabIdRef.current) {
            setMessages(updated);
            messagesRef.current = updated;
          }
        }
      }
      
      // Final save when stream completes
      if (streamTabId !== null && streamMessagesRef.current.length > 0) {
        try {
          const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
          const url = tab?.url;
          const chatId = await saveCurrentChat(streamMessagesRef.current, streamTabId, url, currentChatIdRef.current);
          if (chatId) {
            currentChatIdRef.current = chatId;
            const chats = await loadChatHistory();
            setPersistedChatHistory(chats);
          }
        } catch (error) {
          console.debug('Error saving on stream completion:', error);
        }
      }
      
      // Stream completed - clear stream tracking
      if (activeStreamTabIdRef.current === streamTabId) {
        activeStreamTabIdRef.current = null;
        // Clean up abort controller
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
      }

    } catch (error) {
      console.error('❌ Error streaming with AI SDK:', error);
      // Update the assistant message with error
      const streamTabId = activeStreamTabIdRef.current;
      const updated = [...streamMessagesRef.current];
      const lastMsg = updated[updated.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = `❌ Error: ${error instanceof Error ? error.message : String(error)}`;
      }
      streamMessagesRef.current = updated;
      if (streamTabId !== null) {
        tabMessagesRef.current[streamTabId] = updated;
        if (streamTabId === currentTabIdRef.current) {
          setMessages(updated);
          messagesRef.current = updated;
        }
      }
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
    const streamTabId = activeStreamTabIdRef.current;
    setMessages(prev => [...prev, assistantMessage]);
    streamMessagesRef.current = [...messages, assistantMessage];
    if (streamTabId !== null) {
      tabMessagesRef.current[streamTabId] = [...messages, assistantMessage];
    }
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 3000; // Save every 3 seconds during streaming

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

    // System instruction for onboarding - include instructions for Step 3
    const systemInstruction = `When guiding users through onboarding (Step 3: GoCode Key), always include these instructions:

**How to get your GoCode Key:**
Get your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))

Include this link and instruction in Step 3 when asking for the GoCode Key.`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content || '' }],
        })),
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
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
              const updated = [...streamMessagesRef.current];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = text;
              }
              streamMessagesRef.current = updated;
              if (streamTabId !== null) {
                tabMessagesRef.current[streamTabId] = updated;
                
                // Always update the UI messages state if we're viewing the tab with the active stream
                if (streamTabId === currentTabIdRef.current) {
                  setMessages(updated);
                  messagesRef.current = updated; // Keep messagesRef in sync
                }
              }
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
            const updated = [...streamMessagesRef.current];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content += text;
            }
            streamMessagesRef.current = updated;
            if (streamTabId !== null) {
              tabMessagesRef.current[streamTabId] = updated;
              
              // Periodically save to persisted storage during streaming
              const now = Date.now();
              if (now - lastSaveTime > SAVE_INTERVAL) {
                lastSaveTime = now;
                // Save in background without blocking
                (async () => {
                  try {
                    const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                    const url = tab?.url;
                    await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                    const chats = await loadChatHistory();
                    setPersistedChatHistory(chats);
                  } catch (error) {
                    console.debug('Error auto-saving during stream:', error);
                  }
                })();
              }
              
              // Always update the UI messages state if we're viewing the tab with the active stream
              if (streamTabId === currentTabIdRef.current) {
                setMessages(updated);
                messagesRef.current = updated; // Keep messagesRef in sync
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON (expected for formatted responses)
        }
      }
    }
    
    // Check if we got any content - if not, show error
    const finalMessages = streamMessagesRef.current;
    const lastMessage = finalMessages[finalMessages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
      console.warn('⚠️ Stream completed with no content');
      const updated = [...finalMessages];
      updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
      streamMessagesRef.current = updated;
      if (streamTabId !== null) {
        tabMessagesRef.current[streamTabId] = updated;
        if (streamTabId === currentTabIdRef.current) {
          setMessages(updated);
          messagesRef.current = updated;
        }
      }
    }
    
    // Final save when stream completes
    if (streamTabId !== null && streamMessagesRef.current.length > 0) {
      try {
        const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
        const url = tab?.url;
        const chatId = await saveCurrentChat(streamMessagesRef.current, streamTabId, url, currentChatIdRef.current);
        if (chatId) {
          currentChatIdRef.current = chatId;
          const chats = await loadChatHistory();
          setPersistedChatHistory(chats);
        }
      } catch (error) {
        console.debug('Error saving on stream completion:', error);
      }
    }
  };

  // Helper function to submit a message (can be called with prompt text directly)
  const submitMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading || !settings) return;

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
      content: messageText + pageContext,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput(''); // Clear input field
    setIsLoading(true);
    setIsUserScrolled(false); // Reset scroll state when user sends message
    
    // Track that this tab has an active stream
    if (currentTabId !== null) {
      activeStreamTabIdRef.current = currentTabId;
      streamMessagesRef.current = newMessages;
      // Notify background script that agent mode has started
      notifyAgentModeStatus(true, currentTabId);
    }

    // Force immediate scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 0);

    abortControllerRef.current = new AbortController();
    
    // Also store in streamAbortControllerRef if we have an active stream tab
    if (currentTabId !== null) {
      streamAbortControllerRef.current[currentTabId] = abortControllerRef.current;
    }

    try {
      // CHECK FOR A2A AGENT FOR CURRENT SITE
      // If the current site has a registered A2A agent AND user is opted in, route messages directly to it
      if (currentSiteAgent && trustedAgentOptIn) {
        console.log(`🔀 Routing message to A2A agent "${currentSiteAgent.serverName}" for current site (user opted in)`);

        // Create assistant message placeholder
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
        };
        setMessages(prev => [...prev, assistantMessage]);

        try {
          const a2aService = getA2AService();
          // Send message to A2A agent using SDK
          const response = await a2aService.sendMessage(currentSiteAgent.serverId, messageText);

          // Update assistant message with response
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = response;
            }
            return updated;
          });
        } catch (error: any) {
          console.error('A2A agent error:', error);
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = `Error communicating with A2A agent: ${error.message}`;
            }
            return updated;
          });
        }

        setIsLoading(false);
        // Clear stream tracking
        if (activeStreamTabIdRef.current === currentTabIdRef.current) {
          const streamTabId = activeStreamTabIdRef.current;
          activeStreamTabIdRef.current = null;
          // Clean up abort controller
          if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
            delete streamAbortControllerRef.current[streamTabId];
          }
          // Notify background script that agent mode has stopped
          notifyAgentModeStatus(false, streamTabId);
        }
        return; // Exit early - message handled by A2A agent
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
          
          // CRITICAL: Initialize streamMessagesRef with assistant message
          const browserToolsStreamTabId = activeStreamTabIdRef.current;
          streamMessagesRef.current = [...newMessages, assistantMessage];
          if (browserToolsStreamTabId !== null) {
            tabMessagesRef.current[browserToolsStreamTabId] = [...newMessages, assistantMessage];
          }

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          // Initialize custom MCP and A2A if not already initialized
          if (!customMCPToolsRef.current && settings.mcpServers && settings.mcpServers.length > 0) {
            console.log('🚀 Initializing custom MCP/A2A for browser tools...');
            const enabledServers = settings.mcpServers.filter(s => s.enabled);

            if (enabledServers.length > 0 && !customMCPInitPromiseRef.current) {
              customMCPInitPromiseRef.current = (async () => {
                try {
                  const { getMCPService } = await import('./mcp-service');
                  const { getA2AService } = await import('./a2a-service');
                  const mcpService = getMCPService();
                  const a2aService = getA2AService();

                  // Connect to MCP servers
                  await mcpService.connectToServers(settings.mcpServers);

                  // Connect to A2A servers
                  await a2aService.connectToServers(settings.mcpServers);

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

          // Prepare custom MCP and A2A tools if available
          let mcpTools: any[] | undefined;
          if (customMCPToolsRef.current) {
            const { formatToolsForAnthropic, formatA2AToolsForAnthropic } = await import('./mcp-tool-router');
            const { getA2AService } = await import('./a2a-service');

            // Format MCP tools
            const formattedMCPTools = formatToolsForAnthropic(customMCPToolsRef.current);

            // Format A2A tools
            const a2aService = getA2AService();
            const a2aTools = a2aService.hasConnections()
              ? formatA2AToolsForAnthropic(a2aService.getConnectionStatus())
              : [];

            // Combine MCP and A2A tools
            mcpTools = [...formattedMCPTools, ...a2aTools];

            console.log(`🔌 Adding ${formattedMCPTools.length} MCP + ${a2aTools.length} A2A tools to Anthropic (with browser tools)`);

            // Log tool names and descriptions for debugging
            const toolNames = mcpTools.map(t => t.name).join(', ');
            console.log(`📋 Available tools: ${toolNames}`);

            // Log detailed tool info
            mcpTools.forEach(tool => {
              console.log(`  🔧 ${tool.name}: ${tool.description || 'No description'}`);
            });
          }

          // Create a wrapped executeTool that handles browser, MCP, and A2A tools
          const wrappedExecuteTool = async (toolName: string, params: any) => {
            console.log(`🔧 Tool call: ${toolName}`, params);

            // Check if this is an A2A tool (starts with "a2a_")
            if (toolName.startsWith('a2a_')) {
              try {
                const { getA2AService } = await import('./a2a-service');
                const a2aService = getA2AService();

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
            if (mcpTools) {
              const isMCPTool = mcpTools.some(t => t.name === toolName);

              if (isMCPTool) {
                // Execute MCP tool
                try {
                  const { getMCPService } = await import('./mcp-service');
                  const mcpService = getMCPService();
                  const result = await mcpService.executeToolCall(toolName, params);
                  return result;
                } catch (error: any) {
                  console.error(`❌ MCP tool execution failed:`, error);
                  return { error: error.message || 'MCP tool execution failed' };
                }
              }
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

          await streamAnthropicWithBrowserTools(
            newMessages,
            settings.apiKey,
            modelToUse,
            settings.customBaseUrl,
            (text: string) => {
              const streamTabId = activeStreamTabIdRef.current;
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content += text;
                }
                // Update refs for tab synchronization
                streamMessagesRef.current = updated;
                if (streamTabId !== null) {
                  tabMessagesRef.current[streamTabId] = updated;
                }
                return updated;
              });
              // Force scroll on each chunk - use setTimeout to ensure DOM updates first
              setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
              }, 0);
            },
            () => {
              // On complete - check for empty response and hide browser automation overlay
              const streamTabId = activeStreamTabIdRef.current;
              const finalMessages = streamMessagesRef.current;
              const lastMessage = finalMessages[finalMessages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
                console.warn('⚠️ Anthropic browser tools stream completed with no content');
                const updated = [...finalMessages];
                updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
                streamMessagesRef.current = updated;
                if (streamTabId !== null) {
                  tabMessagesRef.current[streamTabId] = updated;
                  if (streamTabId === currentTabIdRef.current) {
                    setMessages(updated);
                    messagesRef.current = updated;
                  }
                }
              }
              hideBrowserAutomationOverlay();
            },
            wrappedExecuteTool,
            undefined, // Don't pass abort signal for now - causes issues
            mcpTools
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
                console.log('📋 Servers to connect:', settings.mcpServers.map(s => `${s.name} (${s.enabled ? 'enabled' : 'disabled'}, ${s.protocol || 'mcp'})`));

                const mcpService = getMCPService();
                const a2aService = getA2AService();

                await mcpService.connectToServers(settings.mcpServers);
                await a2aService.connectToServers(settings.mcpServers);

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
          
          // CRITICAL: Initialize streamMessagesRef with assistant message
          const anthropicStreamTabId = activeStreamTabIdRef.current;
          streamMessagesRef.current = [...newMessages, assistantMessage];
          if (anthropicStreamTabId !== null) {
            tabMessagesRef.current[anthropicStreamTabId] = [...newMessages, assistantMessage];
          }

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          // Check if we have custom MCP or A2A tools
          if (customMCPToolsRef.current) {
            const { formatToolsForAnthropic, formatA2AToolsForAnthropic } = await import('./mcp-tool-router');
            const { getA2AService } = await import('./a2a-service');

            // Format MCP tools
            const formattedMCPTools = formatToolsForAnthropic(customMCPToolsRef.current);

            // Format A2A tools
            const a2aService = getA2AService();
            const a2aTools = a2aService.hasConnections()
              ? formatA2AToolsForAnthropic(a2aService.getConnectionStatus())
              : [];

            // Combine tools
            const mcpTools = [...formattedMCPTools, ...a2aTools];

            console.log(`🔌 Adding ${formattedMCPTools.length} MCP + ${a2aTools.length} A2A tools to Anthropic`);

            // Log tool names and descriptions for debugging
            const toolNames = mcpTools.map(t => t.name).join(', ');
            console.log(`📋 Available tools: ${toolNames}`);

            // Log detailed tool info
            mcpTools.forEach(tool => {
              console.log(`  🔧 ${tool.name}: ${tool.description || 'No description'}`);
            });

            await streamAnthropicWithBrowserTools(
              newMessages,
              settings.apiKey,
              modelToUse,
              settings.customBaseUrl,
              (text: string) => {
                const streamTabId = activeStreamTabIdRef.current;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content += text;
                  }
                  // Update refs for tab synchronization
                  streamMessagesRef.current = updated;
                  if (streamTabId !== null) {
                    tabMessagesRef.current[streamTabId] = updated;
                  }
                  return updated;
                });
              },
              () => {
                // On complete - check for empty response
                const streamTabId = activeStreamTabIdRef.current;
                const finalMessages = streamMessagesRef.current;
                const lastMessage = finalMessages[finalMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
                  console.warn('⚠️ Anthropic stream completed with no content');
                  const updated = [...finalMessages];
                  updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
                  streamMessagesRef.current = updated;
                  if (streamTabId !== null) {
                    tabMessagesRef.current[streamTabId] = updated;
                    if (streamTabId === currentTabIdRef.current) {
                      setMessages(updated);
                      messagesRef.current = updated;
                    }
                  }
                }
              },
              async (toolName: string, params: any) => {
                console.log(`🔧 Tool call: ${toolName}`, params);

                // Check if this is an A2A tool (starts with "a2a_")
                if (toolName.startsWith('a2a_')) {
                  try {
                    const a2aService = getA2AService();

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
                const mcpService = getMCPService();
                const mcpTools = mcpService.getAggregatedTools();

                if (toolName in mcpTools) {
                  // Execute MCP tool
                  try {
                    const result = await mcpService.executeToolCall(toolName, params);
                    return result;
                  } catch (error: any) {
                    console.error(`❌ MCP tool execution failed:`, error);
                    return { error: error.message || 'MCP tool execution failed' };
                  }
                } else {
                  // Browser tool requested but browser tools not enabled
                  console.warn(`⚠️  Browser tool "${toolName}" requested but browser tools are not enabled`);
                  return { error: 'Browser tools not enabled. Please enable browser tools in settings to use navigation, clicking, and screenshot features.' };
                }
              },
              undefined, // Don't pass abort signal for now - causes issues
              mcpTools  // Pass MCP tools
            );
          } else {
            console.log('ℹ️  No custom MCP tools available');

            // Add assistant message before streaming
            const assistantMessage: Message = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '',
            };
            setMessages(prev => [...prev, assistantMessage]);
            
            // CRITICAL: Initialize streamMessagesRef with assistant message
            const streamTabId = activeStreamTabIdRef.current;
            streamMessagesRef.current = [...newMessages, assistantMessage];
            if (streamTabId !== null) {
              tabMessagesRef.current[streamTabId] = [...newMessages, assistantMessage];
            }

            await streamAnthropic(
              newMessages,
              settings.apiKey,
              modelToUse,
              settings.customBaseUrl,
              (text: string) => {
                const streamTabId = activeStreamTabIdRef.current;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    lastMsg.content += text;
                  }
                  // Update refs for tab synchronization
                  streamMessagesRef.current = updated;
                  if (streamTabId !== null) {
                    tabMessagesRef.current[streamTabId] = updated;
                  }
                  return updated;
                });
              },
              undefined // Don't pass abort signal for now - causes issues
            );
            
            // Check for empty response after Anthropic stream completes
            const checkStreamTabId = activeStreamTabIdRef.current;
            const checkFinalMessages = streamMessagesRef.current;
            const checkLastMessage = checkFinalMessages[checkFinalMessages.length - 1];
            if (checkLastMessage && checkLastMessage.role === 'assistant' && !checkLastMessage.content.trim()) {
              console.warn('⚠️ Anthropic stream completed with no content');
              const updated = [...checkFinalMessages];
              updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
              streamMessagesRef.current = updated;
              if (checkStreamTabId !== null) {
                tabMessagesRef.current[checkStreamTabId] = updated;
                if (checkStreamTabId === currentTabIdRef.current) {
                  setMessages(updated);
                  messagesRef.current = updated;
                }
              }
            }
          }
        } else if (settings.provider === 'google') {
          await streamGoogle(newMessages, abortControllerRef.current.signal);
        } else if (settings.provider === 'openai') {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
          };
          setMessages(prev => [...prev, assistantMessage]);
          
          // CRITICAL: Initialize streamMessagesRef with assistant message
          const streamTabId = activeStreamTabIdRef.current;
          streamMessagesRef.current = [...newMessages, assistantMessage];
          if (streamTabId !== null) {
            tabMessagesRef.current[streamTabId] = [...newMessages, assistantMessage];
          }

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          await streamOpenAI(
            newMessages,
            settings.apiKey,
            modelToUse,
            settings.customBaseUrl,
            (text: string) => {
              const streamTabId = activeStreamTabIdRef.current;
              const updated = [...streamMessagesRef.current];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content += text;
              }
              streamMessagesRef.current = updated;
              if (streamTabId !== null) {
                tabMessagesRef.current[streamTabId] = updated;
                
                // Periodically save to persisted storage during streaming (throttled)
                // Use a simple counter to avoid too frequent saves
                const saveCounter = (streamTabId % 10); // Save roughly every 10th chunk
                if (saveCounter === 0) {
                  // Save in background without blocking
                  (async () => {
                    try {
                      const [tab] = await chrome.tabs.get(streamTabId).catch(() => [null]);
                      const url = tab?.url;
                      await saveCurrentChat(updated, streamTabId, url, currentChatIdRef.current);
                      const chats = await loadChatHistory();
                      setPersistedChatHistory(chats);
                    } catch (error) {
                      console.debug('Error auto-saving during OpenAI stream:', error);
                    }
                  })();
                }
                
                // Always update the UI messages state if we're viewing the tab with the active stream
                if (streamTabId === currentTabIdRef.current) {
                  setMessages(updated);
                  messagesRef.current = updated; // Keep messagesRef in sync
                }
              }
            },
            abortControllerRef.current.signal
          );
          
          // Check for empty response after OpenAI stream completes
          const openAIStreamTabId = activeStreamTabIdRef.current;
          const openAIFinalMessages = streamMessagesRef.current;
          const openAILastMessage = openAIFinalMessages[openAIFinalMessages.length - 1];
          if (openAILastMessage && openAILastMessage.role === 'assistant' && !openAILastMessage.content.trim()) {
            console.warn('⚠️ OpenAI stream completed with no content');
            const updated = [...openAIFinalMessages];
            updated[updated.length - 1].content = '⚠️ No response received from the AI. Please check your API key and try again.';
            streamMessagesRef.current = updated;
            if (openAIStreamTabId !== null) {
              tabMessagesRef.current[openAIStreamTabId] = updated;
              if (openAIStreamTabId === currentTabIdRef.current) {
                setMessages(updated);
                messagesRef.current = updated;
              }
            }
          }
        } else {
          throw new Error(`Provider ${settings.provider} not yet implemented`);
        }
      }

      // Hide browser automation overlay on completion
      await hideBrowserAutomationOverlay();
      setIsLoading(false);
      // Clear stream tracking when stream completes
      if (activeStreamTabIdRef.current === currentTabIdRef.current) {
        const streamTabId = activeStreamTabIdRef.current;
        activeStreamTabIdRef.current = null;
        // Clean up abort controller
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
        // Notify background script that agent mode has stopped
        notifyAgentModeStatus(false, streamTabId);
      }
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
        const streamTabId = activeStreamTabIdRef.current;
        
        // Try to update existing assistant message, or create new one
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          
          if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || !lastMsg.content.trim())) {
            // Update existing empty assistant message
            lastMsg.content = `❌ Error: ${error.message}\n\nPlease check:\n- Your API key is correct\n- Your internet connection\n- The API service is available\n\n\`\`\`\n${errorDetails}\n\`\`\``;
          } else {
            // Add new error message
            updated.push({
              id: Date.now().toString(),
              role: 'assistant',
              content: `❌ Error: ${error.message}\n\nPlease check:\n- Your API key is correct\n- Your internet connection\n- The API service is available\n\n\`\`\`\n${errorDetails}\n\`\`\``,
            });
          }
          
          // Update refs
          streamMessagesRef.current = updated;
          messagesRef.current = updated;
          if (streamTabId !== null) {
            tabMessagesRef.current[streamTabId] = updated;
          }
          
          return updated;
        });
      }
      // Hide browser automation overlay on error
      await hideBrowserAutomationOverlay();
      setIsLoading(false);
      // Clear stream tracking when stream completes
      if (activeStreamTabIdRef.current === currentTabIdRef.current) {
        const streamTabId = activeStreamTabIdRef.current;
        activeStreamTabIdRef.current = null;
        // Clean up abort controller
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
        // Notify background script that agent mode has stopped
        notifyAgentModeStatus(false, streamTabId);
      }
    }
  };

  // Form submit handler (calls submitMessage with input value)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    // Check if we're in onboarding mode
    if (onboardingState?.active) {
      const userInput = input;
      setInput('');
      await processOnboardingInput(userInput);
      return;
    }
    
    // Normal chat flow
    if (!settings) return;
    await submitMessage(input);
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

  // Check for trusted agent when settings change
  useEffect(() => {
    if (settings) {
      checkForTrustedAgent();
    }
  }, [settings]);

  // Cleanup MCP connections on unmount
  useEffect(() => {
    return () => {
      resetMCPService();
    };
  }, []);

  if (!settings && !onboardingState?.active) {
    return (
      <div className="chat-container">
        <div className="welcome-message" style={{ padding: '40px 20px' }}>
          <h2>Welcome! Get Ready to Harness the Agentic Web</h2>
          <div style={{
            marginBottom: '24px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 177, 64, 0.1)',
            border: '1px solid rgba(0, 177, 64, 0.3)'
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: '#00B140'
            }}>Powered by</span>
            <span style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#00B140'
            }}>GoDaddy Agent Name Service</span>
          </div>
          <p style={{ marginBottom: '8px', fontSize: '16px', fontWeight: 500 }}>Let's get your new companion tailored for you.</p>
          <button
            onClick={startOnboarding}
            style={{ 
              width: 'auto', 
              padding: '12px 24px',
              marginTop: '16px',
              fontSize: '15px',
              fontWeight: 600,
              background: 'linear-gradient(90deg, #0066CC, #1BA87E, #6B46C1, #9333EA)',
              backgroundSize: '200% 100%',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              animation: 'godaddy-gradient 4s ease-in-out infinite',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            }}
          >
            Get Started
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
          {settings?.provider && settings?.model && (
            <p>
              {settings.provider.charAt(0).toUpperCase() + settings.provider.slice(1)} · {browserToolsEnabled
                ? (settings.provider === 'google'
                  ? getModelDisplayName('gemini-2.5-computer-use-preview-10-2025')
                  : (settings.model === 'custom' && settings.customModelName
                    ? settings.customModelName
                    : getModelDisplayName(settings.model)) + ' (Browser Tools)')
                : (settings.model === 'custom' && settings.customModelName
                  ? settings.customModelName
                  : getModelDisplayName(settings.model))}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', position: 'relative' }}>
          <button
            onClick={toggleBrowserTools}
            className={`settings-icon-btn ${browserToolsEnabled ? 'active' : ''}`}
            title={browserToolsEnabled ? 'Disable Browser Tools' : 'Enable Browser Tools'}
            disabled={isLoading}
          >
            {browserToolsEnabled ? '◉' : '○'}
          </button>
          <button
            id="ans-menu-button"
            onClick={() => setShowMenu(!showMenu)}
            className="settings-icon-btn"
            title="Open chat menu"
            style={{ position: 'relative' }}
          >
            ⋯
          </button>
          {showMenu && (
            <div id="ans-menu-dropdown" style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              backgroundColor: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              padding: '8px 0',
              minWidth: '220px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              zIndex: 1000
            }}>
              {/* Model Selection */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    setShowModelMenu(!showModelMenu);
                    setShowChatMenu(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>Model</span>
                  <span style={{ fontSize: '12px' }}>▶</span>
                </button>
                {showModelMenu && settings && (
                  <div style={{
                    position: 'absolute',
                    right: '100%',
                    top: 0,
                    marginRight: '4px',
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '8px 0',
                    minWidth: '200px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {PROVIDER_MODELS[settings.provider]?.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => switchModel(model.id)}
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          background: settings.model === model.id ? '#00B140' : 'transparent',
                          border: 'none',
                          color: '#ffffff',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontFamily: 'inherit'
                        }}
                        onMouseEnter={(e) => {
                          if (settings.model !== model.id) {
                            e.currentTarget.style.backgroundColor = '#2a2a2a';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (settings.model !== model.id) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <div style={{ fontWeight: settings.model === model.id ? 600 : 400 }}>
                          {model.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#d1d5db', marginTop: '2px' }}>
                          {model.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Switch Chat */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => {
                    setShowChatMenu(!showChatMenu);
                    setShowModelMenu(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    background: showChatMenu ? '#2a2a2a' : 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => {
                    if (!showChatMenu) {
                      e.currentTarget.style.backgroundColor = '#2a2a2a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!showChatMenu) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    } else {
                      e.currentTarget.style.backgroundColor = '#2a2a2a';
                    }
                  }}
                >
                  <span>Switch Chat</span>
                  <span style={{ fontSize: '12px' }}>▶</span>
                </button>
                {showChatMenu && (
                  <div style={{
                    position: 'absolute',
                    right: '100%',
                    top: 0,
                    marginRight: '4px',
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '8px 0',
                    minWidth: '250px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {getChatHistory().length > 0 ? (
                      getChatHistory().map((chat) => {
                        const isCurrentChat = currentChatIdRef.current === chat.id || 
                          (chat.tabId && currentTabId === chat.tabId && !currentChatIdRef.current);
                        const date = new Date(chat.updatedAt);
                        const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        
                        return (
                          <button
                            key={chat.id}
                            onClick={async () => {
                              console.log('🖱️ Clicked chat:', chat.id, chat.tabId);
                              await switchChat(chat.id);
                            }}
                            style={{
                              width: '100%',
                              padding: '10px 16px',
                              background: isCurrentChat ? '#00B140' : 'transparent',
                              border: 'none',
                              color: '#ffffff',
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontFamily: 'inherit'
                            }}
                            onMouseEnter={(e) => {
                              if (!isCurrentChat) {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isCurrentChat) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            <div style={{ fontWeight: isCurrentChat ? 600 : 400 }}>
                              {chat.title}
                            </div>
                            <div style={{ fontSize: '11px', color: '#d1d5db', marginTop: '2px' }}>
                              {chat.messageCount} messages · {timeStr}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div style={{
                        padding: '10px 16px',
                        color: '#d1d5db',
                        fontSize: '13px',
                        textAlign: 'center'
                      }}>
                        No chat history
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{
                height: '1px',
                backgroundColor: '#333',
                margin: '8px 0'
              }} />

              <button
                onClick={() => {
                  setShowMenu(false);
                  openSettings();
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: '#ffffff',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontFamily: 'inherit'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Settings
              </button>
            </div>
          )}
          <button
            onClick={newChat}
            className="settings-icon-btn"
            title="New Chat"
            disabled={isLoading}
            style={{ fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', lineHeight: '1' }}>edit_note</span>
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

      {/* Trusted Agent Badge */}
      {settings?.provider && settings?.model && (
        <div style={{
          padding: '8px 16px',
          background: currentSiteAgent ? '#dcfce7' : '#f3f4f6',
          borderBottom: currentSiteAgent ? '1px solid #86efac' : '1px solid #d1d5db',
          fontSize: '13px',
          color: currentSiteAgent ? '#166534' : '#6b7280',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>{currentSiteAgent ? '✓' : '○'}</span>
            <span>
              {currentSiteAgent
                ? `Trusted agent available: ${agentNameToDomain(currentSiteAgent.serverName)}`
                : 'Trusted agent not available'}
            </span>
          </div>
          {currentSiteAgent && (
            <button
              onClick={() => setTrustedAgentOptIn(!trustedAgentOptIn)}
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
              title={trustedAgentOptIn ? 'Click to use Claude/Gemini instead' : 'Click to use trusted agent'}
            >
              {trustedAgentOptIn ? 'Opted In' : 'Opt In'}
            </button>
          )}
        </div>
      )}

      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role}`}
            >
              <div className="message-content">
                {message.content || (isLoading && message.role === 'assistant') ? (
                  message.role === 'assistant' ? (
                    <>
                      {message.content ? (
                        <MessageParser content={message.content} />
                      ) : (
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      )}
                      {onboardingState?.active && onboardingState.step === 'provider' && message.id === '1' && (
                        <div style={{ 
                          marginTop: '16px', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '10px' 
                        }}>
                          <button
                            onClick={() => selectProvider('google')}
                            style={{
                              padding: '12px 16px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              color: 'inherit',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: '14px',
                              fontWeight: 500,
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Google</div>
                            <div style={{ fontSize: '12px', opacity: 0.8 }}>Gemini models (recommended for browser automation)</div>
                          </button>
                          <button
                            onClick={() => selectProvider('anthropic')}
                            style={{
                              padding: '12px 16px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              color: 'inherit',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: '14px',
                              fontWeight: 500,
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Anthropic</div>
                            <div style={{ fontSize: '12px', opacity: 0.8 }}>Claude models</div>
                          </button>
                          <button
                            onClick={() => selectProvider('openai')}
                            style={{
                              padding: '12px 16px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              borderRadius: '8px',
                              color: 'inherit',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: '14px',
                              fontWeight: 500,
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>OpenAI</div>
                            <div style={{ fontSize: '12px', opacity: 0.8 }}>GPT models</div>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <UserMessageParser content={message.content} />
                  )
                ) : (
                  isLoading && message.role === 'assistant' && (
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  )
                )}
              </div>
            </div>
          ))
        )}
        {/* Scroll anchor - must be inside messages-container */}
        <div ref={messagesEndRef} />
      </div>

      {/* Sample Prompts */}
      {samplePrompts.length > 0 && messages.length === 0 && !isLoading && (
        <div className="sample-prompts-container">
          {samplePrompts.map((prompt, index) => (
            <button
              key={index}
              type="button"
              className="sample-prompt-button"
              onClick={() => {
                submitMessage(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            onboardingState?.active 
              ? (onboardingState.step === 'provider' 
                  ? "Type Google, Anthropic, or OpenAI..." 
                  : onboardingState.step === 'gocodeUrl'
                  ? "Paste GoCode URL or type 'Use Default'..."
                  : onboardingState.step === 'apiKey'
                  ? "Paste your GoCode Key..."
                  : "Type your response...")
              : !settings 
              ? "Loading settings..." 
              : "Ask me anything"
          }
          disabled={isLoading || (!settings && !onboardingState?.active)}
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
            disabled={!input.trim() || (!settings && !onboardingState?.active)}
            className="send-button"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', lineHeight: '1' }}>send</span>
          </button>
        )}
      </form>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<ChatSidebar />);

