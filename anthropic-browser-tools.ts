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
  {
    name: 'waitForModal',
    description: 'Wait for a modal/dialog to appear on the page. Use this when you expect a modal to open after an action.',
    input_schema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default: 5000)',
        },
      },
    },
  },
  {
    name: 'closeModal',
    description: 'Close the currently visible modal/dialog. Use the close button if available, or try ESC key or backdrop click.',
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

  const MAX_TURNS = 20; // Increased from 10 to 20 for complex tasks
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

TASK COMPLETION REQUIREMENTS:
1. COMPLETE THE FULL TASK: Do not stop until you have:
   - Completed all requested actions
   - Verified the task is done (e.g., form submitted, item created, action confirmed)
   - OR clearly communicated why you cannot complete it

2. ERROR HANDLING & COMMUNICATION:
   - If an action fails, try alternative approaches (different selector, coordinates, etc.)
   - If you cannot complete the task after multiple attempts, clearly explain:
     * What you tried
     * What prevented completion
     * What the user needs to do (if anything)
   - NEVER silently stop - always communicate the status
   - If you reach the turn limit, explain what was accomplished and what remains

3. VERIFICATION:
   - After completing actions, verify success (check for confirmation messages, updated UI, etc.)
   - If verification shows the task isn't complete, continue working until it is

CRITICAL: ALWAYS PREFER DOM-BASED METHODS OVER SCREENSHOTS

INTERACTION WORKFLOW (Follow this order):

1. **First, get page context**: Call getPageContext to see the page structure, interactive elements, their selectors, and authentication status

2. **Check authentication status**:
   - If authentication.requiresLogin is true, you need to help the user log in
   - Look for login forms (input[type="password"], buttons with "Sign In", "Login", etc.)
   - Use the interactive elements list to find login-related buttons and inputs
   - Guide the user through the login process step by step
   - All operations use the user's authentic local IP address and network connection for security

3. **Handle modals and dialogs (CRITICAL for ALL web apps - React, Vue, Angular, etc.)**:
   - ALWAYS check modals array in page context FIRST - if modals are present, they take absolute priority
   - Elements inside modals are automatically prioritized (marked with inModal: true, +20 priority boost)
   - Works with ALL frameworks: React, Vue, Angular, Svelte, vanilla JS, Bootstrap, Material-UI, Ant Design, etc.
   - Modals may not have standard attributes but are detected by z-index, positioning, and framework patterns
   - If you see a modal in the modals array, NEVER use screenshots - use DOM methods with the modal's selectors
   - To close a modal: look for closeButton in the modal data, or use the modal's close button selector
   - Modals are sorted by z-index - the topmost modal is usually the one to interact with
   - If a modal appears, interact with elements inside it first before trying to close it
   - Common close patterns: button with "×", "Close", "X", "Cancel", or aria-label containing "close" (works in all languages)
   - For create/edit modals: look for form inputs, textareas, and submit buttons inside the modal
   - Modal elements will have inModal: true flag - ALWAYS prefer these over page elements
   - Works with international apps: close buttons detected in English, Japanese, Chinese, Korean, French, German, Spanish, Russian, etc.

4. **Use DOM methods (PREFERRED)**:
   - Interactive elements are sorted by priority (higher priority = more likely to be the target)
   - Elements in modals get +20 priority boost - always check modals first!
   - Use clickElement with CSS selectors or text content (e.g., clickElement with selector="#search-btn" or text="Search")
   - Prefer selectors from the interactiveElements list as they're optimized and prioritized
   - Use type with selectors to focus and type into inputs (e.g., type with selector="input[name=q]" and text="pants")
   - These methods are more reliable and efficient than coordinates

5. **ONLY use screenshots as ABSOLUTE LAST RESORT**:
   - NEVER use screenshots if hasActiveModals is true or modals array has items - modals are always accessible via DOM
   - NEVER use screenshots for Jira Cloud or React-based modals - they are fully accessible via DOM
   - Only use screenshots if:
     * No modals are present (hasActiveModals is false)
     * clickElement cannot find the element by selector or text after trying multiple approaches
     * You need to understand visual layout that's not available in DOM
   - Screenshots are cached briefly to improve performance
   - Remember: Modal elements have inModal: true and are prioritized - use them instead of screenshots!

MODAL HANDLING EXAMPLES:
- If modals array has items, check the first (topmost) modal
- Modal close button: clickElement with selector from modal.closeButton.selector
- Elements in modals: Look for interactiveElements with inModal: true (they're already prioritized)
- After completing modal action, close it using the close button selector

DOM METHOD EXAMPLES:
- Search button: clickElement with selector="button[type=submit]" or text="Search"
- Input field: type with selector="input[name=search]" or selector="#search-input"
- Sign in link: clickElement with text="Sign In" or selector="a[href*=signin]"
- Login form: First find the username/email input, then password input, then submit button
- Modal button: clickElement with selector from interactiveElements (check inModal: true)

AUTHENTICATION HANDLING:
- When authentication.requiresLogin is true, look for:
  * Input fields with type="email", type="text" (for username/email)
  * Input fields with type="password"
  * Buttons with text containing "Sign In", "Login", "Log In", "Submit"
- Fill in credentials step by step, then click the login button
- Wait for page navigation after login before proceeding
- All authentication happens using the user's local browser session and IP address

COORDINATE CLICKING (last resort only):
- If DOM methods fail, take a screenshot first
- Measure coordinates from top-left (0,0)
- Click the CENTER of elements
- Viewport dimensions tell you the bounds

PERFORMANCE TIPS:
- Interactive elements are pre-sorted by priority - use higher priority elements first
- Page context is cached briefly - don't call getPageContext excessively
- Screenshots are cached for 1 second - avoid taking multiple screenshots rapidly

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

    // Detect if model is describing tool calls instead of making them
    if (toolUses.length === 0 && textContent?.text) {
      const text = textContent.text.toLowerCase();
      const toolKeywords = ['click_element', 'clickelement', 'executing:', 'selector:', 'description:'];
      const hasToolLikeText = toolKeywords.some(keyword => text.includes(keyword));
      
      if (hasToolLikeText) {
        console.warn('⚠️ Model appears to be describing tool calls instead of making them!');
        console.warn('⚠️ Text content:', textContent.text.substring(0, 200));
        console.warn('⚠️ This usually means the model is confused about tool format.');
        onTextChunk('\n\n⚠️ Note: It looks like I described an action instead of executing it. Let me try again with the proper tool call.\n');
      }
    }

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
      // Ensure we have some text response - if not, add completion message
      if (!fullResponseText.trim() && turnCount > 1) {
        onTextChunk('\n\n✅ Task completed. If you requested something specific, please verify it was completed correctly.');
      }
      break;
    }
    
    // If we've reached max turns, communicate this clearly
    if (turnCount >= MAX_TURNS) {
      onTextChunk(`\n\n⚠️ Reached maximum turns (${MAX_TURNS}). `);
      onTextChunk('If the task is not complete, please try breaking it into smaller steps or provide more specific instructions.');
      break;
    }
  }

  onComplete();
}
