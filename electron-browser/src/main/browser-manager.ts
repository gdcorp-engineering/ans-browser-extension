import { BrowserWindow, BrowserView } from 'electron';

export class BrowserManager {
  private mainWindow: BrowserWindow;
  private browserView: BrowserView | null = null;
  private isWebModeActive: boolean = false;
  private currentChatWidthPercent: number = 40;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Show the embedded browser view for web mode
   */
  showBrowserView(chatWidthPercent: number = 40) {
    if (!this.browserView) {
      this.createBrowserView();
    }

    if (this.browserView) {
      this.mainWindow.addBrowserView(this.browserView);
      this.updateBrowserViewBounds(chatWidthPercent);
      this.isWebModeActive = true;
    }
  }

  /**
   * Hide the embedded browser view (chat mode)
   */
  hideBrowserView() {
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
      this.isWebModeActive = false;
    }
  }

  /**
   * Create the browser view for web automation
   */
  private createBrowserView() {
    this.browserView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
      },
    });

    // Load initial page
    this.browserView.webContents.loadURL('https://www.google.com');

    // Handle navigation
    this.browserView.webContents.on('did-navigate', (_event, url) => {
      this.mainWindow.webContents.send('browser-navigated', url);
    });

    this.browserView.webContents.on('did-navigate-in-page', (_event, url) => {
      this.mainWindow.webContents.send('browser-navigated', url);
    });

    // Update bounds on window resize
    this.mainWindow.on('resize', () => {
      if (this.isWebModeActive && this.browserView) {
        // Use stored chat width percentage
        this.updateBrowserViewBounds(this.currentChatWidthPercent);
      }
    });
  }

  /**
   * Update browser view bounds to fit in the right side of window
   * Layout: [Chat Panel (X%)] [Browser View (100-X%)]
   */
  private updateBrowserViewBounds(chatWidthPercent: number = 40) {
    if (!this.browserView) return;

    // Store current chat width for window resize handler
    this.currentChatWidthPercent = chatWidthPercent;

    const bounds = this.mainWindow.getBounds();
    const chatPanelWidth = Math.floor(bounds.width * (chatWidthPercent / 100));

    this.browserView.setBounds({
      x: chatPanelWidth,
      y: 0,
      width: bounds.width - chatPanelWidth,
      height: bounds.height,
    });
  }

  /**
   * Resize browser view based on chat panel width percentage
   */
  resizeBrowserView(chatWidthPercent: number) {
    this.updateBrowserViewBounds(chatWidthPercent);
  }

  /**
   * Navigate to a URL
   * SECURITY: Validates URL to prevent javascript: and other dangerous protocols
   */
  async navigateToUrl(url: string): Promise<void> {
    if (!this.browserView) {
      this.createBrowserView();
    }

    // SECURITY: Validate URL to prevent javascript: and data: protocol injection
    const validatedUrl = this.validateAndSanitizeUrl(url);
    if (!validatedUrl) {
      throw new Error('Invalid URL: Only http:// and https:// protocols are allowed');
    }

    await this.browserView?.webContents.loadURL(validatedUrl);
  }

  /**
   * Validates and sanitizes URLs to prevent malicious protocols
   * Only allows http:// and https://
   */
  private validateAndSanitizeUrl(url: string): string | null {
    try {
      // Remove whitespace
      url = url.trim();

      // If no protocol, assume https
      if (!url.includes('://')) {
        url = 'https://' + url;
      }

      // Parse URL to validate it
      const parsedUrl = new URL(url);

      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        console.error('[BrowserManager] Blocked navigation to URL with protocol:', parsedUrl.protocol);
        return null;
      }

      return parsedUrl.toString();
    } catch (error) {
      console.error('[BrowserManager] URL validation failed:', error);
      return null;
    }
  }

  /**
   * Go back in browser history
   */
  goBack(): boolean {
    if (!this.browserView) return false;
    if (this.browserView.webContents.canGoBack()) {
      this.browserView.webContents.goBack();
      return true;
    }
    return false;
  }

  /**
   * Go forward in browser history
   */
  goForward(): boolean {
    if (!this.browserView) return false;
    if (this.browserView.webContents.canGoForward()) {
      this.browserView.webContents.goForward();
      return true;
    }
    return false;
  }

  /**
   * Check if can go back
   */
  canGoBack(): boolean {
    return this.browserView?.webContents.canGoBack() ?? false;
  }

  /**
   * Check if can go forward
   */
  canGoForward(): boolean {
    return this.browserView?.webContents.canGoForward() ?? false;
  }

  /**
   * Capture screenshot of the browser view
   */
  async captureScreenshot(): Promise<string> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    const image = await this.browserView.webContents.capturePage();
    return image.toDataURL();
  }

  /**
   * Execute JavaScript in the browser view
   */
  async executeScript(script: string): Promise<any> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    return await this.browserView.webContents.executeJavaScript(script);
  }

  /**
   * Click at coordinates
   */
  async clickAt(x: number, y: number): Promise<void> {
    const script = `
      (function() {
        const element = document.elementFromPoint(${x}, ${y});
        if (element) {
          element.click();
          return { success: true, element: element.tagName };
        }
        return { success: false };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Type text into focused element
   * SECURITY: Uses JSON serialization to safely pass text to JavaScript
   */
  async typeText(text: string): Promise<void> {
    // SECURITY: Safely serialize text as JSON to prevent injection
    const encodedText = JSON.stringify(text);
    const script = `
      (function() {
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable)) {
          activeElement.value = ${encodedText};
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        return { success: false };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Scroll the page
   */
  async scrollPage(direction: 'up' | 'down', amount: number = 300): Promise<void> {
    const scrollAmount = direction === 'down' ? amount : -amount;
    const script = `window.scrollBy(0, ${scrollAmount});`;
    await this.executeScript(script);
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.browserView?.webContents.getURL() || '';
  }

  /**
   * Get page title
   */
  getPageTitle(): string {
    return this.browserView?.webContents.getTitle() || '';
  }

  /**
   * Get page context (similar to Chrome extension's getPageContext)
   */
  async getPageContext(): Promise<any> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    // Wait for page to be fully loaded before extracting context
    const waitForPageLoad = async (): Promise<void> => {
      return new Promise((resolve) => {
        const maxWaitTime = 5000; // Maximum 5 seconds
        const startTime = Date.now();
        
        const checkReady = async () => {
          try {
            const readyState = await this.browserView!.webContents.executeJavaScript('document.readyState');
            if (readyState === 'complete') {
              // Additional small delay to ensure all content is rendered (especially for SPAs)
              setTimeout(resolve, 200);
            } else if (Date.now() - startTime > maxWaitTime) {
              // Timeout - proceed anyway
              console.warn('[BrowserManager] Page load timeout, proceeding with getPageContext');
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          } catch (error) {
            // If script execution fails, wait a bit and try again
            if (Date.now() - startTime > maxWaitTime) {
              console.warn('[BrowserManager] Page load check failed, proceeding anyway');
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          }
        };
        checkReady();
      });
    };

    await waitForPageLoad();

    // Get current URL to verify we're on the right page
    const currentUrl = this.browserView.webContents.getURL();
    console.log(`[BrowserManager] getPageContext called for URL: ${currentUrl}`);

    const script = `
      (function() {
        const links = Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
          text: a.textContent?.trim() || '',
          href: a.href
        }));

        const images = Array.from(document.querySelectorAll('img')).slice(0, 20).map(img => ({
          alt: img.alt,
          src: img.src
        }));

        const forms = Array.from(document.querySelectorAll('form')).map(form => ({
          id: form.id,
          action: form.action,
          inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
            name: input.name,
            type: input.type || 'text'
          }))
        }));

        const getElementSelector = (el) => {
          if (el.id) return '#' + el.id;
          if (el.className) {
            const classes = el.className.split(' ').filter(c => c.trim());
            if (classes.length > 0) return el.tagName.toLowerCase() + '.' + classes[0];
          }
          const name = el.getAttribute('name');
          if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
          return el.tagName.toLowerCase();
        };

        const interactiveElements = Array.from(
          document.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"], [onclick]')
        )
          .slice(0, 30)
          .map(el => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              text: (el.textContent?.trim() || '').slice(0, 50),
              value: el.value || undefined,
              selector: getElementSelector(el),
              type: el.type || undefined,
              ariaLabel: el.getAttribute('aria-label') || undefined,
              visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
              boundingRect: {
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                centerX: rect.left + rect.width / 2,
                centerY: rect.top + rect.height / 2
              }
            };
          })
          .filter(el => el.visible);

        const searchInputs = Array.from(
          document.querySelectorAll('input[type="search"], input[type="text"]')
        )
          .map(el => {
            const rect = el.getBoundingClientRect();
            return {
              selector: getElementSelector(el),
              type: el.type,
              id: el.id,
              name: el.name,
              placeholder: el.placeholder,
              'aria-label': el.getAttribute('aria-label'),
              'data-automation-id': el.getAttribute('data-automation-id'),
              role: el.getAttribute('role'),
              className: el.className,
              visible: rect.width > 0 && rect.height > 0 && rect.top >= 0,
              dimensions: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
            };
          })
          .filter(input => input.visible)
          .slice(0, 10);

        const getMetaContent = (name) => {
          const meta = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
          return meta?.getAttribute('content') || undefined;
        };

        // Verify we're getting content from the current page
        const currentPageUrl = window.location.href;
        const pageTitle = document.title;
        const bodyText = document.body ? document.body.innerText.slice(0, 10000) : '';
        
        console.log('[getPageContext] Extracting context from URL:', currentPageUrl);
        console.log('[getPageContext] Page title:', pageTitle);
        console.log('[getPageContext] Text content length:', bodyText.length);
        
        return {
          url: currentPageUrl,
          title: pageTitle,
          textContent: bodyText,
          links,
          images,
          forms,
          interactiveElements,
          searchInputs,
          metadata: {
            description: getMetaContent('description') || getMetaContent('og:description'),
            keywords: getMetaContent('keywords'),
            author: getMetaContent('author')
          },
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            devicePixelRatio: window.devicePixelRatio
          }
        };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Click element by selector or text
   */
  async clickElement(selector?: string, text?: string): Promise<any> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    const encodedSelector = selector ? JSON.stringify(selector) : 'null';
    const encodedText = text ? JSON.stringify(text) : 'null';

    const script = `
      (function() {
        let element = null;
        
        // Try selector first
        if (${encodedSelector}) {
          element = document.querySelector(${encodedSelector});
        }
        
        // If not found and text provided, search by text
        if (!element && ${encodedText}) {
          const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
          element = allElements.find(el => {
            const elText = el.textContent?.trim() || '';
            return elText.includes(${encodedText}) || el.getAttribute('aria-label')?.includes(${encodedText});
          });
        }
        
        if (element) {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          
          // Dispatch click events
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
          
          return { success: true, element: element.tagName, text: element.textContent?.trim().slice(0, 50) };
        }
        
        return { success: false, error: 'Element not found' };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Press a key (Enter, Tab, Escape, etc.)
   */
  async pressKey(key: string): Promise<any> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    const encodedKey = JSON.stringify(key);
    const script = `
      (function() {
        const activeElement = document.activeElement;
        if (!activeElement) {
          return { success: false, error: 'No active element' };
        }
        
        const keyMap = {
          'Enter': 'Enter',
          'Tab': 'Tab',
          'Escape': 'Escape',
          'ArrowUp': 'ArrowUp',
          'ArrowDown': 'ArrowDown',
          'ArrowLeft': 'ArrowLeft',
          'ArrowRight': 'ArrowRight'
        };
        
        const keyName = keyMap[${encodedKey}] || ${encodedKey};
        const event = new KeyboardEvent('keydown', {
          key: keyName,
          code: keyName,
          bubbles: true,
          cancelable: true
        });
        
        activeElement.dispatchEvent(event);
        
        const keyupEvent = new KeyboardEvent('keyup', {
          key: keyName,
          code: keyName,
          bubbles: true,
          cancelable: true
        });
        activeElement.dispatchEvent(keyupEvent);
        
        // For Enter key, also trigger submit if in a form
        if (keyName === 'Enter' && activeElement.tagName === 'INPUT') {
          const form = activeElement.closest('form');
          if (form) {
            const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(submitEvent);
          }
        }
        
        return { success: true };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Type text into an input field (by selector or focused element)
   */
  async typeTextIntoField(text: string, selector?: string): Promise<any> {
    if (!this.browserView) {
      throw new Error('Browser view not initialized');
    }

    const encodedText = JSON.stringify(text);
    const encodedSelector = selector ? JSON.stringify(selector) : 'null';

    const script = `
      (function() {
        let element = null;
        
        if (${encodedSelector}) {
          element = document.querySelector(${encodedSelector});
        } else {
          element = document.activeElement;
        }
        
        if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)) {
          if (element.isContentEditable) {
            element.textContent = ${encodedText};
          } else {
            element.value = ${encodedText};
          }
          
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          
          return { success: true };
        }
        
        return { success: false, error: 'No suitable input element found' };
      })();
    `;

    return await this.executeScript(script);
  }

  /**
   * Get the browser view instance (for external services like ComputerUseService)
   */
  getBrowserView(): BrowserView | null {
    return this.browserView;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.browserView) {
      try {
        // Check if objects are still valid before destroying
        if (!this.browserView.webContents.isDestroyed()) {
          this.mainWindow.removeBrowserView(this.browserView);
          // @ts-ignore - webContents has destroy method
          this.browserView.webContents.destroy();
        }
      } catch (error) {
        // Ignore errors during cleanup - objects may already be destroyed
        console.log('[BrowserManager] Cleanup: objects already destroyed');
      } finally {
        this.browserView = null;
      }
    }
  }
}
