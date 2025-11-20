// Background service worker for the extension

// Memory store for browser context
interface BrowserMemory {
  recentPages: Array<{ url: string; title: string; timestamp: number; context?: any }>;
  userPreferences: Record<string, any>;
  sessionData: Record<string, any>;
}

const memory: BrowserMemory = {
  recentPages: [],
  userPreferences: {},
  sessionData: {}
};

// Track if browser operations should be aborted
let shouldAbortOperations = false;

// Set side panel to open automatically on extension icon click
// The side panel will be per-tab by default when using tabId
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: Error) => console.error(error));

// Track page visits for memory
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    chrome.tabs.get(details.tabId, (tab) => {
      if (tab.url && tab.title) {
        addToMemory({
          url: tab.url,
          title: tab.title,
          timestamp: Date.now()
        });
      }
    });
  }
});

// Add page to memory
function addToMemory(page: { url: string; title: string; timestamp: number }) {
  memory.recentPages.unshift(page);
  if (memory.recentPages.length > 100) {
    memory.recentPages.pop();
  }

  // Save to chrome.storage for persistence
  chrome.storage.local.set({ browserMemory: memory });
}

// Load memory from storage on startup
chrome.storage.local.get('browserMemory', (result) => {
  if (result.browserMemory) {
    Object.assign(memory, result.browserMemory);
  }
});

