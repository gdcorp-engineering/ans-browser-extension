import { ipcMain } from 'electron';
import { BrowserManager } from './browser-manager';
import type Store from 'electron-store';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { stepCountIs, streamText, ToolSet } from 'ai';
import { google } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { ComputerUseService } from './computer-use-service';
import { randomUUID } from 'crypto';

// Store for MCP state in main process
interface MCPState {
  sessionId?: string;
  mcpUrl?: string;
  tools?: Record<string, Record<string, unknown>>;
}

const mcpState: MCPState = {};

/**
 * Create browser automation tools for AI SDK
 */
function createBrowserTools(browserManager: BrowserManager): ToolSet {
  // Helper to ensure browser view is available
  const ensureBrowserView = () => {
    const browserView = browserManager.getBrowserView();
    if (!browserView) {
      browserManager.showBrowserView();
    }
  };

  return {
    navigate: {
      description: 'Navigate to a specific URL',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to navigate to (must include http:// or https://)',
          },
        },
        required: ['url'],
      },
      execute: async ({ url }: { url: string }) => {
        try {
          ensureBrowserView();
          await browserManager.navigateToUrl(url);
          return { success: true, url: browserManager.getCurrentUrl() };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    getPageContext: {
      description: 'Get page info. Call first to understand page structure.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          ensureBrowserView();
          const context = await browserManager.getPageContext();
          return { success: true, ...context };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    clickElement: {
      description: 'Click an element using CSS selector or text content. PREFERRED method.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element',
          },
          text: {
            type: 'string',
            description: 'Alternative: text content to search for',
          },
        },
      },
      execute: async ({ selector, text }: { selector?: string; text?: string }) => {
        try {
          ensureBrowserView();
          const result = await browserManager.clickElement(selector, text);
          return result;
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    click: {
      description: 'Click at coordinates. Last resort only.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
        },
        required: ['x', 'y'],
      },
      execute: async ({ x, y }: { x: number; y: number }) => {
        try {
          ensureBrowserView();
          const result = await browserManager.clickAt(x, y);
          return result;
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    type: {
      description: 'Type text into input field',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
          selector: { type: 'string', description: 'CSS selector for input' },
        },
        required: ['text'],
      },
      execute: async ({ text, selector }: { text: string; selector?: string }) => {
        try {
          ensureBrowserView();
          const result = await browserManager.typeTextIntoField(text, selector);
          return result;
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    scroll: {
      description: 'Scroll the page',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'Scroll direction',
          },
          amount: { type: 'number', description: 'Pixels to scroll (default: 500)' },
        },
        required: ['direction'],
      },
      execute: async ({ direction, amount = 500 }: { direction: 'up' | 'down'; amount?: number }) => {
        try {
          ensureBrowserView();
          await browserManager.scrollPage(direction, amount);
          return { success: true };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    screenshot: {
      description: 'Take screenshot. Last resort if DOM fails.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          ensureBrowserView();
          const screenshot = await browserManager.captureScreenshot();
          return { success: true, screenshot };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
    pressKey: {
      description: 'Press key (Enter, Tab, Escape, etc)',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Key name',
          },
        },
        required: ['key'],
      },
      execute: async ({ key }: { key: string }) => {
        try {
          ensureBrowserView();
          const result = await browserManager.pressKey(key);
          return result;
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
    },
  };
}

/**
 * Stream chat with AI providers (Google, Anthropic, OpenAI) and Composio tools
 * Runs in main process with Composio MCP tools integration
 * WARNING: Never store API keys in process.env - they can leak to child processes
 */
async function streamChatWithToolsIpc(
  userInput: string,
  conversationHistory: Array<{ role: string; content: string }>,
  modelName: string,
  apiKey: string,
  provider: string = 'google',
  baseUrl: string | undefined,
  tools: ToolSet | undefined,
  onChunk: (chunk: string) => void
): Promise<void> {
  // Build messages - filter out empty content
  const validHistory = conversationHistory.filter(msg => msg.content && msg.content.trim());
  const messages = [
    ...validHistory,
    {
      role: 'user' as const,
      content: userInput,
    },
  ];

  // Select appropriate model based on provider
  let model: any;
  let originalApiKey: string | undefined;
  let envVarName: string;

  switch (provider) {
    case 'anthropic':
      envVarName = 'ANTHROPIC_API_KEY';
      originalApiKey = process.env.ANTHROPIC_API_KEY;

      // Set API key
      process.env.ANTHROPIC_API_KEY = apiKey;

      // Create Anthropic provider with custom baseURL
      if (baseUrl) {
        // GoCode implements Anthropic API at /v1/messages, but AI SDK expects /messages
        // So we need to append /v1 to the base URL
        const anthropicBaseUrl = baseUrl.endsWith('/') ? `${baseUrl}v1` : `${baseUrl}/v1`;
        const anthropicProvider = createAnthropic({
          apiKey: apiKey,
          baseURL: anthropicBaseUrl
        });
        model = anthropicProvider(modelName);
      } else {
        const anthropicProvider = createAnthropic({ apiKey: apiKey });
        model = anthropicProvider(modelName);
      }
      break;

    case 'openai':
      envVarName = 'OPENAI_API_KEY';
      originalApiKey = process.env.OPENAI_API_KEY;

      // Set API key
      process.env.OPENAI_API_KEY = apiKey;

      // Create OpenAI provider with custom baseURL
      if (baseUrl) {
        const openaiProvider = createOpenAI({
          apiKey: apiKey,
          baseURL: baseUrl
        });
        model = openaiProvider(modelName);
      } else {
        const openaiProvider = createOpenAI({ apiKey: apiKey });
        model = openaiProvider(modelName);
      }
      break;

    case 'google':
    default:
      envVarName = 'GOOGLE_GENERATIVE_AI_API_KEY';
      originalApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

      // Set API key
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;

      // Google SDK uses baseURL parameter directly
      model = google(modelName, baseUrl ? { baseURL: baseUrl } : undefined);
      break;
  }

  // Create system prompt that includes browser tool instructions
  const browserToolsSystemPrompt = tools && Object.keys(tools).some(key => 
    ['navigate', 'getPageContext', 'clickElement', 'click', 'type', 'scroll', 'screenshot', 'pressKey'].includes(key)
  ) ? `You are GoDaddy ANS Desktop - a helpful AI assistant with browser automation capabilities.

## Browser Automation Tools

You have access to browser automation tools that allow you to interact with web pages:

**Available Browser Tools:**
- \`getPageContext\`: Get comprehensive page information including text content, links, forms, and interactive elements. ALWAYS use this first when asked to summarize, analyze, or understand a webpage.
- \`navigate\`: Navigate to a specific URL
- \`clickElement\`: Click elements by CSS selector or text content (preferred method)
- \`click\`: Click at coordinates (last resort)
- \`type\`: Type text into input fields
- \`scroll\`: Scroll the page up or down
- \`screenshot\`: Take a screenshot of the current page
- \`pressKey\`: Press keyboard keys (Enter, Tab, Escape, etc.)

## Important Guidelines for Webpage Tasks

**When asked to summarize a webpage:**
1. First, call \`getPageContext\` to get the page structure and content
2. The tool returns: url, title, textContent, links, images, forms, interactiveElements, metadata, and viewport info
3. Use the \`textContent\` field which contains the main text content of the page (up to 10,000 characters)
4. Use the \`metadata.description\` if available for a quick summary
5. Analyze the content and provide a comprehensive summary to the user

**When asked to interact with a webpage:**
1. First call \`getPageContext\` to understand the page structure
2. Identify the elements you need to interact with from the \`interactiveElements\` array
3. Use \`clickElement\` with selector or text to click elements
4. Use \`type\` to fill in input fields
5. Verify actions by calling \`getPageContext\` again or taking a \`screenshot\`

**Best Practices:**
- Always call \`getPageContext\` first to understand the page before taking actions
- Prefer \`clickElement\` over \`click\` (coordinates) for reliability
- For summarization tasks, \`getPageContext\` provides all the text content you need
- The \`textContent\` field contains the main readable content of the page

Remember: When summarizing webpages, you MUST use \`getPageContext\` to retrieve the page content first.` : undefined;

  try {
    const result = streamText({
      model,
      messages: browserToolsSystemPrompt ? [
        { role: 'system', content: browserToolsSystemPrompt },
        ...messages
      ] as any : messages as any,
      tools: tools,
      stopWhen: stepCountIs(20),
    });

    // Process stream
    for await (const chunk of result.fullStream) {
      const chunkObj = chunk as Record<string, unknown>;

      switch (chunkObj.type) {
        case 'text-delta':
          if ('delta' in chunkObj) {
            onChunk(JSON.stringify({ type: 'text', data: chunkObj.delta }));
          } else if ('text' in chunkObj) {
            onChunk(JSON.stringify({ type: 'text', data: chunkObj.text }));
          }
          break;

        case 'tool-call':
          if ('toolName' in chunkObj) {
            onChunk(JSON.stringify({
              type: 'tool-call',
              toolName: chunkObj.toolName,
              args: 'args' in chunkObj ? chunkObj.args : undefined
            }));
          }
          break;

        case 'tool-result':
          if ('result' in chunkObj || 'output' in chunkObj) {
            onChunk(JSON.stringify({
              type: 'tool-result',
              toolName: 'toolName' in chunkObj ? chunkObj.toolName : undefined,
              data: ('result' in chunkObj) ? chunkObj.result : chunkObj.output
            }));
          }
          break;

        case 'error':
          onChunk(JSON.stringify({ type: 'error', error: chunkObj.error }));
          break;

        case 'start':
        case 'finish':
          // Lifecycle events
          break;
      }
    }
  } finally {
    // SECURITY: Always restore original API key env var to prevent leakage
    if (originalApiKey) {
      process.env[envVarName] = originalApiKey;
    } else {
      delete process.env[envVarName];
    }
  }
}

/**
 * Initialize Composio Tool Router session and MCP client in the main process
 */
async function initializeComposioMCP(apiKey: string): Promise<{
  sessionId: string;
  tools: Record<string, any>;
  toolCount: number;
}> {
  try {
    // Create Composio session
    const userId = `atlas-${randomUUID()}`;
    const sessionResponse = await fetch(
      'https://backend.composio.dev/api/v3/labs/tool_router/session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          user_id: userId,
        }),
      }
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(
        `Failed to create Composio session: ${sessionResponse.status} ${errorText}`
      );
    }

    const sessionData = await sessionResponse.json();
    const mcpUrl = sessionData.tool_router_instance_mcp_url;
    const sessionId = sessionData.session_id;

    // Create MCP client
    const mcpClient = await experimental_createMCPClient({
      transport: {
        type: 'http',
        url: mcpUrl,
      },
    });

    // Fetch tools from MCP server
    const tools = await mcpClient.tools();

    // Store in state
    mcpState.sessionId = sessionId;
    mcpState.mcpUrl = mcpUrl;
    mcpState.tools = tools;

    return {
      sessionId,
      tools,
      toolCount: Object.keys(tools).length,
    };
  } catch (error) {
    throw error;
  }
}

export function setupIpcHandlers(browserManager: BrowserManager, store: Store) {
  // Settings management
  ipcMain.handle('get-setting', async (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('set-setting', async (_event, key: string, value: any) => {
    store.set(key, value);
    return { success: true };
  });

  ipcMain.handle('get-all-settings', async () => {
    return store.store;
  });

  // Browser mode toggle
  ipcMain.handle('show-browser-view', async (_event, chatWidthPercent?: number) => {
    browserManager.showBrowserView(chatWidthPercent || 40);
    return { success: true };
  });

  ipcMain.handle('hide-browser-view', async () => {
    browserManager.hideBrowserView();
    return { success: true };
  });

  // Resize browser view based on chat width
  ipcMain.handle('resize-browser-view', async (_event, chatWidthPercent: number) => {
    try {
      browserManager.resizeBrowserView(chatWidthPercent);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Browser navigation - back
  ipcMain.handle('browser-back', async () => {
    try {
      const success = browserManager.goBack();
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Browser navigation - forward
  ipcMain.handle('browser-forward', async () => {
    try {
      const success = browserManager.goForward();
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Check browser navigation state
  ipcMain.handle('get-browser-nav-state', async () => {
    try {
      return {
        success: true,
        canGoBack: browserManager.canGoBack(),
        canGoForward: browserManager.canGoForward(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Browser automation
  ipcMain.handle('navigate-to-url', async (_event, url: string) => {
    try {
      await browserManager.navigateToUrl(url);
      return { success: true, url: browserManager.getCurrentUrl() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('capture-screenshot', async () => {
    try {
      const screenshot = await browserManager.captureScreenshot();
      return { success: true, screenshot };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('click-at', async (_event, x: number, y: number) => {
    try {
      const result = await browserManager.clickAt(x, y);
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('type-text', async (_event, text: string) => {
    try {
      await browserManager.typeText(text);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('scroll-page', async (_event, direction: 'up' | 'down', amount?: number) => {
    try {
      await browserManager.scrollPage(direction, amount);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-current-url', async () => {
    return {
      url: browserManager.getCurrentUrl(),
      title: browserManager.getPageTitle(),
    };
  });

  ipcMain.handle('execute-script', async (_event, script: string) => {
    try {
      const result = await browserManager.executeScript(script);
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Browser automation tools (for chat mode)
  ipcMain.handle('get-page-context', async () => {
    try {
      const context = await browserManager.getPageContext();
      return { success: true, context };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('click-element', async (_event, selector?: string, text?: string) => {
    try {
      const result = await browserManager.clickElement(selector, text);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('press-key', async (_event, key: string) => {
    try {
      const result = await browserManager.pressKey(key);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('type-text-into-field', async (_event, text: string, selector?: string) => {
    try {
      const result = await browserManager.typeTextIntoField(text, selector);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Composio MCP handlers
  ipcMain.handle('initialize-mcp', async (_event, apiKey: string) => {
    try {
      const result = await initializeComposioMCP(apiKey);
      return {
        success: true,
        sessionId: result.sessionId,
        toolCount: result.toolCount,
      };
    } catch (error: any) {
      console.error('[Main] IPC initialize-mcp error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  ipcMain.handle('get-mcp-tools', async () => {
    try {
      if (!mcpState.tools) {
        throw new Error('MCP tools not initialized. Call initialize-mcp first.');
      }
      // Return tools as-is (they're used by streamText in main process, not for IPC)
      return {
        success: true,
        tools: mcpState.tools,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Stream chat with tools (using events for true streaming)
  ipcMain.on(
    'stream-chat-with-tools',
    async (event, userInput: string, conversationHistory: Array<{ role: string; content: string }>, model: string, apiKey: string, provider: string = 'google', baseUrl?: string) => {
      const streamId = event.sender.id;
      const streamState = { active: true };
      activeStreams.set(streamId, streamState);

      try {
        // Get tools from mcpState (don't pass through IPC - they're non-serializable)
        const mcpTools = mcpState.tools as ToolSet | undefined;
        
        // Create browser tools
        const browserTools = createBrowserTools(browserManager);
        
        // Merge browser tools with MCP tools
        const tools: ToolSet = {
          ...browserTools,
          ...(mcpTools || {}),
        };

        await streamChatWithToolsIpc(
          userInput,
          conversationHistory,
          model,
          apiKey,
          provider,
          baseUrl,
          tools,
          (chunk) => {
            // Check if stream was aborted
            if (!streamState.active) {
              return;
            }
            // Send each chunk as an event back to renderer
            event.sender.send('stream-chunk', chunk);
          }
        );

        // Only signal completion if stream wasn't aborted
        if (streamState.active) {
          event.sender.send('stream-complete');
        }
      } catch (error: any) {
        // Don't send error if stream was aborted
        if (streamState.active) {
          console.error('[Main] Error in stream-chat-with-tools:', error);
          event.sender.send('stream-error', error.message);
        }
      } finally {
        activeStreams.delete(streamId);
      }
    }
  );

  // SECURITY: Whitelist of allowed environment variables that can be set
  // This prevents the renderer from modifying sensitive environment variables
  const ALLOWED_ENV_VARS = new Set([
    'NODE_ENV',
    'DEBUG',
    'LOG_LEVEL',
    // Add other safe variables here as needed
  ]);

  // Set environment variables (restricted to whitelist)
  ipcMain.handle('set-environment-variable', async (_event, key: string, value: string) => {
    try {
      // SECURITY: Only allow whitelisted environment variables
      if (!ALLOWED_ENV_VARS.has(key)) {
        return { success: false, error: `Environment variable '${key}' is not allowed` };
      }

      process.env[key] = value;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Store active streams (both computer use and chat) so we can abort them
  const activeStreams = new Map<number, { active: boolean }>();

  // Stream with Computer Use (Gemini or Anthropic)
  ipcMain.on(
    'stream-computer-use',
    async (
      event,
      userMessage: string,
      messageHistory: Array<{ role: string; content: string }>,
      apiKey: string,
      provider: string = 'google',
      model: string = 'gemini-2.5-computer-use-preview-10-2025',
      baseUrl?: string
    ) => {
      const streamId = event.sender.id;
      const streamState = { active: true };
      activeStreams.set(streamId, streamState);

      try {
        // ComputerUseService is ONLY for Gemini, not Anthropic
        if (provider === 'anthropic') {
          event.sender.send('stream-error', 'ComputerUseService is only for Gemini. Use browser tools for Anthropic.');
          return;
        }

        const browserView = browserManager.getBrowserView();
        if (!browserView) {
          event.sender.send('stream-error', 'Browser view not available');
          return;
        }

        const computerUseService = new ComputerUseService(browserView, apiKey, provider, model, baseUrl);

        for await (const chunk of computerUseService.streamWithComputerUse(
          userMessage,
          messageHistory
        )) {
          // Check if stream was aborted
          if (!streamState.active) {
            break;
          }

          event.sender.send('stream-chunk', JSON.stringify(chunk));
        }

        // Only send complete if stream wasn't aborted
        if (streamState.active) {
          event.sender.send('stream-complete');
        }
      } catch (error: any) {
        // Don't send error if stream was aborted
        if (streamState.active) {
          event.sender.send('stream-error', error.message);
        }
      } finally {
        activeStreams.delete(streamId);
      }
    }
  );

  // Stop computer use stream
  ipcMain.handle('stop-computer-use', async (_event) => {
    const streamId = _event.sender.id;
    const streamState = activeStreams.get(streamId);
    if (streamState) {
      streamState.active = false;
      return { success: true };
    }
    return { success: false, error: 'No active stream' };
  });
}
