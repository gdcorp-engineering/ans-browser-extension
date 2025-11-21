import type { Message } from './types';

export async function streamOpenAI(
  messages: Message[],
  apiKey: string,
  model: string,
  customBaseUrl: string | undefined,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  // Use GoCode (customBaseUrl) if provided, otherwise use OpenAI's default
  const baseUrl = customBaseUrl || 'https://api.openai.com';
  
  // System instruction for onboarding - include instructions for Step 3
  const systemInstruction = `When guiding users through onboarding (Step 3: GoCode Key), always include these instructions:

**How to get your GoCode Key:**
Get your GoCode Key from [GoCode (Alpha) - How to Get Started](https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha))

Include this link and instruction in Step 3 when asking for the GoCode Key.`;

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: systemInstruction,
        },
        ...messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      ],
      stream: true,
    }),
  };

  // Only add signal if it's a valid AbortSignal instance
  if (signal && signal instanceof AbortSignal) {
    fetchOptions.signal = signal;
  }

  // OpenAI uses /v1/chat/completions endpoint
  const endpoint = baseUrl.endsWith('/') 
    ? `${baseUrl}v1/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const response = await fetch(endpoint, fetchOptions);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API request failed');
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

        if (json.choices && json.choices[0]?.delta?.content) {
          onChunk(json.choices[0].delta.content);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
}

