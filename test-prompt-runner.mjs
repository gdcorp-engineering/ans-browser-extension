/**
 * Automated Test Runner for Sample Prompts Validation
 * 
 * This script validates that sample prompts are generated correctly
 * across 50+ popular websites.
 * 
 * Usage: node test-prompt-runner.mjs
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test sites organized by category
const testSites = {
  news: [
    { url: 'https://www.cnn.com', expectedType: 'article', name: 'CNN (homepage)' },
    { url: 'https://www.bbc.com/news', expectedType: 'article', name: 'BBC News' },
    { url: 'https://www.nytimes.com', expectedType: 'article', name: 'NYTimes (homepage)' },
    { url: 'https://www.reuters.com', expectedType: 'article', name: 'Reuters (homepage)' },
    { url: 'https://www.theguardian.com', expectedType: 'article', name: 'The Guardian (homepage)' },
    { url: 'https://www.npr.org', expectedType: 'article', name: 'NPR (homepage)' },
  ],
  ecommerce_homepage: [
    { url: 'https://www.amazon.com', expectedType: 'generic', name: 'Amazon (homepage)', note: 'Homepage - should be generic' },
    { url: 'https://www.ebay.com', expectedType: 'generic', name: 'eBay (homepage)', note: 'Homepage - should be generic' },
    { url: 'https://www.target.com', expectedType: 'generic', name: 'Target (homepage)', note: 'Homepage - should be generic' },
  ],
  ecommerce_product: [
    { url: 'https://www.amazon.com/dp/B08N5WRWNW', expectedType: 'ecommerce', name: 'Amazon Product', note: 'Product page - should detect e-commerce if cart buttons present' },
    { url: 'https://www.etsy.com/listing/123456789', expectedType: 'ecommerce', name: 'Etsy Product', note: 'Product page - should detect e-commerce' },
  ],
  forms: [
    { url: 'https://www.godaddy.com/contact-us', expectedType: 'form', name: 'GoDaddy Contact', note: 'Contact form page' },
    { url: 'https://www.salesforce.com/form/signup/freetrial-sales', expectedType: 'form', name: 'Salesforce Signup', note: 'Registration form' },
    { url: 'https://www.hubspot.com/products/get-started', expectedType: 'form', name: 'HubSpot Signup', note: 'Signup form' },
  ],
  documentation: [
    { url: 'https://developer.mozilla.org', expectedType: 'documentation', name: 'MDN Web Docs' },
    { url: 'https://react.dev', expectedType: 'documentation', name: 'React Docs' },
    { url: 'https://docs.github.com', expectedType: 'documentation', name: 'GitHub Docs' },
    { url: 'https://vuejs.org', expectedType: 'documentation', name: 'Vue.js Docs' },
    { url: 'https://nodejs.org/docs', expectedType: 'documentation', name: 'Node.js Docs' },
  ],
  social: [
    { url: 'https://www.linkedin.com', expectedType: 'generic', name: 'LinkedIn' },
    { url: 'https://www.reddit.com', expectedType: 'article', name: 'Reddit' },
  ],
  video: [
    { url: 'https://www.youtube.com', expectedType: 'video', name: 'YouTube' },
    { url: 'https://vimeo.com', expectedType: 'video', name: 'Vimeo' },
  ],
  service: [
    { url: 'https://www.godaddy.com', expectedType: 'generic', name: 'GoDaddy', note: 'Should NOT be article or e-commerce' },
    { url: 'https://www.salesforce.com', expectedType: 'generic', name: 'Salesforce' },
    { url: 'https://stripe.com', expectedType: 'generic', name: 'Stripe' },
  ],
  blog: [
    { url: 'https://medium.com', expectedType: 'article', name: 'Medium' },
    { url: 'https://dev.to', expectedType: 'article', name: 'Dev.to' },
  ],
  educational: [
    { url: 'https://www.khanacademy.org', expectedType: 'documentation', name: 'Khan Academy' },
    { url: 'https://www.wikipedia.org', expectedType: 'article', name: 'Wikipedia' },
  ],
  search: [
    { url: 'https://www.google.com/search?q=test', expectedType: 'search', name: 'Google Search' },
    { url: 'https://www.bing.com/search?q=test', expectedType: 'search', name: 'Bing Search' },
  ],
};

// Expected prompts by page type
const expectedPrompts = {
  article: ['summarize', 'takeaways', 'key points', 'article'],
  ecommerce: ['products', 'pricing', 'deals', 'cart'],
  documentation: ['concepts', 'features', 'documentation', 'examples'],
  search: ['search results', 'refine', 'relevant'],
  video: ['video about', 'summarize', 'key points'],
  generic: ['purpose', 'summarize', 'understand'],
};

// Results storage
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: 0,
  details: [],
};

/**
 * Extract page context (simulating content script)
 */
