/**
 * Computer Use Service for Electron Browser
 * Integrates with Google Gemini 2.5 Computer Use model
 * Only available in browser mode with proper coordinate scaling
 */

import { BrowserView } from 'electron';
import { SYSTEM_PROMPTS } from '../constants/systemPrompts';

export interface ScreenshotData {
  data: string; // base64 data without data URI prefix
  width: number;
  height: number;
}

export interface PageContext {
  url: string;
  viewport?: {
    width: number;
    height: number;
  };
}

export class ComputerUseService {
  private browserView: BrowserView | null = null;
  private apiKey: string = '';
  private provider: string = 'google';
  private model: string = 'gemini-2.5-computer-use-preview-10-2025';
  private baseUrl?: string;

  constructor(
    browserView: BrowserView,
    apiKey: string,
    provider: string = 'google',
    model?: string,
    baseUrl?: string
  ) {
    this.browserView = browserView;
    this.apiKey = apiKey;
    this.provider = provider;
    this.baseUrl = baseUrl;

    // Set model based on provider if not specified
    if (model) {
      this.model = model;
    } else if (provider === 'anthropic') {
      this.model = 'claude-sonnet-4-5-20250929';
    } else {
      this.model = 'gemini-2.5-computer-use-preview-10-2025';
    }
  }

  /**
   * Capture screenshot from the browser view
   */
  async captureScreenshot(): Promise<ScreenshotData> {
    if (!this.browserView) {
      throw new Error('BrowserView not available');
    }

    try {
      // Wait for page to be ready before capturing
      const webContents = this.browserView.webContents;

      // If page is still loading, wait for it
      if (webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          const loadFinished = () => {
            webContents.removeListener('did-finish-load', loadFinished);
            resolve();
          };
          webContents.once('did-finish-load', loadFinished);
          // Timeout after 5 seconds
          setTimeout(loadFinished, 5000);
        });
      }

      const image = await this.browserView.webContents.capturePage();
      const dataUrl = image.toDataURL();

      // Extract base64 data without the data URI prefix
      if (!dataUrl || !dataUrl.includes(',')) {
        throw new Error('Invalid screenshot data format');
      }

      const base64Data = dataUrl.split(',')[1];

      if (!base64Data || base64Data.length === 0) {
        throw new Error('Failed to extract base64 data from screenshot');
      }

