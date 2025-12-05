# Microphone Debugging Guide

## Quick Test Steps

1. **Reload the extension**:
   - Go to `chrome://extensions`
   - Find "Agent Chat Powered by GoDaddy ANS"
   - Click the reload icon (circular arrow)

2. **Open the sidepanel**:
   - Click the extension icon in the toolbar
   - Or navigate to a page and the sidepanel should open

3. **Open DevTools**:
   - **Sidepanel**: Right-click in the sidepanel → "Inspect"
   - **Background Script**: Go to `chrome://extensions` → Find your extension → Click "Inspect views: service worker"

4. **Click the microphone button** and watch both consoles

## What to Look For

### In Sidepanel Console:
- `Starting recording via offscreen document...`
- `Recording started successfully` OR error message

### In Background Script Console (Service Worker):
- `[Background] Received START_RECORDING request`
- `[Background] Offscreen document ensured`
- `[Background] Sending message to offscreen document: START_RECORDING`
- `[Background] ✅ Received matching response from offscreen` OR timeout error

### In Background Script Console (should also show Offscreen logs):
- `[Offscreen] ====== MESSAGE RECEIVED ======`
- `[Offscreen] Handling START_RECORDING request...`
- `[Offscreen] Starting recording in offscreen document...`
- `[Offscreen] ✅ Recording started successfully`
- `[Offscreen] ✅ sendResponse called successfully`

## Common Issues

### Issue 1: "Timeout waiting for offscreen document response"
**Symptoms**: Background script shows timeout, no offscreen logs
**Solution**: 
- Check if offscreen document exists: In background console, run: `chrome.offscreen.hasDocument()`
- If false, the offscreen document wasn't created. Check for errors in the extension.

### Issue 2: "Offscreen document is not responding"
**Symptoms**: Background script can't send message to offscreen
**Solution**:
- Reload the extension
- Check if `offscreen.html` and `offscreen.js` exist in `artifacts/Dev/`

### Issue 3: "Permission denied" or "Permission dismissed"
**Symptoms**: Offscreen logs show permission error
**Solution**:
- Click the microphone button again
- When the permission prompt appears, click "Allow"
- The extension needs its own microphone permission (separate from the website)

### Issue 4: No response received in sidepanel
**Symptoms**: Sidepanel shows no response, but background/offscreen logs show success
**Solution**:
- Check if the response is being sent from background to sidepanel
- Look for `[Background] Sending response to sidepanel:` in background console

## Manual Test in Browser Console

Open the sidepanel and run this in the sidepanel console:

```javascript
// Test microphone recording
chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
  console.log('Response:', response);
  if (chrome.runtime.lastError) {
    console.error('Error:', chrome.runtime.lastError);
  }
});
```

This should show you the exact response or error.

## Check Offscreen Document

In the background script console (service worker), run:

```javascript
// Check if offscreen document exists
chrome.offscreen.hasDocument().then(has => {
  console.log('Has offscreen document:', has);
});

// Try to ping the offscreen document
chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
  console.log('Ping response:', response);
  if (chrome.runtime.lastError) {
    console.error('Ping error:', chrome.runtime.lastError);
  }
});
```

If ping fails, the offscreen document isn't receiving messages.

