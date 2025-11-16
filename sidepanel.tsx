import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Settings, MCPClient, Message } from './types';
import { GeminiResponseSchema } from './types';
import { experimental_createMCPClient, stepCountIs } from 'ai';
import { streamAnthropic } from './anthropic-service';
import { streamAnthropicWithBrowserTools } from './anthropic-browser-tools';
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

// Component to parse and display assistant messages with better formatting
const MessageParser = ({ content }: { content: string }) => {
  // Split message into logical sections - only on strong breaks (double newlines or numbered/bulleted lists)
  const sections = content
    .split(/\n+/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  // If only one section or very short content, just return as-is
  if (sections.length <= 1 || content.length < 150) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent as any }}>
        {content}
      </ReactMarkdown>
    );
  }

  // Display each section separately
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {sections.map((section, idx) => (
        <div
          key={idx}
          style={{
            padding: '10px 12px',
            backgroundColor: '#2d2d2d',
            borderLeft: '3px solid #4d4d4d',
            borderRadius: '4px',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkComponent as any }}>
            {section}
          </ReactMarkdown>
        </div>
      ))}
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
  const [trustedAgentOptIn, setTrustedAgentOptIn] = useState(true); // User opt-in for trusted agents
  const [currentSiteAgent, setCurrentSiteAgent] = useState<{ serverId: string; serverName: string } | null>(null);
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

  // Get current tab ID and load its messages
  useEffect(() => {
    const getCurrentTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        console.log('📍 Current tab ID:', tab.id);
        setCurrentTabId(tab.id);

        // Load messages for this tab
        if (tabMessagesRef.current[tab.id]) {
          setMessages(tabMessagesRef.current[tab.id]);
        } else {
          setMessages([]);
        }

        // Check for trusted agent on this site
        checkForTrustedAgent();
      }
    };

    getCurrentTab();

    // Listen for tab switches
    const handleTabChange = (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('📍 Tab switched to:', activeInfo.tabId);

      // Save current tab's messages before switching (use refs to get current values)
      const currentId = currentTabIdRef.current;
      if (currentId !== null) {
        tabMessagesRef.current[currentId] = messagesRef.current;
      }

      // Load new tab's messages
      setCurrentTabId(activeInfo.tabId);
      if (tabMessagesRef.current[activeInfo.tabId]) {
        setMessages(tabMessagesRef.current[activeInfo.tabId]);
      } else {
        setMessages([]);
      }

      // Check for trusted agent on new tab
      checkForTrustedAgent();
    };

    chrome.tabs.onActivated.addListener(handleTabChange);

    // Listen for URL changes within the current tab (e.g., navigation via browser tools)
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Only react to URL changes on the current tab
      if (changeInfo.url && tabId === currentTabIdRef.current) {
        console.log('📍 Tab URL changed to:', changeInfo.url);
        // Check for trusted agent on the new URL
        checkForTrustedAgent();
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

  // Save messages whenever they change
  useEffect(() => {
    if (currentTabId !== null && messages.length > 0) {
      console.log(`💾 Saving ${messages.length} messages for tab ${currentTabId}`);
      tabMessagesRef.current[currentTabId] = messages;
    }
  }, [messages, currentTabId]);

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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const newChat = async () => {
    // Clear messages for current tab
    setMessages([]);
    setInput('');
    setShowBrowserToolsWarning(false);

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

            // Execute the browser action
            const result = await executeBrowserAction(funcName, funcArgs);
            
            // Wait longer after navigation actions for page to load
            const isNavigationAction = ['navigate', 'open_web_browser', 'navigate_to', 'go_to', 'click', 'click_at', 'mouse_click', 'go_back', 'back', 'go_forward', 'forward'].includes(funcName);
            if (isNavigationAction) {
              await new Promise(resolve => setTimeout(resolve, 2500)); // Wait 2.5 seconds for page to load
            } else {
              await new Promise(resolve => setTimeout(resolve, 500)); // Normal wait
            }
            
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !settings) return;

    // Get page context to include with the message
    let pageContext = '';
    try {
      const context: any = await executeTool('getPageContext', {});
      if (context && context.url && context.title) {
        // Reduce page context size in browser tools mode to avoid hitting context limits
        const maxContentLength = browserToolsEnabled ? 800 : 3000;
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

    abortControllerRef.current = new AbortController();

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
          const response = await a2aService.sendMessage(currentSiteAgent.serverId, input);

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
        return; // Exit early - message handled by A2A agent
      }

      // BROWSER TOOLS MODE
      if (browserToolsEnabled) {
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

            // Execute browser tool
            return await executeTool(toolName, params);
          };

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
              // Force scroll on each chunk
              messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            },
            () => {
              // On complete
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
                // On complete
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

            await streamAnthropic(
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
              undefined // Don't pass abort signal for now - causes issues
            );
          }
        } else if (settings.provider === 'google') {
          await streamGoogle(newMessages, abortControllerRef.current.signal);
        } else {
          throw new Error(`Provider ${settings.provider} not yet implemented`);
        }
      }

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
      setIsLoading(false);
    }
  };

  // Check if user is scrolled to bottom
  const isAtBottom = () => {
    if (!messagesContainerRef.current) return true;
    const container = messagesContainerRef.current;
    const threshold = 100; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  };

  // Handle scroll detection
  const handleScroll = () => {
    setIsUserScrolled(!isAtBottom());
  };

  // Auto-scroll to bottom when messages change (unless user scrolled up)
  useEffect(() => {
    if (!isUserScrolled || isLoading) {
      // Use instant scroll during loading for better UX
      messagesEndRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' });
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

      {/* Trusted Agent Badge */}
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

      <div className="messages-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h2>How can I help you today?</h2>
            <p>I'm GoDaddy ANS, your AI assistant. I can help you browse the web, analyze content, and perform various tasks.</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.role}`}
            >
              <div className="message-content">
                {message.content ? (
                  message.role === 'assistant' ? (
                    <MessageParser content={message.content} />
                  ) : (
                    message.content
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
      <div ref={messagesEndRef} />
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<ChatSidebar />);
