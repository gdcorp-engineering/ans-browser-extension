#!/usr/bin/env node

/**
 * Helper script to get the extension ID from a .crx file or installed extension
 * 
 * The extension ID is needed for Chrome Enterprise Policies
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Method 1: Calculate from private key (if available)
const keyPath = resolve(__dirname, 'extension-key.pem');

if (existsSync(keyPath)) {
  try {
    const key = readFileSync(keyPath, 'utf-8');
    
    // Extract the public key from the private key
    // This is a simplified approach - Chrome uses a specific algorithm
    console.log('📋 Extension ID Calculation');
    console.log('==========================');
    console.log('');
    console.log('⚠️  Note: Extension ID is derived from the public key.');
    console.log('   The exact ID will be generated when Chrome first installs the extension.');
    console.log('');
    console.log('To get your extension ID:');
    console.log('1. Install the extension once (manually or via Load unpacked)');
    console.log('2. Go to chrome://extensions/');
    console.log('3. Enable Developer mode');
    console.log('4. Find your extension - the ID is shown below the name');
    console.log('');
    console.log('Or use Chrome DevTools:');
    console.log('1. Open chrome://extensions/');
    console.log('2. Open DevTools (F12)');
    console.log('3. Run in console:');
    console.log('   chrome.management.getAll((exts) => {');
    console.log('     const ext = exts.find(e => e.name.includes("ANS"));');
    console.log('     console.log("Extension ID:", ext.id);');
    console.log('   });');
    console.log('');
  } catch (error) {
    console.error('Error reading key file:', error.message);
  }
} else {
  console.log('📋 Extension ID Helper');
  console.log('======================');
  console.log('');
  console.log('Extension ID is generated when Chrome first installs the extension.');
  console.log('');
  console.log('To get your extension ID:');
  console.log('1. Install the extension (Load unpacked from artifacts/Dev)');
  console.log('2. Go to chrome://extensions/');
  console.log('3. Enable Developer mode');
  console.log('4. The ID is shown below the extension name');
  console.log('');
  console.log('The ID looks like: abcdefghijklmnopqrstuvwxyz123456');
  console.log('');
}

