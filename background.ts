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

// Track agent mode state per tab (when AI is actively working)
const agentModeState: Map<number, boolean> = new Map();

// Update tab badge to show agent mode status
async function updateTabBadge(tabId: number, isActive: boolean) {
  try {
    if (isActive) {
      // Show badge with "AI" text and blue background
      await chrome.action.setBadgeText({ tabId, text: 'AI' });
      await chrome.action.setBadgeBackgroundColor({ 
        tabId, 
        color: '#007AFF' // Blue color matching the extension theme
      });
    } else {
      // Clear badge when agent mode is inactive
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (error) {
    // Tab might have been closed, ignore errors
    console.debug('Could not update badge for tab', tabId, error);
  }
}

// Update page title in content script to show agent mode status
async function updatePageTitle(tabId: number, isActive: boolean) {
  try {
    // Ensure content script is injected
    await ensureContentScript(tabId);
    
    // Send message to content script to update title
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'UPDATE_AGENT_MODE_TITLE',
      isActive: isActive
    });
    console.log('📝 Page title update', isActive ? 'started' : 'stopped', 'for tab', tabId, response);
  } catch (error) {
    // Log error for debugging
    console.warn('⚠️ Could not update page title for tab', tabId, ':', error);
  }
}

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
  // Ignore RECORDING_RESPONSE messages - these are handled by the messageListener in the microphone handler
  if (request && request.type === 'RECORDING_RESPONSE') {
    return false; // Let other listeners handle it
  }
  
  // Get current tab info
  if (request.type === 'GET_TAB_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({
          url: tabs[0].url,
          title: tabs[0].title,
          id: tabs[0].id,
          favIconUrl: tabs[0].favIconUrl
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

  // Open URL in new tab (for opening settings pages)
  if (request.type === 'OPEN_URL') {
    chrome.tabs.create({ url: request.url }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // Handle microphone recording via offscreen document
  if (request.type === 'START_RECORDING' || request.type === 'STOP_RECORDING' || request.type === 'CHECK_MIC_PERMISSION') {
    // Store sendResponse to ensure it's available
    const sendResponseFn = sendResponse;
    
    (async () => {
      try {
        console.log(`[Background] Received ${request.type} request from:`, _sender.url || 'unknown');
        
        // Ensure offscreen document exists
        await ensureOffscreenDocument();
        console.log('[Background] Offscreen document ensured');
        
        // Verify offscreen document is ready by checking if it exists
        const hasDocument = await chrome.offscreen.hasDocument();
        if (!hasDocument) {
          console.error('[Background] Offscreen document does not exist after creation');
          sendResponseFn({ 
            success: false, 
            error: 'Failed to create offscreen document' 
          });
          return;
        }
        
        // Create a unique request ID to match responses
        const requestId = `mic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const requestWithId = { ...request, requestId };
        
        // Create a promise to handle the response
        let messageListener: ((message: any, msgSender: chrome.runtime.MessageSender) => boolean) | null = null;
        let resolved = false;
        
        const responsePromise = new Promise<any>((resolve) => {
          messageListener = (message: any, msgSender: chrome.runtime.MessageSender) => {
            if (resolved) return false; // Already resolved, ignore
            
            // Ignore messages from background script itself (service worker)
            const senderUrl = msgSender.url || '';
            if (!senderUrl || senderUrl.includes('background.js') || senderUrl.includes('service_worker')) {
              return false; // Ignore messages from background script
            }
            
            // Check if this is a RECORDING_RESPONSE message (from offscreen)
            const isRecordingResponse = message && message.type === 'RECORDING_RESPONSE';
            
            // Check if this is a response from offscreen document
            // Offscreen documents have URLs like: chrome-extension://<id>/offscreen.html
            // OR it's a RECORDING_RESPONSE (which always comes from offscreen)
            const isFromOffscreen = senderUrl.includes('offscreen.html') || 
                                    senderUrl.includes('/offscreen') ||
                                    isRecordingResponse;
            // Check if it's a response message
            const isResponse = message && (message.success !== undefined || message.hasPermission !== undefined || isRecordingResponse);
            // Match by requestId - must match exactly
            const matchesRequest = message && message.requestId === requestId;
            
            console.log('[Background] Message received in listener:', {
              from: senderUrl.substring(0, 80),
              messageType: message?.type,
              isRecordingResponse,
              isFromOffscreen,
              isResponse,
              matchesRequest,
              hasRequestId: message?.requestId,
              expectedRequestId: requestId
            });
            
            // Match RECORDING_RESPONSE messages with matching requestId
            if (isRecordingResponse && matchesRequest) {
              console.log('[Background] ✅ Received matching response from offscreen:', message);
              resolved = true;
              if (messageListener) {
                chrome.runtime.onMessage.removeListener(messageListener);
              }
              // Extract response data (remove type and requestId)
              const { type, requestId, ...cleanResponse } = message;
              resolve(cleanResponse);
              return true; // Indicate we handled this message
            }
            
            // Don't handle other messages - let other listeners process them
            return false;
          };
          
          chrome.runtime.onMessage.addListener(messageListener);
          console.log('[Background] Message listener added, waiting for response from offscreen...');
          
          // Set timeout to avoid hanging
          setTimeout(() => {
            if (!resolved && messageListener) {
              resolved = true;
              chrome.runtime.onMessage.removeListener(messageListener);
              console.log('[Background] ❌ Timeout waiting for offscreen response');
              console.log('[Background] Debug: Check if offscreen document is receiving messages');
              resolve({ 
                success: false, 
                error: 'Timeout waiting for offscreen document response. The offscreen document may not be receiving messages.' 
              });
            }
          }, 20000); // Increased timeout to 20 seconds
        });
        
        // Send message to offscreen document
        console.log('[Background] Sending message to offscreen document:', requestWithId.type, 'requestId:', requestId);
        console.log('[Background] Message payload:', JSON.stringify(requestWithId));
        
        try {
          // Send message to offscreen document
          // The response will come back via our messageListener as a RECORDING_RESPONSE message
          chrome.runtime.sendMessage(requestWithId).then(() => {
            console.log('[Background] Message sent to offscreen, waiting for RECORDING_RESPONSE...');
          }).catch((error) => {
            console.error('[Background] Error sending message:', error);
            if (messageListener) {
              chrome.runtime.onMessage.removeListener(messageListener);
            }
              if (!resolved) {
                resolved = true;
                sendResponseFn({ 
                  success: false, 
                  error: `Failed to send message: ${error.message}` 
                });
              }
          });
          
          // Check for immediate connection errors
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error('[Background] chrome.runtime.lastError:', errorMsg);
            if (errorMsg.includes('Could not establish connection') || 
                errorMsg.includes('Receiving end does not exist')) {
              console.error('[Background] Offscreen document may not be receiving messages');
              if (messageListener) {
                chrome.runtime.onMessage.removeListener(messageListener);
              }
              if (!resolved) {
                resolved = true;
                sendResponseFn({ 
                  success: false, 
                  error: 'Offscreen document is not responding. Please reload the extension.' 
                });
              }
            }
          }
        } catch (error: any) {
          console.error('[Background] Exception sending message:', error);
          // Remove listener before responding
          if (messageListener) {
            chrome.runtime.onMessage.removeListener(messageListener);
          }
          sendResponseFn({ 
            success: false, 
            error: error.message || 'Failed to send message to offscreen document' 
          });
          return;
        }
        
        // Wait for response and send it back
        const response = await responsePromise;
        console.log('[Background] Received response from offscreen, sending to sidepanel:', JSON.stringify(response));
        
        // Ensure sendResponse is called
        try {
          sendResponseFn(response);
          console.log('[Background] ✅ sendResponse called successfully');
        } catch (sendError: any) {
          console.error('[Background] ❌ Error calling sendResponse:', sendError);
          console.error('[Background] sendError details:', {
            name: sendError?.name,
            message: sendError?.message
          });
          // The message channel might have closed - this is a Chrome extension limitation
          // The sidepanel will get a timeout or connection error
        }
      } catch (error: any) {
        console.error('[Background] Error in microphone handler:', error);
        console.error('[Background] Error stack:', error.stack);
        try {
          sendResponseFn({ 
            success: false, 
            error: error.message || 'Failed to communicate with offscreen document' 
          });
        } catch (sendErr) {
          console.error('[Background] Failed to send error response:', sendErr);
        }
      }
    })();
    return true; // Keep channel open for async response
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
      console.error('❌ Error ensuring content script for tab', tabId, ':', error.message);
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

  // Screenshot cache to avoid redundant captures
  const screenshotCache: {
    [tabId: number]: {
      dataUrl: string;
      timestamp: number;
      url: string;
    };
  } = {};

  const SCREENSHOT_CACHE_DURATION = 1000; // 1 second cache

  // Take screenshot with optimizations
  if (request.type === 'TAKE_SCREENSHOT') {
    (async () => {
      try {
        const startTime = performance.now();

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

        if (!activeTab || !activeTab.id) {
          console.error('❌ No active tab found in window');
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }

        // Check if the current tab is restricted
        if (isRestricted(activeTab.url)) {
          // Navigate to google.com automatically
          await chrome.tabs.update(activeTab.id, { url: 'https://www.google.com' });

          // Wait for the page to load
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Get the updated tab
          const updatedTab = await chrome.tabs.get(activeTab.id);
          activeTab = updatedTab;
        }

        // Check cache first
        const cached = screenshotCache[activeTab.id];
        const now = Date.now();
        if (cached && cached.url === activeTab.url && (now - cached.timestamp) < SCREENSHOT_CACHE_DURATION) {
          console.log('📸 Using cached screenshot');
          const viewport = await chrome.tabs.sendMessage(activeTab.id, {
            type: 'GET_VIEWPORT_SIZE'
          }).catch(() => ({ width: 1280, height: 800 }));
          
          sendResponse({
            success: true,
            screenshot: cached.dataUrl,
            viewport: viewport,
            cached: true
          });
          return;
        }

        // Ensure windowId is defined
        if (currentWindow.id === undefined) {
          throw new Error('Window ID is undefined');
        }

        // Wait a brief moment for any pending DOM updates
        await new Promise(resolve => setTimeout(resolve, 100));

        // Capture the visible tab in the current window
        // Use jpeg format for better compression when quality is acceptable
        const format = request.format || 'png'; // Allow format override
        const quality = request.quality || (format === 'jpeg' ? 85 : 100);
        
        const dataUrl = await chrome.tabs.captureVisibleTab(currentWindow.id, {
          format: format as 'png' | 'jpeg',
          quality: quality
        });

        // Cache the screenshot
        screenshotCache[activeTab.id] = {
          dataUrl,
          timestamp: now,
          url: activeTab.url || ''
        };

        // Get viewport dimensions from the tab (parallel with screenshot)
        const viewport = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'GET_VIEWPORT_SIZE'
        }).catch(() => ({ width: 1280, height: 800 })); // Fallback dimensions

        const duration = performance.now() - startTime;
        console.log(`📸 Screenshot captured in ${duration.toFixed(2)}ms`);

        sendResponse({
          success: true,
          screenshot: dataUrl,
          viewport: viewport,
          cached: false,
          format,
          quality
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
          // Clear screenshot cache for this tab on navigation
          delete screenshotCache[tabs[0].id];
          
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

  // Get browser memory
  if (request.type === 'GET_BROWSER_MEMORY') {
    chrome.storage.local.get(['browserMemory'], (result) => {
      const storedMemory = result.browserMemory || memory;
      sendResponse({ success: true, memory: storedMemory });
    });
    return true;
  }

  // Page loaded notification from content script
  if (request.type === 'PAGE_LOADED') {
    console.log('Page loaded:', request.url);
    // Clear screenshot cache when page loads (content script will clear its own cache)
    // This ensures fresh screenshots after navigation
    return false;
  }
  
  // Clear screenshot cache for a specific tab (called on navigation)
  if (request.type === 'CLEAR_SCREENSHOT_CACHE') {
    if (request.tabId) {
      delete screenshotCache[request.tabId];
      sendResponse({ success: true });
    } else {
      // Clear all cache
      Object.keys(screenshotCache).forEach(key => delete screenshotCache[parseInt(key)]);
      sendResponse({ success: true, cleared: 'all' });
    }
    return true;
  }

  // Track agent mode start (when AI starts working on a tab)
  if (request.type === 'AGENT_MODE_START') {
    (async () => {
      try {
        const tabId = request.tabId;
        if (tabId) {
          agentModeState.set(tabId, true);
          await updateTabBadge(tabId, true);
          await updatePageTitle(tabId, true);
          console.log(`🤖 Agent mode started for tab ${tabId}`);
        } else {
          // Fallback: get current tab
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            agentModeState.set(tabs[0].id, true);
            await updateTabBadge(tabs[0].id, true);
            await updatePageTitle(tabs[0].id, true);
            console.log(`🤖 Agent mode started for tab ${tabs[0].id} (fallback)`);
          }
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error starting agent mode:', error);
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }

  // Track agent mode stop (when AI finishes working on a tab)
  if (request.type === 'AGENT_MODE_STOP') {
    (async () => {
      try {
        const tabId = request.tabId;
        if (tabId) {
          agentModeState.set(tabId, false);
          await updateTabBadge(tabId, false);
          await updatePageTitle(tabId, false);
          console.log(`✅ Agent mode stopped for tab ${tabId}`);
        } else {
          // Fallback: get current tab
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            agentModeState.set(tabs[0].id, false);
            await updateTabBadge(tabs[0].id, false);
            await updatePageTitle(tabs[0].id, false);
            console.log(`✅ Agent mode stopped for tab ${tabs[0].id} (fallback)`);
          }
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error stopping agent mode:', error);
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();
    return true;
  }
});

// Ensure offscreen document exists for microphone access
async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.offscreen.hasDocument();
  if (existingContexts) {
    console.log('[Background] Offscreen document already exists');
    // Verify it's ready by sending a ping
    const isReady = await pingOffscreenDocument();
    if (isReady) {
      console.log('[Background] Offscreen document is ready');
      return;
    } else {
      console.log('[Background] Offscreen document exists but not responding, waiting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('[Background] Creating offscreen document for microphone access...');
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Microphone access for voice dictation in sidepanel'
    });
    console.log('[Background] Offscreen document created');
    
    // Wait for the offscreen document to initialize and be ready
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const isReady = await pingOffscreenDocument();
      if (isReady) {
        console.log('[Background] Offscreen document is ready after', attempts + 1, 'attempts');
        return;
      }
      attempts++;
    }
    console.warn('[Background] Offscreen document created but not responding to ping');
  } catch (error: any) {
    console.error('[Background] Error creating offscreen document:', error);
    throw error;
  }
}

// Ping offscreen document to verify it's ready
async function pingOffscreenDocument(): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, 1000);
    
    const listener = (message: any, sender: chrome.runtime.MessageSender) => {
      if (message && message.type === 'PONG' && sender.url && sender.url.includes('offscreen.html')) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(true);
      }
    };
    
    chrome.runtime.onMessage.addListener(listener);
    
    // Send ping
    chrome.runtime.sendMessage({ type: 'PING' }, () => {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(false);
      }
    });
  });
}

// Clean up agent mode state when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  agentModeState.delete(tabId);
});

console.log('Atlas background service worker loaded');
