# ANS Browser Extension

AI-powered browser automation with GoDaddy Agent Name Service (ANS) integration.

## Features

### Core Capabilities
- **◉ Browser Tools Mode**: AI-powered browser automation with clicks, typing, scrolling, and navigation using Gemini 2.5 Computer Use
- **🤖 ANS Integration**: GoDaddy Agent Name Service (ANS) support for trusted A2A agents and Business Marketplace
- **Sidebar Chat Interface**: Clean, modern React-based chat UI accessible from any tab
- **Multiple AI Providers**: Support for Google Gemini, Anthropic Claude, and OpenAI models
- **Direct Browser Automation**: No backend required - all API calls made directly from extension

### File & Media Support
- **File Upload**: Upload images, documents, PDFs, and other file types
- **Screenshot Capture**: Capture and attach screenshots of web pages
- **Tab Attachment**: Attach entire browser tabs for context
- **Voice Dictation**: Microphone support for voice-to-text input

### Business Services
- **🌐 ANS Business Marketplace**: Access to 115 Million verified GoDaddy customer services
- **Service Integration**: Book appointments, order products, and interact with businesses through AI chat
- **A2A Protocol**: Agent-to-Agent protocol support for trusted services

### Protocol & Integration Support
- **MCP (Model Context Protocol)**: Full support for custom MCP servers and ANS marketplace servers
- **🔧 Composio Support**: Optional Tool Router mode for Gmail, Slack, GitHub, and 500+ integrations (hidden from UI)

### User Experience
- **Interactive Onboarding**: Chat-based guided setup process
- **Floating Button**: "Ask GoDaddy ANS" floating button on web pages (configurable)
- **Chat Modes**: Create image, thinking, deep research, study and learn, web search, and more
- **Visual Feedback**: Blue border overlay and element highlighting during automation

### Developer Features
- **Multi-Environment Builds**: Separate Dev, Test, and Prod environment configurations
- **Hot Reload**: Development mode with hot reload support

For a complete list of features, see [FEATURES.md](./docs/FEATURES.md).

## Getting Started

### For GoDaddy Employees (ANS Extension)

#### Prerequisites
- Chrome or Edge browser (Manifest V3 support)
- GoDaddy VPN access
- GoCode API key (required)
- ANS API token (optional - needed for ANS Business Services)

#### Installation Steps

1. **Connect to VPN**
   - Log into GoDaddy VPN

