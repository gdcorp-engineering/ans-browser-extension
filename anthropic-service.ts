import type { Message } from './types';

export async function streamAnthropic(
  messages: Message[],
  apiKey: string,
  model: string,
  customBaseUrl: string | undefined,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  // Validate API key before making request
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('GoCode Key is not configured. Please add your GoCode Key in Settings (⚙️ icon).');
  }

  // Always use GoCode endpoint - no direct Anthropic API access
  const baseUrl = customBaseUrl || 'https://caas-gocode-prod.caas-prod.prod.onkatana.net';

  // Filter out messages with empty content (API requirement)
  const validMessages = messages.filter(m => {
    if (!m.content) {
      console.warn('⚠️ Filtering out message with empty content:', m);
      return false;
    }
    // Handle both string and array content
    if (typeof m.content === 'string') {
      return m.content.trim().length > 0;
    }
    if (Array.isArray(m.content)) {
      return m.content.length > 0;
    }
    return true;
  });

  console.log(`📨 Sending ${validMessages.length} messages to API (filtered ${messages.length - validMessages.length} empty)`);

  // System instruction - merge onboarding guidance with browser tools restrictions
  const systemInstruction = `You are a helpful AI assistant for GoDaddy ANS.

IMPORTANT: You do NOT have browser automation capabilities in this mode. You cannot navigate to URLs, click elements, take screenshots, or interact with web pages directly.

DO NOT mention that browser tools are not enabled unless the user explicitly asks about browser automation or you cannot complete their request with available tools.

You can:
- Answer questions about web pages based on the page context provided
- Provide information and assistance
- Have helpful conversations
- Use any MCP tools that are available
- When MCP or trusted agent tools are available, ALWAYS use them to fulfill the request. Do not mention browser tools unless absolutely necessary.

If the user asks for browser automation and you cannot complete it with available tools:
1. First try to use MCP/trusted agent tools if available
2. Only if no tools can help, briefly mention that browser automation requires enabling Browser Tools
3. DO NOT generate XML-like function call syntax (e.g., <function_calls>, <invoke>, etc.)
4. DO NOT pretend to execute actions you cannot perform

Focus on using available tools to help the user, not on what you cannot do.

When guiding users through onboarding (Step 3: GoCode Key), always include these instructions:

**How to get your GoCode Key:**
Get your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))

Include this link and instruction in Step 3 when asking for the GoCode Key.`;

  // Build messages with image support
  const buildMessages = (messages: Message[]) => {
    return messages.map(m => {
      const content: any[] = [];
      
      // Add text content
      if (m.content) {
        content.push({
          type: 'text',
          text: m.content
        });
      }
      
      // Add images if present
      if (m.images && m.images.length > 0) {
        m.images.forEach(img => {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mime_type,
              data: img.data
            }
          });
        });
      }
      
      return {
        role: m.role,
        content: content.length === 1 && content[0].type === 'text'
          ? m.content
          : content
      };
    });
  };

  const requestBody: any = {
    model,
    max_tokens: 4096,
    system: systemInstruction,
    messages: buildMessages(messages),
    stream: true,
  };

  // Add file metadata and mode if using GoCaaS (customBaseUrl)
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  if (customBaseUrl) {
    if (lastUserMessage?.chat_files_metadata && lastUserMessage.chat_files_metadata.length > 0) {
      requestBody.chat_files_metadata = lastUserMessage.chat_files_metadata;
    }
    // Add mode parameter for GoCaaS integration (create_image, thinking, deep_research, study_and_learn, web_search, canvas, browser_memory)
    if (lastUserMessage?.mode) {
      requestBody.mode = lastUserMessage.mode;
      console.log(`🔵 [Anthropic Service] Mode parameter included: ${lastUserMessage.mode}`);
    }
  }

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
    response = await fetch(`${baseUrl}/v1/messages`, fetchOptions);
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
      errorMsg = error.error?.message || errorMsg;
    } catch (parseError) {
      // Response is not JSON (likely HTML error page)
      const text = await response.text();
      console.error('❌ Non-JSON API Error Response:', text.substring(0, 200));
      errorMsg = `API Error (${response.status} ${response.statusText}). Please check your GoCode key and settings.`;
    }

    throw new Error(errorMsg);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;
  let textChunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data: ')) continue;

      const data = line.slice(6); // Remove 'data: ' prefix
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        chunkCount++;

        // Handle content_block_delta with text_delta
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          if (json.delta.text) {
            textChunkCount++;
            onChunk(json.delta.text);
          }
        }
        // Handle other response types that might contain text
        else if (json.type === 'content_block' && json.content?.type === 'text') {
          if (json.content.text) {
            textChunkCount++;
            onChunk(json.content.text);
          }
        }
        // Handle message_delta (alternative format)
        else if (json.type === 'message_delta' && json.delta?.text) {
          textChunkCount++;
          onChunk(json.delta.text);
        }
        // Log unexpected types for debugging
        else if (json.type) {
          // Security: Use separate arguments instead of template literal to avoid format string issues
          // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
          console.debug('[Anthropic Service] Received unexpected chunk type:', json.type, json);
        }
      } catch (e) {
        // Log parsing errors for debugging
        console.warn('[Anthropic Service] Failed to parse chunk:', data.substring(0, 100), e);
      }
    }
  }

  // Log summary for debugging
  if (chunkCount > 0 && textChunkCount === 0) {
    console.warn(`[Anthropic Service] Received ${chunkCount} chunks but no text content. This may indicate a response format issue.`);
  }
}
