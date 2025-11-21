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

// Create ZIP files - both versioned and latest
const zipFileName = `ans-extension-${BUILD_ENV}-v${version}.zip`;
const zipPath = resolve(outputDir, zipFileName);
const latestZipFileName = `ans-extension-${BUILD_ENV}-latest.zip`;
const latestZipPath = resolve(outputDir, latestZipFileName);

console.log('🔨 Creating ZIP file...');

const createZip = (targetPath) => {
  try {
    // Use zip command (available on macOS and Linux, or install on Windows)
    const command = `cd "${extensionDir}" && zip -r "${targetPath}" . -x "*.DS_Store" "*.git*"`;
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    // Try alternative method for Windows
    if (process.platform === 'win32') {
      try {
        // Try PowerShell Compress-Archive
        const psCommand = `Compress-Archive -Path "${extensionDir}\\*" -DestinationPath "${targetPath}" -Force`;
        execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });
        return true;
      } catch (psError) {
        return false;
      }
    }
    return false;
  }
};

// Create versioned ZIP
if (!createZip(zipPath)) {
  console.error('❌ Failed to create ZIP file');
  console.error('   Please install a ZIP tool or use 7-Zip');
  console.error('   Or manually zip the folder:', extensionDir);
  process.exit(1);
}

console.log(`✅ Successfully created: ${zipPath}`);

// Create latest ZIP (copy of versioned for installer to use)
try {
  if (process.platform === 'win32') {
    // Windows: copy file
    execSync(`copy /Y "${zipPath}" "${latestZipPath}"`, { stdio: 'pipe' });
  } else {
    // Unix: copy file
    execSync(`cp "${zipPath}" "${latestZipPath}"`, { stdio: 'pipe' });
  }
  console.log(`✅ Successfully created: ${latestZipPath} (for installer download)`);
} catch (error) {
  console.warn(`⚠️  Could not create latest ZIP file: ${error.message}`);
  console.warn('   The versioned ZIP file was created successfully.');
}

console.log('');
console.log('📋 Next steps for users:');
console.log('   1. Download this ZIP file');
console.log('   2. Extract it to a folder');
console.log('   3. Open Chrome → chrome://extensions/');
console.log('   4. Enable Developer mode');
console.log('   5. Click "Load unpacked" and select the extracted folder');
console.log('');
console.log(`📦 Files created:`);
console.log(`   - ${zipFileName} (versioned)`);
console.log(`   - ${latestZipFileName} (for installer download)`);

