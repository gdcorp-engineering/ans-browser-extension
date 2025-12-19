// Background service worker for the extension

/**
 * Maximum size for the longest edge of screenshots.
 * This ensures Claude won't resize the image further internally.
 */
const MAX_SCREENSHOT_LONG_EDGE = 1280;

/**
 * Focus the browser window and tab before executing actions.
 * Many websites require document.hasFocus() to be true for interactions to work.
 * @param tabId - The tab ID to focus
 * @returns Promise that resolves after focus is established
 */
async function focusTabAndWindow(tabId: number): Promise<void> {
  try {
    // Get the tab to find its window
    const tab = await chrome.tabs.get(tabId);

    // Focus the window first
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }

    // Make sure the tab is active
    await chrome.tabs.update(tabId, { active: true });

    // Small delay to let OS focus propagate
    await new Promise(resolve => setTimeout(resolve, 50));

    console.log(`✅ Focused window ${tab.windowId} and tab ${tabId}`);
  } catch (error) {
    console.warn('⚠️ Could not focus tab/window:', error);
  }
}

/**
 * Resize a screenshot to ensure the longest edge is under MAX_SCREENSHOT_LONG_EDGE.
 * Maintains aspect ratio. Returns original if already small enough.
 */
async function resizeScreenshot(
  dataUrl: string
): Promise<{ dataUrl: string; width: number; height: number; wasResized: boolean }> {
  try {
    // Extract base64 data from data URL
    const base64Data = dataUrl.split(',')[1];

    // Convert base64 to blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    // Create ImageBitmap to get dimensions
    const imageBitmap = await createImageBitmap(blob);
    const originalWidth = imageBitmap.width;
    const originalHeight = imageBitmap.height;

    // Check if resize is needed
    const longestEdge = Math.max(originalWidth, originalHeight);
    if (longestEdge <= MAX_SCREENSHOT_LONG_EDGE) {
      console.log(`📐 Screenshot ${originalWidth}×${originalHeight} is under ${MAX_SCREENSHOT_LONG_EDGE}px, no resize needed`);
      imageBitmap.close();
      return { dataUrl, width: originalWidth, height: originalHeight, wasResized: false };
    }

    // Calculate scale to fit within limit
    const scale = MAX_SCREENSHOT_LONG_EDGE / longestEdge;
    const targetWidth = Math.round(originalWidth * scale);
    const targetHeight = Math.round(originalHeight * scale);

    console.log(`📐 Resizing screenshot from ${originalWidth}×${originalHeight} to ${targetWidth}×${targetHeight}`);

    // Use OffscreenCanvas to resize
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.warn('⚠️ Could not get canvas context, returning original');
      imageBitmap.close();
      return { dataUrl, width: originalWidth, height: originalHeight, wasResized: false };
    }

    // Draw resized image
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
    imageBitmap.close(); // Free memory

    // Convert to blob then data URL
    const resizedBlob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await resizedBlob.arrayBuffer();
    const resizedBase64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const resizedDataUrl = `data:image/png;base64,${resizedBase64}`;

    console.log(`✅ Screenshot resized to ${targetWidth}×${targetHeight}`);
    return { dataUrl: resizedDataUrl, width: targetWidth, height: targetHeight, wasResized: true };
  } catch (error) {
    console.error('❌ Failed to resize screenshot:', error);
    return { dataUrl, width: 1280, height: 720, wasResized: false };
  }
}

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

// Track if browser operations should be aborted (per-tab)
const tabAbortFlags: Record<number, boolean> = {};

// Track which tabs have the extension enabled
const enabledTabs: Set<number> = new Set();

// Helper functions for per-tab abort flags
function setTabAbortFlag(tabId: number, value: boolean) {
  tabAbortFlags[tabId] = value;
  console.log(`🛑 Tab ${tabId} abort flag set to ${value}`);
}

function getTabAbortFlag(tabId: number): boolean {
  return tabAbortFlags[tabId] || false;
}

function clearTabAbortFlag(tabId: number) {
  delete tabAbortFlags[tabId];
  console.log(`✅ Tab ${tabId} abort flag cleared`);
}

// Helper functions for tab activation state
function isTabEnabled(tabId: number): boolean {
  return enabledTabs.has(tabId);
}

function enableTab(tabId: number) {
  enabledTabs.add(tabId);
  console.log(`✅ Extension enabled for tab ${tabId}`);
}