// Listen for messages from the sidebar and content scripts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // Get current tab info
  if (request.type === 'GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({
          url: tabs[0].url,
          title: tabs[0].title,
          id: tabs[0].id
        });
      }
    });
    return true;
  }

  // Get current tab (for content script)
  if (request.type === 'GET_CURRENT_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ tabId: tabs[0].id });
      } else {
        sendResponse({ tabId: null });
      }
    });
    return true;
  }

  // Open sidebar
  if (request.type === 'OPEN_SIDEBAR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.sidePanel.open({ tabId: tabs[0].id }).then(() => {
          // Notify content script that sidebar opened
          chrome.tabs.sendMessage(tabs[0].id!, { type: 'SIDEBAR_OPENED' }).catch(() => {
            // Content script might not be ready, ignore error
          });
        }).catch((error: Error) => {
          console.error('Error opening sidebar:', error);
        });
        sendResponse({ success: true });
      } else {
        // Fallback: open without tabId
        chrome.sidePanel.open({}).catch((error: Error) => {
          console.error('Error opening sidebar:', error);
        });
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // Check sidebar state
  if (request.type === 'CHECK_SIDEBAR_STATE') {
    // Chrome doesn't provide a direct API to check if sidebar is open
    // We'll assume it's closed by default and let the content script show the button
    // The sidebar will send a message when it opens
    sendResponse({ sidebarOpen: false });
    return true;
  }

  // Close sidebar
  if (request.type === 'CLOSE_SIDEBAR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        // Note: Chrome doesn't provide a direct API to close the sidebar
        // The user can close it by clicking the extension icon
        // We can try to hide it by setting enabled to false temporarily
        chrome.sidePanel.setOptions({ enabled: false, tabId: tabs[0].id }).then(() => {
          // Re-enable it so it can be opened again
          setTimeout(() => {
            chrome.sidePanel.setOptions({ enabled: true, tabId: tabs[0].id }).catch(() => {});
          }, 100);
        }).catch(() => {});
        sendResponse({ success: true });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // Get browser history
  if (request.type === 'GET_HISTORY') {
    const query = request.query || '';
    const maxResults = request.maxResults || 100;
    const startTime = request.startTime || Date.now() - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    chrome.history.search({
      text: query,
      maxResults,
      startTime
    }, (results) => {
      sendResponse({ history: results });
    });
    return true;
  }

  // Get browser memory
  if (request.type === 'GET_MEMORY') {
    sendResponse({ memory });
    return true;
  }

  // Get page context from content script
  // Helper function to ensure content script is injected
  async function ensureContentScript(tabId: number): Promise<void> {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch (error) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (injectError) {
        throw injectError;
      }
    }
  }

  if (request.type === 'GET_PAGE_CONTEXT') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await ensureContentScript(tabs[0].id);
          const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_CONTEXT' });
          sendResponse(response); // Return response directly, not wrapped
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }

  // Abort all browser operations
  if (request.type === 'ABORT_ALL_BROWSER_OPERATIONS') {
    console.log('🛑 ABORT_ALL_BROWSER_OPERATIONS received');
    shouldAbortOperations = true;
    // Reset the abort flag after a short delay to allow for new operations
    setTimeout(() => {
      shouldAbortOperations = false;
      console.log('✅ Abort flag cleared - ready for new operations');
    }, 1000);
    sendResponse({ success: true });
    return true;
  }

  // Execute action on page
  if (request.type === 'EXECUTE_ACTION') {
    (async () => {
      try {
        // Check if operations should be aborted
        if (shouldAbortOperations) {
          console.log('⚠️ Operation aborted by user');
          sendResponse({ success: false, error: 'Operation aborted by user', aborted: true });
          return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await ensureContentScript(tabs[0].id);
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'EXECUTE_ACTION',
            action: request.action,
            target: request.target,
            selector: request.selector,
            value: request.value,
            key: request.key,
            keys: request.keys,
            coordinates: request.coordinates,
            destination: request.destination,
            direction: request.direction,
            amount: request.amount
          });
          sendResponse(response);
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }

  // Take screenshot
  if (request.type === 'TAKE_SCREENSHOT') {
    (async () => {
      try {

        // Define restricted protocols (but allow regular web pages)
        const restrictedProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];
        const isRestricted = (url: string | undefined) => {
          if (!url) return true;
          // Allow http:// and https:// pages (including google.com)
          if (url.startsWith('http://') || url.startsWith('https://')) return false;
          // Block internal browser pages
          return restrictedProtocols.some(protocol => url.startsWith(protocol));
        };

        // Get the currently focused window with windowTypes to exclude devtools
        const currentWindow = await chrome.windows.getLastFocused({
          populate: true,
          windowTypes: ['normal']
        });

        if (!currentWindow || !currentWindow.tabs) {
          console.error('❌ No focused window found');
          sendResponse({ success: false, error: 'No browser window found' });
          return;
        }

        // Get the active AND highlighted tab (the one that's actually visible to the user)
        let activeTab = currentWindow.tabs.find(tab => tab.active === true && tab.highlighted === true);

        // Fallback to just active if highlighted not found
        if (!activeTab) {
          activeTab = currentWindow.tabs.find(tab => tab.active === true);
        }

        if (!activeTab) {
          console.error('❌ No active tab found in window');
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }


        // Check if the current tab is restricted
        if (isRestricted(activeTab.url)) {
          // Navigate to google.com automatically
          if (activeTab.id) {
            await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });

            // Wait for the page to load
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get the updated tab
            const updatedTab = await chrome.tabs.get(activeTab.id);

            // Update activeTab reference
            activeTab = updatedTab;
          } else {
            sendResponse({
              success: false,
              error: 'Cannot navigate from restricted page'
            });
            return;
          }
        }


        // Ensure windowId is defined
        if (currentWindow.id === undefined) {
          throw new Error('Window ID is undefined');
        }

        // Capture the visible tab in the current window
        const dataUrl = await chrome.tabs.captureVisibleTab(currentWindow.id, {
          format: 'png',
          quality: 80
        });

        // Get viewport dimensions from the tab
        const viewport = await chrome.tabs.sendMessage(activeTab.id!, {
          type: 'GET_VIEWPORT_SIZE'
        }).catch(() => ({ width: 1280, height: 800 })); // Fallback dimensions

        sendResponse({
          success: true,
          screenshot: dataUrl,
          viewport: viewport
        });
      } catch (error) {
        console.error('❌ Screenshot capture error:', error);

        // Provide more detailed error information
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('Error details:', errorMsg);
        sendResponse({
          success: false,
          error: `Screenshot failed: ${errorMsg}`
        });
      }
    })().catch(err => {
      // Handle unhandled promise rejections from the IIFE
      console.error('[SCREENSHOT] Unhandled promise rejection:', err instanceof Error ? err.message : String(err));
    });
    return true;
  }

  // Navigate to URL
  if (request.type === 'NAVIGATE') {
    (async () => {
      try {
        // Check if operations should be aborted
        if (shouldAbortOperations) {
          console.log('⚠️ Navigation aborted by user');
          sendResponse({ success: false, error: 'Navigation aborted by user', aborted: true });
          return;
        }

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await chrome.tabs.update(tabs[0].id, { url: request.url });
          sendResponse({ success: true, url: request.url });
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }

  if (request.type === 'EXECUTE_SCRIPT') {
    sendResponse({
      success: false,
      error: 'EXECUTE_SCRIPT is disabled for security reasons. Use content script messaging instead.'
    });
    return true;
  }

  // Get bookmarks
  if (request.type === 'GET_BOOKMARKS') {
    chrome.bookmarks.getTree((bookmarkTree) => {
      sendResponse({ bookmarks: bookmarkTree });
    });
    return true;
  }

  // Store in memory
  if (request.type === 'STORE_MEMORY') {
    const { key, value } = request;
    memory.sessionData[key] = value;
    chrome.storage.local.set({ browserMemory: memory });
    sendResponse({ success: true });
    return true;
  }

  // Page loaded notification from content script
  if (request.type === 'PAGE_LOADED') {
    console.log('Page loaded:', request.url);
    return false;
  }
});

console.log('Atlas background service worker loaded');
