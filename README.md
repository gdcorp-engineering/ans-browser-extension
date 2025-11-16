<div align="center">

![Banner](./assets/banner.png)

# Open ChatGPT Atlas

Open Source and Free Alternative to ChatGPT Atlas.

![Atlas Demo](./atlas.gif)

<a href="https://github.com/composiohq/open-chatgpt-atlas"><img alt="Star" src="https://img.shields.io/badge/⭐%20Star%20Us-GitHub-yellow?style=for-the-badge"></a>


</div>

## Features

- **◉ Browser Tools Mode**: AI-powered browser automation with clicks, typing, scrolling, and navigation
- **🤖 ANS Integration**: GoDaddy Agent Naming System (ANS) support for trusted A2A agents
- **Sidebar Chat Interface**: Clean, modern React-based chat UI accessible from any tab
- **Direct Browser Automation**: No backend required - all API calls made directly from extension
- **Visual Feedback**: Blue border overlay and element highlighting during automation
- **Multi-Environment Builds**: Separate Dev, Test, and Prod environment configurations
- **🔧 Composio Support**: Optional Tool Router mode for Gmail, Slack, GitHub, and 500+ integrations

## Getting Started

### For GoDaddy Employees (ANS Extension)

#### Prerequisites
- Chrome or Edge browser (Manifest V3 support)
- GoDaddy VPN access
- GoCode API key
- ANS credentials

#### Installation Steps

1. **Connect to VPN**
   - Log into GoDaddy VPN

2. **Authenticate ANS Access**
   - Sign into [www.dev-godaddy.com](https://www.dev-godaddy.com) in Chrome
   - This step is required to access ANS services

3. **Download and Install Extension**
   - Download the extension zip file from the latest release
   - Unzip into a folder named `dist`

4. **Load Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right corner
   - Click "Load unpacked"
   - Select the `dist` folder

5. **Configure API Keys**
   - Click the Settings (⚙️) icon in the extension
   - Add the following base URL:
     ```
     https://caas-gocode-prod.caas-prod.prod.onkatana.net
     ```
   - Get your GoCode API key: [https://caas.godaddy.com/gocode/my-api-keys](https://caas.godaddy.com/gocode/my-api-keys)
   - Get your ANS credentials: [https://ra.int.dev-godaddy.com/v1/agents](https://ra.int.dev-godaddy.com/v1/agents)

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

- **[FAQ](./FAQ.md)** - Frequently asked questions and quick troubleshooting
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Detailed troubleshooting guide for common issues

## References

- [ChatGPT Atlas](https://openai.com/index/introducing-chatgpt-atlas/) - OpenAI's browser automation AI agent
- [Gemini Computer Use Model](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) - Google's AI model for browser automation
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs/computer-use) - Official documentation for Gemini Computer Use
- [GoDaddy ANS Documentation](https://ra.int.dev-godaddy.com/v1/agents) - ANS agent registration and credentials
