import type { Message } from './types';

// Browser tool definitions for Anthropic API
// Note: Screenshot resizing is now handled in background.ts to ensure saved screenshots match what Claude sees
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

    const requestBody = {
      model,
      max_tokens: 4096,
      tools: allTools,
      messages: validMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: `You are a helpful AI assistant${browserToolsEnabled ? ' with browser automation capabilities. You can navigate to websites, click elements, type text, scroll pages, and take screenshots.' : '. Browser automation tools are NOT available in this mode - you cannot navigate, click, type, or take screenshots.'}

${browserToolsEnabled ? '' : `🚨 CRITICAL: Browser tools are DISABLED. You CANNOT navigate, click, type, or take screenshots.

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
   - Simply tell the user to perform the action manually`}

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
${browserToolsEnabled ? `   - Navigation/interaction → Always use browser tools (navigate, click, type, screenshot)
   - Specialized tasks → Check MCP tool descriptions - if one matches, use it DIRECTLY (no browser tools)` : `   - Navigation/interaction → Browser tools are NOT available - tell user to do it manually
   - Specialized tasks → Check MCP tool descriptions - if one matches, use it DIRECTLY`}

${browserToolsEnabled ? `BROWSER TOOLS (always use for these):
   - Navigation: "go to", "navigate to", "open", "visit" → navigate tool
   - Interaction: "click", "type", "press", "select" → click/type tools
   - Information: "screenshot", "get page context" → screenshot/getPageContext tools` : `BROWSER TOOLS ARE DISABLED:
   - Navigation requests (e.g., "go to", "navigate to", "open", "visit") → Tell user to navigate manually
   - Interaction requests (e.g., "click", "type", "press", "select") → Tell user these actions are not available
   - Information requests (e.g., "screenshot", "get page context") → Tell user these features are not available`}

${mcpPrioritySection}

${browserToolsEnabled ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERAL BROWSER INTERACTION FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSTRUCTION HIERARCHY:
1. If MCP tools available AND one matches the task → Use MCP tool DIRECTLY (skip all browser automation)
2. If site-specific instructions above → Follow those for this site
3. Always use general patterns below as foundation/fallback

CORE PRINCIPLES:
✓ If MCP tool matches task → Use it DIRECTLY, do NOT navigate or take screenshots first
✓ ALL navigation happens in SAME TAB - never open new tabs (only when using browser tools)
✓ Understand before acting - take screenshot to see page first (only when using browser tools)
✓ One action at a time - verify success before continuing
✓ Prefer DOM methods over coordinates for reliability
✓ When typing in search inputs, Enter is AUTOMATICALLY pressed`
: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
✓ Be helpful and suggest what the user can do manually`}

STEP 1: UNDERSTAND THE PAGE
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
→ If action fails, go back to STEP 2, identify the elements you need to interact with, and try again. If you still fail, take screenshot to diagnose why.

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
1. Use navigate({url: "https://example.com"}) to change pages
2. CRITICAL: Navigation can FAIL - always check the result:
   - Check the tool result for {success: false, error: "..."} - if present, navigation FAILED
   - If navigation failed, report the error to the user immediately
   - DO NOT claim navigation succeeded if you see success: false or an error message
   - Even if success: true, ALWAYS verify by taking a screenshot
   - Check if the page content matches the expected destination
   - If you're still on the wrong page, navigation failed - report the error clearly
   - DO NOT assume navigation succeeded - verify with a screenshot every time
3. For in-page navigation (clicking links):
   - Look for navigation menu - typically in header, top bar, or left sidebar
   - Common navigation patterns:
     - Horizontal nav bar at top
     - Hamburger menu icon (☰) that expands
     - Left sidebar with links
     - Breadcrumbs showing page hierarchy
   - Click links to navigate - verify URL changes or page content updates

📊 EXTRACTING DATA:
1. Use getPageContext to read text content and structure
2. Identify data containers: tables (thead/tbody), lists (ul/ol), cards, sections
3. Extract systematically: headers first, then row by row or item by item
4. Return structured data to user

🎯 CLICKING ELEMENTS:
Preference order:
1. clickElement with text: clickElement({text: "Sign In"})
2. clickElement with selector: clickElement({selector: "button.login"})
3. Coordinate click (last resort): click({x: 100, y: 200})

For coordinate clicks (screenshots are resized with max 1280px on longest edge):
⚠️ Screenshots are resized to fit within 1280px (longest edge), maintaining aspect ratio.
⚠️ You MUST convert your measurements to viewport coordinates using the scale factors provided.

CONVERSION PROCESS:
1. Measure the element's center position in the screenshot (x, y)
2. Apply the scale factors shown in the screenshot result:
   click_x = measured_x × scale_x
   click_y = measured_y × scale_y
3. Use the converted coordinates: click({x: click_x, y: click_y})

TIPS FOR ACCURATE CLICKING:
- Measure to the CENTER of the entire clickable element (not just the text)
- Include badges, icons, padding - click center of whole control
- For tabs like "Assigned to me 11", measure center of entire tab including badge
- Being off by 20-30px can miss the target - be precise with measurements
- ALWAYS apply the scale factors before clicking!

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
  - Try alternative selectors (id, class, text, parent/child)
  - Check if element is hidden or in different section
  - Take screenshot to see current state

→ Click failed:
  - Take screenshot to see current state
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

→ Tool timeout:
  - If a tool result contains {error: "...timed out..."} or {timeout: true}, the tool request took too long
  - Respond to the user with a friendly message explaining the timeout
  - Suggest alternatives: "The request timed out. Please try again later or try a different approach."
  - Do NOT leave the conversation hanging - always provide a helpful response

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

For navigation specifically:
   - If result shows {success: false, error: "..."}, navigation FAILED
   - Report the error to the user: "Navigation failed: [error message]"
   - DO NOT claim you navigated successfully if there's an error
   - Even if success: true, verify with a screenshot

${browserToolsEnabled ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL USAGE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

getPageContext: ALWAYS call first to understand page structure
screenshot: Use when you need visual understanding or coordinates
clickElement: Preferred method - works with selectors or text
click: Last resort - requires screenshot first for coordinates
type: For inputs - automatically presses Enter for search boxes
scroll: To bring content into view
pressKey: For special keys like Enter, Tab, Escape
navigate: To change pages - always in same tab. CHECK FOR ERRORS in result!` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL: TOOL CALLING FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 NEVER output XML-like syntax in your text responses:
   - DO NOT write: <function_calls>, <invoke>, <parameter>, etc.
   - DO NOT write: <tool_call>, <function>, etc.
   - DO NOT write any XML tags in your text

${browserToolsEnabled ? `✅ ALWAYS use the proper tool calling mechanism:
   - Tools are called automatically through the API's tool_use format
   - You just need to think about which tool to use
   - The system will handle the actual tool execution
   - Describe what you're doing in natural language, but don't write XML` : `🚫 CRITICAL: Browser tools are DISABLED - NEVER write tool execution text:
   - DO NOT write "[Executing: navigate]" or "[Executing: screenshot]" or any similar format
   - DO NOT write "[Executing: toolName]" - this format is FORBIDDEN when browser tools are disabled
   - DO NOT pretend to execute tools in your text responses
   - DO NOT claim you are using tools or have used tools
   - Instead, tell the user to perform the action manually`}

${browserToolsEnabled ? `✅ When you want to use a tool:
   - Think: "I need to navigate to Amazon"
   - The system will automatically call the navigate tool
   - You'll see the result and can describe it naturally
   - DO NOT claim navigation succeeded unless you can see the target page in the getPageContext result
   - If navigation failed, report the error clearly

Remember: Take your time, verify each step, and describe what you see before acting. When in doubt, use getPageContext to understand the page!` : `✅ When browser tools are disabled:
   - If user asks to navigate → Tell them: "I don't have browser automation enabled. Please navigate to [URL] manually in your browser."
   - If user asks to click/interact → Tell them: "I don't have browser automation enabled. Please perform this action manually."
   - DO NOT attempt to use browser tools - they are not available
   - DO NOT claim you can navigate or interact - you cannot
   - Be helpful and clear about what you can and cannot do

Remember: When browser tools are disabled, always tell users to perform browser actions manually.`}`,
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
          // Screenshot is already resized in background.ts - extract base64 data
          const base64Data = result.screenshot.split(',')[1];
          const viewport = result.viewport || { width: 1280, height: 800, devicePixelRatio: 1 };
          const imageSize = result.imageSize || { width: viewport.width, height: viewport.height };

          console.log('📐 Screenshot Info:', {
            imageWidth: imageSize.width,
            imageHeight: imageSize.height,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height
          });

          // Calculate scale factors from image to viewport
          const scaleX = viewport.width / imageSize.width;
          const scaleY = viewport.height / imageSize.height;

          // Instructions with conversion formula
          const coordinateInstructions = `Screenshot captured.
📐 IMAGE SIZE: ${imageSize.width}×${imageSize.height}px
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
                  data: base64Data,
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
