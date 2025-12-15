import type { Message } from '../types';

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
 */
async function summarizeOldMessages(
  messages: Message[],
  keepRecentCount: number,
  apiKey: string,
  baseUrl: string
): Promise<Message[]> {
  if (messages.length <= keepRecentCount) {
    return messages;
  }

  const messagesToSummarize = messages.slice(0, -keepRecentCount);
  const recentMessages = messages.slice(-keepRecentCount);

  console.log(`🤖 Summarizing ${messagesToSummarize.length} old messages, keeping ${recentMessages.length} recent`);

  try {
    const conversationText = messagesToSummarize.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    const summaryPrompt = `Please provide a concise summary of this conversation history. Focus on key actions taken, decisions made, and important context that would be useful for continuing the conversation. Keep it under 300 words.

Conversation to summarize:
${conversationText}`;

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
          model: 'claude-3-5-haiku-20241022',
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
      return messages;
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

    const summaryMessage: Message = {
      id: `summary_${Date.now()}`,
      role: 'assistant',
      content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary - conversation continues below]`,
      mode: 'chat',
      timestamp: Date.now(),
    };

    return [summaryMessage, ...recentMessages];
  } catch (error) {
    console.error('Error summarizing messages:', error);
    return messages;
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
  additionalTools?: any[],
  currentUrl?: string,
  siteInstructions?: string,
  settings?: any,
  onToolStart?: (toolName: string, isMcpTool: boolean) => void,
  browserToolsEnabled: boolean = true
): Promise<void> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Anthropic API key is not configured. Please add your API key in Settings.');
  }

  const baseUrl = customBaseUrl || 'https://api.anthropic.com';

  const MAX_HISTORY_MESSAGES = settings?.conversationHistoryLength || 10;

  console.log(`🚀 streamAnthropicWithBrowserTools called with ${messages.length} messages`);

  let conversationMessages: Message[] = [];
  if (messages.length > MAX_HISTORY_MESSAGES) {
    console.log(`✂️ Trimming messages from ${messages.length} to ${MAX_HISTORY_MESSAGES}`);
    let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

    const firstMsg = trimmed[0];
    if (firstMsg?.role === 'user' && Array.isArray(firstMsg.content)) {
      const hasToolResult = (firstMsg.content as any[]).some((item: any) => item.type === 'tool_result');
      if (hasToolResult) {
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

  if (settings?.enableSmartSummarization !== false && conversationMessages.length > 8) {
    console.log('🤖 Smart summarization enabled, checking if summarization needed...');
    const keepRecentCount = Math.ceil(conversationMessages.length * 0.5);
    conversationMessages = await summarizeOldMessages(
      conversationMessages,
      keepRecentCount,
      apiKey,
      baseUrl
    );
  }

  let fullResponseText = '';

  const browserToolsToInclude = browserToolsEnabled ? BROWSER_TOOLS : [];
  const hasAdditionalTools = !!(additionalTools && additionalTools.length > 0);
  const mcpToolNames = (additionalTools || [])
    .filter((tool: any) => tool?.name && !tool.name.startsWith('a2a_'))
    .map((tool: any) => tool.name);
  const a2aToolNames = (additionalTools || [])
    .filter((tool: any) => tool?.name && tool.name.startsWith('a2a_'))
    .map((tool: any) => tool.name);
  const mcpToolNameSet = new Set(mcpToolNames);
  const a2aToolNameSet = new Set(a2aToolNames);
  
  const mcpToolsList = hasAdditionalTools ? (additionalTools || [])
    .filter((tool: any) => tool?.name && !tool.name.startsWith('a2a_'))
    .map((tool: any) => `  - ${tool.name}: ${tool.description || 'No description available'}`)
    .join('\n') : '';
  
  const allTools = hasAdditionalTools
    ? [...additionalTools, ...browserToolsToInclude]
    : browserToolsToInclude;

  console.log('🔧 Total merged tools:', allTools.length);

  const MAX_TURNS = 10;
  let turnCount = 0;

  try {
    while (turnCount < MAX_TURNS) {
      turnCount++;

      console.log('🔧 Anthropic Browser Tools - Turn', turnCount, `of ${MAX_TURNS}`);

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

      const validMessages = conversationMessages.filter(m => {
        if (!m.content) {
          console.warn('⚠️ Filtering out message with empty content:', m);
          return false;
        }
        if (typeof m.content === 'string') {
          return m.content.trim().length > 0;
        }
        const contentArray = m.content as any[];
        if (Array.isArray(contentArray)) {
          return contentArray.length > 0;
        }
        return true;
      });

      // Ensure we have at least one message
      if (validMessages.length === 0) {
        console.error('❌ No valid messages to send to API');
        throw new Error('No valid messages to send. Please try sending a message again.');
      }

      console.log(`📨 Sending ${validMessages.length} messages to API`);

      // Format messages for Anthropic API
      const formattedMessages = validMessages.map(m => {
        // Ensure content is properly formatted
        if (typeof m.content === 'string') {
          return {
            role: m.role,
            content: m.content,
          };
        } else if (Array.isArray(m.content)) {
          return {
            role: m.role,
            content: m.content,
          };
        } else {
          // Fallback: convert to string
          return {
            role: m.role,
            content: String(m.content || ''),
          };
        }
      });

      const requestBody = {
        model,
        max_tokens: 4096,
        tools: allTools,
        messages: formattedMessages,
        system: `You are a helpful AI assistant${browserToolsEnabled ? ' with browser automation capabilities. You can navigate to websites, click elements, type text, scroll pages, and take screenshots.' : '. Browser automation tools are NOT available in this mode - you cannot navigate, click, type, or take screenshots.'}

${browserToolsEnabled ? '' : `🚨 CRITICAL: Browser tools are DISABLED. You CANNOT navigate, click, type, or take screenshots.

🚫 ABSOLUTELY FORBIDDEN WHEN BROWSER TOOLS ARE DISABLED:
   - DO NOT write "[Executing: navigate]" or "[Executing: screenshot]" or any similar text
   - DO NOT pretend to execute browser tools in your text responses
   - DO NOT claim you are navigating, clicking, typing, or taking screenshots
   - DO NOT describe what you "see" after pretending to navigate

✅ WHAT TO DO INSTEAD:
   - When users ask to navigate (e.g., "go to Amazon", "navigate to X", "open Y"), you MUST respond with:
     "I don't have browser automation capabilities enabled. Please navigate to [URL] manually in your browser."
   - Be direct and clear - do not pretend or simulate browser actions`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNDERSTANDING USER INTENT - CHOOSE THE RIGHT TOOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 CRITICAL: Read the user's request carefully to understand their INTENT, then READ TOOL DESCRIPTIONS to find the right tool.

${browserToolsEnabled ? `BROWSER TOOLS (always use for these):
   - Navigation: "go to", "navigate to", "open", "visit" → navigate tool
   - Interaction: "click", "type", "press", "select" → click/type tools
   - Information: "screenshot", "get page context" → screenshot/getPageContext tools` : `BROWSER TOOLS ARE DISABLED:
   - Navigation requests (e.g., "go to", "navigate to", "open", "visit") → Tell user to navigate manually
   - Interaction requests (e.g., "click", "type", "press", "select") → Tell user these actions are not available
   - Information requests (e.g., "screenshot", "get page context") → Tell user these features are not available`}

MCP TOOLS (check descriptions):
   - Read each MCP tool's description to understand what it does
   - Use MCP tools when their description matches the user's request
   - 🚨 When an MCP tool matches → Use it DIRECTLY, do NOT use browser tools first

${mcpPrioritySection}
${siteInstructionsSection}

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
   - DO NOT pretend to execute tools in your text responses
   - Instead, tell the user to perform the action manually`}`,
      };

      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      };

      if (signal && signal instanceof AbortSignal) {
        fetchOptions.signal = signal;
      }

      let response;
      try {
        const timeoutMs = 180000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('API request timed out after 3 minutes')), timeoutMs);
        });
        
        response = await Promise.race([
          fetch(`${baseUrl}/v1/messages`, fetchOptions),
          timeoutPromise
        ]);
      } catch (fetchError: any) {
        console.error('❌ Network Error:', fetchError);
        throw new Error(
          '🔌 Cannot reach Anthropic API endpoint.\n\n' +
          'Please check your API key and network connection.'
        );
      }

      if (!response.ok) {
        let errorMsg = 'Anthropic API request failed';
        try {
          const error = await response.json();
          console.error('❌ API Error:', error);
          errorMsg = error.error?.message || errorMsg;
          if (errorMsg.includes('too long') || errorMsg.includes('Input is too long')) {
            throw new Error('Context limit exceeded. Please start a new chat to continue.');
          }
        } catch (parseError) {
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
        throw new Error('API returned non-JSON response');
      }

      if (!data || typeof data !== 'object') {
        console.error('❌ Invalid response structure:', data);
        throw new Error('API returned invalid response structure');
      }

      if (!data.content || !Array.isArray(data.content)) {
        console.error('❌ Response missing content array:', data);
        throw new Error('API response missing content array');
      }

      const textContent = data.content?.find((c: any) => c.type === 'text');
      
      if (data.content.length === 0) {
        console.error('❌ Response has no content items');
        throw new Error('API returned empty response - no content items');
      }
      
      if (textContent?.text) {
        let filteredText = textContent.text;
        filteredText = filteredText.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '');
        filteredText = filteredText.replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/gi, '');
        filteredText = filteredText.replace(/<parameter\s+name="[^"]*">[^<]*<\/parameter>/gi, '');
        filteredText = filteredText.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
        filteredText = filteredText.replace(/<function>[\s\S]*?<\/function>/gi, '');
        
        if (!browserToolsEnabled) {
          filteredText = filteredText.replace(/\[Executing:\s*[^\]]+\]/gi, '');
          filteredText = filteredText.replace(/I'll navigate to[^.]*\./gi, '');
          filteredText = filteredText.replace(/I've successfully navigated to[^.]*\./gi, '');
        }
        
        if (filteredText.trim().length > 0) {
          fullResponseText += filteredText;
          onTextChunk(filteredText);
        }
      }

      const toolUses = data.content?.filter((c: any) => c.type === 'tool_use') || [];

      if (toolUses.length === 0) {
        console.log(`✅ No more tools to execute. Stop reason: ${data.stop_reason}`);
        break;
      }

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
        onTextChunk(`${JSON.stringify(toolUse.input)}\n`);

        if (onToolStart) {
          onToolStart(toolUse.name, isMcpToolUse);
        }

        try {
          const result = await executeTool(toolUse.name, toolUse.input);
          console.log('✅ Tool result:', result);

          if (toolUse.name === 'screenshot' && result.success && result.screenshot) {
            const base64Data = result.screenshot.split(',')[1];
            const viewport = result.viewport || { width: 1280, height: 800, devicePixelRatio: 1 };
            const dpr = viewport.devicePixelRatio || 1;
            const coordinateInstructions = `Click Task Procedure:
Step 1. Measure the attached image dimensions in pixels to obtain: image_width and image_height.
Step 2. Locate the center point of the element in the screenshot and record its pixel coordinates as: screenshot_x and screenshot_y
Step 3. Apply the following conversion formulas to calculate viewport coordinates:
   * viewport_x = (screenshot_x * ${viewport.width}) / (image_width )
   * viewport_y = (screenshot_y * ${viewport.height}) / (image_height)
Step 4. Output the final click coordinates as: (viewport_x, viewport_y).`;
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
            if (toolUse.name === 'navigate') {
              if (result && typeof result === 'object') {
                if (result.success === false || result.error) {
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
                  toolResults.push({
                    type: 'tool_result',
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(result),
                  });
                }
              } else {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                });
              }
            } else {
              if (result && typeof result === 'object' && result.error) {
                const errorMessage = result.error || 'Tool execution failed';
                const isTimeout = result.timeout === true || errorMessage.includes('timed out') || errorMessage.includes('took too long');
                
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
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                });
              }
            }
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          console.error('❌ Tool execution error:', error);
          const errorMessage = error.message || 'Tool execution failed';
          const isTimeout = errorMessage.includes('timed out') || errorMessage.includes('took too long');
          
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

      conversationMessages.push({
        id: Date.now().toString(),
        role: 'assistant',
        content: data.content,
      } as any);

      conversationMessages.push({
        id: (Date.now() + 1).toString(),
        role: 'user',
        content: toolResults,
      } as any);

      const MAX_LOOP_MESSAGES = settings?.conversationLoopHistoryLength || 15;
      if (conversationMessages.length > MAX_LOOP_MESSAGES) {
        console.log(`⚠️  Trimming conversation from ${conversationMessages.length} to ${MAX_LOOP_MESSAGES} messages`);
        let trimmedMessages = conversationMessages.slice(-MAX_LOOP_MESSAGES);

        const firstMsg = trimmedMessages[0];
        if (firstMsg?.role === 'user' && Array.isArray(firstMsg.content)) {
          const hasToolResult = (firstMsg.content as any[]).some((item: any) => item.type === 'tool_result');
          if (hasToolResult) {
            const firstMsgIndex = conversationMessages.length - MAX_LOOP_MESSAGES;
            if (firstMsgIndex > 0) {
              trimmedMessages = conversationMessages.slice(-(MAX_LOOP_MESSAGES + 1));
              console.log(`   ↳ Included previous assistant message to preserve tool_use/tool_result pair`);
            }
          }
        }

        conversationMessages = trimmedMessages;
      }
    }
    
    if (turnCount >= MAX_TURNS) {
      console.warn(`⚠️ Loop exited due to MAX_TURNS limit (${turnCount}/${MAX_TURNS})`);
      onTextChunk(`\n\n⚠️ Note: Reached maximum turn limit (${MAX_TURNS}). If you need to continue, please send a new message.`);
    }
  } catch (error: any) {
    console.error('❌ Error in tool execution loop:', error);
    throw error;
  }

  console.log(`🏁 streamAnthropicWithBrowserTools completed`);
  onComplete();
}

