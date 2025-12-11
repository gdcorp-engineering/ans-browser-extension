import type { Message } from './types';

/**
 * Maximum size for the longest edge of screenshots sent to Claude.
 * This ensures Claude won't resize the image further internally.
 * Claude's limit is ~1568px, so 1280px gives us a safe margin.
 */
const MAX_SCREENSHOT_LONG_EDGE = 1280;

/**
 * Resize a base64 screenshot for Claude, maintaining aspect ratio.
 * Only resizes if the longest edge exceeds MAX_SCREENSHOT_LONG_EDGE.
 *
 * Why limit size?
 * - Claude automatically resizes large images (max ~1568px on longest edge)
 * - By keeping under 1280px, we KNOW Claude won't resize further
 * - We maintain aspect ratio to avoid distortion
 * - We can then calculate the scale factor to convert coordinates to viewport
 *
 * Returns: { base64: string, width: number, height: number }
 */
async function resizeScreenshotForClaude(
  base64Data: string
): Promise<{ base64: string; width: number; height: number }> {
  try {
    // Convert base64 to blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    // Create ImageBitmap from blob to get original dimensions
    const imageBitmap = await createImageBitmap(blob);
    const originalWidth = imageBitmap.width;
    const originalHeight = imageBitmap.height;

    // Calculate the longest edge
    const longestEdge = Math.max(originalWidth, originalHeight);

    // If already under the limit, return original
    if (longestEdge <= MAX_SCREENSHOT_LONG_EDGE) {
      console.log(`📐 Screenshot ${originalWidth}×${originalHeight} is under ${MAX_SCREENSHOT_LONG_EDGE}px limit, no resize needed`);
      imageBitmap.close(); // Free memory
      return { base64: base64Data, width: originalWidth, height: originalHeight };
    }

    // Calculate scale factor to fit longest edge within limit
    const scale = MAX_SCREENSHOT_LONG_EDGE / longestEdge;
    const targetWidth = Math.round(originalWidth * scale);
    const targetHeight = Math.round(originalHeight * scale);

    console.log(`📐 Resizing screenshot from ${originalWidth}×${originalHeight} to ${targetWidth}×${targetHeight} (scale: ${scale.toFixed(4)})`);

    // Use OffscreenCanvas to resize (available in modern browsers)
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.warn('⚠️ Could not get canvas context, returning original image');
      imageBitmap.close(); // Free memory even on error path
      return { base64: base64Data, width: originalWidth, height: originalHeight };
    }

    // Draw the image scaled to target dimensions (maintains aspect ratio)
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

    // Free the ImageBitmap memory immediately after drawing (before base64 conversion)
    imageBitmap.close();

    // Convert back to blob then base64
    const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await resizedBlob.arrayBuffer();
    const resizedBase64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    console.log(`✅ Screenshot resized successfully to ${targetWidth}×${targetHeight} (aspect ratio preserved)`);
    return { base64: resizedBase64, width: targetWidth, height: targetHeight };
  } catch (error) {
    console.error('❌ Failed to resize screenshot:', error);
    // Return original if resize fails - estimate dimensions based on common sizes
    return { base64: base64Data, width: 1280, height: 720 };
  }
}

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
 * Check if content contains page context (screenshots or large DOM data)
 */
function hasPageContext(content: any): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item: any) => {
    // Check for images (screenshots)
    if (item.type === 'image') return true;
    // Check for tool_result with large content (DOM context from getPageContext)
    if (item.type === 'tool_result' && typeof item.content === 'string') {
      // Page context typically has URLs, textContent, links arrays
      try {
        const parsed = JSON.parse(item.content);
        // If it has url, textContent, or links - it's likely page context
        if (parsed.url || parsed.textContent || parsed.links || parsed.interactiveElements) {
          return true;
        }
      } catch {
        // Not JSON, check if it's a large text block
        return item.content.length > 2000;
      }
    }
    return false;
  });
}

/**
 * Create a summary of stripped page context for older messages
 */
function summarizePageContext(content: any): string {
  if (!Array.isArray(content)) return '[Previous action]';

  const summaries: string[] = [];

  for (const item of content) {
    if (item.type === 'image') {
      summaries.push('[Screenshot taken]');
    } else if (item.type === 'tool_result') {
      try {
        const parsed = JSON.parse(item.content);
        if (parsed.url) {
          summaries.push(`[Page context: ${parsed.url}]`);
        } else if (parsed.success !== undefined) {
          summaries.push(`[Action: ${parsed.success ? 'succeeded' : 'failed'}]`);
        } else {
          summaries.push('[Tool result]');
        }
      } catch {
        summaries.push('[Tool result]');
      }
    }
  }

  return summaries.length > 0 ? summaries.join(' ') : '[Previous action]';
}

/**
 * Prepare messages for API by separating chat history from page context
 * Keeps longer chat history but only recent page context (screenshots, DOM)
 *
 * @param messages - Full message history
 * @param chatHistoryLength - Number of pure chat messages to keep (default: 20)
 * @param pageContextHistoryLength - Number of page context messages to keep (default: 2)
 * @returns Optimized messages with full chat history but trimmed page context
 */
