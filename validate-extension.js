// Quick validation script - run this in Node to check basic structure
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Validating Extension Build...\n');

const artifactsDir = path.join(__dirname, 'artifacts', 'Dev');

// Check if artifacts exist
const requiredFiles = [
  'background.js',
  'sidepanel.js',
  'content.js',
  'offscreen.js',
  'manifest.json'
];

let allGood = true;

requiredFiles.forEach(file => {
  // Security: Validate file name to prevent path traversal
  if (file.includes('..') || file.includes('/') || file.includes('\\')) {
    console.error(`❌ Invalid file name: ${file}`);
    allGood = false;
    return;
  }
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
  const filePath = path.join(artifactsDir, file);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`✅ ${file} exists (${(stats.size / 1024).toFixed(2)} KB)`);
  } else {
    console.log(`❌ ${file} MISSING`);
    allGood = false;
  }
});

// Check background.js for key functions
const backgroundPath = path.join(artifactsDir, 'background.js');
if (fs.existsSync(backgroundPath)) {
  const backgroundCode = fs.readFileSync(backgroundPath, 'utf8');
  
  const checks = [
    { name: 'ensureContentScript function', pattern: /function ensureContentScript/ },
    { name: 'updatePageTitle function', pattern: /function updatePageTitle/ },
    { name: 'updatePageTitle calls ensureContentScript', pattern: /await ensureContentScript\(tabId\)/ },
    { name: 'Offscreen document creation', pattern: /ensureOffscreenDocument/ },
    { name: 'Service worker loaded message', pattern: /Atlas background service worker loaded/ }
  ];
  
  console.log('\n📋 Checking background.js structure:');
  checks.forEach(check => {
    if (check.pattern.test(backgroundCode)) {
      console.log(`  ✅ ${check.name}`);
    } else {
      console.log(`  ❌ ${check.name} - NOT FOUND`);
      allGood = false;
    }
  });
}

console.log('\n' + '='.repeat(50));
if (allGood) {
  console.log('✅ All checks passed! Extension build looks good.');
  console.log('\nNext steps:');
  console.log('1. Load extension from artifacts/Dev/ in chrome://extensions');
  console.log('2. Open service worker console and check for errors');
  console.log('3. Test microphone button');
} else {
  console.log('❌ Some checks failed. Please rebuild: BUILD_ENV=dev npm run build');
}
console.log('='.repeat(50));

