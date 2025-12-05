# File Upload and Voice Dictation Implementation Plan

## Overview
Add file upload and voice dictation features to the chat interface, integrated with GoCaaS API support.

## UI Changes

### Input Form Layout
Current layout: `[input field] [send button]`

New layout: `["Add files and more" button] [input field] [voice button] [send button]`

### Button Specifications

1. **"Add files and more" Button** (left of input)
   - Text: "Add files and more"
   - Keyboard shortcut indicator: "/" shown in a small badge
   - Position: Left side of input form
   - Function: Opens dropdown menu with file and action options
   - Hover tooltip: "Add files and more (Press /)"
   - Visual: Button with text, rounded corners, dark theme
   - Dropdown menu items:
     - Add photos & files (with paperclip icon)
     - Attach tab (with tab icon)
     - Attach screenshot (with screenshot icon)
     - Create image (with image icon)
     - Thinking (with lightbulb icon)
     - Deep research (with telescope icon)
     - Study and learn (with book icon)
     - More (with chevron >) - submenu for additional options

2. **Voice Dictation Button** (right of input)
   - Icon: Material Symbol "mic" (microphone)
   - Position: Right side of input field, before send button
   - Function: Starts/stops voice recording
   - Visual: Icon button, 36x36px, matches send button style
   - State: Shows recording indicator when active (pulsing animation or color change)
   - Hover tooltip: "Voice dictation"

## File Upload Implementation

### Frontend Components

1. **File Upload Handler**
   - Add hidden file input element
   - Support multiple file selection
   - File types: All common formats (images, documents, PDFs, etc.)
   - Max file size: Configurable (default 10MB per file)

2. **File State Management**
   - Track uploaded files in component state
   - Store file metadata: `{ id, name, size, type, file }`
   - Display file previews/chips above input field
   - Allow file removal before sending

3. **File Display**
   - Show file chips above input field when files are selected
   - Each chip shows: file name, size, remove button
   - Limit display to 3-5 files with "and X more" indicator if needed

### GoCaaS API Integration

1. **File Upload to GoCaaS**
   - Upload files to GoCaaS file storage endpoint (if available)
   - Or include file content in message payload (base64 for small files)
   - Get file IDs from upload response

2. **Field Mapping Configuration**
   - Add `chat_files_metadata` to field mappings when sending messages
   - Structure: `[{ id: string, name: string }]`
   - Include in all provider requests (Google, Anthropic, OpenAI)

3. **Message Payload Updates**
   - For Google/Gemini: Include file data in message parts
   - For Anthropic: Include file data in message content
   - For OpenAI: Include file data in message content
   - Ensure backward compatibility with existing message format

### Implementation Files

- `sidepanel.tsx`: Add file upload UI and state management
- `sidepanel.css`: Add styles for file chips and buttons
- `openai-service.ts`: Add file metadata to requests
- `anthropic-service.ts`: Add file metadata to requests
- `sidepanel.tsx` (streamGoogle): Add file metadata to requests

## Voice Dictation Implementation

### Frontend Components

1. **Voice Recording Handler**
   - Use Web Audio API (MediaRecorder) for audio capture
   - Support browser microphone permissions
   - Visual feedback during recording (button state, duration timer)
   - Stop recording on button click or timeout (60s max)

2. **Audio Processing**
   - Convert recorded audio to base64 or blob
   - Support common audio formats (webm, mp3, wav)
   - Handle audio format conversion if needed

### GoCaaS Speech-to-Text Integration

1. **API Endpoint**
   - Use GoCaaS transcription endpoint: `/v1/audio/transcriptions`
   - Base URL: Use `settings.customBaseUrl` (GoCaaS URL)
   - Fallback: Direct OpenAI Whisper API if GoCaaS unavailable

2. **Request Format**
   ```json
   {
     "provider": "openai",
     "providerOptions": {
       "model": "whisper-1",
       "audio": "base64_encoded_audio_or_url"
     }
   }
   ```

3. **Response Handling**
   - Extract transcribed text from response
   - Insert transcribed text into input field
   - Handle errors gracefully (show user-friendly message)

4. **Provider Support**
   - Works with all providers (Google, Anthropic, OpenAI)
   - Transcription happens before message is sent
   - Transcribed text is treated as regular user input

### Implementation Files

- `sidepanel.tsx`: Add voice recording UI and logic
- `sidepanel.css`: Add styles for recording state
- New file: `speech-to-text-service.ts`: Handle GoCaaS transcription API calls

