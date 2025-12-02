#!/usr/bin/env node

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read BUILD_ENV from environment variable (default to 'dev')
const BUILD_ENV = process.env.BUILD_ENV || 'dev';
const envFolder = BUILD_ENV.charAt(0).toUpperCase() + BUILD_ENV.slice(1);
const extensionDir = resolve(__dirname, 'artifacts', envFolder);
const outputDir = resolve(__dirname, 'packages');
const keyPath = resolve(__dirname, 'extension-key.pem');

console.log(`📦 Packaging extension for environment: ${BUILD_ENV}`);
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

// Generate key if it doesn't exist
if (!existsSync(keyPath)) {
  console.log('🔑 Generating new private key...');
  try {
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });
    console.log(`✓ Key generated: ${keyPath}`);
    console.log(`⚠️  IMPORTANT: Keep this key file safe! You'll need it for future updates.`);
  } catch (error) {
    console.error('❌ Failed to generate key. Make sure OpenSSL is installed.');
    console.error('   On macOS: OpenSSL should be pre-installed');
    console.error('   On Linux: sudo apt-get install openssl');
    console.error('   On Windows: Install OpenSSL or use Git Bash');
    process.exit(1);
  }
}

// Try to use Chrome's native packaging (preferred method)
console.log('🔨 Packaging extension...');
let packaged = false;

// Method 1: Use Chrome's command-line tool
try {
  let chromePath;
  if (process.platform === 'darwin') {
    chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else if (process.platform === 'win32') {
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else {
    chromePath = 'google-chrome';
  }
  
  if (existsSync(chromePath) || process.platform === 'linux') {
    console.log('   Using Chrome\'s native packaging...');
    // Chrome creates the .crx in the parent directory of the extension
    const artifactsDir = resolve(__dirname, 'artifacts');
    const chromeCrxPath = resolve(artifactsDir, `${envFolder}.crx`);
    
    // Remove existing .crx if it exists
    if (existsSync(chromeCrxPath)) {
      execSync(`rm "${chromeCrxPath}"`);
    }
    
    // Use Chrome's --pack-extension flag
    const command = `"${chromePath}" --pack-extension="${extensionDir}" --pack-extension-key="${keyPath}" --no-message-box`;
    execSync(command, { stdio: 'pipe' });
    
    if (existsSync(chromeCrxPath)) {
      // Move to packages directory with better name
      const finalCrxPath = resolve(outputDir, `extension-${BUILD_ENV}-v${version}.crx`);
      execSync(`mv "${chromeCrxPath}" "${finalCrxPath}"`);
      console.log(`✅ Successfully packaged: ${finalCrxPath}`);
      packaged = true;
    }
  }
} catch (error) {
  // Chrome packaging failed, will try crx package
  console.log('   Chrome packaging not available, trying crx package...');
}

// Method 2: Use crx package (fallback)
if (!packaged) {
  try {
    const Crx = (await import('crx')).default;
    const crx = new Crx({
      codebase: extensionDir,
      privateKey: readFileSync(keyPath),
    });
    
    const buffer = await crx.pack();
    const crxPath = resolve(outputDir, `extension-${BUILD_ENV}-v${version}.crx`);
    writeFileSync(crxPath, buffer);
    console.log(`✅ Successfully packaged: ${crxPath}`);
    packaged = true;
  } catch (error) {
    console.error('❌ Failed to package extension with crx package');
    console.error(error.message);
  }
}

if (!packaged) {
  console.error('\n❌ All packaging methods failed.');
  console.error('\n💡 Manual packaging option:');
  console.error('   1. Open Chrome and go to chrome://extensions/');
  console.error('   2. Enable Developer mode');
  console.error('   3. Click "Pack extension"');
  console.error(`   4. Extension root directory: ${extensionDir}`);
  console.error(`   5. Private key file: ${keyPath}`);
  process.exit(1);
}

