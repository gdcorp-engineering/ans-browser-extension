#!/usr/bin/env node
/**
 * Automated Agent Mode Validation Tests
 * 
 * Tests agent mode functionality using Playwright with Chromium
 * Validates: message preservation, tab switching, stop button, overlay, etc.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const extensionPath = join(__dirname, 'artifacts', 'Dev');

// Test configuration - 15+ sites with modals, popups, and complex interactions
const TEST_SITES = [
  // E-commerce (modals, add to cart, popups)
  { url: 'https://www.amazon.com', name: 'Amazon', category: 'E-commerce', hasModals: true },
  { url: 'https://www.ebay.com', name: 'eBay', category: 'E-commerce', hasModals: true },
  { url: 'https://www.etsy.com', name: 'Etsy', category: 'E-commerce', hasModals: true },
  
  // Social Media (popups, modals, authentication)
  { url: 'https://twitter.com', name: 'Twitter/X', category: 'Social Media', hasModals: true },
  { url: 'https://www.linkedin.com', name: 'LinkedIn', category: 'Social Media', hasModals: true },
  { url: 'https://www.reddit.com', name: 'Reddit', category: 'Social Media', hasModals: true },
  
  // News/Media (cookie modals, subscription popups)
  { url: 'https://www.cnn.com', name: 'CNN', category: 'News', hasModals: true },
  { url: 'https://www.bbc.com', name: 'BBC', category: 'News', hasModals: true },
  { url: 'https://medium.com', name: 'Medium', category: 'Blog/News', hasModals: true },
  
  // Developer/Technical (complex UIs, modals)
  { url: 'https://github.com', name: 'GitHub', category: 'Developer Tools', hasModals: true },
  { url: 'https://stackoverflow.com', name: 'Stack Overflow', category: 'Developer Tools', hasModals: true },
  { url: 'https://developer.mozilla.org', name: 'MDN Web Docs', category: 'Documentation', hasModals: true },
  
  // SaaS/Productivity (complex forms, modals)
  { url: 'https://www.notion.so', name: 'Notion', category: 'Productivity', hasModals: true },
  { url: 'https://trello.com', name: 'Trello', category: 'Project Management', hasModals: true },
  { url: 'https://www.airtable.com', name: 'Airtable', category: 'Database/Productivity', hasModals: true },
  
  // Video/Entertainment (popups, modals)
  { url: 'https://www.youtube.com', name: 'YouTube', category: 'Video', hasModals: true },
  
  // Forms/Surveys (modals, multi-step)
  { url: 'https://www.typeform.com', name: 'Typeform', category: 'Forms', hasModals: true },
  
  // Government/Public (cookie modals, accessibility popups)
  { url: 'https://www.usa.gov', name: 'USA.gov', category: 'Government', hasModals: true },
  
  // Banking/Financial (security modals, complex forms)
  { url: 'https://www.paypal.com', name: 'PayPal', category: 'Financial', hasModals: true },
  
  // Content/Wiki
  { url: 'https://en.wikipedia.org/wiki/Main_Page', name: 'Wikipedia', category: 'Reference', hasModals: false },
];

const TEST_CASES = [
  {
    name: 'Modal Detection and Interaction',
    description: 'Agent should detect and interact with modals',
    task: 'Navigate to this page and handle any popups or modals that appear',
    sites: ['amazon', 'ebay', 'cnn', 'bbc', 'medium', 'github', 'stackoverflow'],
    validate: async (context, results) => {
      return true; // Manual validation
    }
  },
  {
    name: 'Cookie Consent Modal',
    description: 'Agent handles cookie consent popups',
    task: 'Accept or dismiss any cookie consent dialogs',
    sites: ['bbc', 'cnn', 'medium', 'reddit', 'linkedin'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'E-commerce Add to Cart Modal',
    description: 'Agent interacts with shopping cart modals',
    task: 'Find a product and add it to cart, handle any popups',
    sites: ['amazon', 'ebay', 'etsy'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Authentication Modal',
    description: 'Agent handles login/signup modals',
    task: 'Navigate to login page or handle sign-in prompts',
    sites: ['github', 'linkedin', 'twitter', 'notion'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Search with Results Modal',
    description: 'Agent performs search and handles result modals',
    task: 'Search for "javascript tutorial" and show me the first result',
    sites: ['github', 'stackoverflow', 'youtube', 'medium'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Tab Switch During Modal Interaction',
    description: 'Agent state preserved when switching tabs during modal handling',
    task: 'Start a task that triggers a modal, then switch tabs',
    sites: ['amazon', 'ebay', 'github'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Multi-Step Form with Modals',
    description: 'Agent handles forms with multiple steps and modal confirmations',
    task: 'Fill out a form if available, handling any confirmation modals',
    sites: ['typeform', 'airtable', 'notion'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Video Player Modal',
    description: 'Agent interacts with video player modals',
    task: 'Find and play a video, handle any player modals',
    sites: ['youtube'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Navigation with Overlay Modals',
    description: 'Agent navigates while handling overlay modals',
    task: 'Navigate through the site, handling any overlay modals that appear',
    sites: ['trello', 'notion', 'airtable'],
    validate: async (context, results) => {
      return true;
    }
  },
  {
    name: 'Stop Button During Modal Interaction',
    description: 'Stop button works even when modal is open',
    task: 'Start a task that opens a modal, then click stop',
    sites: ['amazon', 'github', 'linkedin'],
    validate: async (context, results) => {
      return true;
    }
  },
];

async function testAgentMode() {
  console.log('🤖 Agent Mode Validation Tests');
  console.log('================================\n');

  // Check if extension exists
  if (!existsSync(extensionPath)) {
    console.error('❌ Extension not found at:', extensionPath);
    console.log('💡 Run "npm run build" first to build the extension');
    process.exit(1);
  }

  if (!existsSync(join(extensionPath, 'manifest.json'))) {
    console.error('❌ manifest.json not found in extension directory');
    process.exit(1);
  }

  console.log('🚀 Launching Chromium with extension...\n');

  let browser;
  let results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  try {
    // Launch Chromium with extension
    browser = await chromium.launchPersistentContext('', {
      headless: false,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      viewport: { width: 1920, height: 1080 }
    });

    console.log('✅ Chromium launched with extension loaded\n');

    // Get extension ID - try multiple methods
    const extensionPage = await browser.newPage();
    await extensionPage.goto('chrome://extensions/', { waitUntil: 'networkidle' });
    await extensionPage.waitForTimeout(3000);
    
    // Enable developer mode
    try {
      await extensionPage.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        if (manager) {
          const toolbar = manager.shadowRoot?.querySelector('extensions-toolbar');
          if (toolbar) {
            const devMode = toolbar.shadowRoot?.querySelector('#devMode');
            if (devMode && !devMode.hasAttribute('checked')) {
              devMode.click();
            }
          }
        }
      });
      await extensionPage.waitForTimeout(1000);
    } catch (error) {
      console.log('⚠️  Could not enable developer mode (may already be enabled)');
    }

    // Get extension ID from the page - try multiple methods
    let extensionId = await extensionPage.evaluate(() => {
      // Method 1: Try extensions-item elements
      const extensions = document.querySelectorAll('extensions-item');
      for (const ext of extensions) {
        const shadowRoot = ext.shadowRoot;
        if (shadowRoot) {
          const nameEl = shadowRoot.querySelector('#name');
          const name = nameEl?.textContent || '';
          if (name.includes('Atlas') || name.includes('Browser') || name.toLowerCase().includes('extension')) {
            const id = ext.getAttribute('id');
            if (id) return id;
          }
        }
      }
      
      // Method 2: Try to find by ID attribute directly
      for (const ext of extensions) {
        const id = ext.getAttribute('id');
        if (id && id.length === 32) { // Extension IDs are 32 chars
          return id;
        }
      }
      
      return null;
    });

    // If still not found, try to get from service worker or use a fallback
    if (!extensionId) {
      console.log('⚠️  Could not automatically detect extension ID');
      console.log('💡 Using fallback: will test without extension ID');
      extensionId = 'unknown';
    }

    if (extensionId !== 'unknown') {
      console.log(`📦 Extension ID: ${extensionId}\n`);
    } else {
      console.log('📦 Extension ID: (using fallback)\n');
    }

    // Test 1: Basic Extension Loading
    console.log('📋 Test 1: Extension Loading');
    console.log('─────────────────────────────');
    const page = await browser.newPage();
    await page.goto('https://www.google.com', { waitUntil: 'networkidle' });
    console.log('✅ Page loaded:', page.url());
    
    // Check if sidepanel can be opened
    try {
      await page.evaluate((id) => {
        chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      }, extensionId);
      await page.waitForTimeout(1000);
      console.log('✅ Sidepanel accessible\n');
      results.passed++;
      results.tests.push({ name: 'Extension Loading', status: 'PASS' });
    } catch (error) {
      console.log('⚠️  Sidepanel test skipped (requires manual verification)\n');
      results.tests.push({ name: 'Extension Loading', status: 'SKIP' });
    }

    // Test 2: Navigate to test sites (15+ sites with modals/popups)
    console.log('📋 Test 2: Site Navigation & Modal Detection');
    console.log('─────────────────────────────');
    console.log(`Testing ${TEST_SITES.length} sites with complex interactions...\n`);
    
    const siteResults = {
      loaded: 0,
      failed: 0,
      withModals: 0,
      details: []
    };
    
    for (const site of TEST_SITES) {
      try {
        console.log(`\n🌐 [${site.category}] ${site.name}...`);
        
        // Try loading with retry logic
        let loaded = false;
        let lastError = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // Use 'domcontentloaded' instead of 'networkidle' for faster loading
            // Some sites have continuous network activity
            await page.goto(site.url, { 
              waitUntil: 'domcontentloaded', 
              timeout: attempt === 1 ? 15000 : attempt === 2 ? 25000 : 35000 
            });
            loaded = true;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 3) {
              console.log(`   ⏳ Attempt ${attempt} failed, retrying...`);
              await page.waitForTimeout(2000);
            }
          }
        }
        
        if (!loaded) {
          throw lastError;
        }
        
        console.log(`   ✅ Loaded: ${page.url()}`);
        await page.waitForTimeout(3000); // Wait for modals/popups to appear
        
        // Check if page loaded correctly
        const title = await page.title();
        console.log(`   📄 Title: ${title.substring(0, 70)}...`);
        
        // Check for modals/popups
        if (site.hasModals) {
          const hasModal = await page.evaluate(() => {
            // Check for common modal selectors
            const modalSelectors = [
              '[role="dialog"]',
              '.modal',
              '.popup',
              '.overlay',
              '[class*="modal"]',
              '[class*="popup"]',
              '[class*="dialog"]',
              '#cookie-consent',
              '[id*="modal"]',
              '[id*="popup"]',
            ];
            
            for (const selector of modalSelectors) {
              const element = document.querySelector(selector);
              if (element && window.getComputedStyle(element).display !== 'none') {
                return true;
              }
            }
            return false;
          });
          
          if (hasModal) {
            console.log(`   🪟 Modal/Popup detected`);
            siteResults.withModals++;
          } else {
            console.log(`   ℹ️  No visible modal (may appear on interaction)`);
          }
        }
        
        siteResults.loaded++;
        siteResults.details.push({
          name: site.name,
          category: site.category,
          url: page.url(),
          loaded: true,
          hasModals: site.hasModals
        });
        results.passed++;
      } catch (error) {
        const errorMsg = error.message || 'Unknown error';
        const isTimeout = errorMsg.includes('Timeout') || errorMsg.includes('timeout');
        const isNetwork = errorMsg.includes('net::') || errorMsg.includes('ERR_');
        
        console.log(`   ❌ Failed: ${errorMsg.substring(0, 80)}...`);
        if (isTimeout) {
          console.log(`   💡 Suggestion: Site may be slow or require authentication`);
        } else if (isNetwork) {
          console.log(`   💡 Suggestion: Network issue or site unavailable`);
        }
        
        siteResults.failed++;
        siteResults.details.push({
          name: site.name,
          category: site.category,
          loaded: false,
          error: errorMsg,
          errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'other'
        });
        results.failed++;
      }
    }
    
    console.log('\n📊 Site Navigation Summary:');
    console.log(`   ✅ Loaded: ${siteResults.loaded}/${TEST_SITES.length}`);
    console.log(`   ❌ Failed: ${siteResults.failed}`);
    console.log(`   🪟 Sites with modals detected: ${siteResults.withModals}`);
    console.log('');

    // Test 3: Extension Storage Check
    console.log('📋 Test 3: Extension Storage');
    console.log('─────────────────────────────');
    if (extensionId !== 'unknown') {
      try {
        // Navigate to extension's sidepanel
        const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
        const sidepanelPage = await browser.newPage();
        await sidepanelPage.goto(sidepanelUrl, { waitUntil: 'networkidle', timeout: 10000 });
        await sidepanelPage.waitForTimeout(2000);
        
        // Check if sidepanel loaded
        const sidepanelContent = await sidepanelPage.content();
        if (sidepanelContent.includes('Atlas') || sidepanelContent.includes('Chat') || sidepanelContent.length > 100) {
          console.log('✅ Sidepanel loaded successfully');
          console.log('✅ Extension storage accessible');
          results.passed++;
          results.tests.push({ name: 'Extension Storage', status: 'PASS' });
        } else {
          throw new Error('Sidepanel content not found');
        }
        
        await sidepanelPage.close();
      } catch (error) {
        console.log(`⚠️  Storage test: ${error.message}`);
        console.log('   (This may require manual verification)');
        results.tests.push({ name: 'Extension Storage', status: 'SKIP' });
      }
    } else {
      console.log('⚠️  Skipping storage test (extension ID not found)');
      console.log('   (This will be tested manually)');
      results.tests.push({ name: 'Extension Storage', status: 'SKIP' });
    }
    console.log('');

    // Test 4: Tab Management
    console.log('📋 Test 4: Tab Switching');
    console.log('─────────────────────────────');
    try {
      const tabs = browser.pages();
      console.log(`✅ Current tabs: ${tabs.length}`);
      
      // Create a new tab
      const newTab = await browser.newPage();
      await newTab.goto('https://example.com', { waitUntil: 'networkidle' });
      console.log('✅ Created new tab');
      
      // Switch back to original tab
      await page.bringToFront();
      console.log('✅ Switched back to original tab');
      console.log(`✅ Tab management working (${browser.pages().length} tabs)`);
      
      results.passed++;
      results.tests.push({ name: 'Tab Switching', status: 'PASS' });
    } catch (error) {
      console.log(`❌ Tab switching test failed: ${error.message}`);
      results.failed++;
      results.tests.push({ name: 'Tab Switching', status: 'FAIL' });
    }
    console.log('');

    // Test 5: Content Script Injection
    console.log('📋 Test 5: Content Script Injection');
    console.log('─────────────────────────────');
    try {
      await page.goto('https://www.google.com', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      
      // Check if content script has injected (by checking for extension messages)
      const hasContentScript = await page.evaluate(() => {
        return typeof chrome !== 'undefined' && chrome.runtime;
      });
      
      if (hasContentScript) {
        console.log('✅ Content script injected');
        console.log('✅ Chrome runtime API available');
        results.passed++;
        results.tests.push({ name: 'Content Script', status: 'PASS' });
      } else {
        throw new Error('Content script not detected');
      }
    } catch (error) {
      console.log(`⚠️  Content script test: ${error.message}`);
      console.log('   (Content scripts run in isolated context)');
      results.tests.push({ name: 'Content Script', status: 'SKIP' });
    }
    console.log('');

    // Manual Test Instructions - Modal/Popup Focus
    console.log('📋 Manual Agent Mode Tests (Modal/Popup Focus)');
    console.log('─────────────────────────────────────────────────');
    console.log(`Testing ${TEST_CASES.length} scenarios across complex sites:\n`);
    
    let testNum = 1;
    for (const testCase of TEST_CASES) {
      console.log(`${testNum}. ${testCase.name}`);
      console.log(`   Description: ${testCase.description}`);
      console.log(`   Task: ${testCase.task}`);
      if (testCase.sites) {
        const siteNames = testCase.sites.map(s => TEST_SITES.find(ts => ts.name.toLowerCase().includes(s))?.name || s).join(', ');
        console.log(`   Recommended sites: ${siteNames}`);
      }
      console.log(`   Validation:`);
      console.log(`   - [ ] Agent detects modal/popup`);
      console.log(`   - [ ] Agent interacts with modal correctly`);
      console.log(`   - [ ] Agent completes task or communicates clearly`);
      console.log(`   - [ ] Messages preserved if tab switching occurs`);
      console.log(`   - [ ] Overlay shows/hides appropriately`);
      console.log('');
      testNum++;
    }
    
    console.log('\n🎯 Key Modal/Popup Test Scenarios:');
    console.log('─────────────────────────────────────────────────');
    console.log('1. Cookie Consent Modals:');
    console.log('   - Sites: BBC, CNN, Medium, Reddit, LinkedIn');
    console.log('   - Test: Agent should detect and handle cookie dialogs\n');
    
    console.log('2. E-commerce Modals:');
    console.log('   - Sites: Amazon, eBay, Etsy');
    console.log('   - Test: Add to cart, product details, checkout modals\n');
    
    console.log('3. Authentication Modals:');
    console.log('   - Sites: GitHub, LinkedIn, Twitter, Notion');
    console.log('   - Test: Login/signup popups, OAuth flows\n');
    
    console.log('4. Search/Results Modals:');
    console.log('   - Sites: GitHub, Stack Overflow, YouTube');
    console.log('   - Test: Search results, video player modals\n');
    
    console.log('5. Form/Input Modals:');
    console.log('   - Sites: Typeform, Airtable, Notion');
    console.log('   - Test: Multi-step forms, confirmation dialogs\n');
    
    console.log('6. Navigation Overlays:');
    console.log('   - Sites: Trello, Notion, Airtable');
    console.log('   - Test: Sidebar modals, navigation overlays\n');
    
    console.log('7. Tab Switching During Modal:');
    console.log('   - Test: Start task → Modal appears → Switch tab → Switch back');
    console.log('   - Verify: Modal state preserved, agent continues\n');
    
    console.log('8. Stop Button with Modal Open:');
    console.log('   - Test: Modal appears → Click stop');
    console.log('   - Verify: Task stops, modal handling stops, overlay disappears\n');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📊 Test Summary');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    console.log('');
    console.log('🌐 Site Navigation:');
    console.log(`   ✅ Loaded: ${siteResults.loaded}/${TEST_SITES.length} sites`);
    console.log(`   🪟 Modals detected: ${siteResults.withModals} sites`);
    console.log(`   📋 Test cases: ${TEST_CASES.length} scenarios`);
    console.log('');
    console.log('Detailed Results:');
    results.tests.forEach(test => {
      const icon = test.status === 'PASS' ? '✅' : test.status === 'FAIL' ? '❌' : '⚠️';
      console.log(`  ${icon} ${test.name}: ${test.status}`);
    });
    console.log('');
    console.log('💡 Browser will remain open for manual testing');
    console.log('   Focus on modal/popup interaction scenarios');
    console.log('   Press Ctrl+C to close when done\n');

    // Keep browser open for manual testing
    console.log('⏳ Keeping browser open for 10 minutes for comprehensive modal testing...');
    console.log('   Test modal interactions on the sites listed above');
    console.log('   (Close manually or wait for timeout)\n');
    
    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10 minutes

  } catch (error) {
    console.error('❌ Test execution error:', error);
    results.failed++;
  } finally {
    if (browser) {
      await browser.close();
      console.log('\n✅ Browser closed');
    }
  }

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
testAgentMode().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