## Technical Considerations

### Browser Compatibility
- File API: Supported in all modern browsers
- MediaRecorder API: Supported in Chrome, Edge, Firefox, Safari (with polyfill if needed)
- Microphone permissions: Handle gracefully with user prompts

### Error Handling
- File upload errors: Show user-friendly messages
- Voice recording errors: Handle permission denials, API failures
- Network errors: Retry logic for API calls
- File size limits: Warn before upload, reject if too large

### Performance
- File size limits: Prevent memory issues
- Audio recording: Limit duration to prevent large files
- Lazy loading: Load audio processing libraries only when needed

### Security
- File validation: Check file types, scan for malicious content
- Audio privacy: Clear audio data after transcription
- API keys: Ensure secure transmission to GoCaaS

## Integration Points

### Current Features Compatibility

1. **Browser Tools Mode**
   - Files and voice work in browser tools mode
   - Files can be screenshots, page exports, etc.
   - Voice can be used for browser automation commands

2. **MCP/A2A Integration**
   - File metadata passed through to MCP tools if needed
   - Voice transcription works with all tool modes

3. **Chat History**
   - File metadata stored in chat history
   - Voice transcriptions stored as regular messages

4. **Multi-Provider Support**
   - Works with Google (Gemini), Anthropic (Claude), OpenAI (GPT)
   - Provider-specific file handling if needed

### Settings Integration
- No new settings required initially
- Uses existing `customBaseUrl` for GoCaaS API
- Uses existing `apiKey` for authentication

## Testing Checklist

- [ ] File upload button appears and works
- [ ] Multiple files can be selected
- [ ] File chips display correctly
- [ ] Files can be removed before sending
- [ ] File metadata sent to GoCaaS API correctly
- [ ] Voice button appears and works
- [ ] Microphone permissions handled correctly
- [ ] Voice recording works and shows feedback
- [ ] Transcription API called correctly
- [ ] Transcribed text appears in input field
- [ ] Works with Google provider
- [ ] Works with Anthropic provider
- [ ] Works with OpenAI provider
- [ ] Works in browser tools mode
- [ ] Works with MCP tools
- [ ] Error handling works for all failure cases
- [ ] File size limits enforced
- [ ] Audio duration limits enforced

## Implementation Order

1. **Phase 1: UI Components**
   - Add buttons to input form
   - Add file chips display area
   - Add recording state indicators

2. **Phase 2: File Upload**
   - Implement file picker
   - Add file state management
   - Create file upload service

3. **Phase 3: GoCaaS File Integration**
   - Integrate file upload with GoCaaS
   - Add field mappings for file metadata
   - Update all provider services

4. **Phase 4: Voice Recording**
   - Implement audio recording
   - Add recording UI feedback
   - Create speech-to-text service

5. **Phase 5: GoCaaS Voice Integration**
   - Integrate with GoCaaS transcription API
   - Handle all error cases
   - Test with all providers

6. **Phase 6: Testing & Polish**
   - Test all features
   - Fix edge cases
   - Optimize performance

## Files to Modify/Create

### Modify Existing Files
- `sidepanel.tsx`: Add UI components and state management
- `sidepanel.css`: Add button and file chip styles
- `openai-service.ts`: Add file metadata support
- `anthropic-service.ts`: Add file metadata support
- `types.ts`: Add file metadata types (if needed)

### Create New Files
- `speech-to-text-service.ts`: GoCaaS transcription service
- `file-upload-service.ts`: File upload and management service (optional, can be in sidepanel.tsx)

## API Endpoints Reference

### GoCaaS File Upload (if available)
- Endpoint: TBD (check GoCaaS documentation)
- Method: POST
- Headers: Authorization with API key
- Body: Multipart form data or base64

### GoCaaS Speech-to-Text
- Endpoint: `/v1/audio/transcriptions` (or as per GoCaaS docs)
- Method: POST
- Headers: Authorization with API key, Content-Type: application/json
- Body: `{ provider: "openai", providerOptions: { model: "whisper-1", audio: "..." } }`

## Questions to Resolve

1. Does GoCaaS have a file upload endpoint, or should files be included in message payload?
2. What is the exact GoCaaS transcription endpoint URL?
3. Should file content be included in system_prompt or as separate message parts?
4. What are the file size limits for GoCaaS?
5. Should we support file previews in the chat (images, PDFs)?

