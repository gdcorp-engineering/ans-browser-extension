import type { Message } from './types';

export async function streamAnthropic(
  messages: Message[],
  apiKey: string,
  model: string,
  customBaseUrl: string | undefined,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const baseUrl = customBaseUrl || 'https://api.anthropic.com';

  // System instruction for onboarding - include instructions for Step 3
  const systemInstruction = `When guiding users through onboarding (Step 3: GoCode Key), always include these instructions:

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

  const response = await fetch(`${baseUrl}/v1/messages`, fetchOptions);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Anthropic API request failed');
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
          console.debug(`[Anthropic Service] Received unexpected chunk type: ${json.type}`, json);
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
