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
    name: 'screenshot',
    description: 'Take a screenshot of the current page',
    input_schema: {
      type: 'object',
      properties: {},
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
];

export async function streamAnthropicWithBrowserTools(
  messages: Message[],
  apiKey: string,
  model: string,
  customBaseUrl: string | undefined,
  onTextChunk: (text: string) => void,
  onComplete: () => void,
  executeTool: (toolName: string, params: any) => Promise<any>,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = customBaseUrl || 'https://api.anthropic.com';
  let conversationMessages = [...messages];
  let fullResponseText = '';

  const MAX_TURNS = 10; // Prevent infinite loops
  let turnCount = 0;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    console.log('🔧 Anthropic Browser Tools - Turn', turnCount);
    console.log('📤 Sending request with tools:', BROWSER_TOOLS.map(t => t.name));

    const requestBody = {
      model,
      max_tokens: 4096,
      tools: BROWSER_TOOLS,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: 'You are a helpful AI assistant with browser automation capabilities. You can navigate to websites, click elements, type text, scroll pages, and take screenshots. When the user asks you to visit a website or interact with a page, USE THE AVAILABLE TOOLS to perform the action.',
    };

    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ API Error:', error);
      throw new Error(error.error?.message || 'Anthropic API request failed');
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
      onTextChunk(`\n${JSON.stringify(toolUse.input, null, 2)}\n`);

      try {
        console.log('🔧 Calling executeTool with:', toolUse.name, toolUse.input);
        const result = await executeTool(toolUse.name, toolUse.input);
        console.log('✅ Tool result:', result);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });

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
      content: JSON.stringify(data.content),
    });

    // Add user message with tool results
    conversationMessages.push({
      id: (Date.now() + 1).toString(),
      role: 'user',
      content: JSON.stringify(toolResults),
    });

    // If the response has a stop_reason of 'end_turn', we're done
    if (data.stop_reason === 'end_turn') {
      break;
    }
  }

  onComplete();
}
