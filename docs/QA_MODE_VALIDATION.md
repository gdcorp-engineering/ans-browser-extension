# Comprehensive QA: Chat Modes with GoCode Integration

## Test API Key
```
Configure in extension settings - do not hardcode
```

## Modes to Test

1. **create_image** - Image generation mode
2. **thinking** - Deep thinking mode
3. **deep_research** - Research mode
4. **study_and_learn** - Study mode
5. **web_search** - Web search mode
6. **canvas** - Canvas/drawing mode
7. **browser_memory** - Browser memory mode

## Test Checklist

### Setup
- [ ] Configure extension with GoCode URL (customBaseUrl)
- [ ] Set API key in extension settings (do not hardcode)
- [ ] Verify extension loads without errors

### Mode Integration Tests

#### 1. Create Image Mode
- [ ] Click "+" menu → "Create image"
- [ ] Verify mode indicator appears below input field
- [ ] Verify placeholder text: "Describe the image you want to create..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: create_image`
- [ ] Verify network request includes `"mode": "create_image"` in request body
- [ ] Verify response is received

#### 2. Thinking Mode
- [ ] Click "+" menu → "Thinking"
- [ ] Verify mode indicator appears with lightbulb icon
- [ ] Verify placeholder text: "Ask a question for deep thinking..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: thinking`
- [ ] Verify network request includes `"mode": "thinking"` in request body
- [ ] Verify response is received

#### 3. Deep Research Mode
- [ ] Click "+" menu → "Deep research"
- [ ] Verify mode indicator appears with travel_explore icon
- [ ] Verify placeholder text: "Ask a question for deep research..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: deep_research`
- [ ] Verify network request includes `"mode": "deep_research"` in request body
- [ ] Verify response is received

#### 4. Study and Learn Mode
- [ ] Click "+" menu → "Study and learn"
- [ ] Verify mode indicator appears with menu_book icon
- [ ] Verify placeholder text: "Ask a question to study and learn..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: study_and_learn`
- [ ] Verify network request includes `"mode": "study_and_learn"` in request body
- [ ] Verify response is received

#### 5. Web Search Mode
- [ ] Click "+" menu → "More" → "Web search"
- [ ] Verify mode indicator appears with public icon
- [ ] Verify placeholder text: "Search the web for..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: web_search`
- [ ] Verify network request includes `"mode": "web_search"` in request body
- [ ] Verify response is received

#### 6. Canvas Mode
- [ ] Click "+" menu → "More" → "Canvas"
- [ ] Verify mode indicator appears with draw icon
- [ ] Verify placeholder text: "Describe what you want to draw..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: canvas`
- [ ] Verify network request includes `"mode": "canvas"` in request body
- [ ] Verify response is received

#### 7. Browser Memory Mode
- [ ] Click "+" menu → "More" → "Browser memory"
- [ ] Verify mode indicator appears with layers icon
- [ ] Verify placeholder text: "Ask about browser memory..."
- [ ] Send a test message
- [ ] Check browser console for: `🔵 [Service] Mode parameter included: browser_memory`
- [ ] Verify network request includes `"mode": "browser_memory"` in request body
- [ ] Verify response is received

### Mode Indicator Tests
- [ ] Verify mode indicator appears below input field when mode is selected
- [ ] Verify correct icon displays for each mode
- [ ] Verify correct text displays for each mode
- [ ] Verify close icon (X) appears on hover
- [ ] Verify clicking close icon clears the mode
- [ ] Verify mode clears after sending a message

### Cross-Provider Tests
Test each mode with:
- [ ] Google provider (Gemini)
- [ ] Anthropic provider (Claude)
- [ ] OpenAI provider (GPT)

### Network Request Validation
For each mode, verify in browser DevTools Network tab:
- [ ] Request URL is correct (GoCode endpoint)
- [ ] Request method is POST
- [ ] Request headers include API key
- [ ] Request body includes `"mode": "<mode_name>"`
- [ ] Request body structure is correct
- [ ] Response is received successfully

### Error Handling
- [ ] Test with invalid API key
- [ ] Test with network errors
- [ ] Verify error messages are user-friendly
- [ ] Verify mode is preserved on retry

## Expected Request Body Structure

```json
{
  "model": "model-name",
  "messages": [...],
  "mode": "create_image" | "thinking" | "deep_research" | "study_and_learn" | "web_search" | "canvas" | "browser_memory",
  "chat_files_metadata": [...],  // if files attached
  ...
}
```

## Console Logs to Verify

Look for these console logs when testing:
- `🔵 [Submit Message] Chat mode set: <mode>`
- `🔵 [Anthropic Service] Mode parameter included: <mode>`
- `🔵 [OpenAI Service] Mode parameter included: <mode>`
- `🔵 [Google Service] Mode parameter included: <mode>`
- `🔵 [Anthropic Browser Tools] Mode parameter included: <mode>`

## Notes

- Mode parameter is only included when `customBaseUrl` (GoCode) is configured
- Mode is cleared after sending a message
- Mode can be manually cleared by clicking the X icon on hover
- All 7 modes should work identically in terms of integration

