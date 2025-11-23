import type { Message } from './types';

// Browser tool definitions for Anthropic API
const BROWSER_TOOLS = [
  {
    name: 'navigate',
    description: 'Navigate to a specific URL',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to (must include http:// or https://)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'clickElement',
    description: 'Click an element using CSS selector or text content. PREFERRED method.',
    input_schema: {
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
  },
  {
    name: 'click',
    description: 'Click at coordinates. Last resort only.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'type',
    description: 'Type text into input field',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        selector: { type: 'string', description: 'CSS selector for input' },
      },
      required: ['text'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page',
    input_schema: {
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
  },
  {
    name: 'getPageContext',
    description: 'Get page info. Call first.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'screenshot',
    description: 'Take screenshot. Last resort if DOM fails.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pressKey',
    description: 'Press key (Enter, Tab, Escape, etc)',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key name',
        },
      },
      required: ['key'],
    },
  },
];

export async function streamAnthropicWithBrowserTools(
  messages: Message[],
  apiKey: string,
  model: string,
  customBaseUrl: string | undefined,
  onTextChunk: (text: string) => void,
  onComplete: () => void,
  executeTool: (toolName: string, params: any) => Promise<any>,
  signal?: AbortSignal,
  additionalTools?: any[], // Custom MCP tools
  currentUrl?: string, // Current page URL for matching site instructions
  siteInstructions?: string // Matched site-specific instructions
): Promise<void> {
  const baseUrl = customBaseUrl || 'https://api.anthropic.com';

  // Keep only the most recent messages to avoid context length issues
  // Page context can be large, and tool use adds more messages during the loop
  // So we need to be very aggressive with history trimming
  const MAX_HISTORY_MESSAGES = 1; // Keep only the immediate last message
  let conversationMessages = messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : [...messages];

  let fullResponseText = '';

  // Merge browser tools with additional tools (MCP)
  console.log('🔧 Browser tools count:', BROWSER_TOOLS.length);
  console.log('🔧 Additional tools (MCP/A2A) count:', additionalTools?.length || 0);

  const hasAdditionalTools = !!(additionalTools && additionalTools.length > 0);
  const mcpToolNames = (additionalTools || [])
    .filter((tool: any) => tool?.name && !tool.name.startsWith('a2a_'))
    .map((tool: any) => tool.name);
  const a2aToolNames = (additionalTools || [])
    .filter((tool: any) => tool?.name && tool.name.startsWith('a2a_'))
    .map((tool: any) => tool.name);
  const mcpToolNameSet = new Set(mcpToolNames);
  const a2aToolNameSet = new Set(a2aToolNames);
  const allTools = hasAdditionalTools
    ? [...additionalTools, ...BROWSER_TOOLS] // Surface MCP/A2A tools first
    : BROWSER_TOOLS;

  console.log('🔧 Total merged tools:', allTools.length);
  console.log('🔧 All tool names:', allTools.map((t: any) => t.name).join(', '));
  console.log('🔧 Starting with', conversationMessages.length, 'messages (limited from', messages.length, ')');

  const MAX_TURNS = 10; // Prevent infinite loops
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    console.log('🔧 Anthropic Browser Tools - Turn', turnCount);
    console.log('📤 Sending request with tools:', allTools.map((t: any) => t.name));

    const mcpPrioritySection = hasAdditionalTools ? `
🔴 CRITICAL - MCP / TRUSTED AGENT PRIORITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have specialized MCP or trusted agent tools available.
THESE MUST BE YOUR FIRST CHOICE - not browser automation!

BEFORE using browser tools:
1. Check if ANY MCP/A2A tool can handle the request
2. If yes → USE IT IMMEDIATELY (do not use browser tools)
3. If no → Explain why, then proceed with browser automation

Examples:
- "Find domains" → Use MCP domain search tool (NOT manual navigation)
- "Check email" → Use MCP email tool (NOT manual login)
- "Create issue" → Use MCP GitHub tool (NOT manual clicking)

Only use browser automation when:
- No MCP tool exists for the task
- MCP tool output needs visual verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

    const siteInstructionsSection = siteInstructions ? `
📍 SITE-SPECIFIC INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current URL: ${currentUrl}

Follow these site-specific instructions when interacting with this site:

${siteInstructions}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : '';

    const requestBody = {
      model,
      max_tokens: 4096,
      tools: allTools,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: `You are a helpful AI assistant with browser automation capabilities. You can navigate to websites, click elements, type text, scroll pages, and take screenshots.

${mcpPrioritySection}
${siteInstructionsSection}

IMPORTANT: When typing in search inputs, Enter is AUTOMATICALLY pressed - you only need to call type().

ALWAYS PREFER DOM-BASED METHODS OVER SCREENSHOTS

BROWSER AUTOMATION WORKFLOW (when no MCP tool applies):

1. **First, get page context**: Call getPageContext to see the page structure, interactive elements, and their selectors

2. **Use DOM methods (PREFERRED)**:
   - Use clickElement with CSS selectors or text content
   - Use type with selectors to focus and type into inputs
   - For search inputs: Enter is automatically pressed after typing
   - For forms with submit buttons: Use clickElement to click the submit button OR type will auto-submit if it's a search field
   - These methods are more reliable and efficient than coordinates

3. **Only use screenshots as LAST RESORT**:
   - If clickElement cannot find the element by selector or text
   - If you need to understand visual layout
   - Then take screenshot and use coordinate-based click

SEARCH BOX WORKFLOW:
Simply: type({selector:"input[type=search]", text:"your search text"})
That's it! Enter is pressed automatically for search inputs.

DOM METHOD EXAMPLES:
- Search: type({selector:"input[type=search]", text:"query"}) - Enter pressed automatically
- Click button: clickElement({text:"Search"}) or clickElement({selector:"button[type=submit]"})
- Sign in link: clickElement({text:"Sign In"}) or clickElement({selector:"a[href*=signin]"})

COORDINATE CLICKING (last resort only):
- If DOM methods fail, take a screenshot first
- Measure coordinates from top-left (0,0)
- Click the CENTER of elements
- Viewport dimensions tell you the bounds

When the user asks you to interact with a page, follow this workflow carefully. Always try DOM methods first!`,
    };

    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    };

    // Only add signal if it's a valid AbortSignal instance
    if (signal && signal instanceof AbortSignal) {
      fetchOptions.signal = signal;
    }

    const response = await fetch(`${baseUrl}/v1/messages`, fetchOptions);

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ API Error:', error);

      // Check if it's a context length error
      const errorMsg = error.error?.message || '';
      if (errorMsg.includes('too long') || errorMsg.includes('Input is too long')) {
        throw new Error('Context limit exceeded. Please start a new chat to continue.');
      }

      throw new Error(errorMsg || 'Anthropic API request failed');
    }

    const data = await response.json();
    console.log('📥 Response:', JSON.stringify(data, null, 2));

    // Check if response includes text
    const textContent = data.content?.find((c: any) => c.type === 'text');
    if (textContent?.text) {
      fullResponseText += textContent.text;
      onTextChunk(textContent.text);
    }

    // Check for tool use
    const toolUses = data.content?.filter((c: any) => c.type === 'tool_use') || [];

    if (toolUses.length === 0) {
      // No more tools to execute, we're done
      break;
    }

    // Execute tools and collect results
    const toolResults: any[] = [];

    for (const toolUse of toolUses) {
      console.log(`🔧 Executing tool: ${toolUse.name}`, toolUse.input);
      const isMcpToolUse = mcpToolNameSet.has(toolUse.name);
      const isA2AToolUse = a2aToolNameSet.has(toolUse.name);
      const toolTypeTags: string[] = [];
      if (isMcpToolUse) toolTypeTags.push('MCP tool');
      if (isA2AToolUse) toolTypeTags.push('A2A tool');
      const executingHeader = toolTypeTags.length
        ? `[Executing: ${toolUse.name}] (${toolTypeTags.join(' & ')})`
        : `[Executing: ${toolUse.name}]`;
      onTextChunk(`\n${executingHeader}\n`);
      if (toolTypeTags.length) {
        const availabilityParts: string[] = [];
        if (mcpToolNames.length) {
          availabilityParts.push(`MCP available: ${mcpToolNames.join(', ')}`);
        }
        if (a2aToolNames.length) {
          availabilityParts.push(`A2A available: ${a2aToolNames.join(', ')}`);
        }
        if (availabilityParts.length) {
          onTextChunk(`${availabilityParts.join(' | ')}\n`);
        }
      }
      onTextChunk(`${JSON.stringify(toolUse.input)}\n`);

      try {
        console.log('🔧 Calling executeTool with:', toolUse.name, toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input);
        console.log('✅ Tool result:', result);

        // Handle screenshot results differently - include image data
        if (toolUse.name === 'screenshot' && result.success && result.screenshot) {
          // Extract base64 data from data URL
          const base64Data = result.screenshot.split(',')[1];
          const viewport = result.viewport || { width: 1280, height: 800, devicePixelRatio: 1 };
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: `Screenshot: ${viewport.width}×${viewport.height}px. Top-left=(0,0), Bottom-right=(${viewport.width},${viewport.height})`,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: base64Data,
                },
              },
            ],
          });
        } else {
          // Regular tool result
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }

        // Small delay between actions
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error('❌ Tool execution error:', error);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: error.message }),
          is_error: true,
        });
      }
    }

    // Add assistant message with tool uses
    conversationMessages.push({
      id: Date.now().toString(),
      role: 'assistant',
      content: data.content, // Keep as array, don't stringify
    } as any);

    // Add user message with tool results
    conversationMessages.push({
      id: (Date.now() + 1).toString(),
      role: 'user',
      content: toolResults, // Keep as array, don't stringify
    } as any);

    // Trim conversation to prevent context overflow during the loop
    // Keep only the most recent messages to avoid hitting limits
    const MAX_LOOP_MESSAGES = 4; // Aggressive trimming - page context is large
    if (conversationMessages.length > MAX_LOOP_MESSAGES) {
      console.log(`⚠️  Trimming conversation from ${conversationMessages.length} to ${MAX_LOOP_MESSAGES} messages`);
      conversationMessages = conversationMessages.slice(-MAX_LOOP_MESSAGES);
    }

    // If the response has a stop_reason of 'end_turn', we're done
    if (data.stop_reason === 'end_turn') {
      break;
    }
  }

  onComplete();
}
