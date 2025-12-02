import { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Settings, MCPClient, Message, ChatHistory, Provider, SiteInstruction, ServiceMapping } from './types';
import { GeminiResponseSchema } from './types';
import { experimental_createMCPClient, stepCountIs } from 'ai';
import { streamAnthropic } from './anthropic-service';
import { streamAnthropicWithBrowserTools } from './anthropic-browser-tools';
import { streamOpenAI } from './openai-service';
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
// const ONBOARDING_STEP_3_MESSAGE = `Step 3: GoCode Key
//
// Please provide your GoCode Key. This is your API key for the GoCode service.
//
// **How to get your GoCode Key:**
// Get your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))
//
// Paste your GoCode Key here:`;

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

// Sanitize error messages to remove API keys and sensitive information
function sanitizeErrorMessage(error: any, settings?: Settings): string {
  let errorMessage = '';
  
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object') {
    errorMessage = JSON.stringify(error, null, 2);
  } else {
    errorMessage = String(error);
  }
  
  // Remove API keys from error messages
  // Pattern: sk- followed by alphanumeric characters (common API key format)
  errorMessage = errorMessage.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***REDACTED***');
  
  // Remove Bearer tokens
  errorMessage = errorMessage.replace(/Bearer\s+[a-zA-Z0-9_-]{20,}/gi, 'Bearer ***REDACTED***');
  
  // Remove JWT tokens (typically start with eyJ)
  errorMessage = errorMessage.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '***REDACTED_JWT***');
  
  // Remove any API keys from settings if they appear in the error
  if (settings) {
    if (settings.apiKey) {
      errorMessage = errorMessage.replace(new RegExp(settings.apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***API_KEY_REDACTED***');
    }
    if (settings.ansApiToken) {
      errorMessage = errorMessage.replace(new RegExp(settings.ansApiToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***ANS_TOKEN_REDACTED***');
    }
  }
  
  // Remove any long alphanumeric strings that might be keys (20+ chars)
  errorMessage = errorMessage.replace(/\b[a-zA-Z0-9_-]{30,}\b/g, (match) => {
    // Don't redact URLs or common patterns
    if (match.startsWith('http://') || match.startsWith('https://') || match.includes('://')) {
      return match;
    }
    // Don't redact if it looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match)) {
      return match;
    }
    return '***REDACTED***';
  });
  
  return errorMessage;
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
// async function deleteChatHistory(chatId: string): Promise<void> {
//   const chats = await loadChatHistory();
//   const filteredChats = chats.filter(c => c.id !== chatId);
//   chrome.storage.local.set({ [CHAT_HISTORY_KEY]: filteredChats }, () => {
//     console.log(`🗑️ Deleted chat ${chatId}`);
//   });
// }

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
  // Get settings URL once
  const settingsUrl = chrome.runtime.getURL('settings.html');
  
  const handleLinkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Normalize href - ReactMarkdown might pass it differently
    const normalizedHref = href || '';
    console.log('LinkComponent clicked, href:', normalizedHref, 'settingsUrl:', settingsUrl);
    
    // Check if it's a chrome-extension:// URL pointing to settings.html
    const isSettingsPage = normalizedHref.includes('settings.html') || 
                          normalizedHref === 'settings://open' || 
                          normalizedHref.includes('settings://open') ||
                          normalizedHref === settingsUrl;
    
    if (isSettingsPage) {
      // Get the chrome-extension:// URL and open it in a new tab
      console.log('Opening settings page:', settingsUrl);
      chrome.tabs.create({ url: settingsUrl }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error opening settings:', chrome.runtime.lastError);
        }
      });
      return;
    }
    
    // Handle regular HTTP/HTTPS links
    if (normalizedHref.startsWith('http://') || normalizedHref.startsWith('https://')) {
      chrome.tabs.create({ url: normalizedHref });
    }
  };

  // Check if this is a settings link - compare with actual settings URL
  const isSettingsLink = href?.includes('settings.html') || 
                        href === 'settings://open' || 
                        href?.includes('settings://open') ||
                        href === settingsUrl;
  
  // For settings links, ALWAYS use the actual settings URL - force it to be absolute
  const displayHref = isSettingsLink ? settingsUrl : href;
  
  console.log('LinkComponent render, href:', href, 'displayHref:', displayHref, 'isSettingsLink:', isSettingsLink);

  return (
    <a
      href={displayHref}
      onClick={handleLinkClick}
      style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
      title={isSettingsLink ? 'Open Settings' : href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
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
  // Pre-process content to replace [Settings](settings://open) with a unique marker
  const preprocessContent = (text: string): { content: string; hasSettingsButton: boolean } => {
    const settingsMarker = '🔗SETTINGS_LINK_PLACEHOLDER🔗';
    const hasSettingsButton = text.includes('[Settings](settings://open)');
    const processed = text.replace(/\[Settings\]\(settings:\/\/open\)/g, settingsMarker);
    return { content: processed, hasSettingsButton };
  };
  
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
      const friendlyName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
      return `Executing ${friendlyName}`;
    });
    
    // Also handle cases without description tag
    cleaned = cleaned.replace(/<(\w+)>[\s\S]*?<selector>(.*?)<\/selector>[\s\S]*?<\/\1>/gi, (_match, _toolName, selector) => {
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
        const { content: processedContent, hasSettingsButton } = preprocessContent(group.content);
        
        // If content has Settings button, render and replace placeholder after mount
        if (hasSettingsButton && !isTool) {
          const containerRef = useRef<HTMLDivElement>(null);
          const settingsMarker = '🔗SETTINGS_LINK_PLACEHOLDER🔗';
          
          useEffect(() => {
            if (containerRef.current) {
              // Find all text nodes containing the marker and replace with Settings link
              const walker = document.createTreeWalker(
                containerRef.current,
                NodeFilter.SHOW_TEXT,
                null
              );
              
              const nodesToReplace: { node: Text; parent: Node }[] = [];
              let node;
              while (node = walker.nextNode()) {
                if (node.textContent?.includes(settingsMarker)) {
                  nodesToReplace.push({ node: node as Text, parent: node.parentNode! });
                }
              }
              
              nodesToReplace.forEach(({ node, parent }) => {
                const parts = node.textContent!.split(settingsMarker);
                const fragment = document.createDocumentFragment();
                
                parts.forEach((part, partIdx) => {
                  if (part) {
                    fragment.appendChild(document.createTextNode(part));
                  }
                  if (partIdx < parts.length - 1) {
                    const link = document.createElement('a');
                    link.href = '#';
                    link.textContent = 'Settings';
                    link.style.cssText = 'color: #2563eb; text-decoration: underline; cursor: pointer; display: inline;';
                    link.title = 'Open Settings';
                    link.onclick = (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      chrome.runtime.openOptionsPage();
                    };
                    fragment.appendChild(link);
                  }
                });
                
                parent.replaceChild(fragment, node);
              });
            }
          }, [processedContent]);
          
          return (
            <div
              key={idx}
              ref={containerRef}
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
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]} 
                components={{ 
                  a: LinkComponent as any
                }}
              >
                {processedContent}
              </ReactMarkdown>
            </div>
          );
        }
        
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
              {processedContent}
            </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
};

// Tab favicon component with fallback
function TabFavicon({ favIconUrl, size = 16 }: { favIconUrl?: string; size?: number }) {
  const [faviconError, setFaviconError] = useState(false);
  
  if (favIconUrl && !faviconError) {
    return (
      <img 
        src={favIconUrl} 
        alt="" 
        style={{ 
          width: `${size}px`, 
          height: `${size}px`, 
          flexShrink: 0,
          objectFit: 'contain'
        }} 
        onError={() => setFaviconError(true)}
      />
    );
  }
  
  return <span style={{ fontSize: `${size}px` }}>🔷</span>;
}

// Tab chip component with favicon support
function TabChip({ tab, onRemove }: { tab: { id: string; url: string; title: string; tabId: number; favIconUrl?: string }; onRemove: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        backgroundColor: '#262626',
        borderRadius: '6px',
        fontSize: '13px',
        color: '#ffffff',
        maxWidth: '100%',
        flexShrink: 1,
        minWidth: 0
      }}
    >
      <TabFavicon favIconUrl={tab.favIconUrl} size={16} />
      <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
        {tab.title}
      </span>
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          color: '#8e8ea0'
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
      </button>
    </div>
  );
}