function prepareMessagesWithSeparateHistory(
  messages: Message[],
  chatHistoryLength: number = 20,
  pageContextHistoryLength: number = 2
): Message[] {
  console.log(`📚 Preparing messages with separate history management`);
  console.log(`   Chat history: ${chatHistoryLength}, Page context: ${pageContextHistoryLength}`);
  console.log(`   Input messages: ${messages.length}`);

  // Track which messages have page context
  const messageInfo = messages.map((msg, index) => ({
    index,
    message: msg,
    hasPageContext: msg.role === 'user' && hasPageContext(msg.content),
  }));

  // Find all messages with page context
  const pageContextIndices = messageInfo
    .filter(info => info.hasPageContext)
    .map(info => info.index);

  console.log(`   Messages with page context: ${pageContextIndices.length}`);

  // If we have more page context messages than allowed, we need to strip some
  const pageContextToStrip = pageContextIndices.slice(0, -pageContextHistoryLength);
  const pageContextToKeep = new Set(pageContextIndices.slice(-pageContextHistoryLength));

  console.log(`   Stripping page context from ${pageContextToStrip.length} messages`);
  console.log(`   Keeping page context in ${pageContextToKeep.size} messages`);

  // Process messages: strip old page context, keep recent
  const processedMessages: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (pageContextToStrip.includes(i)) {
      // This message has page context we want to strip
      // Replace the content with a summary
      const summary = summarizePageContext(msg.content);
      processedMessages.push({
        ...msg,
        content: summary,
      });
      console.log(`   Stripped message ${i}: ${summary}`);
    } else {
      // Keep message as-is
      processedMessages.push(msg);
    }
  }

  // Now apply chat history limit to pure chat messages
  // We want to keep the last N messages, but we've already processed page context
  if (processedMessages.length > chatHistoryLength) {
    // Smart trim: preserve tool_use/tool_result pairs
    let trimmed = processedMessages.slice(-chatHistoryLength);

    // Check if first message is a user message with tool_result
    const firstMsg = trimmed[0];
    if (firstMsg?.role === 'user' && Array.isArray(firstMsg.content)) {
      const hasToolResult = (firstMsg.content as any[]).some((item: any) => item.type === 'tool_result');
      if (hasToolResult) {
        // Include one more message to get the assistant's tool_use
        const firstMsgIndex = processedMessages.length - chatHistoryLength;
        if (firstMsgIndex > 0) {
          trimmed = processedMessages.slice(-(chatHistoryLength + 1));
        }
      }
    }

    console.log(`   Final message count: ${trimmed.length} (from ${processedMessages.length})`);
    return trimmed;
  }

  console.log(`   Final message count: ${processedMessages.length}`);
  return processedMessages;
}

