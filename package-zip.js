#!/usr/bin/env node

/**
 * Creates a ready-to-use ZIP file for easy distribution
 * Users can download, extract, and load in Chrome
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read BUILD_ENV from environment variable (default to 'dev')
const BUILD_ENV = process.env.BUILD_ENV || 'dev';
const envFolder = BUILD_ENV.charAt(0).toUpperCase() + BUILD_ENV.slice(1);
const extensionDir = resolve(__dirname, 'artifacts', envFolder);
const outputDir = resolve(__dirname, 'packages');

console.log(`📦 Creating ZIP package for environment: ${BUILD_ENV}`);
console.log(`📁 Extension directory: ${extensionDir}`);

// Check if extension directory exists
if (!existsSync(extensionDir)) {
  console.error(`❌ Extension directory not found: ${extensionDir}`);
  console.error(`   Please build the extension first: BUILD_ENV=${BUILD_ENV} npm run build`);
  process.exit(1);
}

// Check if manifest.json exists
const manifestPath = resolve(extensionDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`❌ manifest.json not found in ${extensionDir}`);
  process.exit(1);
}

// Read version from manifest
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const version = manifest.version || '1.0.0';
console.log(`📌 Extension version: ${version}`);

// Create output directory
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Create ZIP file
const zipFileName = `ans-extension-${BUILD_ENV}-v${version}.zip`;
const zipPath = resolve(outputDir, zipFileName);

console.log('🔨 Creating ZIP file...');

try {
  // Use zip command (available on macOS and Linux, or install on Windows)
  const command = `cd "${extensionDir}" && zip -r "${zipPath}" . -x "*.DS_Store" "*.git*"`;
  execSync(command, { stdio: 'inherit' });
  console.log(`✅ Successfully created: ${zipPath}`);
  console.log('');
  console.log('📋 Next steps for users:');
  console.log('   1. Download this ZIP file');
  console.log('   2. Extract it to a folder');
  console.log('   3. Open Chrome → chrome://extensions/');
  console.log('   4. Enable Developer mode');
  console.log('   5. Click "Load unpacked" and select the extracted folder');
} catch (error) {
  // Try alternative method for Windows
  if (process.platform === 'win32') {
    try {
      // Try PowerShell Compress-Archive
      const psCommand = `Compress-Archive -Path "${extensionDir}\\*" -DestinationPath "${zipPath}" -Force`;
      execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });
      console.log(`✅ Successfully created: ${zipPath}`);
    } catch (psError) {
      console.error('❌ Failed to create ZIP file');
      console.error('   Please install a ZIP tool or use 7-Zip');
      console.error('   Or manually zip the folder:', extensionDir);
      process.exit(1);
    }
  } else {
    console.error('❌ Failed to create ZIP file');
    console.error('   Make sure the `zip` command is available');
    process.exit(1);
  }
}

