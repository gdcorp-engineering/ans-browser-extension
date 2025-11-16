# Building from Source

## Prerequisites

- **Node.js** 20.x or higher
- **npm** (comes with Node.js)
- **Git**

## Clone the Repository

```bash
git clone https://github.com/gdcorp-engineering/ans-browser-extension.git
cd ans-browser-extension
```

## Install Dependencies

```bash
npm install
```

## Build for Different Environments

The extension can be built for three different environments:

### Development Build
```bash
BUILD_ENV=dev npm run build
```
Output: `artifacts/Dev/`

### Test Build
```bash
BUILD_ENV=test npm run build
```
Output: `artifacts/Test/`

### Production Build
```bash
BUILD_ENV=prod npm run build
```
Output: `artifacts/Prod/`

### Default Build
If you don't specify `BUILD_ENV`, it defaults to `dev`:
```bash
npm run build
```

## Build Output

After building, the extension files will be in:
```
artifacts/
  ├── Dev/        # Development build
  ├── Test/       # Test build
  └── Prod/       # Production build
```

Each environment folder contains:
- `manifest.json` - Extension manifest
- `sidepanel.html` - Sidebar chat UI
- `settings.html` - Settings page
- `background.js` - Background service worker
- `content.js` - Content script
- `icons/` - Extension icons
- Other compiled assets

## Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the appropriate environment folder (e.g., `artifacts/Dev`)

## Development Workflow

For active development:

1. Make your changes to source files
2. Rebuild the extension:
   ```bash
   BUILD_ENV=dev npm run build
   ```
3. Go to `chrome://extensions/` and click the refresh icon on your extension
4. Test your changes

## Automated Builds

The repository uses GitHub Actions to automatically build the extension when you:
- Manually trigger a workflow from the Actions tab
- Select an environment (dev/test/prod)

See the [Artifacts Guide](Artifacts) for downloading pre-built versions.
