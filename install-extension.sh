#!/bin/bash

# Installation script for ANS Browser Extension
# This script helps automate the installation process

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/artifacts/Dev"
CHROME_EXTENSIONS_DIR=""

# Detect OS and set Chrome extensions directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CHROME_EXTENSIONS_DIR="$HOME/Library/Application Support/Google/Chrome/Default/Extensions"
    CHROME_USER_DATA="$HOME/Library/Application Support/Google/Chrome"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    CHROME_EXTENSIONS_DIR="$HOME/.config/google-chrome/Default/Extensions"
    CHROME_USER_DATA="$HOME/.config/google-chrome"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows (Git Bash)
    CHROME_EXTENSIONS_DIR="$APPDATA/Google/Chrome/User Data/Default/Extensions"
    CHROME_USER_DATA="$APPDATA/Google/Chrome/User Data"
else
    echo "❌ Unsupported operating system: $OSTYPE"
    exit 1
fi

echo "📦 ANS Browser Extension Installation Script"
echo "============================================"
echo ""

# Check if extension directory exists
if [ ! -d "$EXTENSION_DIR" ]; then
    echo "❌ Extension directory not found: $EXTENSION_DIR"
    echo "   Please build the extension first: BUILD_ENV=dev npm run build"
    exit 1
fi

# Check if manifest.json exists
if [ ! -f "$EXTENSION_DIR/manifest.json" ]; then
    echo "❌ manifest.json not found in $EXTENSION_DIR"
    exit 1
fi

echo "✓ Extension directory found: $EXTENSION_DIR"
echo ""

# Method 1: Try to install via Chrome's command line (requires Chrome running)
echo "Method 1: Attempting automatic installation..."
echo ""

if command -v google-chrome &> /dev/null || [ -d "/Applications/Google Chrome.app" ]; then
    echo "⚠️  Chrome detected. However, Chrome's security model requires manual user interaction."
    echo "   Automatic installation is not possible for unsigned extensions."
    echo ""
fi

# Method 2: Provide instructions for manual installation
echo "Method 2: Manual Installation (Recommended)"
echo "============================================"
echo ""
echo "Follow these steps to install the extension:"
echo ""
echo "1. Open Google Chrome"
echo "2. Navigate to: chrome://extensions/"
echo "3. Enable 'Developer mode' (toggle in top right)"
echo "4. Click 'Load unpacked'"
echo "5. Select this folder:"
echo "   $EXTENSION_DIR"
echo ""
echo "The extension will be installed and enabled automatically."
echo ""

# Method 3: Create a symlink (advanced, may not work due to Chrome security)
echo "Method 3: Enterprise Deployment"
echo "==============================="
echo ""
echo "For enterprise deployments, use Chrome Enterprise Policies:"
echo ""
echo "1. See enterprise-policy.json for policy configuration"
echo "2. Deploy via Group Policy (Windows) or MDM (macOS)"
echo "3. Or publish to Chrome Web Store for automatic updates"
echo ""

# Check if user wants to open Chrome extensions page
read -p "Would you like to open chrome://extensions/ in your browser? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "chrome://extensions/"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        google-chrome "chrome://extensions/" 2>/dev/null || chromium "chrome://extensions/" 2>/dev/null || echo "Please open Chrome manually and go to chrome://extensions/"
    else
        echo "Please open Chrome manually and go to chrome://extensions/"
    fi
fi

echo ""
echo "✅ Installation instructions provided."
echo "   Extension location: $EXTENSION_DIR"