async function disableTab(tabId: number) {
  enabledTabs.delete(tabId);

  // Disable sidepanel for this tab
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
  } catch (error) {
    console.error(`Failed to disable sidepanel for tab ${tabId}:`, error);
  }

  console.log(`❌ Extension disabled for tab ${tabId}`);
}

// Inject content script into a tab
async function injectContentScript(tabId: number): Promise<void> {
  try {
    // Check if content script is already injected by trying to ping it
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      console.log(`Content script already injected in tab ${tabId}`);
      return;
    } catch {
      // Content script not found, proceed with injection
    }

    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });

    // Wait a bit for the script to initialize
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log(`✅ Content script injected into tab ${tabId}`);
  } catch (error) {
    console.error(`Failed to inject content script into tab ${tabId}:`, error);
  }
}

// Cleanup on tab removal
chrome.tabs.onRemoved.addListener(async (tabId) => {
  console.log(`🗑️ Tab ${tabId} removed, cleaning up background resources`);
  clearTabAbortFlag(tabId);
  await disableTab(tabId);
  // Cleanup old memory entries (keep last 24 hours)
  memory.recentPages = memory.recentPages.filter(page =>
    page.timestamp > Date.now() - 24 * 60 * 60 * 1000
  );
});

// Track if sidepanel options have been initialized
let sidepanelInitialized = false;

// Initialize global sidepanel options (disabled by default)
async function initializeSidepanel() {
  if (sidepanelInitialized) return;

  try {
    // Set sidepanel globally but disabled - it will be enabled per-tab
    await chrome.sidePanel.setOptions({
      path: "sidepanel.html",
      enabled: false
    });
    sidepanelInitialized = true;
    console.log('Sidepanel options initialized globally (disabled by default)');
  } catch (error) {
    console.error('Failed to initialize sidepanel options:', error);
  }
}

// CRITICAL: Register click handler synchronously at top level
// This ensures the handler is ready immediately when the service worker wakes up
// If this is registered after async operations, clicks during worker startup may be lost
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    // Check if extension is already enabled for this tab
    const isEnabled = isTabEnabled(tab.id);

    if (!isEnabled) {
      // First click: Enable the extension for this tab
      console.log(`⚡ FIRST CLICK - Enabling extension for tab ${tab.id}`);
      enableTab(tab.id);

      // Enable sidepanel for this specific tab SYNCHRONOUSLY (before async operations)
      chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: 'sidepanel.html',
        enabled: true
      }).then(() => {
        console.log(`✅ Sidepanel enabled for tab ${tab.id}`);
      }).catch((error) => {
        console.error(`Failed to enable sidepanel for tab ${tab.id}:`, error);
      });

      // Open the sidepanel IMMEDIATELY while still in user gesture context
      chrome.sidePanel.open({ tabId: tab.id }).then(() => {
        console.log(`✅ Sidepanel opened for tab ${tab.id}: ${tab.url}`);
      }).catch((error) => {
        console.error('❌ Failed to open sidepanel:', error);
      });

      // Inject content script in the background (don't await - let it happen async)
      injectContentScript(tab.id);
    } else {
      // Subsequent clicks: Just open the sidepanel
      chrome.sidePanel.open({ tabId: tab.id }).then(() => {
        console.log(`✅ Sidepanel opened for tab ${tab.id}: ${tab.url}`);
      }).catch((error) => {
        console.error('❌ Failed to open sidepanel:', error);
      });
    }
  }
});

// Initialize sidepanel options on extension install/startup
chrome.runtime.onInstalled.addListener(() => {
  initializeSidepanel();
});

chrome.runtime.onStartup.addListener(() => {
  initializeSidepanel();
});

