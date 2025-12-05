# Microphone Functionality Debugging Guide

## Implementation Overview

The microphone functionality uses Chrome's **offscreen document API** because sidepanels cannot directly use `getUserMedia()`. 

### Architecture

```
Sidepanel → Background Script → Offscreen Document → getUserMedia()
     ↑                                              ↓
     └────────── Response (base64 audio) ─────────┘
```

## How It Works

1. **User clicks microphone button** in sidepanel
2. **Sidepanel** sends `START_RECORDING` message to background script
3. **Background script** ensures offscreen document exists, then forwards message
4. **Offscreen document** receives message and calls `getUserMedia()` (this works here!)
5. **Offscreen document** starts MediaRecorder
6. **User clicks again** to stop
7. **Offscreen document** stops recording, converts to base64, sends back
8. **Sidepanel** receives audio blob and sends to transcription API

## Testing with Playwright

Run the test script:
```bash
node test-microphone-debug.mjs
```

This will:
- Launch Chrome with the extension loaded
- Monitor console logs from all pages
- Automatically try to click the microphone button
- Report any errors or issues

## Common Issues & Solutions

### Issue: "Offscreen document not created"

**Symptoms:**
- No offscreen.html page appears
- Console shows "Failed to create offscreen document"

**Solutions:**
1. Check manifest.json has `"offscreen"` permission
2. Check chrome://extensions for extension errors
3. Verify offscreen.html and offscreen.js exist in artifacts/Dev/

### Issue: "Permission denied"

**Symptoms:**
- getUserMedia fails with NotAllowedError
- No permission prompt appears

**Solutions:**
1. Go to chrome://settings/content/microphone
2. Find your extension in the list
3. Set to "Allow"
4. Or click extension icon → Site permissions → Microphone → Allow

### Issue: "Message timeout"

**Symptoms:**
- Background script waits but never gets response
- "Timeout waiting for offscreen document response"

**Solutions:**
1. Check offscreen document console for errors
2. Verify message listener is set up correctly
3. Check that offscreen document is actually receiving messages

### Issue: "Recording doesn't start"

**Symptoms:**
- Button clicked but no recording state
- No console logs from offscreen document

**Solutions:**
1. Check browser console for JavaScript errors
2. Verify offscreen document was created
3. Check message routing between sidepanel → background → offscreen

## Debugging Steps

1. **Open Chrome DevTools:**
   - Go to chrome://extensions
   - Find your extension
   - Click "Inspect views: service worker" (for background)
   - Check console for logs

2. **Check Offscreen Document:**
   - The offscreen document runs in the background
   - Check service worker console for offscreen logs
   - Look for `[Offscreen]` prefixed logs

3. **Check Sidepanel:**
   - Right-click in sidepanel → Inspect
   - Check console for errors
   - Look for microphone button click events

4. **Verify Permissions:**
   - chrome://settings/content/microphone
   - Ensure extension has microphone permission

## Console Log Patterns

### Successful Flow:
```
[Background] Received START_RECORDING request
[Background] Offscreen document ensured
[Background] Sending message to offscreen document
[Offscreen] Received message: START_RECORDING
[Offscreen] Starting recording in offscreen document...
[Offscreen] Microphone access granted, stream: ...
[Offscreen] Recording started successfully
[Background] Received response from offscreen: {success: true}
```

### Error Flow:
```
[Background] Received START_RECORDING request
[Offscreen] Received message: START_RECORDING
[Offscreen] Error starting recording: NotAllowedError
[Offscreen] Error starting recording: Permission denied
[Background] Received response from offscreen: {success: false, error: "..."}
```

## Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Sidepanel opens successfully
- [ ] Microphone button is visible
- [ ] Clicking button shows permission prompt (first time)
- [ ] Permission granted, recording starts
- [ ] Button shows recording state (pulsing/animation)
- [ ] Clicking again stops recording
- [ ] Audio is transcribed and appears in input field

## Files Involved

- `sidepanel.tsx` - UI and button click handler
- `background.ts` - Message routing and offscreen document management
- `offscreen.ts` - getUserMedia and MediaRecorder logic
- `offscreen.html` - Offscreen document entry point
- `manifest.json` - Permissions and offscreen declaration

## References

- [Chrome Offscreen Documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [getUserMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

