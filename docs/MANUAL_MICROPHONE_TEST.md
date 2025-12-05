# Manual Microphone Testing Guide

## Issue with Automated Testing

Playwright's `launchPersistentContext` with `--load-extension` has limitations and may not load extensions reliably. For thorough testing, manual testing is recommended.

## Manual Testing Steps

### 1. Build the Extension

```bash
BUILD_ENV=dev npm run build
```

### 2. Load Extension in Chrome

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `artifacts/Dev` folder
6. Verify the extension appears in the list

### 3. Open Jira Site

Navigate to: `https://godaddy-corp.atlassian.net/issues/?filter=-2`

### 4. Open Extension Sidepanel

1. Click the extension icon in the Chrome toolbar
2. The sidepanel should open on the right side

### 5. Test Microphone

1. **Find the microphone button** (🎤 icon) in the sidepanel
2. **Click the microphone button**
3. **Allow permission** if prompted (should already be enabled for the site)
4. **Verify recording starts:**
   - Button should show recording state (pulsing/animation)
   - Console should show logs
5. **Click again to stop** recording
6. **Verify audio is transcribed** to the input field

## Debugging Console Logs

### Background Script Logs

1. Go to `chrome://extensions`
2. Find your extension
3. Click "Inspect views: service worker"
4. Look for logs prefixed with `[Background]`:
   - `[Background] Offscreen document ensured`
   - `[Background] Offscreen document is ready`
   - `[Background] Sending message to offscreen document`
   - `[Background] ✅ Received matching response from offscreen`

### Offscreen Document Logs

The offscreen document logs appear in the service worker console:
- `[Offscreen] Received message: START_RECORDING`
- `[Offscreen] Recording started successfully`
- `[Offscreen] Microphone access granted`

### Sidepanel Logs

1. Right-click in the sidepanel
2. Select "Inspect"
3. Look for logs about microphone/recording

## Expected Log Flow

### Successful Recording Start:

```
[Background] Received START_RECORDING request
[Background] Offscreen document ensured
[Background] Offscreen document is ready
[Background] Sending message to offscreen document: START_RECORDING
[Offscreen] Received message: START_RECORDING
[Offscreen] Requesting microphone access...
[Offscreen] Microphone access granted, stream: ...
[Offscreen] Recording started successfully
[Background] ✅ Received matching response from offscreen: {success: true}
```

### If Timeout Occurs:

```
[Background] Received START_RECORDING request
[Background] Offscreen document ensured
[Background] Sending message to offscreen document: START_RECORDING
[Background] ❌ Timeout waiting for offscreen response
```

**This means:**
- Offscreen document might not be receiving messages
- Check if offscreen document was created
- Check service worker console for errors

## Common Issues

### Issue: "Permission dismissed"

**Solution:**
1. Click the lock/info icon in the address bar
2. Find "Microphone" and set to "Allow"
3. Click microphone button again

### Issue: "Timeout waiting for offscreen document response"

**Check:**
1. Service worker console for errors
2. Verify offscreen document was created
3. Look for `[Offscreen]` logs in service worker console
4. Try reloading the extension

### Issue: Extension not loading

**Check:**
1. `chrome://extensions` for errors
2. Verify all files exist in `artifacts/Dev/`
3. Check manifest.json is valid
4. Try reloading the extension

## Validation Checklist

- [ ] Extension loads without errors
- [ ] Sidepanel opens successfully
- [ ] Microphone button is visible
- [ ] Clicking button shows permission prompt (first time) or starts recording
- [ ] Recording state is visible (button animation/pulsing)
- [ ] Clicking again stops recording
- [ ] Audio is transcribed to input field
- [ ] Console logs show proper flow:
  - [Background] logs show message routing
  - [Offscreen] logs show recording activity
  - No timeout errors

## Automated Testing Alternative

For automated testing, consider:
1. Using Chrome DevTools Protocol directly
2. Using Puppeteer (better extension support)
3. Manual testing with detailed logging (current approach)

The Playwright test script (`test-microphone-jira.mjs`) can still be useful for:
- Opening the browser
- Navigating to the site
- Keeping browser open for manual testing
- Collecting logs after manual interaction