2. **Authenticate ANS Access**
   - Sign into [www.dev-godaddy.com](https://www.dev-godaddy.com) in Chrome
   - This step is required to access ANS services

3. **Download and Install Extension**

   **Easy Method (Recommended for Non-Technical Users):**
   - Download the extension ZIP file (from GitHub releases or your administrator)
   - Extract the ZIP file to a folder (right-click → Extract All on Windows, double-click on Mac)
   - Open the `INSTALL_INSTRUCTIONS.html` file in Chrome for a visual step-by-step guide
   - Or follow the simple steps in [INSTALL_GUIDE.md](./docs/INSTALL_GUIDE.md)

   **Quick Steps:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the extracted folder (the one containing `manifest.json`)

4. **Configure API Keys**
   - Click the Settings (⚙️) icon in the extension
   - Add the GoCode URL (default: `https://caas-gocode-prod.caas-prod.prod.onkatana.net`)
   - Get your GoCode API key: [https://caas.godaddy.com/gocode/my-api-keys](https://caas.godaddy.com/gocode/my-api-keys)
   - (Optional) Get your ANS API token: [https://ra.int.dev-godaddy.com/v1/agents](https://ra.int.dev-godaddy.com/v1/agents) - Required only if you want to use ANS Business Services

### For Developers (Building from Source)

#### Prerequisites
- Node.js 18+ and npm
- Chrome or Edge browser (Manifest V3 support)

#### Build and Install

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
# Build for Dev environment
BUILD_ENV=dev npm run build

# Build for Test environment
BUILD_ENV=test npm run build

# Build for Prod environment
BUILD_ENV=prod npm run build
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select the `artifacts/Dev` (or `artifacts/Test` or `artifacts/Prod`) folder
   - Configure your API keys in Settings (⚙️ icon)

#### Package for Distribution

**Create a ZIP file (Recommended for Easy Distribution):**

```bash
# Package for Dev environment
npm run package:zip:dev

# Package for Test environment
npm run package:zip:test

# Package for Prod environment
npm run package:zip:prod

# Or specify environment manually
BUILD_ENV=dev npm run package:zip
```

The ZIP file will be created in the `packages/` directory. Users can:
1. Download the ZIP file
2. Extract it to a folder
3. Open `INSTALL_INSTRUCTIONS.html` (in the extracted folder) in Chrome for visual installation guide
4. Follow the simple steps to load in Chrome

**Create a .crx file:**

To create a distributable `.crx` file:

```bash
# Package for Dev environment
npm run package:crx:dev

# Package for Test environment
npm run package:crx:test

# Package for Prod environment
npm run package:crx:prod

# Or specify environment manually
BUILD_ENV=dev npm run package:crx
```

The packaged `.crx` file will be created in the `packages/` directory with the name `extension-{env}-v{version}.crx`.

**Note**: The first time you package, a private key (`extension-key.pem`) will be generated. Keep this key file safe - you'll need it for future updates to maintain the same extension ID.

**Installing the .crx file**: When installing a self-signed `.crx` file, Chrome will show a warning: "Chrome can't verify where this extension comes from". This is expected for extensions not published to the Chrome Web Store. 

⚠️ **Important**: Chrome may block unsigned extensions from running even after installation. For local development, use "Load unpacked" instead.

**Options:**
- **For Development**: Use "Load unpacked" with the `artifacts/{Dev|Test|Prod}` folder (no warnings, works immediately)
- **For Enterprise**: See [ENTERPRISE_DEPLOYMENT.md](./docs/ENTERPRISE_DEPLOYMENT.md) for Chrome Enterprise Policies
- **For Public Distribution**: Publish to Chrome Web Store (removes all warnings)

**Installation Helper:**
```bash
# Run the installation helper script
./install-extension.sh
```

### Running the Electron Browser

The project includes a standalone Electron-based browser application with built-in Atlas capabilities.

1. Build the Electron app:
```bash
npm run build:electron
```

2. Start the Electron browser:
```bash
npm run electron
```

3. Or, run in development mode with hot reload:
```bash
npm run electron:dev
```

The Electron browser will launch with the full Atlas functionality integrated, allowing you to use browser tools and tool routing directly from the desktop application.

### Using Browser Tools

1. Enable Browser Tools by clicking the ◉ button in the chat header
2. The extension automatically uses Gemini 2.5 Computer Use Preview
3. Provide natural language instructions to control the browser

**Example prompts:**
- "Navigate to reddit.com and scroll down"
- "Click on the search box and type 'puppies'"
- "Take a screenshot of this page"
- "Click the first image on the page"

### Development

Run with hot reload:
```bash
npm run dev
```

Then reload the extension in Chrome after each change.

---

## For Composio Users (Tool Router Mode)

This extension also supports Composio's Tool Router for accessing Gmail, Slack, GitHub, and 500+ app integrations.

### Prerequisites
- Composio API key from [Composio Dashboard](https://app.composio.dev/settings)
- Google API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Setup

1. Open extension Settings (⚙️ icon)
2. Add your Composio API key under "Composio API Key"
3. Add your Google API key under "Google API Key"

### Using Tool Router Mode

1. Make sure Browser Tools is disabled (◉ button should be OFF)
2. Chat normally - the AI will automatically use Composio tools when needed

**Example prompts:**
- "Check my Gmail for unread messages"
- "Create a GitHub issue titled 'Bug in login flow'"
- "Send a Slack message to #general with 'Hello team!'"

### Composio Resources
- [Composio Platform](https://composio.dev/?utm_source=Github&utm_medium=Youtube&utm_campaign=2025-11&utm_content=Atlas)
- [Tool Router Documentation](https://docs.composio.dev/docs/tool-router/quick-start)
- [Composio GitHub](https://github.com/composiohq)

## Documentation

- **[FEATURES.md](./docs/FEATURES.md)** - Complete list of all features and capabilities
- **[FAQ](./docs/FAQ.md)** - Frequently asked questions and quick troubleshooting
- **[TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** - Detailed troubleshooting guide for common issues

## References

- [ChatGPT Atlas](https://openai.com/index/introducing-chatgpt-atlas/) - OpenAI's browser automation AI agent
- [Gemini Computer Use Model](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) - Google's AI model for browser automation
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs/computer-use) - Official documentation for Gemini Computer Use
- [GoDaddy ANS Documentation](https://ra.int.dev-godaddy.com/v1/agents) - ANS agent registration and credentials

---

**Last Updated:** November 23, 2025