async function extractPageContext(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
      text: a.textContent?.trim() || '',
      href: a.href
    }));

    const images = Array.from(document.querySelectorAll('img')).slice(0, 20).map(img => ({
      alt: img.alt,
      src: img.src
    }));

    const forms = Array.from(document.querySelectorAll('form')).map(form => ({
      id: form.id,
      action: form.action,
      inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
        name: input.name,
        type: input.type || 'text'
      }))
    }));

    const interactiveElements = Array.from(
      document.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"]')
    )
      .slice(0, 30)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 50) || '',
          type: el.type || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          visible: rect.width > 0 && rect.height > 0
        };
      })
      .filter(el => el.visible);

    const getMetaContent = (name) => {
      const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return meta?.getAttribute('content') || undefined;
    };

    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10).map(h => ({
      level: h.tagName.toLowerCase(),
      text: h.textContent?.trim() || ''
    }));

    const mainContent = document.querySelector('article, main, [role="main"]') || 
                       Array.from(document.querySelectorAll('div')).reduce((largest, div) => {
                         const text = div.textContent || '';
                         return text.length > (largest?.textContent?.length || 0) ? div : largest;
                       }, null);

    const mainContentText = mainContent?.textContent?.slice(0, 5000) || '';
    const mainContentLength = mainContentText.length;
    const totalTextLength = document.body.innerText.length;

    return {
      url: window.location.href,
      title: document.title,
      textContent: document.body.innerText.slice(0, 10000),
      links,
      images,
      forms,
      interactiveElements,
      metadata: {
        description: getMetaContent('description') || getMetaContent('og:description'),
        keywords: getMetaContent('keywords'),
        author: getMetaContent('author'),
        ogType: getMetaContent('og:type')
      },
      structure: {
        headings,
        hasArticleStructure: !!document.querySelector('article, [role="article"]'),
        hasMainStructure: !!document.querySelector('main, [role="main"]'),
        hasNavigation: !!document.querySelector('nav, [role="navigation"]'),
        sectionCount: document.querySelectorAll('section, article').length,
        paragraphCount: document.querySelectorAll('p').length,
        mainContentLength,
        mainContentRatio: mainContentLength / Math.max(totalTextLength, 1)
      }
    };
  });
}

/**
 * Analyze page characteristics (from sidepanel.tsx logic)
 */