function ChatSidebar() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [browserToolsEnabled, setBrowserToolsEnabled] = useState(false);
  const [showBrowserToolsWarning, setShowBrowserToolsWarning] = useState(false);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentTabUrl, setCurrentTabUrl] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [onboardingState, setOnboardingState] = useState<{
    active: boolean;
    step: 'provider' | 'apiKey' | 'optional' | 'complete';
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
  const [currentSiteMcpCount, setCurrentSiteMcpCount] = useState(0); // Number of MCP servers for current site
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [showSiteInstructions, setShowSiteInstructions] = useState(false);
  const [isEditingSiteInstructions, setIsEditingSiteInstructions] = useState(false);
  const [editedSiteInstructions, setEditedSiteInstructions] = useState('');
  const [servicesUpdated, setServicesUpdated] = useState(0); // Increment to force re-render when services update
  const toolAudioLinksRef = useRef<string[]>([]); // Track audio links from tool results
  const [isToolExecuting, setIsToolExecuting] = useState(false); // Track when tools are executing
  const hasLoadedTrustedAgentOptInRef = useRef(false); // Track if we've loaded from storage
  const [samplePrompts, setSamplePrompts] = useState<string[]>([]);
  const [showAddFilesMenu, setShowAddFilesMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ id: string; name: string; file: File }>>([]);
  const [selectedTabs, setSelectedTabs] = useState<Array<{ id: string; url: string; title: string; tabId: number; favIconUrl?: string }>>([]);
  const [selectedScreenshots, setSelectedScreenshots] = useState<Array<{ id: string; dataUrl: string; timestamp: number }>>([]);
  const [previewImage, setPreviewImage] = useState<{ src: string; type: 'screenshot' | 'file' } | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [currentTabInfo, setCurrentTabInfo] = useState<{ url: string; title: string; id: number; favIconUrl?: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingOperationInProgress = useRef(false);
  const [chatMode, setChatMode] = useState<'create_image' | 'thinking' | 'deep_research' | 'study_and_learn' | 'web_search' | 'canvas' | 'browser_memory' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // const mediaRecorderRef = useRef<HTMLDivElement>(null);
  const addFilesMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputFormRef = useRef<HTMLFormElement>(null);

  // Load trustedAgentOptIn from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['trustedAgentOptIn'], (result) => {
      console.log('Loading trustedAgentOptIn from storage:', result.trustedAgentOptIn);
      hasLoadedTrustedAgentOptInRef.current = true;
      if (result.trustedAgentOptIn !== undefined) {
        setTrustedAgentOptIn(result.trustedAgentOptIn);
      } else {
        // If no value in storage, save the default value
        chrome.storage.local.set({ trustedAgentOptIn: true });
      }
    });
  }, []);

  // Save trustedAgentOptIn to storage whenever it changes (but only after initial load)
  useEffect(() => {
    // Only save if we've already loaded from storage to avoid race conditions
    if (hasLoadedTrustedAgentOptInRef.current) {
      console.log('Saving trustedAgentOptIn to storage:', trustedAgentOptIn);
      chrome.storage.local.set({ trustedAgentOptIn });
    }
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
  const [persistedChatHistory, setPersistedChatHistory] = useState<ChatHistory[]>([]);
  const currentChatIdRef = useRef<string | null>(null); // Track current chat ID for updates
  const activeStreamTabIdRef = useRef<number | null>(null); // Track which tab has an active stream
  const streamMessagesRef = useRef<Message[]>([]); // Track messages during streaming
  const streamAbortControllerRef = useRef<Record<number, AbortController>>({}); // Track abort controllers per tab
  const lastTypedSelectorRef = useRef<string | null>(null); // Store last typed selector for Enter key (from PR #7)

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

  // Helper function to match URL against domain patterns and get site instructions text
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

  // Helper function to get the matching site instruction object (for editing)
  const getMatchingSiteInstructionObject = (url: string | null): SiteInstruction | null => {
    if (!url || !settings?.siteInstructions) return null;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Find matching site instructions
      for (const instruction of settings.siteInstructions) {
        if (!instruction.enabled) continue;

        const pattern = instruction.domainPattern;

        // Convert wildcard pattern to regex
        const regexPattern = pattern
          .replace(/\./g, '\\.')  // Escape dots
          .replace(/\*/g, '.*');   // Convert * to .*

        const regex = new RegExp(`^${regexPattern}$`, 'i');

        if (regex.test(hostname)) {
          return instruction;
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
    console.log('🔍 [checkForTrustedAgent] Called at', new Date().toISOString());
    console.log('🔍 [checkForTrustedAgent] Call stack:', new Error().stack?.split('\n').slice(1, 4).join('\n'));
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

    // Check if we have either mcpServers OR serviceMappings configured
    // Even if mcpServers is empty, we can auto-add from serviceMappings
    const hasMcpServers = localSettings?.mcpServers && localSettings.mcpServers.length > 0;
    const hasServiceMappings = localSettings?.serviceMappings && localSettings.serviceMappings.length > 0;

    if (!hasMcpServers && !hasServiceMappings) {
      console.log('⚠️  No services configured (no mcpServers or serviceMappings)');
      setCurrentSiteAgent(null);
      setCurrentSiteMcpCount(0);
      return;
    }

    // Initialize mcpServers array if it doesn't exist (needed for auto-add logic)
    if (!localSettings.mcpServers) {
      localSettings.mcpServers = [];
    }

    console.log('📋 Service mappings:', localSettings.serviceMappings);
    console.log('📋 MCP servers:', localSettings.mcpServers.map((s: any) => ({ id: s.id, name: s.name, enabled: s.enabled })));

    // Check for service mappings for current site
    const { a2aMapping, mcpServerIds } = findMatchingMappings(currentUrl, localSettings.serviceMappings);
    console.log('🗺️  Mapping results:', { a2aMapping, mcpServerIds });

    // Initialize A2A service based on mappings (tab-specific)
    const a2aService = getTabA2AService();
    const mcpService = getTabMcpService();

    // CRITICAL: Check if servers are already connected OR connecting BEFORE doing anything else
    // This prevents race conditions where reset happens while connection is in progress
    const alreadyConnected = mcpService.hasConnections() || a2aService.hasConnections();
    const isConnecting = mcpService.hasConnectingConnections();
    
    if (alreadyConnected || isConnecting) {
      console.log('⏭️  [checkForTrustedAgent] Servers already connected or connecting for this tab, skipping connection');
      console.log(`⏭️  [checkForTrustedAgent] MCP connections: ${mcpService.hasConnections()}, A2A connections: ${a2aService.hasConnections()}`);
      console.log(`⏭️  [checkForTrustedAgent] MCP connecting: ${isConnecting}`);
      // Still update the UI state based on mappings
      if (a2aMapping) {
        setCurrentSiteAgent({ serverId: a2aMapping.serviceId, serverName: a2aMapping.serviceName });
      } else {
        setCurrentSiteAgent(null);
      }
      setCurrentSiteMcpCount(mcpServerIds.length);
      return;
    }

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

    // Only reset services if they're not already connected or connecting (to avoid unnecessary reconnections)
    const needsReset = !mcpService.hasConnections() && !a2aService.hasConnections() && !mcpService.hasConnectingConnections();
    if (needsReset) {
      console.log('🔄 Resetting services (no existing connections or in-progress connections)...');
      resetA2AService();
      resetMCPService();
    } else {
      console.log('⏭️  [checkForTrustedAgent] Skipping service reset - connections exist or are in progress');
      console.log(`⏭️  [checkForTrustedAgent] MCP connected: ${mcpService.hasConnections()}, connecting: ${mcpService.hasConnectingConnections()}`);
      console.log(`⏭️  [checkForTrustedAgent] A2A connected: ${a2aService.hasConnections()}`);
    }

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

  // Memoized badge calculation - only recalculates when URL or settings change
  const badgeData = useMemo(() => {
    // Only check mappings when both currentTabUrl and settings are ready
    if (!currentTabUrl || !settings) {
      return null;
    }

    // Skip chrome:// and chrome-extension:// URLs (not regular websites)
    if (currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
      return null;
    }

    // Ensure serviceMappings exists and is an array
    const serviceMappings = settings.serviceMappings || [];
    
    // Get mapped services for current site
    const mappedServices = findMatchingMappings(currentTabUrl, serviceMappings);
    
    const hasMappedMCPs = mappedServices.mcpServerIds.length > 0;
    const hasMappedA2A = mappedServices.a2aMapping !== null;
    const hasServices = hasMappedMCPs || hasMappedA2A;

    const serviceText = (() => {
      const totalCount = (hasMappedA2A ? 1 : 0) + mappedServices.mcpServerIds.length;
      if (totalCount === 0) {
        return 'No trusted services for this site';
      } else if (totalCount === 1) {
        return '1 Verified Agent Connected';
      } else {
        return `${totalCount} Verified Agents Connected`;
      }
    })();

    return {
      mappedServices,
      hasMappedMCPs,
      hasMappedA2A,
      hasServices,
      serviceText
    };
  }, [currentTabUrl, settings?.serviceMappings]);

  // Memoized tools panel calculation - only recalculates when URL or settings change
  const toolsPanelData = useMemo(() => {
    if (!currentTabUrl || !settings) {
      return null;
    }

    // Get mapped services for current site (from mappings, not live connections)
    const mappedServices = findMatchingMappings(currentTabUrl, settings.serviceMappings);

    const hasMappedMCPs = mappedServices.mcpServerIds.length > 0;
    const hasMappedA2A = mappedServices.a2aMapping !== null;
    const hasBrowserTools = browserToolsEnabled;

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

    return {
      mappedServices,
      hasMappedMCPs,
      hasMappedA2A,
      hasBrowserTools,
      mappedMcpServers,
      willShow: hasMappedMCPs || hasMappedA2A || hasBrowserTools
    };
  }, [currentTabUrl, settings?.serviceMappings, settings?.mcpServers, browserToolsEnabled]);

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

  // Comprehensive page analysis based on content, structure, and semantic HTML
  const analyzePageCharacteristics = (context: any) => {
    const title = context.title || '';
    const url = (context.url || '').toLowerCase();
    const textContent = context.textContent || '';
    // const lowerContent = textContent.toLowerCase();
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
    // const title = characteristics.title || (context?.title || '').toLowerCase();
    
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
    
    // Escape special regex characters to prevent ReDoS
    // This is safe because we're escaping all special characters
    const escapedWord = lowerWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Use a pre-compiled regex pattern to avoid ReDoS
    // Limit word length to prevent excessive backtracking
    if (escapedWord.length > 100) {
      return word; // Return original if word is too long
    }
    
    // Try to find the word in the original text with its original capitalization
    const regex = new RegExp(`\\b${escapedWord}\\b`, 'gi');
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
        console.log('📍 Current tab URL:', tab.url);
        setCurrentTabId(tab.id);
        setCurrentTabUrl(tab.url || null);
        currentTabIdRef.current = tab.id; // Sync ref immediately

        // Reset all chat-related states for initial load
        setIsToolExecuting(false);
        setInput('');
        setShowBrowserToolsWarning(false);
        setIsUserScrolled(false);

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

      // Save current tab's resources and messages before switching
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
            const tab = await chrome.tabs.get(currentId).catch(() => null);
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
      
      if (currentId !== null) {
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
      currentTabIdRef.current = activeInfo.tabId; // Sync ref immediately
      
      // Reset all chat-related states for the new tab
      setIsToolExecuting(false);
      setInput('');
      setShowBrowserToolsWarning(false);
      
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
    };

    chrome.tabs.onActivated.addListener(handleTabChange);

    // Listen for URL changes and page refreshes within the current tab
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Only react to changes on the current tab
      if (tabId === currentTabIdRef.current) {
        // Handle URL changes (navigation)
        if (changeInfo.url) {
          console.log('📍 Tab URL changed to:', changeInfo.url);
          setCurrentTabUrl(changeInfo.url);
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


  // Save messages whenever they change
  useEffect(() => {
    if (currentTabId !== null && messages.length > 0) {
      console.log(`💾 Saving ${messages.length} messages for tab ${currentTabId}`);
      tabMessagesRef.current[currentTabId] = messages;
      
      // Debounced save to persisted storage (save after 2 seconds of no changes)
      const saveTimeout = setTimeout(async () => {
        try {
          const tab = await chrome.tabs.get(currentTabId).catch(() => null);
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

      // Also persist to chrome.storage if enabled (upstream feature)
      if (settings?.enableConversationPersistence !== false) { // Default: true
        chrome.storage.local.set({
          [`conversations_tab_${currentTabId}`]: messages
        }).then(() => {
          console.log(`💾 Persisted ${messages.length} messages to storage for tab ${currentTabId}`);
        }).catch(err => {
          console.error('Failed to persist messages:', err);
        });
      }
      
      return () => clearTimeout(saveTimeout);
    }
  }, [messages, currentTabId, settings?.enableConversationPersistence]);

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
        // Automatically set default GoCode URL
        tempSettings.customBaseUrl = 'https://caas-gocode-prod.caas-prod.prod.onkatana.net';
        
        const providerName = provider === 'google' ? 'Google' : provider === 'anthropic' ? 'Anthropic' : 'OpenAI';

        setOnboardingState({
          active: true,
          step: 'apiKey',
          tempSettings
        });

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `Great! You've selected **${providerName}**.\n\n**Step 2: GoCode Key**\n\nPlease provide your GoCode Key. This is your API key for the GoCode service.\n\nPaste your GoCode Key here:\n\n---\n\n💡 **Need help?** You can also configure your GoCode Key in [Settings](settings://open).\n\n**GoCode Key Format:** Your key should start with "sk-" followed by a long string of characters.`
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
    } else if (currentStep === 'apiKey') {
      // Validate that the input looks like an API key, not a question or instruction
      const trimmedInput = userInput.trim();
      
      // Comprehensive question detection - check for question words, question marks, and common phrases
      const lowerInput = trimmedInput.toLowerCase();
      
      // Check for question marks
      const hasQuestionMark = lowerInput.includes('?');
      
      // Check for question words (at start or after common prefixes)
      const questionWords = ['how', 'where', 'what', 'when', 'why', 'who', 'which', 'whose', 'whom'];
      const hasQuestionWord = questionWords.some(word => {
        const index = lowerInput.indexOf(word);
        return index !== -1 && (
          index === 0 || // At start
          lowerInput[index - 1] === ' ' || // After space
          lowerInput.substring(Math.max(0, index - 3), index) === 'do ' || // After "do "
          lowerInput.substring(Math.max(0, index - 4), index) === 'can ' || // After "can "
          lowerInput.substring(Math.max(0, index - 6), index) === 'could ' // After "could "
        );
      });
      
      // Check for question phrases
      const questionPhrases = [
        'i need', 'i want', 'i would like', 'i am looking for', 'i am trying to',
        'can you', 'could you', 'would you', 'will you', 'should i',
        'please help', 'help me', 'need help', 'looking for', 'trying to find',
        'where can', 'where do', 'where is', 'where are',
        'how can', 'how do', 'how to', 'how does', 'how did',
        'what is', 'what are', 'what do', 'what does',
        'tell me', 'show me', 'explain', 'describe',
        'do you know', 'do you have', 'is there', 'are there',
        'i don\'t know', 'i don\'t have', 'i\'m not sure',
        'i need to', 'i want to', 'i\'m looking for', 'i\'m trying to'
      ];
      const hasQuestionPhrase = questionPhrases.some(phrase => lowerInput.includes(phrase));
      
      // Check for imperative/question patterns
      const imperativePatterns = [
        /^(please|can|could|would|will|should)\s+(you|i|we)/i,
        /^(help|show|tell|explain|describe|find|get|obtain|retrieve)/i,
        /^(i|we)\s+(need|want|would like|am looking|am trying)/i
      ];
      const hasImperativePattern = imperativePatterns.some(pattern => pattern.test(trimmedInput));
      
      // Check if input contains spaces and common words (likely a sentence/question, not an API key)
      const wordCount = trimmedInput.split(/\s+/).filter(w => w.length > 0).length;
      const commonWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must'];
      const hasCommonWords = commonWords.some(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(trimmedInput);
      });
      const looksLikeSentence = wordCount > 2 && hasCommonWords;
      
      // Check for question indicators in context
      const isQuestion = hasQuestionMark || 
                        hasQuestionWord || 
                        hasQuestionPhrase || 
                        hasImperativePattern ||
                        (looksLikeSentence && (hasQuestionWord || hasQuestionPhrase));
      
      // Check if it looks like an API key - GoCode keys should start with "sk-"
      // Also accept Bearer tokens and JWT tokens, but be strict about format
      const startsWithSk = trimmedInput.startsWith('sk-');
      const startsWithBearer = trimmedInput.startsWith('Bearer ') && trimmedInput.length > 20;
      const startsWithJWT = trimmedInput.startsWith('eyJ') && trimmedInput.length > 50; // JWT tokens are longer
      
      // For keys starting with "sk-", validate minimum length (at least 20 chars after "sk-")
      const isValidSkKey = startsWithSk && trimmedInput.length >= 23; // "sk-" + at least 20 chars
      
      // For other formats, require longer strings and strict alphanumeric pattern (no spaces)
      const isValidOtherKey = (startsWithBearer || startsWithJWT) && 
                             /^[a-zA-Z0-9_.-]+$/.test(trimmedInput.replace(/^Bearer\s+/, '').replace(/^eyJ/, ''));
      
      const looksLikeApiKey = isValidSkKey || isValidOtherKey;
      
      // ALWAYS reject questions, even if they somehow pass other checks
      if (isQuestion) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `It looks like you're asking a question. Please paste your GoCode Key directly.\n\n**GoCode Key Format:**\nYour GoCode Key should start with "sk-" followed by a long string of characters (at least 20 characters after "sk-").\n\n**How to get your GoCode Key:**\nGet your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))\n\n💡 **Need help?** You can also configure your GoCode Key in [Settings](settings://open).`
        }]);
        return;
      }
      
      // Validate API key format
      if (looksLikeApiKey) {
        tempSettings.apiKey = trimmedInput;
        
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
            content: `Perfect! Your GoCode Key has been saved. ✅\n\n**Step 3: Optional Configuration**\n\nWould you like to configure optional features now?\n\n• **Enable Business Services** - Access 115 Million verified GoDaddy customer services through AI chat (requires ANS API Token)\n\n• **Custom MCP Servers** - Add custom Model Context Protocol servers\n\nType **"Yes"** to configure these, or **"No"** to skip and start chatting.`
          }]);
        });
      } else {
        // Invalid key format - show helpful error with settings link
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'user',
          content: userInput
        }, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `That doesn't look like a valid GoCode Key.\n\n**GoCode Key Format:**\nYour GoCode Key should start with "sk-" followed by a long string of characters (at least 20 characters after "sk-").\n\n**Examples of valid formats:**\n• \`sk-abc123...\` (at least 23 characters total)\n• \`Bearer eyJ...\` (for Bearer tokens)\n\n**How to get your GoCode Key:**\nGet your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))\n\n💡 **Need help?** You can also configure your GoCode Key in [Settings](settings://open).`
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
    // Clear messages for current tab
    setMessages([]);
    setInput('');
    setShowBrowserToolsWarning(false);

    // Clear current chat ID to prevent reloading old chat
    currentChatIdRef.current = null;

    // Clear messages storage for current tab
    if (currentTabId !== null) {
      tabMessagesRef.current[currentTabId] = [];

      // Also clear persisted messages
      chrome.storage.local.remove([`conversations_tab_${currentTabId}`]).catch(err => {
        console.error('Failed to clear persisted messages:', err);
      });
    }
    
    // Clear stream messages ref to prevent syncing old messages
    streamMessagesRef.current = [];
    
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
    customMCPToolsRef.current = null;
    
    // Clear any hanging MCP initialization promises (tabId already declared above)
    if (tabId !== null) {
      tabCustomMCPInitPromiseRef.current[tabId] = null;
    }
    customMCPInitPromiseRef.current = null;
    mcpInitPromiseRef.current = null;
    
    console.log('🧹 Cleared all MCP initialization promises and resources');
    
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

          const rawErrorMessage = errorDetails?.error?.message || `API request failed with status ${response.status}: ${response.statusText}`;
          console.error('❌ Full error details:', errorDetails);

          // Sanitize error message before throwing
          const sanitizedErrorMessage = sanitizeErrorMessage(rawErrorMessage, settings);
          throw new Error(sanitizedErrorMessage);
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
          const errorData = JSON.stringify(data);
          const sanitizedErrorData = sanitizeErrorMessage(errorData, settings);
          throw new Error(`No candidate in Gemini response. Finish reason: ${data.candidates?.[0]?.finishReason || 'unknown'}. Full response: ${sanitizedErrorData}`);
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
                const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
                const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
                    const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
      const streamTabId = activeStreamTabIdRef.current;
      if (activeStreamTabIdRef.current === streamTabId) {
        activeStreamTabIdRef.current = null;
        if (streamTabId !== null && streamAbortControllerRef.current[streamTabId]) {
          delete streamAbortControllerRef.current[streamTabId];
        }
      }
      
      throw error;
    } finally {
      // Clean up stream tracking when function completes (success or error)
      const streamTabId = activeStreamTabIdRef.current;
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
                const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
        console.warn('⚠️ Provider:', settings?.provider, 'Model:', settings?.model, 'Custom URL:', settings?.customBaseUrl || 'none');
        const updated = [...finalMessages];
        updated[updated.length - 1].content = '⚠️ No response received from the AI. The API returned an empty response.\n\nPossible causes:\n- Check your API key is correct\n- Check the console for detailed error messages\n- Verify your internet connection\n- If using GoCaaS, check the service status';
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
          const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
        const sanitizedError = sanitizeErrorMessage(error, settings);
        lastMsg.content = `❌ Error: ${sanitizedError}`;
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

    // Build message parts including images
    const buildMessageParts = (message: Message) => {
      const parts: any[] = [{ text: message.content || '' }];
      
      // Add images if present (for direct API calls)
      if (message.images && message.images.length > 0) {
        message.images.forEach(img => {
          parts.push({
            inline_data: {
              mime_type: img.mime_type,
              data: img.data
            }
          });
        });
      }
      
      return parts;
    };

    // Build request body
    const requestBody: any = {
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: buildMessageParts(m),
      })),
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
    };

    // Add file metadata and mode if using GoCaaS (customBaseUrl)
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (isCustomProvider) {
      if (lastUserMessage?.chat_files_metadata && lastUserMessage.chat_files_metadata.length > 0) {
        requestBody.chat_files_metadata = lastUserMessage.chat_files_metadata;
      }
      // Add mode parameter for GoCaaS integration (create_image, thinking, deep_research, study_and_learn, web_search, canvas, browser_memory)
      if (lastUserMessage?.mode) {
        requestBody.mode = lastUserMessage.mode;
        console.log(`🔵 [Google Service] Mode parameter included: ${lastUserMessage.mode}`);
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
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
            // Handle SSE format - extract JSON from "data: {...}" lines
            let bufferToParse = jsonBuffer.trim();
            // If it contains SSE format, extract JSON parts
            if (bufferToParse.includes('data: ')) {
              const dataLines = bufferToParse.split('\n').filter(l => l.trim().startsWith('data: '));
              if (dataLines.length > 0) {
                // Try to parse the last data line
                const lastDataLine = dataLines[dataLines.length - 1];
                bufferToParse = lastDataLine.slice(6); // Remove 'data: ' prefix
              }
            }
            let data = JSON.parse(bufferToParse);
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
          // Handle SSE format (data: prefix) or direct JSON
          let jsonLine = line.trim();
          if (jsonLine.startsWith('data: ')) {
            jsonLine = jsonLine.slice(6).trim(); // Remove 'data: ' prefix
          }
          if (jsonLine === '[DONE]' || jsonLine === '') continue;
          
          const json = JSON.parse(jsonLine);
          
          // Handle different response formats
          let text = null;
          
          // Google format: candidates[0].content.parts[0].text
          if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
            text = json.candidates[0].content.parts[0].text;
          }
          // Alternative format: direct text field
          else if (json.text) {
            text = json.text;
          }
          // Alternative format: content field
          else if (json.content) {
            text = typeof json.content === 'string' ? json.content : json.content.text;
          }
          
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
                    const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
          // Log parsing errors for debugging (but don't fail)
          if (line.trim().length > 0 && !line.trim().startsWith(':')) {
            console.debug('[Google Stream] Failed to parse line:', line.substring(0, 100), e);
          }
        }
      }
    }
    
    // Check if we got any content - if not, show error
    const finalMessages = streamMessagesRef.current;
    const lastMessage = finalMessages[finalMessages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()) {
      console.warn('⚠️ Stream completed with no content');
      console.warn('⚠️ Provider:', settings?.provider, 'Model:', settings?.model, 'Custom URL:', settings?.customBaseUrl || 'none');
      const updated = [...finalMessages];
      updated[updated.length - 1].content = '⚠️ No response received from the AI. The API returned an empty response.\n\nPossible causes:\n- Check your API key is correct\n- Check the console for detailed error messages\n- Verify your internet connection\n- If using GoCaaS, check the service status';
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
        const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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

  const submitMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

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

    // Include attached tabs info in message
    let tabContext = '';
    if (selectedTabs.length > 0) {
      tabContext = '\n\n[Attached Tabs]\n';
      selectedTabs.forEach(tab => {
        tabContext += `- ${tab.title}\n  URL: ${tab.url}\n`;
      });
    }

    // Upload files and screenshots, collect metadata
    const chatFilesMetadata: Array<{ id: string; name: string }> = [];
    const imageData: Array<{ data: string; mime_type: string }> = [];

    // Upload regular files to GoCaaS if using GoCaaS
    for (const fileItem of selectedFiles) {
      if (settings?.customBaseUrl) {
        // Using GoCaaS - upload file and get ID
        const fileMetadata = await uploadFileToGoCaaS(fileItem.file);
        if (fileMetadata) {
          chatFilesMetadata.push(fileMetadata);
        } else {
          // Upload failed, include as image data if it's an image
          if (fileItem.file.type.startsWith('image/')) {
            const reader = new FileReader();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(fileItem.file);
            });
            const base64Data = dataUrl.split(',')[1];
            imageData.push({
              data: base64Data,
              mime_type: fileItem.file.type
            });
          }
        }
      } else {
        // Not using GoCaaS - include images as image data for direct API calls
        if (fileItem.file.type.startsWith('image/')) {
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(fileItem.file);
          });
          const base64Data = dataUrl.split(',')[1];
          imageData.push({
            data: base64Data,
            mime_type: fileItem.file.type
          });
        }
      }
    }

    // Handle screenshots - convert to files and upload, or include as image data
    for (const screenshot of selectedScreenshots) {
      if (settings?.customBaseUrl) {
        // Using GoCaaS - convert screenshot to file and upload
        const screenshotFile = dataUrlToFile(screenshot.dataUrl, `screenshot-${screenshot.id}.png`);
        const fileMetadata = await uploadFileToGoCaaS(screenshotFile);
        if (fileMetadata) {
          chatFilesMetadata.push(fileMetadata);
        } else {
          // Upload failed, include as image data
          const base64Data = screenshot.dataUrl.split(',')[1];
          imageData.push({
            data: base64Data,
            mime_type: 'image/png'
          });
        }
      } else {
        // Not using GoCaaS - include as image data
        const base64Data = screenshot.dataUrl.split(',')[1];
        imageData.push({
          data: base64Data,
          mime_type: 'image/png'
        });
      }
    }

    // Include attached screenshots info in message text (for context)
    let screenshotContext = '';
    if (selectedScreenshots.length > 0) {
      screenshotContext = '\n\n[Attached Screenshots]\n';
      selectedScreenshots.forEach((screenshot, index) => {
        screenshotContext += `Screenshot ${index + 1} (captured at ${new Date(screenshot.timestamp).toLocaleTimeString()})\n`;
      });
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText + pageContext + tabContext + screenshotContext,
      ...(chatFilesMetadata.length > 0 && { chat_files_metadata: chatFilesMetadata }),
      ...(imageData.length > 0 && { images: imageData }),
      ...(chatMode && { mode: chatMode }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
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
            console.log(`🚀 MCP initialization check - customMCPToolsRef.current: ${!!customMCPToolsRef.current}, customMCPInitPromiseRef.current: ${!!customMCPInitPromiseRef.current}`);
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
              console.log(`🚀 [INIT] Starting MCP initialization for ${enabledServers.length} server(s) at ${new Date().toISOString()}`);
              console.log(`🚀 [INIT] Promise does NOT exist - creating new promise`);
              console.log(`🚀 [INIT] Server IDs: ${enabledServers.map(s => s.id).join(', ')}`);
              
              customMCPInitPromiseRef.current = (async () => {
                const initStartTime = Date.now();
                console.log(`🚀 [INIT PROMISE] Promise execution started at ${new Date().toISOString()}`);
                console.log(`🚀 [INIT PROMISE] This promise will call client.tools() for each server`);
                
                try {
                  console.log(`📡 [INIT PROMISE] Step 1: Getting tab-specific services...`);
                  // Use tab-specific services
                  const mcpService = getTabMcpService();
                  const a2aService = getTabA2AService();


                  if (mcpService.hasConnections()) {
                    customMCPToolsRef.current = mcpService.getAggregatedTools();
                    console.log(`✅ [INIT PROMISE] Custom MCP ready - ${mcpService.getTotalToolCount()} tool(s) available`);
                    console.log(getToolDescription(mcpService.getToolsWithOrigin()));
                  } else {
                    console.warn('⚠️  [INIT PROMISE] No custom MCP servers connected');
                    customMCPToolsRef.current = null;
                  }

                  if (a2aService.hasConnections()) {
                    console.log(`✅ [INIT PROMISE] A2A ready - ${a2aService.getConnectionStatus().length} agent(s) registered`);
                  }
                  
                  const totalTime = Date.now() - initStartTime;
                  console.log(`✅ [INIT PROMISE] MCP/A2A initialization completed successfully (total time: ${totalTime}ms)`);
                } catch (error) {
                  const totalTime = Date.now() - initStartTime;
                  console.error(`❌ [INIT PROMISE] Custom MCP/A2A init failed after ${totalTime}ms:`, error);
                  console.error(`❌ [INIT PROMISE] Error details:`, error instanceof Error ? error.stack : error);
                  customMCPToolsRef.current = null;
                  throw error; // Re-throw to be caught by outer try-catch
                } finally {
                  console.log(`🔓 [INIT PROMISE] Clearing MCP init promise at ${new Date().toISOString()}`);
                  customMCPInitPromiseRef.current = null;
                }
              })();

              console.log(`⏳ [INIT WAIT] Waiting for MCP initialization to complete...`);
              console.log(`⏳ [INIT WAIT] Promise created, now waiting at ${new Date().toISOString()}`);
              try {
                // Add timeout to prevent hanging (30 seconds)
                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => {
                    console.error(`🔴 [INIT WAIT] TIMEOUT: MCP initialization timed out after 30 seconds at ${new Date().toISOString()}`);
                    console.error(`🔴 [INIT WAIT] The initialization promise never resolved - this indicates client.tools() hung`);
                    reject(new Error('MCP initialization timed out after 30 seconds'));
                  }, 30000);
                });
                console.log(`⏳ [INIT WAIT] Starting Promise.race() with 30-second timeout at ${new Date().toISOString()}`);
                await Promise.race([customMCPInitPromiseRef.current, timeoutPromise]);
                console.log(`✅ [INIT WAIT] MCP initialization completed successfully at ${new Date().toISOString()}`);
              } catch (error: any) {
                console.error(`❌ [INIT WAIT] MCP initialization failed or timed out at ${new Date().toISOString()}:`, error);
                console.error(`❌ [INIT WAIT] Error message: ${error?.message}`);
                console.error(`❌ [INIT WAIT] Clearing promise so subsequent messages don't wait`);
                // Clear the promise so we don't wait again
                customMCPInitPromiseRef.current = null;
                // Continue anyway - don't block the conversation
              }
            } else if (customMCPInitPromiseRef.current) {
              console.log(`⏳ [SUBSEQUENT MSG] MCP initialization already in progress at ${new Date().toISOString()}`);
              console.log(`⏳ [SUBSEQUENT MSG] Promise EXISTS - this message will wait for it`);
              console.log(`⏳ [SUBSEQUENT MSG] This is the bug scenario: multiple messages waiting for the same promise`);
              console.log(`⏳ [SUBSEQUENT MSG] Will wait up to 2 seconds, then proceed without MCP tools if not ready`);
              
              try {
                // Use a very short timeout (2 seconds) to avoid blocking messages
                // If init completes quickly, great. If not, proceed without MCP tools.
                // This prevents every message from getting stuck waiting for a hanging init.
                const shortTimeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => {
                    console.warn(`⚠️ [SUBSEQUENT MSG] SHORT TIMEOUT: MCP initialization taking too long (2 seconds) at ${new Date().toISOString()}`);
                    console.warn(`⚠️ [SUBSEQUENT MSG] The promise is still pending - likely client.tools() is hanging`);
                    console.warn(`⚠️ [SUBSEQUENT MSG] Proceeding without MCP tools for this message to avoid blocking`);
                    reject(new Error('MCP initialization taking too long, proceeding without MCP tools'));
                  }, 2000);
                });
                
                console.log(`⏳ [SUBSEQUENT MSG] Starting Promise.race() with 2-second timeout at ${new Date().toISOString()}`);
                await Promise.race([customMCPInitPromiseRef.current, shortTimeoutPromise]);
                console.log(`✅ [SUBSEQUENT MSG] MCP initialization completed (waited for existing promise) at ${new Date().toISOString()}`);
              } catch (error: any) {
                // If timeout or error, proceed without MCP tools for this message
                // Don't clear the promise - let it continue in background
                // Future messages will either have tools ready, or will also proceed without them
                console.warn(`⚠️ [SUBSEQUENT MSG] MCP initialization wait timed out or failed at ${new Date().toISOString()}: ${error.message}`);
                console.warn(`⚠️ [SUBSEQUENT MSG] This message will proceed without MCP tools`);
                console.warn(`⚠️ [SUBSEQUENT MSG] However, the promise is still hanging - future messages will also wait`);
                console.log(`ℹ️ [SUBSEQUENT MSG] MCP initialization not ready yet, proceeding without MCP tools for this message`);
                console.log(`ℹ️ [SUBSEQUENT MSG] Initialization will continue in background for future messages`);
              }
            } else {
              console.log(`ℹ️ No MCP initialization needed - tools already available or no servers configured`);
            }
          }
          
          console.log(`✅ MCP initialization wait completed, continuing with message processing...`);

          // Prepare custom MCP and A2A tools if available AND there's a trusted mapping
          let mcpTools: any[] | undefined;
          let mcpToolNameSet: Set<string> | null = null;
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
                const sanitizedError = sanitizeErrorMessage(error, settings);
                return { error: sanitizedError || 'A2A tool execution failed' };
              }
            }

            // Check if this is an MCP tool
            if (mcpTools && mcpToolNameSet?.has(toolName)) {
              // Check if there's a trusted mapping for the current site
              if (!hasTrustedMappingForCurrentSite()) {
                console.warn(`🚫 MCP tool "${toolName}" blocked: No trusted service mapping for current site`);
                setIsToolExecuting(false);
                return { 
                  error: `MCP tools are not available for this site. Please configure a trusted service mapping in settings.`,
                  blocked: true
                };
              }

              try {
                const executionStartTime = Date.now();
                setIsToolExecuting(true);
                console.log(`🔧 Executing MCP tool: ${toolName}`);
                const mcpService = getTabMCPService();
                const result = await mcpService.executeToolCall(toolName, params);
                setIsToolExecuting(false);
                return result;
              } catch (error: any) {
                const executionDuration = Date.now() - executionStartTime;
                console.error(`❌ MCP tool execution failed after ${executionDuration}ms:`, error);
                console.error(`   Error type: ${error?.constructor?.name}`);
                console.error(`   Error message: ${error?.message}`);
                console.error(`   Error stack: ${error?.stack}`);
                setIsToolExecuting(false); // Hide indicator on error
                
                // Check if it's a timeout error
                const errorMessage = error.message || 'MCP tool execution failed';
                const isTimeout = errorMessage.includes('timed out') || 
                                 errorMessage.includes('took too long') ||
                                 errorMessage.includes('timeout');
                
                console.log(`   Is timeout: ${isTimeout}`);
                
                // Return user-friendly error message
                return { 
                  error: isTimeout 
                    ? 'The request took too long and timed out. Please try again later or try a different approach.'
                    : errorMessage,
                  timeout: isTimeout
                };
              }
            }

            // No hard blocking - let the AI decide which tools to use based on the task
            // The system prompt already instructs prioritizing MCP tools when relevant
            // Browser tools can be used for tasks that MCP tools don't handle (e.g., navigation, clicking)

            // Only show overlay for browser tools, not MCP tools
            // Also only show if browser tools are enabled
            const isBrowserTool = BROWSER_TOOL_NAMES.has(toolName);
            if (isBrowserTool && browserToolsEnabled) {
              // Show overlay before browser tool execution
              // (ensures overlay is always visible during automation)
              console.log(`🔵 Showing overlay for browser tool: ${toolName}`);
              await showBrowserAutomationOverlay();
            } else if (isBrowserTool && !browserToolsEnabled) {
              console.log(`ℹ️ Skipping overlay - browser tools not enabled: ${toolName}`);
            } else {
              console.log(`ℹ️ Skipping overlay for non-browser tool: ${toolName}`);
            }

            // Execute tool (browser or other)
            const result = await executeTool(toolName, params);

            // Re-show overlay after browser tool execution (in case page navigation removed it)
            // Only for browser tools, not MCP tools, and only if browser tools are enabled
            if (isBrowserTool && browserToolsEnabled) {
              // Small delay to let any page changes settle
              setTimeout(async () => {
                await showBrowserAutomationOverlay();
              }, 500);
            }

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
              hideBrowserAutomationOverlay();
              // Clear loading and tool executing states
              setIsLoading(false);
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
            },
            browserToolsEnabled // Pass browser tools enabled status
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
          console.log(`🔍 [Second Init Path] MCP/A2A enabled with ${settings.mcpServers.length} configured server(s)`);
          console.log(`🔍 [Second Init Path] customMCPInitPromiseRef.current exists: ${!!customMCPInitPromiseRef.current}`);
          console.log(`🔍 [Second Init Path] customMCPToolsRef.current exists: ${!!customMCPToolsRef.current}`);
          console.log(`🔍 [Second Init Path] This is the SECOND initialization path (else block)`);

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

                } else {
                  console.log('🗺️  No MCP mappings for current site - MCPs disabled');
                }

                console.log('📋 Servers to connect:', serversToConnect.map(s => `${s.name} (${s.enabled ? 'enabled' : 'disabled'}, ${s.protocol || 'mcp'})`));
                console.log('📋 Number of servers to connect:', serversToConnect.length);

                const mcpService = getTabMcpService();
                const a2aService = getTabA2AService();

                // Check if already connected before attempting connection
                const alreadyConnected = mcpService.hasConnections() || a2aService.hasConnections();
                if (alreadyConnected) {
                  console.log('⏭️  [Second Init Path] Servers already connected, skipping connection attempt');
                  console.log(`⏭️  [Second Init Path] MCP connections: ${mcpService.hasConnections()}, A2A connections: ${a2aService.hasConnections()}`);
                  
                  // Still update tools ref if MCP is connected
                  if (mcpService.hasConnections()) {
                    customMCPToolsRef.current = mcpService.getAggregatedTools();
                    console.log(`✅ [Second Init Path] Using existing MCP tools - ${mcpService.getTotalToolCount()} tool(s) available`);
                  }
                } else {
                  console.log('🔌 [Second Init Path] No existing connections, proceeding with connection...');
                  await mcpService.connectToServers(serversToConnect);
                  await a2aService.connectToServers(serversToConnect);

                  // Update tools ref after connection
                  if (mcpService.hasConnections()) {
                    customMCPToolsRef.current = mcpService.getAggregatedTools();
                    console.log(`✅ [Second Init Path] Custom MCP ready - ${mcpService.getTotalToolCount()} tool(s) available`);
                    console.log(getToolDescription(mcpService.getToolsWithOrigin()));
                  } else {
                    console.warn('⚠️  [Second Init Path] No custom MCP servers connected');
                    customMCPToolsRef.current = null;
                  }

                  if (a2aService.hasConnections()) {
                    console.log(`✅ [Second Init Path] A2A ready - ${a2aService.getConnectionStatus().length} agent(s) registered`);
                  }
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

          // Merge browser tools with MCP/A2A tools if available
          // Browser tools are always included, merge with MCP/A2A tools if they exist
          const mergedTools = mcpTools && mcpTools.length > 0
            ? mergeToolDefinitions([], mcpTools) // Browser tools are handled separately in the function
            : undefined;

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
                // Stream completed
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
                    const sanitizedError = sanitizeErrorMessage(error, settings);
                    return { error: sanitizedError || 'A2A tool execution failed' };
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
                  }
                } else {
                  // Browser tool requested but browser tools not enabled
                  console.warn(`⚠️  Browser tool "${toolName}" requested but browser tools are not enabled`);
                  return { error: 'Browser tools not enabled. Please enable browser tools in settings to use navigation, clicking, and screenshot features.' };
                }
              },
              undefined, // Don't pass abort signal for now - causes issues
              mergedTools,
              currentTabUrl || undefined,
              matchedInstructions || undefined,
              settings,
              (toolName: string, isMcpTool: boolean) => {
                if (isMcpTool) {
                  setIsToolExecuting(true);
                }
              },
              false // Browser tools not enabled in this path
            );
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
                      const tab = await chrome.tabs.get(streamTabId).catch(() => null);
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
            console.warn('⚠️ Provider:', settings?.provider, 'Model:', settings?.model, 'Custom URL:', settings?.customBaseUrl || 'none');
            const updated = [...openAIFinalMessages];
            updated[updated.length - 1].content = '⚠️ No response received from the AI. The API returned an empty response.\n\nPossible causes:\n- Check your API key is correct\n- Check the console for detailed error messages\n- Verify your internet connection\n- If using GoCaaS, check the service status';
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
    } catch (error: any) {
      console.error(`❌ handleSubmit failed at message #${messages.length + 1}`);
      console.error('❌ Chat error occurred:');
      console.error('Error type:', typeof error);
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Full error object:', error);

      if (error.name !== 'AbortError') {
        // Sanitize error message to remove API keys
        const sanitizedError = sanitizeErrorMessage(error, settings);
        const streamTabId = activeStreamTabIdRef.current;
        
        // Try to update existing assistant message, or create new one
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          
          if (lastMsg && lastMsg.role === 'assistant' && (!lastMsg.content || !lastMsg.content.trim())) {
            // Update existing empty assistant message
            lastMsg.content = `❌ Error: ${sanitizedError}\n\nPlease check:\n- Your API key is correct\n- Your internet connection\n- The API service is available`;
          } else {
            // Add new error message
            updated.push({
              id: Date.now().toString(),
              role: 'assistant',
              content: `❌ Error: ${sanitizedError}\n\nPlease check:\n- Your API key is correct\n- Your internet connection\n- The API service is available`,
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
    const messageText = input;
    setInput(''); // Clear input immediately
    await submitMessage(messageText);
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map(file => ({
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      file: file
    }));
    setSelectedFiles(prev => [...prev, ...newFiles]);
    setShowAddFilesMenu(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle file removal
  const handleFileRemove = (fileId: string) => {
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Handle tab removal
  const handleTabRemove = (tabId: string) => {
    setSelectedTabs(prev => prev.filter(t => t.id !== tabId));
  };

  // Handle screenshot removal
  const handleScreenshotRemove = (screenshotId: string) => {
    setSelectedScreenshots(prev => prev.filter(s => s.id !== screenshotId));
  };

  // Upload file to GoCaaS and get file ID
  const uploadFileToGoCaaS = async (file: File): Promise<{ id: string; name: string } | null> => {
    if (!settings?.customBaseUrl) {
      // Not using GoCaaS, return null to handle as direct API call
      return null;
    }

    try {
      const baseUrl = settings.customBaseUrl;
      const endpoint = baseUrl.endsWith('/') 
        ? `${baseUrl}v1/files`
        : `${baseUrl}/v1/files`;

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        console.warn('File upload to GoCaaS failed, will include as image data instead');
        return null;
      }

      const result = await response.json();
      // GoCaaS returns file with id and name
      return {
        id: result.id || `${Date.now()}_${file.name}`,
        name: result.name || file.name
      };
    } catch (error) {
      console.warn('Error uploading file to GoCaaS:', error);
      return null;
    }
  };

  // Convert screenshot data URL to File object
  const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  // Handle "Attach screenshot" menu item
  const handleAttachScreenshot = async () => {
    try {
      setShowAddFilesMenu(false);
      setIsCapturingScreenshot(true);
      // Take screenshot using the executeTool function
      const result = await executeTool('screenshot', {});
      if (result && result.success && result.screenshot) {
        const newScreenshot = {
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          dataUrl: result.screenshot,
          timestamp: Date.now()
        };
        setSelectedScreenshots(prev => [...prev, newScreenshot]);
      } else {
        alert(result?.error || 'Failed to capture screenshot');
      }
    } catch (error: any) {
      console.error('Error capturing screenshot:', error);
      alert(`Failed to capture screenshot: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  // Fetch current tab info
  const fetchCurrentTabInfo = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_INFO' });
      if (response && response.url && response.title) {
        setCurrentTabInfo({
          url: response.url,
          title: response.title,
          id: response.id,
          favIconUrl: response.favIconUrl
        });
      }
    } catch (error) {
      console.error('Failed to fetch current tab info:', error);
      setCurrentTabInfo(null);
    }
  };

  // Handle "Add photos & files" menu item
  const handleAddFiles = () => {
    fileInputRef.current?.click();
    setShowAddFilesMenu(false);
  };

  // Handle "Attach tab" menu item
  const handleAttachTab = () => {
    if (currentTabInfo) {
      const newTab = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url: currentTabInfo.url,
        title: currentTabInfo.title,
        tabId: currentTabInfo.id,
        favIconUrl: currentTabInfo.favIconUrl
      };
      setSelectedTabs(prev => [...prev, newTab]);
      setShowAddFilesMenu(false);
    }
  };

  // Handle "Web search" menu item
  const handleWebSearch = () => {
    setChatMode('web_search');
    setShowMoreMenu(false);
    setShowAddFilesMenu(false);
  };

  // Handle "Canvas" menu item
  const handleCanvas = () => {
    setChatMode('canvas');
    setShowMoreMenu(false);
    setShowAddFilesMenu(false);
  };

  // Handle "Browser memory" menu item
  const handleBrowserMemory = () => {
    setChatMode('browser_memory');
    setShowMoreMenu(false);
    setShowAddFilesMenu(false);
  };

  // Handle voice recording - use offscreen document for microphone access
  const handleVoiceRecording = async () => {
    // Prevent double-clicks and rapid clicking
    if (isRecordingOperationInProgress.current) {
      console.log('[Sidepanel] Recording operation already in progress, ignoring click');
      return;
    }
    
    if (isRecording) {
      // Stop recording via offscreen document
      // Immediately set state to false to provide immediate feedback
      setIsRecording(false);
      isRecordingOperationInProgress.current = true;
      
      try {
        console.log('[Sidepanel] Stopping recording...');
        const response = await new Promise<any>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Sidepanel] chrome.runtime.lastError:', chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            console.log('[Sidepanel] Received STOP_RECORDING response:', response);
            resolve(response);
          });
        });
        
        if (!response) {
          console.error('[Sidepanel] No response received when stopping recording');
          // State already set to false, just show error
          alert('No response from extension when stopping recording. Recording may have stopped anyway.');
          return;
        }
        
        if (response.success && response.audioBlob) {
          // Convert base64 back to blob
          const responseData = await fetch(response.audioBlob);
          const audioBlob = await responseData.blob();
          await transcribeAudio(audioBlob);
        } else {
          console.error('[Sidepanel] Stop recording failed:', response.error);
          // State already set to false, just show error
          alert(response.error || 'Failed to stop recording');
        }
      } catch (error: any) {
        console.error('[Sidepanel] Error stopping recording:', error);
        // State already set to false, just show error
        alert(`Failed to stop recording: ${error.message || 'Unknown error'}`);
      } finally {
        isRecordingOperationInProgress.current = false;
      }
    } else {
      // Start recording via offscreen document
      // Don't set state optimistically - wait for confirmation that recording actually started
      // This prevents the mic indicator from appearing and then disappearing
      
      isRecordingOperationInProgress.current = true;
      try {
        console.log('[Sidepanel] Starting recording via offscreen document...');
        const response = await new Promise<any>((resolve, reject) => {
          // Set a timeout to prevent hanging forever
          const timeout = setTimeout(() => {
            reject(new Error('Recording request timed out after 10 seconds'));
          }, 10000);
          
          chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.error('[Sidepanel] chrome.runtime.lastError:', chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            console.log('[Sidepanel] Received response:', response);
            resolve(response);
          });
        });
        
        if (!response) {
          console.error('[Sidepanel] No response received');
          alert('No response from extension. Please reload the extension.');
          // Don't return - let finally block reset the flag
        } else if (response.success) {
          // Only set state to true AFTER we confirm recording actually started
          setIsRecording(true);
          console.log('[Sidepanel] Recording started successfully');
        } else {
          // Don't set state - recording didn't start
          // Handle errors with concise messages
          let errorMessage = response.error || 'Failed to start recording';
          
          // Simplify error messages - remove verbose multi-line alerts
          if (errorMessage.includes('permission') || errorMessage.includes('Permission')) {
            // Permission errors are already concise from offscreen.ts
            alert(errorMessage);
          } else if (errorMessage.includes('Timeout') || errorMessage.includes('timed out')) {
            alert('Recording request timed out. Please try again.');
          } else {
            alert(errorMessage);
          }
        }
      } catch (error: any) {
        console.error('[Sidepanel] Error starting recording:', error);
        // Don't set state - recording didn't start
        
        let errorMsg = error.message || 'Failed to start recording';
        if (error.message?.includes('Could not establish connection')) {
          errorMsg = 'Extension not responding. Please reload the extension.';
        } else if (error.message?.includes('Extension context invalidated')) {
          errorMsg = 'Extension was reloaded. Please refresh this page.';
        }
        
        alert(errorMsg);
      } finally {
        isRecordingOperationInProgress.current = false;
      }
    }
  };

  // Transcribe audio using GoCaaS API
  const transcribeAudio = async (audioBlob: Blob) => {
    if (!settings) {
      console.error('[Sidepanel] Cannot transcribe: no settings');
      return;
    }
    
    // Validate blob
    if (!audioBlob || audioBlob.size === 0) {
      console.error('[Sidepanel] Cannot transcribe: empty audio blob');
      alert('No audio data recorded. Please try again.');
      return;
    }
    
    // Check blob size (Whisper has limits, typically 25MB)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioBlob.size > maxSize) {
      console.error('[Sidepanel] Audio blob too large:', audioBlob.size);
      alert('Recording is too long. Please record a shorter message.');
      return;
    }

    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.onerror = (error) => {
        console.error('[Sidepanel] FileReader error:', error);
        alert('Failed to read audio file. Please try again.');
      };
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        const baseUrl = settings.customBaseUrl || 'https://api.openai.com';
        
        // Try GoCaaS transcription endpoint first, fallback to OpenAI format
        const endpoint = baseUrl.endsWith('/') 
          ? `${baseUrl}v1/audio/transcriptions`
          : `${baseUrl}/v1/audio/transcriptions`;

        try {
          // Try GoCaaS format first
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify({
              provider: 'openai',
              providerOptions: {
                model: 'whisper-1',
                audio: `data:audio/webm;base64,${base64Audio}`
              }
            }),
          });

          if (!response.ok) {
            throw new Error('GoCaaS transcription failed');
          }

          const data = await response.json();
          const transcribedText = data.text || data.transcription || data.result?.text || '';
          if (transcribedText) {
            setInput(prev => prev + (prev ? ' ' : '') + transcribedText);
          } else {
            console.warn('[Sidepanel] No transcription text in response:', data);
            alert('No transcription received. Please try again.');
          }
        } catch (goCaaSError) {
          // Fallback: try direct OpenAI format if GoCaaS format fails
          console.log('GoCaaS format failed, trying OpenAI format:', goCaaSError);
          const formData = new FormData();
          formData.append('file', audioBlob, 'audio.webm');
          formData.append('model', 'whisper-1');

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${settings.apiKey}`,
            },
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Transcription failed');
          }

          const data = await response.json();
          const transcribedText = data.text || '';
          if (transcribedText) {
            setInput(prev => prev + (prev ? ' ' : '') + transcribedText);
          } else {
            console.warn('[Sidepanel] No transcription text in OpenAI response:', data);
            alert('No transcription received. Please try again.');
          }
        }
      };
      reader.readAsDataURL(audioBlob);
    } catch (error) {
      console.error('Error transcribing audio:', error);
      alert('Failed to transcribe audio. Please try again.');
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle "/" key to open "Add files and more" menu
    if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const target = e.target as HTMLInputElement;
      if (target.value === '' || target.selectionStart === 0) {
        e.preventDefault();
        setShowAddFilesMenu(true);
      }
    }
  };

  // Fetch current tab info when menu opens
  useEffect(() => {
    if (showAddFilesMenu) {
      fetchCurrentTabInfo();
    }
  }, [showAddFilesMenu]);

  // Position dropdown above the chat field
  useEffect(() => {
    if (showAddFilesMenu && addFilesMenuRef.current && dropdownRef.current && inputFormRef.current) {
      const updatePosition = () => {
        if (addFilesMenuRef.current && dropdownRef.current && inputFormRef.current) {
          const buttonRect = addFilesMenuRef.current.getBoundingClientRect();
          const inputFormRect = inputFormRef.current.getBoundingClientRect();
          const dropdownRect = dropdownRef.current.getBoundingClientRect();
          const dropdownHeight = dropdownRect.height || dropdownRef.current.offsetHeight;
          
          // Position above the input form (not just the button) with 8px gap
          const topPosition = inputFormRect.top - dropdownHeight - 8;
          
          dropdownRef.current.style.left = `${buttonRect.left}px`;
          dropdownRef.current.style.top = `${Math.max(8, topPosition)}px`; // Ensure it doesn't go above viewport
        }
      };
      
      // Initial positioning
      requestAnimationFrame(() => {
        requestAnimationFrame(updatePosition); // Double RAF to ensure layout is complete
      });
      
      // Update on resize/scroll
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition);
      
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition);
      };
    }
  }, [showAddFilesMenu]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideAddFilesMenu = (addFilesMenuRef.current && addFilesMenuRef.current.contains(target)) ||
                                   (dropdownRef.current && dropdownRef.current.contains(target));
      const isInsideMoreMenu = (moreButtonRef.current && moreButtonRef.current.contains(target)) ||
                               (moreMenuRef.current && moreMenuRef.current.contains(target));
      
      if (showAddFilesMenu && !isInsideAddFilesMenu) {
        setShowAddFilesMenu(false);
      }
      if (showMoreMenu && !isInsideMoreMenu) {
        setShowMoreMenu(false);
      }
    };

    if (showAddFilesMenu || showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAddFilesMenu, showMoreMenu]);

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

  // Show onboarding welcome screen if no settings
  if (!settings) {
    return (
      <div className="chat-container">
        <div className="welcome-message" style={{ padding: '40px 20px' }}>
          <h2>Welcome! Get Ready for the Agentic Open Web</h2>
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
            onClick={() => {
              chrome.runtime.openOptionsPage();
            }}
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
                  : getModelDisplayName(settings.model))
                : getModelDisplayName(settings.model)}
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

      {currentSiteAgent && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          </div>
        </div>
      )}

      {/* Trusted Services Badge - Show based on mappings (memoized) */}
      {badgeData && (
        <div style={{
          padding: '8px 16px',
          background: badgeData.hasServices ? '#dcfce7' : '#f3f4f6',
          borderBottom: badgeData.hasServices ? '1px solid #86efac' : '1px solid #d1d5db',
          fontSize: '13px',
          color: badgeData.hasServices ? '#166534' : '#6b7280',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {badgeData.hasServices ? (
              <>
                <img 
                  src={chrome.runtime.getURL('icons/trust-badge-light.svg')} 
                  alt="Trust Badge" 
                  style={{ width: '16px', height: '16px', display: 'none' }}
                  className="trust-badge-icon trust-badge-light"
                />
                <img 
                  src={chrome.runtime.getURL('icons/trust-badge-dark.svg')} 
                  alt="Trust Badge" 
                  style={{ width: '16px', height: '16px' }}
                  className="trust-badge-icon trust-badge-dark"
                />
              </>
            ) : (
              <span style={{ fontSize: '16px' }}>○</span>
            )}
            <span>{String(badgeData.serviceText || '')}</span>
          </div>
          {badgeData.hasMappedA2A && (
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
      )}

      {/* Available Tools Panel - Show mapped services for current site (memoized) */}
      {toolsPanelData && toolsPanelData.willShow && (
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
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔧</span>
              <span>Available Tools</span>
            </span>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Browser Tools */}
                {toolsPanelData.hasBrowserTools && (
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
                {toolsPanelData.mappedMcpServers.length > 0 && (
                  <div>
                    <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '6px' }}>
                      🔌 MCP Servers ({toolsPanelData.mappedMcpServers.length})
                    </div>
                    {toolsPanelData.mappedMcpServers.map((server) => (
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
                {toolsPanelData.mappedServices.a2aMapping && (
                  <div>
                    <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '6px' }}>
                      🤖 A2A Agents (1)
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ paddingLeft: '12px', fontSize: '11px', fontWeight: '500', color: '#16a34a' }}>
                        {toolsPanelData.mappedServices.a2aMapping.serviceName}
                      </div>
                      <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#6b7280' }}>
                        {toolsPanelData.mappedServices.a2aMapping.serviceUrl}
                      </div>
                      <div style={{ paddingLeft: '24px', fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', marginTop: '2px' }}>
                        Mapped to this site
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
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
                {message.content || (isLoading && message.role === 'assistant') ? (
                  message.role === 'assistant' ? (
                    <MessageParser content={String(message.content)} />
                  ) : (
                    <UserMessageParser content={String(message.content)} />
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
        {/* Loading indicator for tool execution - only show if not already showing in a message */}
        {(() => {
          // Check if we're already showing a typing indicator inside a message
          const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
          const isLastAssistantMessage = lastMessage?.role === 'assistant';
          const hasIndicatorInMessage = isLastAssistantMessage && (
            // Indicator shown when message has content and isToolExecuting
            (lastMessage.content && isToolExecuting && !lastMessage.audioLink) ||
            // Indicator shown when message has no content and (isLoading || isToolExecuting)
            (!lastMessage.content && (isLoading || isToolExecuting))
          );
          
          // Only show separate indicator if isLoading and we're NOT showing one in a message
          return isLoading && !hasIndicatorInMessage;
        })() && (
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

      {/* File chips display */}
      {selectedFiles.length > 0 && (
        <div style={{
          padding: '8px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          borderTop: '1px solid #333333',
          backgroundColor: '#1a1a1a'
        }}>
          {selectedFiles.map((file) => (
            <div
              key={file.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                backgroundColor: '#262626',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#ffffff'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>attach_file</span>
              <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => handleFileRemove(file.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#8e8ea0'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab chips display */}
      {selectedTabs.length > 0 && (
        <div style={{
          padding: '8px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          borderTop: selectedFiles.length > 0 ? '1px solid #333333' : 'none',
          backgroundColor: '#1a1a1a',
          position: 'relative',
          zIndex: 1,
          maxWidth: '100%',
          overflow: 'hidden'
        }}>
          {selectedTabs.map((tab) => (
            <TabChip 
              key={tab.id}
              tab={tab}
              onRemove={() => handleTabRemove(tab.id)}
            />
          ))}
        </div>
      )}

      {/* Screenshot chips display */}
      {(selectedScreenshots.length > 0 || isCapturingScreenshot) && (
        <div style={{
          padding: '8px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          borderTop: (selectedFiles.length > 0 || selectedTabs.length > 0) ? '1px solid #333333' : 'none',
          backgroundColor: '#1a1a1a'
        }}>
          {isCapturingScreenshot && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                backgroundColor: '#262626',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#ffffff'
              }}
            >
              <div style={{
                width: '32px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#1a1a1a',
                borderRadius: '4px',
                flexShrink: 0
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid #60a5fa',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite'
                }} />
              </div>
              <span style={{ fontSize: '12px', color: '#8e8ea0' }}>
                Capturing...
              </span>
            </div>
          )}
          {selectedScreenshots.map((screenshot) => (
            <div
              key={screenshot.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                backgroundColor: '#262626',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease'
              }}
              onClick={() => setPreviewImage({ src: screenshot.dataUrl, type: 'screenshot' })}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2a2a2a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#262626';
              }}
            >
              <img 
                src={screenshot.dataUrl} 
                alt="Screenshot" 
                style={{ 
                  width: '32px', 
                  height: '24px', 
                  objectFit: 'cover',
                  borderRadius: '4px',
                  flexShrink: 0,
                  pointerEvents: 'none'
                }} 
              />
              <span style={{ fontSize: '12px', color: '#8e8ea0' }}>
                Screenshot
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleScreenshotRemove(screenshot.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#8e8ea0'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="input-form" onSubmit={handleSubmit} ref={inputFormRef}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Add files and more button */}
        <div style={{ position: 'relative' }} ref={addFilesMenuRef}>
          <button
            type="button"
            onClick={() => setShowAddFilesMenu(!showAddFilesMenu)}
            className="add-files-button"
            title="Add files and more (Press /)"
            disabled={isLoading || (!settings && !onboardingState?.active)}
          >
            +
          </button>
        </div>

        {/* Dropdown menu */}
          {showAddFilesMenu && (
            <div className="add-files-dropdown" ref={dropdownRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleAddFiles();
                }}
                className="dropdown-menu-item"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>attach_file</span>
                <span>Add photos & files</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleAttachTab();
                }}
                className="dropdown-menu-item"
                disabled={!currentTabInfo}
                style={{ 
                  opacity: currentTabInfo ? 1 : 0.6,
                  flexDirection: 'row',
                  alignItems: currentTabInfo ? 'flex-start' : 'center'
                }}
              >
                <TabFavicon favIconUrl={currentTabInfo?.favIconUrl} size={20} />
                {currentTabInfo ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <div style={{ fontWeight: 500, lineHeight: '1.4' }}>Attach tab</div>
                    <div style={{ fontSize: '12px', color: '#8e8ea0', wordBreak: 'break-word', lineHeight: '1.3' }}>
                      {currentTabInfo.title}
                    </div>
                  </div>
                ) : (
                  <span>Attach tab</span>
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleAttachScreenshot();
                }}
                className="dropdown-menu-item"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>crop_free</span>
                <span>Attach screenshot</span>
              </button>
              <div style={{
                width: '100%',
                height: '1px',
                backgroundColor: '#333333',
                margin: '4px 0'
              }} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setChatMode('create_image');
                  setShowAddFilesMenu(false);
                }}
                className={`dropdown-menu-item ${chatMode === 'create_image' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>image</span>
                <span>Create image</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setChatMode('thinking');
                  setShowAddFilesMenu(false);
                }}
                className={`dropdown-menu-item ${chatMode === 'thinking' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>lightbulb</span>
                <span>Thinking</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setChatMode('deep_research');
                  setShowAddFilesMenu(false);
                }}
                className={`dropdown-menu-item ${chatMode === 'deep_research' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>travel_explore</span>
                <span>Deep research</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setChatMode('study_and_learn');
                  setShowAddFilesMenu(false);
                }}
                className={`dropdown-menu-item ${chatMode === 'study_and_learn' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>menu_book</span>
                <span>Study and learn</span>
              </button>
              <div style={{ position: 'relative' }}>
                <button
                  ref={moreButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setShowMoreMenu(!showMoreMenu);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  className="dropdown-menu-item"
                  style={{
                    backgroundColor: showMoreMenu ? '#2a2a2a' : 'transparent',
                    border: showMoreMenu ? '2px solid #2563eb' : 'none',
                    borderRadius: showMoreMenu ? '4px' : '0',
                    margin: showMoreMenu ? '0' : '0'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>more_horiz</span>
                  <span>More</span>
                  <span style={{ marginLeft: 'auto', fontSize: '12px' }}>▶</span>
                </button>
                
                {/* More submenu - positioned to the right of More button */}
                {showMoreMenu && (
                  <div 
                    ref={moreMenuRef}
                    style={{
                      position: 'absolute',
                      left: '100%',
                      top: 0,
                      marginLeft: '4px',
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px 0',
                      minWidth: '200px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                      zIndex: 10001,
                      display: 'flex',
                      flexDirection: 'column'
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleWebSearch();
                }}
                className={`dropdown-menu-item ${chatMode === 'web_search' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>public</span>
                <span>Web search</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleCanvas();
                }}
                className={`dropdown-menu-item ${chatMode === 'canvas' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>draw</span>
                <span>Canvas</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleBrowserMemory();
                }}
                className={`dropdown-menu-item ${chatMode === 'browser_memory' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>layers</span>
                <span>Browser memory</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            onboardingState?.active 
              ? (onboardingState.step === 'provider' 
                  ? "Type Google, Anthropic, or OpenAI..." 
                  : onboardingState.step === 'apiKey'
                  ? "Paste your GoCode Key..."
                  : "Type your response...")
              : !settings 
              ? "Loading settings..." 
              : chatMode === 'create_image'
              ? "Describe the image you want to create..."
              : chatMode === 'thinking'
              ? "Ask a question for deep thinking..."
              : chatMode === 'deep_research'
              ? "Ask a question for deep research..."
              : chatMode === 'study_and_learn'
              ? "Ask a question to study and learn..."
              : "Ask me anything"
          }
          disabled={isLoading || (!settings && !onboardingState?.active)}
          className="chat-input"
        />

        {/* Voice dictation button */}
        <button
          type="button"
          onClick={handleVoiceRecording}
          className={`voice-button ${isRecording ? 'recording' : ''}`}
          title="Voice dictation"
          disabled={isLoading || (!settings && !onboardingState?.active)}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px', lineHeight: '1' }}>
            {isRecording ? 'mic' : 'mic'}
          </span>
        </button>

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

      {chatMode && (
        <div 
          style={{
            padding: '12px 16px',
            backgroundColor: '#1a1a1a',
            borderTop: '1px solid #333333',
            display: 'block',
            visibility: 'visible',
            opacity: 1,
            width: '100%',
            boxSizing: 'border-box',
            position: 'relative',
            zIndex: 1
          }}
          onMouseEnter={(e) => {
            const closeIcon = e.currentTarget.querySelector('.mode-close-icon') as HTMLElement;
            if (closeIcon) {
              closeIcon.style.display = 'flex';
            }
          }}
          onMouseLeave={(e) => {
            const closeIcon = e.currentTarget.querySelector('.mode-close-icon') as HTMLElement;
            if (closeIcon) {
              closeIcon.style.display = 'none';
            }
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            position: 'relative'
          }}>
            <button
              type="button"
              className="mode-close-icon"
              onClick={(e) => {
                e.stopPropagation();
                setChatMode(null);
              }}
              style={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: '#60a5fa',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '50%',
                width: '20px',
                height: '20px',
                fontSize: '16px',
                lineHeight: '1',
                fontFamily: 'inherit',
                transition: 'background-color 0.15s ease',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(96, 165, 250, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px', lineHeight: '1' }}>close</span>
            </button>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', lineHeight: '1', color: '#60a5fa', flexShrink: 0 }}>
              {chatMode === 'create_image' ? 'image' : 
               chatMode === 'thinking' ? 'lightbulb' : 
               chatMode === 'deep_research' ? 'travel_explore' : 
               chatMode === 'study_and_learn' ? 'menu_book' :
               chatMode === 'web_search' ? 'public' :
               chatMode === 'canvas' ? 'draw' :
               'layers'}
            </span>
            <span style={{ lineHeight: '1', color: '#60a5fa', fontSize: '14px' }}>
              {chatMode === 'create_image' ? 'Create image' : 
               chatMode === 'thinking' ? 'Thinking' : 
               chatMode === 'deep_research' ? 'Deep research' : 
               chatMode === 'study_and_learn' ? 'Study and learn' :
               chatMode === 'web_search' ? 'Web search' :
               chatMode === 'canvas' ? 'Canvas' :
               'Browser memory'}
            </span>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            cursor: 'pointer'
          }}
          onClick={() => setPreviewImage(null)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.src}
              alt="Preview"
              style={{
                maxWidth: '100%',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '8px'
              }}
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '32px',
                padding: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                transition: 'background-color 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<ChatSidebar />);

