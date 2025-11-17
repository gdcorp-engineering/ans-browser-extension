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
    description: 'Click an element using a CSS selector or text content. This is the PREFERRED method - use this instead of coordinate-based clicking whenever possible.',
    input_schema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click (e.g., "button.submit", "#search-btn", "input[type=submit]")',
        },
        text: {
          type: 'string',
          description: 'Alternative: text content to search for (e.g., "Search", "Sign In"). Will click the first matching element.',
        },
      },
    },
  },
  {
    name: 'click',
    description: 'Click at specific coordinates on the page. ONLY use this as a last resort when clickElement cannot find the element.',
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
    description: 'Type text into an input field. If selector is provided, will focus that element first.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        selector: { type: 'string', description: 'CSS selector for the input (e.g., "input[name=search]", "#email")' },
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
    description: 'Get information about the current page including URL, title, content, and interactive elements. ALWAYS call this first to understand what elements are available.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current page. Only use this if DOM-based methods fail or you need to see visual layout.',
    input_schema: {
      type: 'object',
      properties: {},
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
  additionalTools?: any[] // Custom MCP tools
): Promise<void> {
  const baseUrl = customBaseUrl || 'https://api.anthropic.com';

  // Keep only the most recent messages to avoid context length issues
  // Page context can be large, and tool use adds more messages during the loop
  // So we need to be very aggressive with history trimming
  const MAX_HISTORY_MESSAGES = 2; // Reduced from 4 to 2 - only keep last user message
  let conversationMessages = messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : [...messages];

  let fullResponseText = '';

  // Merge browser tools with additional tools (MCP)
  console.log('🔧 Browser tools count:', BROWSER_TOOLS.length);
  console.log('🔧 Additional tools (MCP) count:', additionalTools?.length || 0);

  const allTools = additionalTools ? [...BROWSER_TOOLS, ...additionalTools] : BROWSER_TOOLS;

  console.log('🔧 Total merged tools:', allTools.length);
  console.log('🔧 All tool names:', allTools.map((t: any) => t.name).join(', '));
  console.log('🔧 Starting with', conversationMessages.length, 'messages (limited from', messages.length, ')');

  const MAX_TURNS = 10; // Prevent infinite loops
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    console.log('🔧 Anthropic Browser Tools - Turn', turnCount);
    console.log('📤 Sending request with tools:', allTools.map((t: any) => t.name));

    const requestBody = {
      model,
      max_tokens: 4096,
      tools: allTools,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: `You are a helpful AI assistant with browser automation capabilities. You can navigate to websites, click elements, type text, scroll pages, and take screenshots.

CRITICAL: ALWAYS PREFER DOM-BASED METHODS OVER SCREENSHOTS

INTERACTION WORKFLOW (Follow this order):

1. **First, get page context**: Call getPageContext to see the page structure, interactive elements, and their selectors

2. **Use DOM methods (PREFERRED)**:
   - Use clickElement with CSS selectors or text content (e.g., clickElement with selector="#search-btn" or text="Search")
   - Use type with selectors to focus and type into inputs (e.g., type with selector="input[name=q]" and text="pants")
   - These methods are more reliable and efficient than coordinates

3. **Only use screenshots as LAST RESORT**:
   - If clickElement cannot find the element by selector or text
   - If you need to understand visual layout
   - Then take screenshot and use coordinate-based click

DOM METHOD EXAMPLES:
- Search button: clickElement with selector="button[type=submit]" or text="Search"
- Input field: type with selector="input[name=search]" or selector="#search-input"
- Sign in link: clickElement with text="Sign In" or selector="a[href*=signin]"

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
      onTextChunk(`\n[Executing: ${toolUse.name}]\n`);
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
                text: `Screenshot captured successfully!

Viewport dimensions: ${viewport.width}px wide × ${viewport.height}px tall

COORDINATE SYSTEM:
- Top-left corner: (0, 0)
- Top-right corner: (${viewport.width}, 0)
- Bottom-left corner: (0, ${viewport.height})
- Bottom-right corner: (${viewport.width}, ${viewport.height})
- Center of screen: (${Math.round(viewport.width/2)}, ${Math.round(viewport.height/2)})

TO CLICK AN ELEMENT:
1. Look at the screenshot image below
2. Find the visual element you want to click
3. Estimate where it appears in the image (measure from top-left)
4. Click the CENTER of that element
5. X coordinate = horizontal position (left to right, 0 to ${viewport.width})
6. Y coordinate = vertical position (top to bottom, 0 to ${viewport.height})`,
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
    const MAX_LOOP_MESSAGES = 6; // Reduced from 8 to 6 - tool use/results are verbose
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