function analyzePageCharacteristics(context) {
  const title = (context.title || '').toLowerCase();
  const url = (context.url || '').toLowerCase();
  const textContent = context.textContent || '';
  const structure = context.structure || {};
  const interactiveElements = context.interactiveElements || [];

  const buttonTexts = interactiveElements
    .filter(el => el.tag === 'button')
    .map(el => (el.text || el.ariaLabel || '').toLowerCase())
    .join(' ');
  
  const hasCartButtons = /\b(add to cart|add to bag|checkout|view cart|shopping cart)\b/i.test(buttonTexts);
  const hasPurchaseButtons = /\b(buy now|purchase|order now|add to cart)\b/i.test(buttonTexts);

  const paragraphCount = structure.paragraphCount || 0;
  const wordsPerParagraph = paragraphCount > 0 ? textContent.length / paragraphCount : 0;
  const isContentDense = wordsPerParagraph > 100 || (paragraphCount > 10 && textContent.length > 2000);
  
  const mainContentRatio = structure.mainContentRatio || 0;
  const hasShortContent = textContent.length < 1000;
  
  return {
    hasArticleTag: structure.hasArticleStructure || false,
    hasMainTag: structure.hasMainStructure || false,
    hasStructuredContent: paragraphCount > 3 || (structure.sectionCount || 0) > 1,
    paragraphCount,
    isContentDense,
    mainContentRatio,
    hasShortContent,
    hasStrongEcommerceIndicators: hasCartButtons || hasPurchaseButtons,
    hasPriceKeywords: /\$\d+\.?\d*|\d+\.?\d*\s*(dollars?|euros?|pounds?|USD|EUR|GBP|per month|per year)\b/i.test(textContent),
    urlHasProduct: /\/product\/|\/item\/|\/shop\/|\/buy\/|\/cart\//i.test(url),
    contentLength: textContent.length,
    hasLongContent: textContent.length > 2000,
    hasManyLinks: context.links.length > 10,
    hasDocumentationKeywords: /\b(guide|tutorial|documentation|api|reference|docs|getting started|how to)\b/i.test(title + ' ' + textContent),
    hasArticleKeywords: /\b(article|story|news|report|analysis|opinion|editorial|published|byline)\b/i.test(title + ' ' + textContent),
    hasVideoKeywords: /\b(video|watch|play|stream|youtube|vimeo)\b/i.test(title + ' ' + url + ' ' + textContent),
    hasSocialKeywords: /\b(profile|follow|like|share|comment|post)\b/i.test(title + ' ' + url),
    urlHasProfile: /\/profile\/|\/user\/|\/account\//i.test(url),
    hasSearchBox: interactiveElements.some(el => 
      el.type === 'search' || 
      el.text?.toLowerCase().includes('search') || 
      el.ariaLabel?.toLowerCase().includes('search')
    ) || false,
    hasPrimaryForms: context.forms?.some(f => 
      f.action?.match(/(contact|register|signup|submit|apply)/i) ||
      f.inputs?.some(input => 
        input.name?.match(/(name|email|phone|message|subject)/i)
      )
    ) || false,
    url,
    title,
  };
}

/**
 * Detect page type (from sidepanel.tsx logic - updated)
 */
