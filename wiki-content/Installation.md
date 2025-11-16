# Installation Guide

## Option 1: Install from GitHub Actions Artifacts

### Step 1: Download the Extension

1. Go to the [Actions tab](https://github.com/gdcorp-engineering/ans-browser-extension/actions)
2. Click on the latest **Build Extension** workflow run
3. Scroll down to the **Artifacts** section
4. Download one of the following:
   - **ZIP Package** (`extension-{env}-v{build_number}`) - Download and extract
   - **Unzipped** (`extension-{env}-unzipped-v{build_number}`) - Ready to use

Choose the environment you need:
- **dev**: Development environment with debugging enabled
- **test**: Testing environment
- **prod**: Production environment

### Step 2: Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right corner)
3. Click **Load unpacked**
4. Select the extracted extension folder
5. The extension icon should appear in your toolbar

### Step 3: Configure API Keys

1. Click the extension icon in your toolbar
2. Click the settings icon (⚙️) in the sidebar
3. Enter your API keys:
   - **Anthropic API Key** (required for Claude)
   - **OpenAI API Key** (optional)
   - **Google API Key** (optional for Gemini)
4. Select your preferred AI provider
5. Click **Save Settings**

## Option 2: Build from Source

See the [Building from Source](Building) guide for instructions on building the extension locally.

## Troubleshooting

### Extension doesn't load
- Make sure you've enabled **Developer mode** in `chrome://extensions/`
- Check that you selected the correct folder containing `manifest.json`

### API not working
- Verify your API key is valid
- Check the browser console for error messages (F12 → Console)

### Features not working
- Make sure you've granted all requested permissions
- Try reloading the extension in `chrome://extensions/`
