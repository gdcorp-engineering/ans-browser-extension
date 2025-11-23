/**
 * Sample Prompts Validation Test Script
 * 
 * This script helps validate that sample prompts are generated correctly
 * across different types of websites. Run this in the browser console
 * on each test site to validate the prompt generation logic.
 * 
 * Usage:
 * 1. Navigate to a test website
 * 2. Open browser console
 * 3. Copy and paste this script
 * 4. Review the output
 */

(async function validatePrompts() {
  console.log('🧪 Starting Sample Prompts Validation Test\n');
  
  // Extract page context (simulating what content script does)
  function extractPageContext() {
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
        name: (input).name,
        type: (input).type || 'text'
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

    // Extract structural information
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
  }

  // Analyze page characteristics (simplified version)
  function analyzePage(context) {
    const textContent = context.textContent || '';
    const structure = context.structure || {};
    const interactiveElements = context.interactiveElements || [];
    
    const buttonTexts = interactiveElements
      .filter(el => el.tag === 'button')
      .map(el => (el.text || el.ariaLabel || '').toLowerCase())
      .join(' ');
    
    const hasCartButtons = /\b(add to cart|add to bag|checkout|view cart|shopping cart)\b/i.test(buttonTexts);
    const hasPurchaseButtons = /\b(buy now|purchase|order now|add to cart)\b/i.test(buttonTexts);

    return {
      hasArticleTag: structure.hasArticleStructure || false,
      hasMainTag: structure.hasMainStructure || false,
      hasStructuredContent: (structure.paragraphCount || 0) > 3 || (structure.sectionCount || 0) > 1,
      paragraphCount: structure.paragraphCount || 0,
      isContentDense: structure.paragraphCount > 0 ? textContent.length / structure.paragraphCount > 100 : false,
      hasStrongEcommerceIndicators: hasCartButtons || hasPurchaseButtons,
      hasPriceKeywords: /\$\d+\.?\d*|\d+\.?\d*\s*(dollars?|euros?|pounds?|USD|EUR|GBP|per month|per year)\b/i.test(textContent),
      urlHasProduct: /\/product\/|\/item\/|\/shop\/|\/buy\/|\/cart\//i.test(context.url),
      contentLength: textContent.length,
      hasLongContent: textContent.length > 2000,
    };
  }

  // Detect page type
  function detectPageType(characteristics) {
    if (characteristics.hasArticleTag) return 'article';
    
    if (characteristics.hasStructuredContent && 
        characteristics.isContentDense && 
        !characteristics.hasStrongEcommerceIndicators &&
        (characteristics.hasLongContent || characteristics.paragraphCount > 5)) {
      return 'article';
    }
    
    const hasEcommerceEvidence = characteristics.hasStrongEcommerceIndicators && (
      characteristics.urlHasProduct || characteristics.hasPriceKeywords
    );
    
    const isContentPage = characteristics.hasArticleTag || 
                         (characteristics.hasStructuredContent && characteristics.isContentDense);
    
    if (hasEcommerceEvidence && !isContentPage) {
      return 'ecommerce';
    }
    
    return 'generic';
  }

  // Run analysis
  const context = extractPageContext();
  const analysis = analyzePage(context);
  const pageType = detectPageType(analysis);

  // Display results
  console.log('📄 Page Information:');
  console.log(`   URL: ${context.url}`);
  console.log(`   Title: ${context.title}`);
  console.log(`   Content Length: ${context.textContent.length} chars`);
  console.log(`   Paragraphs: ${analysis.paragraphCount}`);
  console.log(`   Sections: ${context.structure?.sectionCount || 0}`);
  console.log('');

  console.log('🔍 Structural Analysis:');
  console.log(`   Has <article> tag: ${analysis.hasArticleTag}`);
  console.log(`   Has <main> tag: ${analysis.hasMainTag}`);
  console.log(`   Has structured content: ${analysis.hasStructuredContent}`);
  console.log(`   Is content dense: ${analysis.isContentDense}`);
  console.log('');

  console.log('🛒 E-commerce Indicators:');
  console.log(`   Has cart/purchase buttons: ${analysis.hasStrongEcommerceIndicators}`);
  console.log(`   Has price keywords: ${analysis.hasPriceKeywords}`);
  console.log(`   URL has product pattern: ${analysis.urlHasProduct}`);
  console.log('');

  console.log('📊 Detected Page Type:', pageType.toUpperCase());
  console.log('');

  // Expected prompts based on type
  const expectedPrompts = {
    article: [
      'Summarize the main points of this article',
      'What are the key takeaways from this content?',
      'Tell me more about [Topic] or Find related topics'
    ],
    ecommerce: [
      'What products or services are available on this page?',
      'Show me product details and pricing information',
      'Help me find the best deals or offers'
    ],
    generic: [
      'What is the purpose of this page?',
      'Summarize the main content',
      'Help me understand this page better'
    ]
  };

  console.log('✅ Expected Prompts:');
  expectedPrompts[pageType]?.forEach((prompt, i) => {
    console.log(`   ${i + 1}. ${prompt}`);
  });

  console.log('\n💡 Validation:');
  console.log('   Review the prompts above and verify they make sense for this page.');
  console.log('   Check the browser extension sidepanel to see actual generated prompts.');
  console.log('   Compare actual vs expected and document any discrepancies.');

  return {
    pageType,
    analysis,
    expectedPrompts: expectedPrompts[pageType] || []
  };
})();

