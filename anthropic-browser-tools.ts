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
    name: 'click',
    description: 'Click at specific coordinates on the page',
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
    description: 'Type text into a focused input field',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        selector: { type: 'string', description: 'CSS selector for the input (optional)' },
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
    description: 'Get information about the current page (URL, title, content)',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current page to see what is visible',
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

CRITICAL COORDINATE INSTRUCTIONS:
1. ALWAYS take a screenshot BEFORE clicking to see the page
2. When you receive a screenshot, you'll also get the viewport dimensions (e.g., "1280x800")
3. The screenshot image shows the EXACT pixels you need to click
4. Measure coordinates carefully in the screenshot:
   - Top-left corner of the image = (0, 0)
   - If viewport is 1280x800, bottom-right = (1280, 800)
   - A button in the center would be around (640, 400)
5. Look at WHERE elements appear in the screenshot and estimate their center coordinates
6. For small buttons/icons, click their CENTER point, not edges

WORKFLOW:
1. Take screenshot
2. Carefully examine the screenshot to find the target element
3. Estimate the CENTER coordinates of that element in the image
4. Click those coordinates
5. If clicking fails, take another screenshot and try again with adjusted coordinates

COORDINATE EXAMPLES:
- Search button in top-right corner of 1280x800 screen → around (1200, 50)
- Input field in center of screen → around (640, 400)
- "Sign in" button in header → measure its position in the screenshot

When the user asks you to interact with a page, follow this workflow carefully.`,
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
