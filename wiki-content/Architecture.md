# Architecture Overview

## High-Level Architecture

The extension follows Chrome's Manifest V3 architecture with three main components:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Content       │      │   Background    │      │   Sidebar       │
│   Script        │◄────►│   Service       │◄────►│   Panel         │
│   (content.js)  │      │   Worker        │      │   (React UI)    │
│                 │      │   (background.js)      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Web Page      │      │   Chrome APIs   │      │   AI APIs       │
│   DOM           │      │   Storage, Tabs │      │   (Anthropic)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Components

### 1. Sidebar Panel (sidepanel.tsx)

**Purpose**: Main user interface for chat interaction

**Technology**: React with AI SDK

**Key Features**:
- Chat interface with message history
- Real-time streaming responses
- Tool execution visualization
- Settings configuration
- Message parsing (distinguishes AI responses from tool output)

**Styling Highlights**:
- Tool messages: Compact, monospace, gray (#999), 70% opacity
- User messages: Page context shown in blue box (#1a2332)
- AI messages: Normal text with markdown support

### 2. Background Service Worker (background.ts)

**Purpose**: Coordinates between components and handles API calls

**Key Responsibilities**:
- Message passing between sidebar and content script
- API key management (storage)
- Tool execution routing
- Chrome API integration (tabs, navigation, bookmarks)

**Tool Router**:
```typescript
executeTool(toolName, params) {
  switch(toolName) {
    case 'navigate': // Navigate to URL
    case 'click':    // Click at coordinates
    case 'type':     // Type text
    case 'scroll':   // Scroll page
    case 'getPageContext': // Get page info
  }
}
```

### 3. Content Script (content.ts)

**Purpose**: Interacts with web page DOM

**Key Features**:
- DOM manipulation (click, type, scroll)
- Page context extraction
- Visual feedback overlay

**Overlay Effect**:
When browser automation is active, shows:
- Full-screen blue tint (50% opacity)
- Magic wand emoji (✨) with rotation
- 12 golden sparkle particles
- Auto-dismisses after 1.2 seconds

### 4. AI Integration

#### Anthropic Browser Tools (anthropic-browser-tools.ts)

Provides browser automation tools to Claude:

```typescript
BROWSER_TOOLS = [
  { name: 'navigate',      // Navigate to URL
  { name: 'click',         // Click coordinates
  { name: 'type',          // Type text
  { name: 'scroll',        // Scroll page
  { name: 'getPageContext' // Get page info
]
```

**Tool Execution Loop**:
1. User sends message
2. Claude decides which tools to use
3. Extension executes tools via content script
4. Results sent back to Claude
5. Claude formulates response
6. Repeat if needed (max 10 turns)

**Context Management**:
- Keeps ALL messages for full conversation context
- Old page context (DOM/screenshots) is compressed to summaries
- Only last 2 page contexts retain full content (configurable)
- Prevents token bloat while maintaining conversation history

#### AI SDK Integration

Uses Vercel AI SDK for:
- OpenAI integration
- Google Gemini support
- Streaming responses
- Tool calling standardization

### 5. Settings (settings.html)

**Purpose**: Configuration management

**Stored Settings**:
- API keys (Anthropic, OpenAI, Google)
- Selected AI provider
- Model preferences
- Custom base URLs

## Data Flow

### Chat Message Flow

1. **User Input** → Sidebar panel
2. **Add Page Context** → Get current page info via content script
3. **Send to AI** → Background worker makes API call
4. **Tool Use Decision** → AI returns tool calls
5. **Execute Tools** → Background worker → Content script
6. **Tool Results** → Back to AI
7. **Final Response** → Streamed to sidebar panel

### Tool Execution Flow

```
Sidebar Panel                Background Worker              Content Script
     │                              │                             │
     ├─ Send message ──────────────►│                             │
     │                              ├─ Add page context ─────────►│
     │                              │◄─ Return context ───────────┤
     │                              │                             │
     │                              ├─ Call AI API               │
     │                              │◄─ Tool use decision         │
     │                              │                             │
     │                              ├─ Execute tool ─────────────►│
     │                              │                  (perform action)
     │                              │◄─ Tool result ──────────────┤
     │                              │                             │
     │◄─ Stream response ───────────┤                             │
     │                              │                             │
```

## File Structure

```
├── manifest.json          # Extension configuration
├── sidepanel.tsx          # React UI (main chat interface)
├── sidepanel.html         # Sidebar HTML entry point
├── background.ts          # Service worker
├── content.ts             # Content script (DOM interaction)
├── settings.html          # Settings page
├── anthropic-browser-tools.ts  # Claude tool definitions
├── a2a-service.ts         # Agent-to-Agent protocol
├── tools.ts               # Tool router integration
├── types.ts               # TypeScript type definitions
└── vite.config.ts         # Build configuration
```

## Build System

**Tool**: Vite

**Environment Variables**:
- `BUILD_ENV`: dev | test | prod
- Controls output directory: `artifacts/{Dev|Test|Prod}`

**Build Process**:
1. Compile TypeScript
2. Bundle React components
3. Copy manifest and icons
4. Output to environment-specific folder

## Security

### Permissions

```json
"permissions": [
  "sidePanel",     # Enable sidebar
  "storage",       # Store API keys
  "tabs",          # Tab management
  "history",       # Browser history access
  "bookmarks",     # Bookmark access
  "webNavigation",  # Navigation events
  "scripting",     # Execute scripts
  "contextMenus"   # Context menu integration
]
```

### API Key Storage

- Stored in Chrome's `chrome.storage.sync`
- Never logged or exposed
- User-provided, not hardcoded

### Content Security

- Content script has limited permissions
- Cannot access Chrome APIs directly
- Must message background worker

## Extension Updates

Version managed in:
- `manifest.json` → `version` field
- Updated with each release
- Artifacts tagged with version in GitHub Actions
