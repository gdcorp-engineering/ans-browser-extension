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

// Track sidebar state per tab
const sidebarState: Map<number, boolean> = new Map();

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

  // Track sidebar opened (from sidepanel visibility change)
  if (request.type === 'SIDEBAR_OPENED') {
    if (request.tabId) {
      sidebarState.set(request.tabId, true);
      console.log(`Sidebar opened for tab ${request.tabId}`);
    } else {
      // Fallback: get current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          sidebarState.set(tabs[0].id, true);
          console.log(`Sidebar opened for tab ${tabs[0].id} (fallback)`);
        }
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Track sidebar closed (from sidepanel visibility change)
  if (request.type === 'SIDEBAR_CLOSED') {
    if (request.tabId) {
      sidebarState.set(request.tabId, false);
      console.log(`Sidebar closed for tab ${request.tabId}`);
    } else {
      // Fallback: get current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          sidebarState.set(tabs[0].id, false);
          console.log(`Sidebar closed for tab ${tabs[0].id} (fallback)`);
        }
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Open sidebar
  if (request.type === 'OPEN_SIDEBAR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.sidePanel.open({ tabId: tabs[0].id }).then(() => {
          // Track sidebar as open for this tab
          sidebarState.set(tabs[0].id!, true);
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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        // Check our tracked state for this specific tab
        const isOpen = sidebarState.get(tabs[0].id) || false;
        console.log(`Checking sidebar state for tab ${tabs[0].id}: ${isOpen ? 'open' : 'closed'}`);
        sendResponse({ sidebarOpen: isOpen });
      } else {
        console.log('No active tab found, assuming sidebar closed');
        sendResponse({ sidebarOpen: false });
      }
    });
    return true;
  }

  // Close sidebar
  if (request.type === 'CLOSE_SIDEBAR') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        const tabId = tabs[0].id;
        // Track sidebar as closed for this tab
        sidebarState.set(tabId, false);
        
        // Attempt to programmatically close the side panel using Chrome's Side Panel API
        // Try multiple methods in sequence for best compatibility
        
        // Method 1: Try disabling the side panel (Chrome 116+)
        // This should cause the panel to close
        chrome.sidePanel.setOptions({
          tabId: tabId,
          enabled: false
        }).then(() => {
          // Re-enable after a short delay to allow panel to close
          // This ensures the panel can be opened again later
          setTimeout(() => {
            chrome.sidePanel.setOptions({
              tabId: tabId,
              enabled: true
            }).catch(() => {
              // Ignore errors on re-enable - panel may have closed successfully
              // or the tab may have been closed
            });
          }, 150);
        }).catch((error) => {
          // If disabling doesn't work, try alternative method
          console.log('Method 1 (enabled: false) failed, trying alternative:', error);
          
          // Method 2: Try setting empty path (may work in some Chrome versions)
          chrome.sidePanel.setOptions({
            tabId: tabId,
            path: ''
          }).then(() => {
            // Restore path after delay
            setTimeout(() => {
              chrome.sidePanel.setOptions({
                tabId: tabId,
                path: 'sidepanel.html'
              }).catch(() => {
                // Ignore errors
              });
            }, 150);
          }).catch(() => {
            // If both methods fail, we'll rely on content script notification
            // The user may need to use Chrome's native close button
            console.log('Both methods failed - user may need to use Chrome\'s native close button');
          });
        });
        
        // Notify content script that sidebar should be closed
        chrome.tabs.sendMessage(tabId, { type: 'SIDEBAR_CLOSED' }).catch(() => {
          // Content script might not be ready, ignore error
        });
        
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
      // Check if tab URL is accessible first
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
        throw new Error(`Cannot access a ${tab.url.split(':')[0]}:// URL`);
      }
      
      // Try to ping the content script (with timeout)
      try {
        await Promise.race([
          chrome.tabs.sendMessage(tabId, { type: 'PING' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 1000))
        ]);
        // Content script is already loaded
        return;
      } catch (pingError) {
        // Content script not loaded, inject it
        console.log(`📦 Injecting content script into tab ${tabId}`);
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        // Wait for script to initialize and be ready
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verify it's ready by pinging again
        let retries = 3;
        while (retries > 0) {
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'PING' });
            console.log(`✅ Content script ready in tab ${tabId}`);
            return;
          } catch (e) {
            retries--;
            if (retries > 0) {
              await new Promise(resolve => setTimeout(resolve, 200));
            } else {
              throw new Error('Content script failed to initialize');
            }
          }
        }
      }
    } catch (error: any) {
      console.error(`❌ Error ensuring content script for tab ${tabId}:`, error.message);
      throw error;
    }
  }

  if (request.type === 'GET_PAGE_CONTEXT') {
    // Use async handler pattern that properly handles sendResponse
    (async () => {
      try {
        // Try to get active tab in current window first
        let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // If no active tab in current window, try to get any tab in current window
        if (!tabs[0]?.id) {
          tabs = await chrome.tabs.query({ currentWindow: true });
        }
        
        // If still no tab, try to get the most recently active tab across all windows
        if (!tabs[0]?.id) {
          tabs = await chrome.tabs.query({ active: true });
        }
        
        if (tabs[0]?.id) {
          try {
            await ensureContentScript(tabs[0].id);
            
            // Send message to content script with timeout
            const response = await Promise.race([
              chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_CONTEXT' }),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Content script response timeout')), 5000)
              )
            ]) as any;
            
            if (response && !response.error && response.success !== false) {
              sendResponse(response);
            } else {
              sendResponse({ success: false, error: response?.error || 'Invalid response from content script' });
            }
          } catch (contentError: any) {
            const errorMsg = contentError?.message || 'Unknown error';
            console.error('❌ Error getting page context:', errorMsg);
            sendResponse({ success: false, error: errorMsg });
          }
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error: any) {
        const errorMsg = (error as Error)?.message || 'Unknown error';
        console.error('❌ Error in GET_PAGE_CONTEXT:', errorMsg);
        sendResponse({ success: false, error: errorMsg });
      }
    })();
    return true; // Keep channel open for async response
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