// Also initialize immediately (for when service worker wakes up)
initializeSidepanel();

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

  // Check if extension is enabled for current tab
  if (request.type === 'CHECK_TAB_ENABLED') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        sendResponse({ enabled: isTabEnabled(tabs[0].id) });
      } else {
        sendResponse({ enabled: false });
      }
    });
    return true;
  }

  // Enable extension for current tab
  if (request.type === 'ENABLE_TAB') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          const tabId = tabs[0].id;
          enableTab(tabId);
          await injectContentScript(tabId);

          // Enable sidepanel for this specific tab
          await chrome.sidePanel.setOptions({
            tabId,
            path: 'sidepanel.html',
            enabled: true
          });

          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }

  // Disable extension for current tab
  if (request.type === 'DISABLE_TAB') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await disableTab(tabs[0].id);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
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
    // Enable the tab if not already enabled
    if (!isTabEnabled(tabId)) {
      enableTab(tabId);
    }
    // Inject content script
    await injectContentScript(tabId);
  }

  if (request.type === 'GET_PAGE_CONTEXT') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          // Focus the tab before getting page context to ensure accurate DOM state
          await focusTabAndWindow(tabs[0].id);
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
    const tabId = _sender.tab?.id;
    if (tabId !== undefined) {
      console.log(`🛑 ABORT_ALL_BROWSER_OPERATIONS received for tab ${tabId}`);
      setTabAbortFlag(tabId, true);
      // Reset the abort flag after a short delay to allow for new operations
      setTimeout(() => {
        clearTabAbortFlag(tabId);
        console.log(`✅ Tab ${tabId} abort flag cleared - ready for new operations`);
      }, 1000);
    } else {
      console.warn('⚠️ ABORT_ALL_BROWSER_OPERATIONS received but no tab ID available');
    }
    sendResponse({ success: true });
    return true;
  }

  // Execute action on page
  if (request.type === 'EXECUTE_ACTION') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;

        // Check if operations should be aborted for this specific tab
        if (tabId !== undefined && getTabAbortFlag(tabId)) {
          console.log(`⚠️ Operation aborted by user for tab ${tabId}`);
          sendResponse({ success: false, error: 'Operation aborted by user', aborted: true });
          return;
        }

        if (tabId) {
          // CRITICAL: Focus the browser window before executing actions
          // This ensures dropdowns and modals render properly (they often check document.hasFocus())
          await focusTabAndWindow(tabId);

          await ensureContentScript(tabId);
          const response = await chrome.tabs.sendMessage(tabId, {
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

        // Focus the tab before taking screenshot to ensure accurate capture
        if (activeTab.id) {
          await focusTabAndWindow(activeTab.id);
        }

        // Capture the visible tab in the current window
        const originalDataUrl = await chrome.tabs.captureVisibleTab(currentWindow.id, {
          format: 'png',
          quality: 80
        });

        // Get viewport dimensions from the tab
        const viewport = await chrome.tabs.sendMessage(activeTab.id!, {
          type: 'GET_VIEWPORT_SIZE'
        }).catch(() => ({ width: 1280, height: 800 })); // Fallback dimensions

        // Resize the screenshot BEFORE saving (so saved screenshot matches what Claude sees)
        const resized = await resizeScreenshot(originalDataUrl);

        // Check if auto-save screenshots is enabled
        const settings = await chrome.storage.local.get(['atlasSettings']);
        if (settings.atlasSettings?.autoSaveScreenshots) {
          try {
            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `screenshot-${timestamp}.png`;

            // Save the RESIZED screenshot to Downloads folder (matches what Claude sees)
            await chrome.downloads.download({
              url: resized.dataUrl,
              filename: filename,
              saveAs: false // Auto-save without prompting
            });

            console.log(`📸 Screenshot auto-saved: ${filename} (${resized.width}×${resized.height}${resized.wasResized ? ' resized' : ''})`);
          } catch (downloadError) {
            console.error('❌ Failed to auto-save screenshot:', downloadError);
            // Don't fail the screenshot operation if download fails
          }
        }

        // Send the resized screenshot along with image dimensions
        sendResponse({
          success: true,
          screenshot: resized.dataUrl,
          viewport: viewport,
          imageSize: { width: resized.width, height: resized.height }
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
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;

        // Check if operations should be aborted for this specific tab
        if (tabId !== undefined && getTabAbortFlag(tabId)) {
          console.log(`⚠️ Navigation aborted by user for tab ${tabId}`);
          sendResponse({ success: false, error: 'Navigation aborted by user', aborted: true });
          return;
        }

        if (tabId) {
          await chrome.tabs.update(tabId, { url: request.url });
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

  // Inject content script on demand
  if (request.type === 'INJECT_CONTENT_SCRIPT') {
    (async () => {
      try {
        const tabId = request.tabId;
        if (tabId) {
          await injectContentScript(tabId);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No tab ID provided' });
        }
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }
});

console.log('Atlas background service worker loaded');
