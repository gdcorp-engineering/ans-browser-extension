# Development Guide

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm (comes with Node.js)
- Git
- Chrome browser
- API keys (Anthropic, OpenAI, or Google)

### Initial Setup

```bash
# Clone repository
git clone https://github.com/gdcorp-engineering/ans-browser-extension.git
cd ans-browser-extension

# Install dependencies
npm install

# Build for development
BUILD_ENV=dev npm run build
```

## Project Structure

```
ans-browser-extension/
├── .github/
│   └── workflows/
│       └── build.yml           # GitHub Actions workflow
├── artifacts/                  # Build output
│   ├── Dev/                   # Development builds
│   ├── Test/                  # Test builds
│   └── Prod/                  # Production builds
├── icons/                     # Extension icons
├── manifest.json              # Extension manifest
├── sidepanel.tsx              # Main React UI component
├── sidepanel.html             # Sidebar HTML entry
├── background.ts              # Background service worker
├── content.ts                 # Content script (DOM interaction)
├── settings.html              # Settings page
├── anthropic-browser-tools.ts # Browser automation tools
├── a2a-service.ts             # Agent-to-Agent protocol
├── tools.ts                   # Tool router
├── types.ts                   # TypeScript types
├── vite.config.ts             # Build configuration
└── package.json               # Dependencies
```

## Development Workflow

### 1. Make Changes

Edit source files:
- `sidepanel.tsx` - Chat UI and message parsing
- `background.ts` - Service worker and API integration
- `content.ts` - DOM manipulation and page interaction
- `anthropic-browser-tools.ts` - Tool definitions

### 2. Build

```bash
BUILD_ENV=dev npm run build
```

Watch for errors in the console output.

### 3. Reload Extension

1. Go to `chrome://extensions/`
2. Find your extension
3. Click the refresh icon 🔄
4. Test your changes

### 4. Debug

**Console Logs:**
- **Sidebar panel**: Right-click sidebar → Inspect → Console
- **Background worker**: `chrome://extensions/` → Click "service worker" link
- **Content script**: F12 on any webpage → Console

**Common Debug Points:**
```typescript
// In sidepanel.tsx
console.log('💬 Chat message:', message);

// In background.ts
console.log('🔧 Tool execution:', toolName, params);

// In content.ts
console.log('📄 Page context:', context);
```

## Key Development Areas

### Adding New Browser Tools

**1. Define tool in `anthropic-browser-tools.ts`:**

```typescript
const BROWSER_TOOLS = [
  // ... existing tools
  {
    name: 'myNewTool',
    description: 'Description of what it does',
    input_schema: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Parameter description' },
      },
      required: ['param1'],
    },
  },
];
```

**2. Implement tool in `background.ts`:**

```typescript
case 'myNewTool':
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'myNewTool',
    ...params
  });
  return result;
```

**3. Handle in `content.ts`:**

```typescript
case 'myNewTool':
  // Implement the actual DOM manipulation
  const result = performAction(message.param1);
  sendResponse({ success: true, result });
  break;
```

### Modifying UI

**Sidebar Chat (sidepanel.tsx):**

```typescript
// Add new UI elements
const MyComponent = () => {
  return <div>Custom UI</div>;
};

// Modify message styling
const MessageParser = ({ content }) => {
  // Custom rendering logic
};
```

**CSS Styling:**

Styles are defined inline using React style objects:

```typescript
<div style={{
  backgroundColor: '#1a1a1a',
  padding: '10px',
  borderRadius: '4px'
}}>
  Content
</div>
```

### Content Script Visual Effects

The `highlightElement()` function in `content.ts` shows visual feedback:

```typescript
function highlightElement() {
  // Create overlay with blue tint
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    width: 100%;
    height: 100%;
    background: rgba(0, 122, 255, 0.50);
    z-index: 999997;
  `;

  // Add sparkle effects
  // Auto-remove after 1.2s
}
```

## Testing

### Manual Testing

1. **Build** the extension
2. **Reload** in Chrome
3. **Test features**:
   - Chat interface
   - Tool execution (navigate, click, type, scroll)
   - Settings page
   - Visual effects

### Testing Tools

```bash
# Test navigation
"Navigate to google.com"

# Test clicking
"Click the search button"

# Test typing
"Type 'hello world' in the search box"

# Test page context
"What is the title of this page?"
```

### Testing Different Environments

```bash
# Development (verbose logging)
BUILD_ENV=dev npm run build

# Test (production-like)
BUILD_ENV=test npm run build

# Production (optimized)
BUILD_ENV=prod npm run build
```

## Code Style

### TypeScript

- Use explicit types
- Avoid `any` when possible
- Use interfaces for complex types

```typescript
interface ToolInput {
  url?: string;
  x?: number;
  y?: number;
}
```

### React

- Functional components only
- Use hooks for state management
- Keep components focused and small

```typescript
const ChatMessage = ({ message }: { message: Message }) => {
  return <div>{message.content}</div>;
};
```

### Naming Conventions

- **Files**: kebab-case (`anthropic-browser-tools.ts`)
- **Components**: PascalCase (`MessageParser`)
- **Functions**: camelCase (`executeTool`)
- **Constants**: UPPER_SNAKE_CASE (`BROWSER_TOOLS`)

## Version Management

Update version in `manifest.json`:

```json
{
  "version": "1.1.9"
}
```

Version format: `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking changes
- **MINOR**: New features
- **PATCH**: Bug fixes

## Committing Changes

```bash
# Stage changes
git add .

# Commit with descriptive message
git commit -m "feat: add new browser tool for page scrolling"

# Push to repository
git push origin main
```

### Commit Message Format

```
<type>: <description>

[optional body]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, styling
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

## Common Issues

### Build Errors

**Issue**: TypeScript errors
- Run `npm install` to ensure all dependencies are installed
- Check TypeScript version compatibility

**Issue**: Vite build fails
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check vite.config.ts for errors

### Extension Load Errors

**Issue**: Extension won't load in Chrome
- Check that `manifest.json` is present in build output
- Verify all required files are in the artifacts folder
- Check Chrome console for specific errors

**Issue**: Content script not working
- Verify content.ts compiled to content.js
- Check that host_permissions includes `<all_urls>`

### Runtime Errors

**Issue**: API calls failing
- Verify API key is set in settings
- Check browser console for error messages
- Ensure API endpoint is accessible

**Issue**: Tools not executing
- Check background worker console for errors
- Verify tool routing in background.ts
- Test tool execution step-by-step

## Resources

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)

## Getting Help

- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Wiki**: Read detailed documentation
