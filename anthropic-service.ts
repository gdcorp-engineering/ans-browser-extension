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

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: validMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      system: `You are a helpful AI assistant for GoDaddy ANS.

IMPORTANT: You do NOT have browser automation capabilities in this mode. You cannot navigate to URLs, click elements, take screenshots, or interact with web pages directly.

If the user asks you to perform browser automation (navigate, click, type, screenshot, etc.):
1. Politely explain that browser tools are not currently enabled
2. Tell them to click the "○" button in the header to enable Browser Tools
3. DO NOT generate XML-like function call syntax (e.g., <function_calls>, <invoke>, etc.)
4. DO NOT pretend to execute actions you cannot perform

You can:
- Answer questions about web pages based on the page context provided
- Provide information and assistance
- Have helpful conversations
- Use any MCP tools that are available
- When MCP or trusted agent tools are available, ALWAYS inspect them first and call the one that directly satisfies the request before asking the user to enable browser tools. Only skip them if none match—explain your reasoning when you fall back.

Be clear and direct when explaining that browser automation requires enabling Browser Tools.`,
      stream: true,
    }),
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

        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          onChunk(json.delta.text);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
}