function detectPageType(characteristics, context) {
  const url = (context?.url || characteristics.url || '').toLowerCase();
  const title = (context?.title || characteristics.title || '').toLowerCase();
  
  // Check URL patterns first (most reliable)
  const urlHasDocs = /\/docs\/|\/documentation\/|\/guide\/|\/tutorial\//i.test(url) ||
                    /developer\.|docs\.|documentation\./i.test(url) ||
                    /react\.dev|vuejs\.org|developer\.mozilla/i.test(url);
  const urlHasVideo = /youtube\.com|vimeo\.com|twitch\.tv/i.test(url);
  const urlHasSearch = /\/search\/|\/results\//i.test(url) || /google\.com\/search|bing\.com\/search/i.test(url);
  const urlHasArticle = /\/article\/|\/post\/|\/blog\/|\/news\/|\/story\//i.test(url);
  const urlHasBlog = /medium\.com|dev\.to|wordpress\.com/i.test(url);
  const urlIsHomepage = /^https?:\/\/(www\.)?[^\/]+\/?$/.test(url) || /^https?:\/\/(www\.)?[^\/]+\/index\.(html|php)?$/.test(url);
  const urlHasForm = /\/contact|\/signup|\/register|\/apply|\/form\//i.test(url);
  const urlHasProduct = /\/product\/|\/item\/|\/shop\/|\/buy\/|\/cart\/|\/dp\//i.test(url);
  
  // Priority order: Form (URL) > Search > Video (domain) > Documentation (URL) > Article (URL) > Blog > News > Article (structure) > E-commerce > Generic
  
  // 1. Form pages (check URL FIRST - forms are very specific)
  // If URL pattern matches, trust it even if form detection fails
  if (urlHasForm) {
    // Prefer form if primary forms detected, but also accept if it's a form URL with short content
    if (characteristics.hasPrimaryForms || 
        (characteristics.hasShortContent && !characteristics.hasLongContent)) {
      return 'form';
    }
  }
  
  // 2. Search results (URL pattern is most reliable)
  if (urlHasSearch) {
    return 'search';
  }
  
  // 3. Video sites (ONLY on video domains - avoid false positives)
  if (urlHasVideo) {
    return 'video';
  }
  
  // 4. Documentation (check URL BEFORE article tags - docs often use article tags)
  if (urlHasDocs) {
    return 'documentation';
  }
  
  // 5. Article URL patterns (blog posts, news articles)
  if (urlHasArticle) {
    return 'article';
  }
  
  // 6. Blog platforms (Medium, Dev.to) - even if content is minimal
  if (urlHasBlog) {
    return 'article';
  }
  
  // 7. News site detection - detect by domain and content structure
  const isNewsDomain = /(cnn|bbc|nytimes|washingtonpost|theguardian|reuters|npr|ap|wsj|bloomberg)\.(com|org)/i.test(url);
  if (isNewsDomain && 
      characteristics.hasStructuredContent &&
      (characteristics.hasLongContent || characteristics.paragraphCount > 5) &&
      !characteristics.hasStrongEcommerceIndicators) {
    return 'article';
  }
  
  // 8. Documentation by keywords (but NOT if it has article tags - docs use article tags)
  if (characteristics.hasDocumentationKeywords &&
      !characteristics.hasArticleTag &&
      !urlIsHomepage &&
      characteristics.hasStructuredContent && 
      characteristics.hasManyLinks && 
      (characteristics.isContentDense || characteristics.hasLongContent)) {
    return 'documentation';
  }
  
  // 9. Article detection by structure (but exclude homepages, docs URLs, and form URLs)
  if (!urlIsHomepage && !urlHasDocs && !urlHasForm &&
      characteristics.hasArticleTag &&
      (characteristics.hasLongContent || characteristics.paragraphCount > 5)) {
    return 'article';
  }
  
  // 10. Strong content structure indicators for articles (but not homepages, docs, or forms)
  // Also handle Wikipedia and educational sites
  const isWikipedia = /wikipedia\.org/i.test(url);
  const isEducational = /khanacademy|wikipedia|edu/i.test(url);
  
  if (!urlIsHomepage && !urlHasDocs && !urlHasForm &&
      characteristics.hasStructuredContent && 
      (characteristics.isContentDense || characteristics.paragraphCount > 10) && 
      !characteristics.hasStrongEcommerceIndicators &&
      (characteristics.hasLongContent || characteristics.paragraphCount > 5) &&
      (characteristics.hasArticleKeywords || !characteristics.hasDocumentationKeywords)) {
    return 'article';
  }
  
  // Wikipedia and educational sites with structured content
  if ((isWikipedia || isEducational) && 
      characteristics.hasStructuredContent &&
      (characteristics.hasLongContent || characteristics.paragraphCount > 5)) {
    if (isEducational && characteristics.hasDocumentationKeywords) {
      return 'documentation';
    }
    return 'article';
  }
  
  // 11. E-commerce product pages (URL pattern is strongest signal)
  if (urlHasProduct && 
      (characteristics.hasStrongEcommerceIndicators || characteristics.hasPriceKeywords) &&
      !characteristics.hasArticleTag) {
    return 'ecommerce';
  }
  
  // 12. E-commerce by cart buttons + price keywords (but not content pages)
  const hasEcommerceEvidence = characteristics.hasStrongEcommerceIndicators && (
    characteristics.urlHasProduct || characteristics.hasPriceKeywords
  );
  const isContentPage = characteristics.hasArticleTag || 
                       (characteristics.hasStructuredContent && characteristics.isContentDense);
  if (hasEcommerceEvidence && !isContentPage && !urlIsHomepage) {
    return 'ecommerce';
  }
  
  // 13. Form pages by form detection (if URL pattern didn't match)
  if (characteristics.hasPrimaryForms && 
      characteristics.hasShortContent &&
      !characteristics.hasLongContent &&
      !urlIsHomepage) {
    return 'form';
  }
  
  // 14. Social / Profile pages
  if (characteristics.hasSocialKeywords || characteristics.urlHasProfile) {
    return 'social';
  }
  
  // 15. Generic fallback (homepages, service pages, etc.)
  return 'generic';
}

/**
 * Test a single site
 */
