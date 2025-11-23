# Sample Prompts Validation Results

## Test Runner Created

✅ **Automated test runner** (`test-prompt-runner.mjs`) validates prompts across 26+ popular sites

## Improvements Made Based on Testing

### 1. **Fixed Documentation Detection**
- ✅ Documentation sites now correctly detected (MDN, React, GitHub, Vue, Node.js docs all passing)
- Changed priority: Documentation checked AFTER article detection
- Added URL pattern matching for docs sites

### 2. **Improved Article Detection**
- ✅ NYTimes now correctly detected as article (was generic)
- ✅ Improved content density calculation (handles pages with many paragraphs)
- Added article keyword/URL pattern checks before documentation

### 3. **Enhanced Homepage Detection**
- Added homepage URL pattern detection
- Homepages excluded from article/documentation classification
- Prevents false positives on e-commerce/service homepages

### 4. **Better Content Density Analysis**
- Now handles pages with many paragraphs (like NYTimes with 358 paragraphs)
- Uses: `wordsPerParagraph > 100 OR (paragraphCount > 10 AND contentLength > 2000)`

### 5. **Proper Noun Capitalization**
- Preserves original capitalization from page text
- "GoDaddy" stays "GoDaddy" (not "Godaddy")
- Finds most common capitalization in original text

## Current Test Results

### ✅ Passing Categories:
- **Documentation Sites**: 5/5 passing (100%)
  - MDN Web Docs ✅
  - React Docs ✅
  - GitHub Docs ✅
  - Vue.js Docs ✅
  - Node.js Docs ✅

- **News Sites**: 3/5 passing (60%)
  - CNN ✅
  - NYTimes ✅ (fixed!)
  - The Guardian ✅

### ⚠️ Known Issues:

1. **Homepage Detection**
   - eBay homepage detected as article (has article tag)
   - Need better homepage vs content page distinction

2. **Video Sites**
   - YouTube homepage not detected as video (needs video-specific content detection)
   - Video detection relies on URL/keywords, but homepages lack these

3. **Search Sites**
   - Google search results not detected (needs better search result page detection)
   - Search pages have minimal content, need URL-based detection

4. **Social Media**
   - Reddit homepage has minimal content (needs special handling)
   - LinkedIn detected as article (has structured content)

5. **Service Sites**
   - Some service sites (Stripe) detected as article (has dense content)
   - Need to distinguish marketing/content pages from service pages

## Test Execution

Run the test runner:
```bash
npm run test:prompts
```

Or manually:
```bash
node test-prompt-runner.mjs
```

## Next Steps for Improvement

1. **Homepage Detection**: Better logic to distinguish homepages from content pages
2. **Video Detection**: Detect video players/embeds, not just URLs
3. **Search Detection**: Better detection of search result pages
4. **Service Pages**: Distinguish marketing pages from actual service/product pages
5. **Social Media**: Special handling for social media feed pages

## Success Metrics

- **Target**: 80%+ accuracy across all test sites
- **Current**: ~50% (improving with each iteration)
- **Documentation**: 100% ✅
- **News/Articles**: 60% (improving)

The test runner provides detailed analysis of each site, making it easy to identify and fix issues.

