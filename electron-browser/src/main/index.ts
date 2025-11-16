import { join } from 'path';
import type Store from 'electron-store';
import { app, BrowserWindow } from 'electron';
import { WindowManager } from './window-manager';
import { BrowserManager } from './browser-manager';
import { setupIpcHandlers } from './ipc-handlers';

let windowManager: WindowManager;
let browserManager: BrowserManager;
let store: Store<Record<string, unknown>>;

async function createApplication() {
  // Check if vite dev server is running to determine dev mode
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
  // Initialize store on first app ready (to handle ESM import)
  if (!store) {
    const StoreModule = await import('electron-store');
    const StoreConstructor = StoreModule.default;
    store = new StoreConstructor({
      name: 'atlas-settings',
    });
  }

  // Create main window
  windowManager = new WindowManager(isDev);
  const mainWindow = windowManager.createMainWindow();

  // Create browser manager for web mode
  browserManager = new BrowserManager(mainWindow);

  // Setup IPC handlers
  setupIpcHandlers(browserManager, store);

  // Load the app
  if (isDev) {
    // In dev mode, vite-plugin-electron sets this env var
    const rendererUrl = process.env.VITE_DEV_SERVER_URL;
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl);
    } else {
      // Fallback to localhost
      mainWindow.loadURL('http://localhost:5173');
    }
    mainWindow.webContents.openDevTools();
  } else {
    // Use app.getAppPath() for proper asar archive support
    const indexPath = join(app.getAppPath(), 'dist/renderer/index.html');
    console.log('Loading file from:', indexPath);
    mainWindow.loadFile(indexPath);
    // Open dev tools in production to debug
    mainWindow.webContents.openDevTools();
  }

  // Debug: log what's being loaded
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
}

// App lifecycle
app.whenReady().then(createApplication);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createApplication();
  }
});

// Handle app termination
app.on('before-quit', () => {
  if (browserManager) {
    browserManager.cleanup();
  }
});