/**
 * Summarize old messages to reduce token usage while preserving context
 * @param messages - Full message history
 * @param keepRecentCount - Number of recent messages to keep unsummarized
 * @param apiKey - GoCode API key
 * @param baseUrl - API base URL (GoCode endpoint)
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
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/messages`, {
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
    } catch (fetchError) {
      console.warn('❌ Network error during summarization, keeping original messages:', fetchError);
      return messages; // Return original on network error
    }

    if (!response.ok) {
      console.warn('Failed to generate summary, keeping original messages');
      return messages;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.warn('Failed to parse summary response as JSON, keeping original messages');
      return messages;
    }

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
  settings?: any, // User settings for conversation history and summarization
  onToolStart?: (toolName: string, isMcpTool: boolean) => void, // Callback when tool execution starts
  browserToolsEnabled: boolean = true // Whether browser tools are enabled
): Promise<void> {
  // Validate API key before making request
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('GoCode Key is not configured. Please add your GoCode Key in Settings (⚙️ icon).');
  }

  // Always use GoCode endpoint - no direct Anthropic API access
  const baseUrl = customBaseUrl || 'https://caas-gocode-prod.caas-prod.prod.onkatana.net';

  // Keep only the most recent messages to avoid context length issues
  // Page context can be large, and tool use adds more messages during the loop
  // User can configure how much history to keep in settings
  const MAX_HISTORY_MESSAGES = settings?.conversationHistoryLength || 10; // Default: 10 messages
  const CHAT_HISTORY_LENGTH = settings?.chatHistoryLength || 20; // Default: 20 chat messages
  const PAGE_CONTEXT_HISTORY_LENGTH = settings?.pageContextHistoryLength || 2; // Default: 2 page contexts
  const ENABLE_SEPARATE_HISTORY = settings?.enableSeparateHistoryManagement !== false; // Default: true

  console.log(`🚀 streamAnthropicWithBrowserTools called with ${messages.length} messages`);
  console.log(`🚀 Browser tools enabled: ${browserToolsEnabled}`);
  console.log(`🚀 Additional tools count: ${additionalTools?.length || 0}`);
  console.log(`🚀 Separate history management: ${ENABLE_SEPARATE_HISTORY}`);

  let conversationMessages: Message[] = [];

  // Use separate history management if enabled (separates chat from page context)
  if (ENABLE_SEPARATE_HISTORY) {
    console.log(`📚 Using separate history: chat=${CHAT_HISTORY_LENGTH}, pageContext=${PAGE_CONTEXT_HISTORY_LENGTH}`);
    conversationMessages = prepareMessagesWithSeparateHistory(
      messages,
      CHAT_HISTORY_LENGTH,
      PAGE_CONTEXT_HISTORY_LENGTH
    );
  } else {
    // Fallback to legacy trimming behavior
    console.log(`🚀 Using legacy trimming: MAX_HISTORY_MESSAGES=${MAX_HISTORY_MESSAGES}`);

    // Smart trimming to preserve tool_use/tool_result pairs
    if (messages.length > MAX_HISTORY_MESSAGES) {
      console.log(`✂️ Trimming messages from ${messages.length} to ${MAX_HISTORY_MESSAGES}`);
      let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

      // Check if first message is a user message with tool_result
      const firstMsg = trimmed[0];
      if (firstMsg?.role === 'user' && Array.isArray(firstMsg.content)) {
        const hasToolResult = (firstMsg.content as any[]).some((item: any) => item.type === 'tool_result');
        if (hasToolResult) {
          // Include one more message to get the assistant's tool_use
          const firstMsgIndex = messages.length - MAX_HISTORY_MESSAGES;
          if (firstMsgIndex > 0) {
            trimmed = messages.slice(-(MAX_HISTORY_MESSAGES + 1));
            console.log(`📎 Preserved tool_use/tool_result pair during initial trim`);
          }
        }
      }
      conversationMessages = trimmed;
    } else {
      conversationMessages = [...messages];
    }
  }

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
  // Only include browser tools if they're enabled
  const browserToolsToInclude = browserToolsEnabled ? BROWSER_TOOLS : [];
  console.log('🔧 Browser tools enabled:', browserToolsEnabled);
  console.log('🔧 Browser tools count:', browserToolsToInclude.length);
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

  // Build dynamic list of available MCP tools with descriptions
  const mcpToolsList = hasAdditionalTools ? (additionalTools || [])
    .filter((tool: any) => tool?.name && !tool.name.startsWith('a2a_'))
    .map((tool: any) => `  - ${tool.name}: ${tool.description || 'No description available'}`)
    .join('\n') : '';

  const allTools = hasAdditionalTools
    ? [...additionalTools, ...browserToolsToInclude] // Surface MCP/A2A tools first
    : browserToolsToInclude;

  console.log('🔧 Total merged tools:', allTools.length);
  console.log('🔧 All tool names:', allTools.map((t: any) => t.name).join(', '));
  console.log('🔧 Starting with', conversationMessages.length, 'messages (limited from', messages.length, ')');

  const MAX_TURNS = 20; // Prevent infinite loops
  let turnCount = 0;

  try {
    while (turnCount < MAX_TURNS) {
    turnCount++;

    console.log('🔧 Anthropic Browser Tools - Turn', turnCount, `of ${MAX_TURNS}`);
    if (turnCount >= MAX_TURNS - 2) {
      console.warn(`⚠️ Approaching MAX_TURNS limit (${turnCount}/${MAX_TURNS})`);
    }
    console.log('📤 Sending request with tools:', allTools.map((t: any) => t.name));

    const mcpPrioritySection = hasAdditionalTools ? `
🔴 CRITICAL - MCP / TRUSTED AGENT TOOLS AVAILABLE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have specialized MCP tools available. READ EACH TOOL'S DESCRIPTION to understand what it does.

AVAILABLE MCP TOOLS:
${mcpToolsList || '  (No MCP tools available)'}

HOW TO CHOOSE THE RIGHT TOOL:
1. Read the user's request to understand their INTENT
2. Review ALL available tool descriptions (both MCP and browser tools)
3. Match the user's intent to the tool that BEST fits the task:
   - Check MCP tool descriptions first - do any match the task?
   - If yes → Use that MCP tool DIRECTLY (do NOT use browser tools first)
   - If no → Use browser tools (navigate, click, type, screenshot, etc.)

🚨 CRITICAL RULE: When an MCP tool matches the task, use it DIRECTLY:
   - DO NOT navigate to the website first
   - DO NOT take screenshots first
   - DO NOT use any browser tools
   - Just call the MCP tool with the parameters it needs (e.g., URL, site name, etc.)
   - MCP tools can work with URLs/parameters directly - they don't need browser automation

TOOL SELECTION GUIDELINES:
- Navigation requests ("go to", "navigate to", "open", "visit") → ALWAYS use browser navigate tool
- Web interaction ("click", "type", "scroll", "screenshot") → ALWAYS use browser tools
- Specialized tasks → Check MCP tool descriptions - if one matches, use it DIRECTLY (no browser tools)
- If unsure → Read the tool description - it tells you what the tool does

EXAMPLES:
✅ CORRECT:
- "Go to Amazon" → browser navigate tool (navigation is always browser tool)
- "Click the button" → browser click tool (interaction is always browser tool)
- "Create a rap version of GoDaddy.com" → Use MCP generate_song tool DIRECTLY with URL (do NOT navigate first)
- "Generate a song about Amazon" → Use MCP generate_song tool DIRECTLY (do NOT navigate first)
- "Search for domains" → Use MCP domain_search tool DIRECTLY (if available, do NOT navigate first)

❌ WRONG:
- "Create a rap version of GoDaddy.com" → navigate + screenshot + generate_song (WRONG - just use generate_song)
- "Generate a song about Amazon" → navigate + screenshot + generate_song (WRONG - just use generate_song)

IMPORTANT:
- MCP tools are specialized - they only handle specific tasks described in their tool descriptions
- When an MCP tool matches the task, use it DIRECTLY - no browser automation needed
- Browser tools handle navigation, clicking, typing, scrolling, screenshots - use these only when MCP tools don't match
- READ TOOL DESCRIPTIONS - they tell you exactly what each tool does and what parameters it needs
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

    // Filter out messages with empty content (API requirement)
    const validMessages = conversationMessages.filter(m => {
      if (!m.content) {
        console.warn('⚠️ Filtering out message with empty content:', m);
        return false;
      }
      // Handle both string and array content
      if (typeof m.content === 'string') {
        return m.content.trim().length > 0;
      }
      const contentArray = m.content as any[];
      if (Array.isArray(contentArray)) {
        return contentArray.length > 0;
      }
      return true;
    });

    console.log(`📨 Sending ${validMessages.length} messages to API (filtered ${conversationMessages.length - validMessages.length} empty)`);
    console.log(`📨 Message breakdown:`, validMessages.map(m => ({
      role: m.role,
      contentType: Array.isArray(m.content) ? `array[${m.content.length}]` : typeof m.content,
      hasToolUse: Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_use'),
      hasToolResult: Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'),
    })));

    // Build the system prompt based on whether browser tools are enabled
    const systemPrompt = browserToolsEnabled
      ? `You are a helpful AI assistant with browser automation and MCP tool capabilities.

Follow the PEVI loop:

1. PLAN — Understand the user's goal. Decide whether the task needs:
   - Browser automation (navigate, click, type, scroll, screenshot, getPageContext)
   - OR an MCP tool (use directly if its description matches the user's intent)

2. EXECUTE — Perform ONE action at a time using the correct tool.

3. VERIFY — MANDATORY AFTER EVERY ACTION:
   - FIRST: Check tool results for {success: false}, {error}, {timeout}
   - IF success: false → IMMEDIATELY report "❌ Tool failed: [error message]" and STOP
   - IF error exists → IMMEDIATELY report "❌ Error: [error message]" and STOP
   - IF timeout: true → IMMEDIATELY report "❌ Tool timed out" and STOP
   - ONLY if tool result shows success: true → use getPageContext to confirm page state
   - Take screenshot ONLY if getPageContext is insufficient to verify success
   - FORBIDDEN: Do not claim success unless tool result shows success: true AND getPageContext confirms it worked

4. ITERATE — If verification fails:
   - Adjust plan: try an alternate selector, query, or path
   - Do not repeat the same failing action more than twice
   - If multiple attempts fail, stop and explain what happened

INSTRUCTION PRIORITY:
1. If an MCP tool matches the user request → use it *directly* (no navigation or screenshots)

BROWSER AUTOMATION RULES:
- Always begin with getPageContext to understand the page
- Minimize taking screenshots unless strictly necessary, and prefer getPageContext to understand the page before acting.
- Prefer clickElement(text/selector) over coordinate clicks
- Use coordinate clicks ONLY after measuring in screenshot and applying scale factors
- Navigation: verify via getPageContext; use screenshot only if getPageContext doesn't confirm successful navigation
- Type: focus field if needed; Enter auto-submits for search bars
- Scroll before clicking if element not visible

SCREENSHOT USAGE RULES:
- Take screenshots ONLY when:
  • getPageContext doesn't contain enough information for the specific task
  • You need to measure coordinates for complex layouts
  • Visual confirmation is required for verification after multiple failed attempts
- DO NOT take screenshots for simple tasks like:
  • Clicking buttons/links when text is available in getPageContext (e.g., "Edit", "Save", "Submit")
  • Typing in form fields when selectors are available in getPageContext
  • Adding text content (e.g., "add a subtitle") when editing interfaces are accessible
  • Basic navigation when page content is clear from getPageContext

EXAMPLE - Adding a subtitle to a page (SUCCESS):
1. Use getPageContext to find "Edit" button text
2. clickElement({text: "Edit"}) - Check result: {success: true}
3. Use getPageContext to find content area or text input
4. clickElement({text: "content area"}) or click at coordinates - Check result: {success: true}
5. type({text: "subtitle content"}) - Check result: {success: true}
6. Use getPageContext to verify content was added

EXAMPLE - Tool failure handling:
1. clickElement({text: "Edit"}) - Result: {success: false, message: "Element not found"}
2. STOP and report: "❌ Could not find Edit button. Available elements: [list from getPageContext]"
3. Do not proceed to type - the click failed

EXAMPLE - Type tool failure:
1. type({text: "content"}) - Result: {success: false, message: "No focused element found"}
2. STOP and report: "❌ Could not type text - no input field is focused. Try clicking on the content area first."
3. Do not claim the text was added

CLICKING ELEMENTS:
Preference order:
1. clickElement with text: clickElement({text: "Submit"})
2. clickElement with selector: clickElement({selector: "button.submit"})
3. Coordinate click (last resort): click({x: 100, y: 200})

For coordinate clicks (screenshots are resized with max 1280px on longest edge):
Screenshots are resized to fit within 1280px (longest edge), maintaining aspect ratio.
You MUST convert your measurements to viewport coordinates using the scale factors provided.

When coordinate click is needed, always use the CONVERSION PROCESS:
1. Measure the element's center position in the screenshot (x, y)
2. Apply the scale factors shown in the screenshot result:
   click_x = measured_x × scale_x
   click_y = measured_y × scale_y
3. Use the converted coordinates: click({x: click_x, y: click_y})

ERROR HANDLING RULES:
- If navigation returns {success: false} or any error → report immediately
- If element not found: re-check DOM, try alternative selectors, or scroll
- For modals, dropdowns, dynamic content: wait for visibility then interact
- Timeouts: inform user and suggest alternatives

OUTPUT RULES:
- Never use XML-like tags
- Describe intent briefly in natural language; tool calls are handled automatically
- Never claim actions succeeded unless verified on-screen

Use the PEVI loop on every task. Think carefully before acting. Verify after each step. Adjust when needed. Stop gracefully if progress becomes impossible.`
      : `You are a helpful AI assistant. Browser automation tools are NOT available in this mode - you cannot navigate, click, type, or take screenshots.

🚨 CRITICAL: Browser tools are DISABLED. You CANNOT navigate, click, type, or take screenshots.

🚫 ABSOLUTELY FORBIDDEN WHEN BROWSER TOOLS ARE DISABLED:
   - DO NOT write "[Executing: navigate]" or "[Executing: screenshot]" or any similar text
   - DO NOT pretend to execute browser tools in your text responses
   - DO NOT claim you are navigating, clicking, typing, or taking screenshots
   - DO NOT describe what you "see" after pretending to navigate
   - DO NOT write tool execution syntax like "[Executing: toolName]" - this is FORBIDDEN
   - DO NOT claim success like "I've successfully navigated to..." - you CANNOT navigate

✅ WHAT TO DO INSTEAD:
   - When users ask to navigate (e.g., "go to Amazon", "navigate to X", "open Y"), you MUST respond with:
     "I don't have browser automation capabilities enabled. Please navigate to [URL] manually in your browser."
   - Be direct and clear - do not pretend or simulate browser actions
   - Do not write any text that looks like tool execution
   - Simply tell the user to perform the action manually

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNDERSTANDING USER INTENT - CHOOSE THE RIGHT TOOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 CRITICAL: Read the user's request carefully to understand their INTENT, then READ TOOL DESCRIPTIONS to find the right tool.

STEP 1: Understand the user's intent
   - What are they trying to accomplish?
   - What type of action is needed?

STEP 2: Review available tools and their descriptions
   - Each tool has a description that explains what it does
   - Read the descriptions to understand each tool's capabilities
   - Match the user's intent to the tool that best fits

STEP 3: Select the appropriate tool
   - Navigation/interaction → Browser tools are NOT available - tell user to do it manually
   - Specialized tasks → Check MCP tool descriptions - if one matches, use it DIRECTLY

BROWSER TOOLS ARE DISABLED:
   - Navigation requests (e.g., "go to", "navigate to", "open", "visit") → Tell user to navigate manually
   - Interaction requests (e.g., "click", "type", "press", "select") → Tell user these actions are not available
   - Information requests (e.g., "screenshot", "get page context") → Tell user these features are not available

MCP TOOLS (check descriptions):
   - Read each MCP tool's description to understand what it does
   - Use MCP tools when their description matches the user's request
   - MCP tools are specialized - they only do what their description says
   - 🚨 When an MCP tool matches → Use it DIRECTLY, do NOT use browser tools first
   - MCP tools can work with URLs/parameters directly - they don't need navigation or screenshots

KEY PRINCIPLE:
   - "Go to Amazon" = NAVIGATION → Browser tools disabled - tell user: "I don't have browser automation enabled. Please navigate to Amazon.com manually in your browser."
   - "Create a rap version of GoDaddy.com" = MCP generate_song matches → use it DIRECTLY with URL (do NOT navigate first)
   - "Generate a song about Amazon" = MCP generate_song matches → use it DIRECTLY (do NOT navigate first)
   - "Search for domains" = Check MCP tools - if domain_search matches, use it DIRECTLY
   - Always read tool descriptions - they tell you exactly what each tool does
   - When browser tools are disabled → Always tell user to perform navigation/interaction manually
   - When MCP tool matches → Use MCP tool directly (no browser automation needed)

${mcpPrioritySection}
${siteInstructionsSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HANDLING REQUESTS WHEN BROWSER TOOLS ARE DISABLED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCTION HIERARCHY:
1. If MCP tools available AND one matches the task → Use MCP tool DIRECTLY
2. If user requests navigation/interaction → Tell them to do it manually
3. Be helpful and clear about what you can and cannot do

CORE PRINCIPLES:
✓ If MCP tool matches task → Use it DIRECTLY
✓ If user asks to navigate → Tell them: "I don't have browser automation enabled. Please navigate to [URL] manually."
✓ If user asks to click/type/interact → Tell them: "I don't have browser automation enabled. Please perform this action manually."
✓ DO NOT claim you can navigate or interact with the browser - you cannot
✓ DO NOT attempt to use browser tools - they are not available
✓ Be helpful and suggest what the user can do manually

⚠️ CRITICAL: Browser automation tools are NOT available. You CANNOT navigate, click, type, or take screenshots.

When users request browser automation:
- Navigation requests → Tell user: "I don't have browser automation enabled. Please navigate to [URL] manually in your browser."
- Click/interaction requests → Tell user: "I don't have browser automation enabled. Please click/interact with the page manually."
- Form filling requests → Tell user: "I don't have browser automation enabled. Please fill out the form manually."
- Screenshot requests → Tell user: "I don't have browser automation enabled. I cannot take screenshots."

DO NOT attempt to use browser tools - they are not available.
DO NOT claim you can perform browser actions - you cannot.
Be helpful and clear about what you can and cannot do.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERROR HANDLING IN TOOL RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 CRITICAL: ALWAYS check tool results for errors:
   - Look for {success: false, error: "..."} in the result
   - Look for {error: "..."} in the result
   - Look for {timeout: true} in the result (indicates the tool timed out)
   - If you see an error or timeout, report it to the user immediately with a friendly message
   - DO NOT claim success if there's an error in the result
   - DO NOT ignore error messages - they indicate the action failed
   - For timeouts: Respond with "The request took too long and timed out. Please try again later or try a different approach."
   - Always provide a helpful response - never leave the conversation hanging

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL: TOOL CALLING FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 NEVER output XML-like syntax in your text responses:
   - DO NOT write: <function_calls>, <invoke>, <parameter>, etc.
   - DO NOT write: <tool_call>, <function>, etc.
   - DO NOT write any XML tags in your text

🚫 CRITICAL: Browser tools are DISABLED - NEVER write tool execution text:
   - DO NOT write "[Executing: navigate]" or "[Executing: screenshot]" or any similar format
   - DO NOT write "[Executing: toolName]" - this format is FORBIDDEN when browser tools are disabled
   - DO NOT pretend to execute tools in your text responses
   - DO NOT claim you are using tools or have used tools
   - Instead, tell the user to perform the action manually

✅ When browser tools are disabled:
   - If user asks to navigate → Tell them: "I don't have browser automation enabled. Please navigate to [URL] manually in your browser."
   - If user asks to click/interact → Tell them: "I don't have browser automation enabled. Please perform this action manually."
   - DO NOT attempt to use browser tools - they are not available
   - DO NOT claim you can navigate or interact - you cannot
   - Be helpful and clear about what you can and cannot do

Remember: When browser tools are disabled, always tell users to perform browser actions manually.`;

    const requestBody = {
      model,
      max_tokens: 4096,
      tools: allTools,
      messages: validMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: systemPrompt,
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

    let response;
    try {
      // Add timeout to prevent hanging (3 minutes for API calls)
      const timeoutMs = 180000; // 3 minutes
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('API request timed out after 3 minutes')), timeoutMs);
      });

      console.log(`🌐 Making API call to ${baseUrl}/v1/messages`);
      console.log(`🌐 Request body size: ${JSON.stringify(requestBody).length} bytes`);
      console.log(`🌐 Tools count: ${allTools.length}`);
      console.log(`🌐 Messages count: ${validMessages.length}`);

      const fetchStartTime = Date.now();
      response = await Promise.race([
        fetch(`${baseUrl}/v1/messages`, fetchOptions),
        timeoutPromise
      ]);
      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`✅ API call completed in ${fetchDuration}ms, status: ${response.status}`);
    } catch (fetchError: any) {
      // Network error - likely VPN not connected or endpoint unreachable
      console.error('❌ Network Error:', fetchError);
      throw new Error(
        '🔌 Cannot reach GoCode API endpoint.\n\n' +
        'This usually means:\n' +
        '• You are not connected to GoDaddy VPN\n' +
        '• The GoCode service is temporarily unavailable\n\n' +
        'Please connect to VPN and try again.'
      );
    }

    if (!response.ok) {
      let errorMsg = 'GoCode API request failed';

      try {
        const error = await response.json();
        console.error('❌ API Error:', error);

        // Check if it's a context length error
        errorMsg = error.error?.message || errorMsg;
        if (errorMsg.includes('too long') || errorMsg.includes('Input is too long')) {
          throw new Error('Context limit exceeded. Please start a new chat to continue.');
        }
      } catch (parseError) {
        // Response is not JSON (likely HTML error page)
        const text = await response.text();
        console.error('❌ Non-JSON API Error Response:', text.substring(0, 200));
        errorMsg = `API Error (${response.status} ${response.statusText})`;
      }

      throw new Error(errorMsg);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      const text = await response.text();
      console.error('❌ Failed to parse successful response as JSON:', text.substring(0, 200));
      throw new Error('API returned non-JSON response (possible redirect or proxy issue)');
    }

    // Validate response structure
    if (!data || typeof data !== 'object') {
      console.error('❌ Invalid response structure:', data);
      throw new Error('API returned invalid response structure');
    }

    if (!data.content || !Array.isArray(data.content)) {
      console.error('❌ Response missing content array:', data);
      throw new Error('API response missing content array');
    }

    console.log('📥 Response:', JSON.stringify(data, null, 2));
    console.log(`📥 Response content items: ${data.content.length}`);

    // Check if response includes text
    const textContent = data.content?.find((c: any) => c.type === 'text');

    // If response has no content at all, this is an error
    if (data.content.length === 0) {
      console.error('❌ Response has no content items');
      throw new Error('API returned empty response - no content items');
    }

    if (textContent?.text) {
      // Filter out XML-like syntax that shouldn't appear in text responses
      let filteredText = textContent.text;
      // Remove XML function call syntax patterns
      filteredText = filteredText.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
      filteredText = filteredText.replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/gi, '');
      filteredText = filteredText.replace(/<parameter\s+name="[^"]*">[^<]*<\/parameter>/gi, '');
      filteredText = filteredText.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
      filteredText = filteredText.replace(/<function>[\s\S]*?<\/function>/gi, '');

      // When browser tools are disabled, remove any "[Executing: ...]" text that the AI might generate
      if (!browserToolsEnabled) {
        filteredText = filteredText.replace(/\[Executing:\s*[^\]]+\]/gi, '');
        filteredText = filteredText.replace(/I'll navigate to[^.]*\./gi, '');
        filteredText = filteredText.replace(/I've successfully navigated to[^.]*\./gi, '');
        filteredText = filteredText.replace(/Let me take a screenshot[^.]*\./gi, '');
        filteredText = filteredText.replace(/Let me verify[^.]*\./gi, '');
      }

      // Only output if there's actual content after filtering
      if (filteredText.trim().length > 0) {
        fullResponseText += filteredText;
        onTextChunk(filteredText);
      }
    }

    // Check for tool use
    const toolUses = data.content?.filter((c: any) => c.type === 'tool_use') || [];

    if (toolUses.length === 0) {
      // No more tools to execute, we're done
      // But first, make sure we've output any text content
      console.log(`✅ No more tools to execute. Stop reason: ${data.stop_reason}`);
      console.log(`✅ Total response text length: ${fullResponseText.length}`);
      console.log(`✅ Turn count: ${turnCount}/${MAX_TURNS}`);
      console.log(`✅ Conversation messages: ${conversationMessages.length}`);

      // If we have no text content and no tools, something might be wrong
      if (fullResponseText.trim().length === 0 && !textContent?.text) {
        console.warn(`⚠️ No text content and no tools - response might be empty`);
        console.warn(`⚠️ Response content:`, JSON.stringify(data.content, null, 2));
        // This shouldn't happen, but if it does, we should still break to avoid infinite loop
        // The user will see no response, which indicates an issue
      }

      // If we have text content, make sure it was output
      if (textContent?.text && fullResponseText.trim().length === 0) {
        console.warn(`⚠️ Text content exists but wasn't output - outputting now`);
        let filteredText = textContent.text.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
          .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/gi, '')
          .replace(/<parameter\s+name="[^"]*">[^<]*<\/parameter>/gi, '')
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
          .replace(/<function>[\s\S]*?<\/function>/gi, '');

        // When browser tools are disabled, remove any "[Executing: ...]" text that the AI might generate
        if (!browserToolsEnabled) {
          filteredText = filteredText.replace(/\[Executing:\s*[^\]]+\]/gi, '');
          filteredText = filteredText.replace(/I'll navigate to[^.]*\./gi, '');
          filteredText = filteredText.replace(/I've successfully navigated to[^.]*\./gi, '');
          filteredText = filteredText.replace(/Let me take a screenshot[^.]*\./gi, '');
          filteredText = filteredText.replace(/Let me verify[^.]*\./gi, '');
        }

        if (filteredText.trim().length > 0) {
          fullResponseText += filteredText;
          onTextChunk(filteredText);
        }
      }

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

      // Notify that tool execution is starting (for typing indicator)
      if (onToolStart) {
        onToolStart(toolUse.name, isMcpToolUse);
      }

      try {
        console.log('🔧 Calling executeTool with:', toolUse.name, toolUse.input);

        // Extract context for screenshot to understand what AI is looking for
        if (toolUse.name === 'screenshot') {
          const lastUserMsg = conversationMessages
            .filter(m => m.role === 'user')
            .slice(-1)[0];
          const userIntent = typeof lastUserMsg?.content === 'string'
            ? lastUserMsg.content
            : JSON.stringify(lastUserMsg?.content);

          const aiExplanation = fullResponseText || textContent?.text || '';

          console.log('📸 Screenshot Intent:', {
            userRequest: userIntent,
            aiExplanation: aiExplanation,
            currentUrl: currentUrl,
            lookingFor: aiExplanation || 'Unknown'
          });
        }

        const result = await executeTool(toolUse.name, toolUse.input);
        console.log('✅ Tool result:', result);

        // Handle screenshot results differently - include image data
        if (toolUse.name === 'screenshot' && result.success && result.screenshot) {
          // Extract base64 data from data URL
          const originalBase64 = result.screenshot.split(',')[1];
          const viewport = result.viewport || { width: 1280, height: 800, devicePixelRatio: 1 };
          const dpr = viewport.devicePixelRatio || 1;
          console.log('📐 Viewport Info:', {
            width: viewport.width,
            height: viewport.height,
            dpr: dpr,
            hasViewport: !!result.viewport
          });

          // Resize screenshot to fixed size so we know exactly what Claude sees
          // This is small enough that Claude won't resize it further
          const resized = await resizeScreenshotForClaude(originalBase64);

          // Calculate scale factors from image to viewport
          const scaleX = viewport.width / resized.width;
          const scaleY = viewport.height / resized.height;

          // Instructions with conversion formula
          const coordinateInstructions = `Screenshot captured.
📐 IMAGE SIZE: ${resized.width}×${resized.height}px
📐 VIEWPORT SIZE: ${viewport.width}×${viewport.height}px

⚠️ COORDINATE CONVERSION REQUIRED:
When you measure coordinates in this image, convert them to viewport coordinates:
  click_x = measured_x × ${scaleX.toFixed(2)}
  click_y = measured_y × ${scaleY.toFixed(2)}

Example: Element at image position (400, 300):
  click_x = 400 × ${scaleX.toFixed(2)} = ${Math.round(400 * scaleX)}
  click_y = 300 × ${scaleY.toFixed(2)} = ${Math.round(300 * scaleY)}
  Use: click({x: ${Math.round(400 * scaleX)}, y: ${Math.round(300 * scaleY)}})`;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'text',
                text: coordinateInstructions,
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: resized.base64,
                },
              },
            ],
          });
        } else {
          // Regular tool result
          // For navigation, check for errors and make them explicit
          if (toolUse.name === 'navigate') {
            if (result && typeof result === 'object') {
              if (result.success === false || result.error) {
                // Navigation failed - make error explicit
                const errorMsg = result.error || 'Navigation failed for unknown reason';
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    success: false,
                    error: `Navigation failed: ${errorMsg}. The page did not change. Please verify the URL is correct and try again.`,
                    attemptedUrl: result.url || toolUse.input?.url
                  }),
                  is_error: true,
                });
              } else if (result.success === true) {
                // Navigation succeeded - but still require verification
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    success: true,
                    url: result.url,
                    message: 'Navigation command executed. IMPORTANT: You must verify navigation succeeded by taking a screenshot to confirm the page actually changed.'
                  }),
                });
              } else {
                // Unknown result format
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                });
              }
            } else {
              // Non-object result
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              });
            }
          } else {
            // Non-navigation tool result
            // Check if result contains an error (e.g., from MCP tool timeout)
            if (result && typeof result === 'object' && result.error) {
              // Tool returned an error - mark it as an error so AI can respond
              const errorMessage = result.error || 'Tool execution failed';
              const isTimeout = result.timeout === true || errorMessage.includes('timed out') || errorMessage.includes('took too long');

              console.error(`❌ Tool "${toolUse.name}" returned an error:`, errorMessage);
              console.error(`   Timeout: ${isTimeout}`);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  error: errorMessage,
                  timeout: isTimeout
                }),
                is_error: true,
              });
            } else {
              // Normal successful result
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
              });
            }
          }
        }

        // Small delay between actions
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error('❌ Tool execution error:', error);
        const errorMessage = error.message || 'Tool execution failed';
        const isTimeout = errorMessage.includes('timed out') || errorMessage.includes('took too long');

        // Provide user-friendly error message for timeouts
        const friendlyError = isTimeout
          ? 'The request took too long and timed out. Please try again later or try a different approach.'
          : errorMessage;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({
            error: friendlyError,
            timeout: isTimeout
          }),
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

    console.log(`📝 Added tool results to conversation. Total messages: ${conversationMessages.length}`);
    console.log(`📝 Tool results:`, JSON.stringify(toolResults, null, 2));

    // Trim conversation to prevent context overflow during the loop
    // Keep only the most recent messages to avoid hitting limits
    // User can configure max loop history in settings
    const MAX_LOOP_MESSAGES = settings?.conversationLoopHistoryLength || 15; // Default: 15 messages (increased from 4)
    if (conversationMessages.length > MAX_LOOP_MESSAGES) {
      console.log(`⚠️  Trimming conversation from ${conversationMessages.length} to ${MAX_LOOP_MESSAGES} messages`);
      console.log(`⚠️  Turn: ${turnCount}, Before trim message roles:`, conversationMessages.map(m => m.role));

      // Smart trimming: Don't break tool_use/tool_result pairs
      // If the first message after trimming is a user message with tool_result,
      // we need to also include the previous assistant message with tool_use
      let trimmedMessages = conversationMessages.slice(-MAX_LOOP_MESSAGES);

      // Check if first message is a user message with tool_result content
      const firstMsg = trimmedMessages[0];
      if (firstMsg?.role === 'user' && Array.isArray(firstMsg.content)) {
        const hasToolResult = (firstMsg.content as any[]).some((item: any) => item.type === 'tool_result');
        if (hasToolResult) {
          // Find the index in original array and include one more message before it
          const firstMsgIndex = conversationMessages.length - MAX_LOOP_MESSAGES;
          if (firstMsgIndex > 0) {
            // Include the previous assistant message too
            trimmedMessages = conversationMessages.slice(-(MAX_LOOP_MESSAGES + 1));
            console.log(`   ↳ Included previous assistant message to preserve tool_use/tool_result pair`);
          }
        }
      }

      conversationMessages = trimmedMessages;
    }

    // CRITICAL: After adding tool results, we MUST continue the loop to let the AI process them
    // The stop_reason from the current response (which requested tools) doesn't matter here
    // because we've already executed the tools and added results to the conversation
    // We need to continue to the next iteration where:
    // - The tool results will be sent to the API
    // - The AI will process them and respond with text
    // - If that response has no tool uses, the loop will break at line 750-752
    // - If that response has stop_reason 'end_turn', we'll handle it then

    console.log(`🔄 Continuing loop to process tool results. Stop reason: ${data.stop_reason}, Tool results added: ${toolResults.length}`);
    console.log(`📝 Conversation messages count: ${conversationMessages.length}`);
    console.log(`📝 Last message role: ${conversationMessages[conversationMessages.length - 1]?.role}`);

    // Continue the loop - we just added tool results that need to be processed by the AI
    // The next iteration will send these results back and get the AI's response
    // IMPORTANT: The loop will continue to the next iteration where:
    // 1. A new API call will be made with the tool results
    // 2. The AI will process the tool results and respond
    // 3. If the response has text, it will be output
    // 4. If the response has no tool uses, the loop will break
    }

    // Check if we exited due to MAX_TURNS limit
    if (turnCount >= MAX_TURNS) {
      console.warn(`⚠️ Loop exited due to MAX_TURNS limit (${turnCount}/${MAX_TURNS})`);
      console.warn(`⚠️ This might indicate the conversation is stuck in a loop or needs more turns`);
      // Output a message to the user about the limit
      onTextChunk(`\n\n⚠️ Note: Reached maximum turn limit (${MAX_TURNS}). If you need to continue, please send a new message.`);
    }
  } catch (error: any) {
    console.error('❌ Error in tool execution loop:', error);
    console.error('   Turn count when error occurred:', turnCount);
    console.error('   Conversation messages count:', conversationMessages.length);

    // If we have partial response text, output it before error
    if (fullResponseText.trim().length > 0) {
      console.log(`📝 Outputting partial response before error: ${fullResponseText.length} chars`);
    }

    // Ensure we still call onComplete to clear states even on error
    // The error will be handled by the caller's try-catch
    // Re-throw the error so the caller can handle it
    throw error;
  }

  console.log(`🏁 streamAnthropicWithBrowserTools completed`);
  console.log(`🏁 Total turns: ${turnCount}/${MAX_TURNS}`);
  console.log(`🏁 Final conversation messages: ${conversationMessages.length}`);
  console.log(`🏁 Total response text length: ${fullResponseText.length} chars`);

  onComplete();
}