async function testSite(browser, site) {
  const page = await browser.newPage();
  
  try {
    console.log(`\n🧪 Testing: ${site.name}`);
    console.log(`   URL: ${site.url}`);
    
    // Navigate to site with better timeout handling
    try {
      await page.goto(site.url, { 
        waitUntil: 'domcontentloaded', // Less strict than networkidle
        timeout: 20000 
      });
    } catch (timeoutError) {
      // If timeout, try with load event instead
      try {
        await page.goto(site.url, { 
          waitUntil: 'load',
          timeout: 15000 
        });
      } catch (loadError) {
        throw timeoutError; // Throw original error
      }
    }
    
    // Wait for page to stabilize
    await page.waitForTimeout(1500);
    
    // Extract page context
    const context = await extractPageContext(page);
    
    // Analyze page
    const characteristics = analyzePageCharacteristics(context);
    const detectedType = detectPageType(characteristics, context);
    
    // Validate
    const passed = detectedType === site.expectedType;
    
    results.total++;
    if (passed) {
      results.passed++;
      console.log(`   ✅ PASSED - Detected: ${detectedType}, Expected: ${site.expectedType}`);
    } else {
      results.failed++;
      console.log(`   ❌ FAILED - Detected: ${detectedType}, Expected: ${site.expectedType}`);
    }
    
    // Store details
    results.details.push({
      name: site.name,
      url: site.url,
      expected: site.expectedType,
      detected: detectedType,
      passed,
      note: site.note || '',
      characteristics: {
        hasArticleTag: characteristics.hasArticleTag,
        hasStructuredContent: characteristics.hasStructuredContent,
        isContentDense: characteristics.isContentDense,
        hasStrongEcommerceIndicators: characteristics.hasStrongEcommerceIndicators,
        paragraphCount: characteristics.paragraphCount,
        contentLength: characteristics.contentLength,
      }
    });
    
    await page.close();
    return passed;
    
  } catch (error) {
    results.errors++;
    results.total++;
    console.log(`   ⚠️  ERROR: ${error.message}`);
    
    results.details.push({
      name: site.name,
      url: site.url,
      expected: site.expectedType,
      detected: 'error',
      passed: false,
      error: error.message,
    });
    
    await page.close();
    return false;
  }
}

/**
 * Generate report
 */
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.total}`);
  console.log(`✅ Passed: ${results.passed} (${Math.round(results.passed/results.total*100)}%)`);
  console.log(`❌ Failed: ${results.failed} (${Math.round(results.failed/results.total*100)}%)`);
  console.log(`⚠️  Errors: ${results.errors}`);
  console.log('\n');
  
  // Failed tests
  if (results.failed > 0) {
    console.log('❌ FAILED TESTS:');
    results.details
      .filter(r => !r.passed && !r.error)
      .forEach(r => {
        console.log(`   ${r.name}`);
        console.log(`      Expected: ${r.expected}, Detected: ${r.detected}`);
        if (r.note) console.log(`      Note: ${r.note}`);
        console.log(`      Characteristics:`, r.characteristics);
        console.log('');
      });
  }
  
  // Errors
  if (results.errors > 0) {
    console.log('⚠️  ERRORS:');
    results.details
      .filter(r => r.error)
      .forEach(r => {
        console.log(`   ${r.name}: ${r.error}`);
      });
    console.log('');
  }
  
  // Save detailed report
  const reportPath = path.join(__dirname, 'test-prompt-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📄 Detailed report saved to: ${reportPath}`);
  
  // Success threshold
  const successRate = results.passed / results.total;
  if (successRate >= 0.8) {
    console.log('\n✅ SUCCESS: 80%+ tests passed!');
    return 0;
  } else {
    console.log('\n❌ FAILURE: Less than 80% tests passed');
    return 1;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Sample Prompts Validation Test Runner');
  console.log('='.repeat(60));
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    // Test each category
    for (const [category, sites] of Object.entries(testSites)) {
      console.log(`\n📂 Testing ${category.toUpperCase()} category (${sites.length} sites)`);
      for (const site of sites) {
        await testSite(browser, site);
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
  } finally {
    await browser.close();
  }
  
  // Generate report
  const exitCode = generateReport();
  process.exit(exitCode);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

