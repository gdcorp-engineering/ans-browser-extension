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

/**
 * Summarize old messages to reduce token usage while preserving context
 * @param messages - Full message history
 * @param keepRecentCount - Number of recent messages to keep unsummarized
 * @param apiKey - Anthropic API key
 * @param baseUrl - API base URL
 * @returns Messages with old ones summarized
 */
async function summarizeOldMessages(
  messages: Message[],
  keepRecentCount: number,
  apiKey: string,
  baseUrl: string
): Promise<Message[]> {
  // If we don't have enough messages to summarize, return as-is
  if (messages.length <= keepRecentCount) {
    return messages;
  }

  // Split messages into "to summarize" and "keep recent"
  const messagesToSummarize = messages.slice(0, -keepRecentCount);
  const recentMessages = messages.slice(-keepRecentCount);

  console.log(`🤖 Summarizing ${messagesToSummarize.length} old messages, keeping ${recentMessages.length} recent`);

  try {
    // Create a prompt to summarize the old messages
    const conversationText = messagesToSummarize.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    const summaryPrompt = `Please provide a concise summary of this conversation history. Focus on key actions taken, decisions made, and important context that would be useful for continuing the conversation. Keep it under 300 words.

Conversation to summarize:
${conversationText}`;

    // Call Claude API to get summary
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // Use fast, cheap model for summarization
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: summaryPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn('Failed to generate summary, keeping original messages');
      return messages;
    }

    const data = await response.json();
    const summary = data.content?.[0]?.text || '';

    if (!summary) {
      console.warn('Empty summary received, keeping original messages');
      return messages;
    }

    console.log(`✅ Generated summary (${summary.length} chars)`);

    // Create a summary message
    const summaryMessage: Message = {
      id: `summary_${Date.now()}`,
      role: 'assistant',
      content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary - conversation continues below]`,
    };

    // Return summary + recent messages
    return [summaryMessage, ...recentMessages];

  } catch (error) {
    console.error('Error summarizing messages:', error);
    return messages; // Return original on error
  }
}

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
  siteInstructions?: string, // Matched site-specific instructions
  settings?: any // User settings for conversation history and summarization
): Promise<void> {
  const baseUrl = customBaseUrl || 'https://api.anthropic.com';

  // Keep only the most recent messages to avoid context length issues
  // Page context can be large, and tool use adds more messages during the loop
  // User can configure how much history to keep in settings
  const MAX_HISTORY_MESSAGES = settings?.conversationHistoryLength || 10; // Default: 10 messages (increased from 1)
  let conversationMessages = messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : [...messages];

  // Smart summarization: If enabled and we have many messages, summarize old ones
  if (settings?.enableSmartSummarization !== false && conversationMessages.length > 8) {
    console.log('🤖 Smart summarization enabled, checking if summarization needed...');
    const keepRecentCount = Math.ceil(conversationMessages.length * 0.5); // Keep 50% most recent
    conversationMessages = await summarizeOldMessages(
      conversationMessages,
      keepRecentCount,
      apiKey,
      baseUrl
    );
  }

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERAL BROWSER INTERACTION FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCTION HIERARCHY:
1. If MCP tools available → Use them first (highest priority)
2. If site-specific instructions above → Follow those for this site
3. Always use general patterns below as foundation/fallback

CORE PRINCIPLES:
✓ ALL navigation happens in SAME TAB - never open new tabs
✓ Understand before acting - take screenshot to see page first
✓ One action at a time - verify success before continuing
✓ Prefer DOM methods over coordinates for reliability
✓ When typing in search inputs, Enter is AUTOMATICALLY pressed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STANDARD WORKFLOW FOR ANY WEBSITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: UNDERSTAND THE PAGE
→ Take screenshot to see full page layout and visual context
→ Call getPageContext to get DOM structure and interactive elements
→ Identify page type: form, dashboard, article, web app, etc.
→ Locate key sections: navigation, main content, sidebars, forms

STEP 2: PLAN YOUR ACTIONS
→ Break down user request into specific steps
→ Identify which elements you need to interact with
→ Consider what could go wrong and have fallback approaches

STEP 3: EXECUTE WITH VERIFICATION
→ Perform ONE action at a time
→ Wait for page to update after each action
→ Verify success: look for confirmations, page changes, error messages
→ If action fails, take screenshot to diagnose why

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON INTERACTION PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 FILLING FORMS:
1. Identify all input fields using getPageContext
2. Match fields to data using labels or placeholders
3. Fill fields one by one using type()
4. Look for required field markers
5. Find and click submit button (look for button[type=submit] or text like "Submit", "Save", "Continue")
6. Wait for response - success message, error, or page navigation

🔍 SEARCHING CONTENT:
1. Find search input: look for input[type=search], input[placeholder*=search], or "Search" text
2. Type query using type() - Enter automatically pressed for search inputs
3. Wait for results to load
4. Extract results from page

🧭 NAVIGATION:
1. Look for navigation menu - typically in header, top bar, or left sidebar
2. Common navigation patterns:
   - Horizontal nav bar at top
   - Hamburger menu icon (☰) that expands
   - Left sidebar with links
   - Breadcrumbs showing page hierarchy
3. Click links to navigate - verify URL changes or page content updates

📊 EXTRACTING DATA:
1. Take screenshot to see data layout
2. Use getPageContext to read text content and structure
3. Identify data containers: tables (thead/tbody), lists (ul/ol), cards, sections
4. Extract systematically: headers first, then row by row or item by item
5. Return structured data to user

🎯 CLICKING ELEMENTS:
Preference order:
1. clickElement with text: clickElement({text: "Sign In"})
2. clickElement with selector: clickElement({selector: "button.login"})
3. Coordinate click (last resort): click({x: 100, y: 200})

For coordinates (use ONLY when DOM methods fail):
- Take screenshot first to see exact location
- Screenshot shows viewport - measure from top-left corner (0,0)
- Measure to the CENTER of the ENTIRE clickable control (button/link/tab), not just the text
- Include all visible parts: text, badges, icons, padding - measure to center of the whole control
- For "Assigned to me 11": measure center of the entire tab including both text and badge
- Be precise - off by even 20-30 pixels can miss the target
- Double-check your measurement before clicking
- If click misses, take new screenshot and measure again more carefully

⌨️ TYPING TEXT:
1. Focus field first if needed: clickElement to focus
2. Type text: type({selector: "input[name=email]", text: "user@example.com"})
3. For search boxes: Enter pressed automatically
4. For forms: Press Enter manually or click submit button

⏱️ WAITING & TIMING:
1. After navigation: Wait for page load, check URL changed
2. After form submit: Wait for confirmation or error message
3. For dynamic content: Look for loading indicators, wait for them to disappear
4. If content doesn't appear: Wait longer, then check if action failed

❌ ERROR HANDLING:
→ Element not found:
  - Take screenshot to see current state
  - Try alternative selectors (id, class, text, parent/child)
  - Check if element is hidden or in different section

→ Click failed:
  - Check for overlays, modals, popups blocking the element
  - Try clicking parent or child element
  - Scroll element into view first

→ Page didn't load:
  - Check if URL changed
  - Look for error messages
  - Wait longer for slow pages

→ Form submission failed:
  - Look for validation error messages
  - Check if required fields are empty
  - Look for error indicators (red text, exclamation marks)

🔔 MODALS & POPUPS:
1. Wait for modal to appear after triggering action
2. Interact with modal content
3. Close modal: look for X button, "Close", "Cancel", or click outside
4. Verify modal disappeared before continuing

🗂️ DROPDOWNS & MENUS:
1. Click to open dropdown
2. Wait for options to appear
3. Click desired option
4. Verify selection updated

📁 FILE UPLOADS:
1. Find file input: input[type=file]
2. Note: Direct file upload not supported - inform user
3. Alternative: describe how user can upload manually

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL USAGE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

getPageContext: ALWAYS call first to understand page structure
screenshot: Use when you need visual understanding or coordinates
clickElement: Preferred method - works with selectors or text
click: Last resort - requires screenshot first for coordinates
type: For inputs - automatically presses Enter for search boxes
scroll: To bring content into view
pressKey: For special keys like Enter, Tab, Escape
navigate: To change pages - always in same tab

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Remember: Take your time, verify each step, and describe what you see before acting. When in doubt, take a screenshot!`,
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
          const dpr = viewport.devicePixelRatio || 1;
          const coordinateInstructions = dpr > 1
            ? `IMPORTANT: This is a high-DPI display (devicePixelRatio=${dpr}). When measuring coordinates from this screenshot, DIVIDE by ${dpr} to get viewport coordinates. Example: if you measure (940, 882) in the image, use click({x: ${Math.round(940/dpr)}, y: ${Math.round(882/dpr)}}).`
            : '';
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: `Screenshot: ${viewport.width}×${viewport.height}px viewport (image is ${viewport.width * dpr}×${viewport.height * dpr}px). Top-left=(0,0), Bottom-right=(${viewport.width},${viewport.height}). ${coordinateInstructions}`,
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
    // User can configure max loop history in settings
    const MAX_LOOP_MESSAGES = settings?.conversationLoopHistoryLength || 15; // Default: 15 messages (increased from 4)
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