      const bounds = this.browserView.getBounds();
      return {
        data: base64Data,
        width: bounds.width,
        height: bounds.height
      };
    } catch (error) {
      throw new Error(`Failed to capture screenshot: ${(error as Error).message}`);
    }
  }

  /**
   * Get page context (URL and viewport info)
   */
  async getPageContext(): Promise<PageContext> {
    if (!this.browserView) {
      throw new Error('BrowserView not available');
    }

    try {
      const url = this.browserView.webContents.getURL();
      const bounds = this.browserView.getBounds();

      return {
        url,
        viewport: {
          width: bounds.width,
          height: bounds.height
        }
      };
    } catch (error) {
      return {
        url: 'about:blank',
        viewport: { width: 1400, height: 900 }
      };
    }
  }

  /**
   * Scale coordinates from Gemini's 1000x1000 grid to actual viewport
   */
  async scaleCoordinates(x: number, y: number): Promise<{ x: number; y: number }> {
    try {
      const context = await this.getPageContext();
      const viewportWidth = context.viewport?.width || 1400;
      const viewportHeight = context.viewport?.height || 900;

      // Gemini uses 1000x1000 normalized coordinates
      const scaledX = Math.round((x / 1000) * viewportWidth);
      const scaledY = Math.round((y / 1000) * viewportHeight);

      return { x: scaledX, y: scaledY };
    } catch (error) {
      return { x, y };
    }
  }

  /**
   * Execute browser action from Gemini function call
   */
  async executeBrowserAction(functionName: string, args: any): Promise<any> {
    if (!this.browserView) {
      throw new Error('BrowserView not available');
    }

    switch (functionName) {
      case 'click':
      case 'click_at':
      case 'mouse_click': {
        const coords = await this.scaleCoordinates(
          args.x || args.coordinate?.x || 0,
          args.y || args.coordinate?.y || 0
        );

        return new Promise((resolve) => {
          this.browserView!.webContents.executeJavaScript(`
            (function() {
              const element = document.elementFromPoint(${coords.x}, ${coords.y});
              if (element) {
                const event = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: ${coords.x},
                  clientY: ${coords.y}
                });
                element.dispatchEvent(event);
                return { success: true, element: element.tagName };
              }
              return { success: false, message: 'No element found' };
            })();
          `).then(result => resolve(result)).catch(() => resolve({ success: false }));
        });
      }

      case 'type':
      case 'type_text':
      case 'type_text_at':
      case 'keyboard_input': {
        return new Promise((resolve) => {
          // If coordinates provided, click first
          if (args.x !== undefined && args.y !== undefined) {
            this.scaleCoordinates(args.x, args.y).then(coords => {
              this.browserView!.webContents.executeJavaScript(`
                document.elementFromPoint(${coords.x}, ${coords.y})?.click?.();
              `).then(() => {
                setTimeout(() => this.typeText(args.text || args.content).then(resolve), 500);
              }).catch(() => resolve({ success: false }));
            });
          } else {
            this.typeText(args.text || args.content).then(resolve);
          }
        });
      }

      case 'scroll':
      case 'scroll_down':
      case 'scroll_up':
      case 'mouse_scroll': {
        const direction = functionName === 'scroll_up' ? -1 : 1;
        const amount = args.amount || args.pixels || args.delta || 500;

        return new Promise((resolve) => {
          this.browserView!.webContents.executeJavaScript(`
            window.scrollBy(0, ${direction * amount});
            { success: true, message: 'Scrolled' };
          `).then(() => resolve({ success: true })).catch(() => resolve({ success: false }));
        });
      }

      case 'navigate':
      case 'open_web_browser':
      case 'navigate_to':
      case 'go_to': {
        const url = args.url || args.address || args.uri;
        if (!url) {
          return { success: false, error: 'No URL provided for navigation' };
        }

        // Ensure URL has protocol
        let finalUrl = url;
        if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
          finalUrl = 'https://' + finalUrl;
        }

        return new Promise((resolve) => {
          this.browserView!.webContents.loadURL(finalUrl)
            .then(() => resolve({ success: true, url: finalUrl }))
            .catch(err => resolve({ success: false, error: (err as Error).message }));
        });
      }

      case 'wait':
      case 'sleep':
      case 'delay': {
        const seconds = args.seconds || (args.milliseconds ? args.milliseconds / 1000 : 1);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        return { success: true, message: `Waited ${seconds}s` };
      }

      case 'wait_5_seconds': {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { success: true, message: 'Waited 5 seconds' };
      }

      case 'get_screenshot':
      case 'screenshot': {
        const screenshot = await this.captureScreenshot();
        return { success: true, screenshot: screenshot.data };
      }

      default:
        return { success: false, error: `Unknown function: ${functionName}` };
    }
  }

  /**
   * Helper to type text into focused element
   */
  private async typeText(text: string): Promise<any> {
    return new Promise((resolve) => {
      this.browserView!.webContents.executeJavaScript(`
        (function() {
          const el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute?.('contenteditable'))) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.value = (el.value || '') + '${text.replace(/'/g, "\\'")}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              el.textContent = (el.textContent || '') + '${text}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { success: true };
          }
          return { success: false, error: 'No focused element' };
        })();
      `).then(result => resolve(result)).catch(() => resolve({ success: false }));
    });
  }

  /**
   * Stream chat with Computer Use (routes to appropriate provider)
   */
  async *streamWithComputerUse(
    userMessage: string,
    messageHistory: Array<{ role: string; content: string }>
  ): AsyncGenerator<any> {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    // Route to the appropriate provider implementation
    if (this.provider === 'anthropic') {
      yield* this.streamWithAnthropic(userMessage, messageHistory);
    } else {
      yield* this.streamWithGemini(userMessage, messageHistory);
    }
  }

  /**
   * Stream chat with Gemini Computer Use model
   */
  private async *streamWithGemini(
    userMessage: string,
    messageHistory: Array<{ role: string; content: string }>
  ): AsyncGenerator<any> {
    // Capture initial screenshot
    let screenshot = await this.captureScreenshot();
    let pageContext = await this.getPageContext();

    const systemInstruction = SYSTEM_PROMPTS.WEB;

    const contents: any[] = [];

    // Add conversation history
    for (const msg of messageHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    // Add current message with screenshot
    if (!screenshot.data) {
      throw new Error('Screenshot data is empty - cannot proceed with computer use');
    }

    contents.push({
      role: 'user',
      parts: [
        { text: userMessage },
        {
          inline_data: {
            mime_type: 'image/png',
            data: screenshot.data
          }
        }
      ]
    });

    const maxTurns = 30;
    let responseText = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const requestBody = {
        contents,
        tools: [{
          computer_use: {
            environment: 'ENVIRONMENT_BROWSER'
          }
        }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 1.0 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

      const candidate = data.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];

      // Add model response to conversation first (important!)
      contents.push(candidate.content);

      // Check if there are function calls
      const hasFunctionCalls = parts.some((p: any) => 'functionCall' in p && p.functionCall);

      if (!hasFunctionCalls) {
        // No more actions - task complete
        for (const part of parts) {
          if ('text' in part && typeof part.text === 'string') {
            responseText += part.text;
            yield { type: 'text', content: part.text };
          }
        }
        break;
      }

      // Stream any text responses from Gemini immediately
      for (const part of parts) {
        if ('text' in part && typeof part.text === 'string') {
          responseText += part.text + '\n';
          // Yield text response immediately so UI shows thinking/planning
          yield { type: 'text', content: part.text };
        }
      }

      // Execute function calls
      const functionResponses: any[] = [];

      for (const part of parts) {
        if ('functionCall' in part && part.functionCall) {
          const funcName = part.functionCall.name;
          const funcArgs = part.functionCall.args || {};

          // Emit function call as text so it shows in UI (like "[Executing: click]")
          const actionText = `\n**[Executing: ${funcName}]**\n`;
          yield { type: 'text', content: actionText };
          yield { type: 'action', action: { name: funcName, args: funcArgs } };

          // Execute the browser action
          const result = await this.executeBrowserAction(funcName, funcArgs);

          // Wait longer after navigation actions for page to load
          const isNavigationAction = ['navigate', 'open_web_browser', 'navigate_to', 'go_to', 'click', 'click_at', 'mouse_click', 'go_back', 'back', 'go_forward', 'forward'].includes(funcName);
          if (isNavigationAction) {
            await new Promise(resolve => setTimeout(resolve, 2500)); // Wait 2.5 seconds
          } else {
            await new Promise(resolve => setTimeout(resolve, 500)); // Normal wait
          }

          // Capture new screenshot
          screenshot = await this.captureScreenshot();
          pageContext = await this.getPageContext();

          // Build function response (matching chrome extension format)
          const functionResponse: any = {
            name: funcName,
            response: {
              ...result,
              url: pageContext.url,
              viewport_info: pageContext.viewport ? ` Viewport: ${pageContext.viewport.width}x${pageContext.viewport.height}` : '',
              success: result.success !== false
            }
          };

          functionResponses.push(functionResponse);

          // Emit result message so UI shows feedback
          if (result.success) {
            const resultText = `${result.message || 'Action completed successfully'}`;
            yield { type: 'text', content: resultText };
          } else {
            const resultText = ` ${result.error || result.message || 'Action failed'}`;
            yield { type: 'text', content: resultText };
          }

          yield { type: 'result', result };
        }
      }

      // Add function responses back to conversation with new screenshot
      if (functionResponses.length > 0) {
        const userParts: any[] = functionResponses.map(fr => ({
          function_response: fr
        }));

        // Add new screenshot
        if (screenshot && screenshot.data) {
          userParts.push({
            inline_data: {
              mime_type: 'image/png',
              data: screenshot.data
            }
          });
        }

        contents.push({
          role: 'user',
          parts: userParts
        });
      }
    }

    yield { type: 'complete', content: responseText };
  }

  /**
   * Stream chat with Anthropic Computer Use
   */
  private async *streamWithAnthropic(
    userMessage: string,
    messageHistory: Array<{ role: string; content: string }>
  ): AsyncGenerator<any> {
    // Capture initial screenshot
    let screenshot = await this.captureScreenshot();
    let pageContext = await this.getPageContext();

    const systemInstruction = SYSTEM_PROMPTS.WEB;

    // Build messages array for Anthropic
    const messages: any[] = [];

    // Add conversation history
    for (const msg of messageHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    // Add current message with screenshot
    if (!screenshot.data) {
      throw new Error('Screenshot data is empty - cannot proceed with computer use');
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: screenshot.data
          }
        },
        {
          type: 'text',
          text: userMessage
        }
      ]
    });

    const maxTurns = 30;
    let responseText = '';

    // Anthropic computer use tool definition
    const tools = [
      {
        type: 'computer_20241022',
        name: 'computer',
        display_width_px: screenshot.width,
        display_height_px: screenshot.height,
        display_number: 1
      }
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      const requestBody: any = {
        model: this.model,
        max_tokens: 4096,
        messages,
        tools,
        system: systemInstruction
      };

      // Determine API URL
      let apiUrl = 'https://api.anthropic.com/v1/messages';
      if (this.baseUrl) {
        apiUrl = this.baseUrl.endsWith('/') ? `${this.baseUrl}v1/messages` : `${this.baseUrl}/v1/messages`;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'computer-use-2024-10-22'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (data.error) throw new Error(`Anthropic error: ${data.error.message}`);

      // Add assistant response to conversation
      messages.push({
        role: 'assistant',
        content: data.content
      });

      // Process content blocks
      const hasToolUse = data.content.some((block: any) => block.type === 'tool_use');

      if (!hasToolUse) {
        // No more actions - task complete
        for (const block of data.content) {
          if (block.type === 'text') {
            responseText += block.text;
            yield { type: 'text', content: block.text };
          }
        }
        break;
      }

      // Stream any text responses immediately
      for (const block of data.content) {
        if (block.type === 'text') {
          responseText += block.text + '\n';
          yield { type: 'text', content: block.text };
        }
      }

      // Execute tool use blocks
      const toolResults: any[] = [];

      for (const block of data.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const toolInput = block.input || {};

          // Emit function call as text
          const actionText = `\n**[Executing: ${toolInput.action}]**\n`;
          yield { type: 'text', content: actionText };
          yield { type: 'action', action: { name: toolInput.action, args: toolInput } };

          // Map Anthropic computer tool actions to our browser actions
          let result;
          switch (toolInput.action) {
            case 'mouse_move':
            case 'left_click':
            case 'right_click':
            case 'middle_click':
            case 'double_click':
              result = await this.executeBrowserAction('click_at', {
                x: toolInput.coordinate?.[0] || 0,
                y: toolInput.coordinate?.[1] || 0
              });
              break;

            case 'type':
              result = await this.executeBrowserAction('type_text', {
                text: toolInput.text
              });
              break;

            case 'key':
              // Handle key presses (Enter, etc.)
              if (toolInput.text === 'Return' || toolInput.text === 'Enter') {
                result = await this.executeBrowserAction('type_text', { text: '\n' });
              } else {
                result = { success: true, message: `Key ${toolInput.text} pressed` };
              }
              break;

            case 'screenshot':
              screenshot = await this.captureScreenshot();
              result = { success: true, screenshot: screenshot.data };
              break;

            case 'cursor_position':
              result = { success: true, message: 'Cursor position noted' };
              break;

            default:
              result = { success: false, error: `Unknown action: ${toolInput.action}` };
          }

          // Wait after actions
          const isNavigationAction = ['left_click', 'right_click', 'double_click'].includes(toolInput.action);
          if (isNavigationAction) {
            await new Promise(resolve => setTimeout(resolve, 2500));
          } else {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Capture new screenshot
          screenshot = await this.captureScreenshot();
          pageContext = await this.getPageContext();

          // Add tool result
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result.success ? 'Action completed successfully' : (result.error || 'Action failed')
          });

          // Emit result message
          if (result.success) {
            const resultText = `${result.message || 'Action completed successfully'}`;
            yield { type: 'text', content: resultText };
          } else {
            const resultText = ` ${result.error || result.message || 'Action failed'}`;
            yield { type: 'text', content: resultText };
          }

          yield { type: 'result', result };
        }
      }

      // Add tool results with new screenshot to conversation
      if (toolResults.length > 0) {
        const userContent: any[] = [...toolResults];

        // Add new screenshot
        if (screenshot && screenshot.data) {
          userContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshot.data
            }
          });
        }

        messages.push({
          role: 'user',
          content: userContent
        });
      }
    }

    yield { type: 'complete', content: responseText };
  }
}
