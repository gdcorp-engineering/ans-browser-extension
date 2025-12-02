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

  // Build messages with image support
  const buildMessages = (messages: Message[]) => {
    return messages.map(m => {
      const messageContent: any[] = [];
      
      // Add text content
      if (m.content) {
        messageContent.push({
          type: 'text',
          text: m.content
        });
      }
      
      // Add images if present
      if (m.images && m.images.length > 0) {
        m.images.forEach(img => {
          messageContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.mime_type};base64,${img.data}`
            }
          });
        });
      }
      
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: messageContent.length === 1 && messageContent[0].type === 'text' 
          ? m.content 
          : messageContent
      };
    });
  };

  const requestBody: any = {
    model,
    messages: [
      {
        role: 'system',
        content: systemInstruction,
      },
      ...buildMessages(messages),
    ],
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
      console.log(`🔵 [OpenAI Service] Mode parameter included: ${lastUserMessage.mode}`);
    }
  }

  const fetchOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
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
