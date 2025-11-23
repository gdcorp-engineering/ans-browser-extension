# Sample Prompts Validation Test Plan

## Test Categories and Sites

### News/Article Sites (10 sites)
1. **CNN.com** - Expected: Article prompts
2. **BBC.com** - Expected: Article prompts
3. **NYTimes.com** - Expected: Article prompts
4. **WashingtonPost.com** - Expected: Article prompts
5. **TheGuardian.com** - Expected: Article prompts
6. **Reuters.com** - Expected: Article prompts
7. **NPR.org** - Expected: Article prompts
8. **AP.org** - Expected: Article prompts
9. **WSJ.com** - Expected: Article prompts
10. **Bloomberg.com** - Expected: Article prompts

**Expected Prompts:**
- "Summarize the main points of this article"
- "What are the key takeaways from this content?"
- "Tell me more about [Topic]" or "Find related topics or links on this page"

### E-commerce Sites (10 sites)
1. **Amazon.com** - Expected: E-commerce prompts (if product page with cart)
2. **eBay.com** - Expected: E-commerce prompts (if product page)
3. **Walmart.com** - Expected: E-commerce prompts (if product page)
4. **Target.com** - Expected: E-commerce prompts (if product page)
5. **BestBuy.com** - Expected: E-commerce prompts (if product page)
6. **Etsy.com** - Expected: E-commerce prompts (if product page)
7. **Shopify.com** (store pages) - Expected: E-commerce prompts
8. **Zappos.com** - Expected: E-commerce prompts (if product page)
9. **Wayfair.com** - Expected: E-commerce prompts (if product page)
10. **Overstock.com** - Expected: E-commerce prompts (if product page)

**Expected Prompts:**
- "What products or services are available on this page?"
- "Show me product details and pricing information"
- "Help me find the best deals or offers"

### Documentation/Tutorial Sites (10 sites)
1. **MDN Web Docs** (developer.mozilla.org) - Expected: Documentation prompts
2. **Stack Overflow** (stackoverflow.com) - Expected: Documentation/Generic prompts
3. **GitHub Docs** (docs.github.com) - Expected: Documentation prompts
4. **React Docs** (react.dev) - Expected: Documentation prompts
5. **Vue.js Docs** (vuejs.org) - Expected: Documentation prompts
6. **Angular Docs** (angular.io) - Expected: Documentation prompts
7. **Python.org/docs** - Expected: Documentation prompts
8. **Node.js Docs** (nodejs.org/docs) - Expected: Documentation prompts
9. **W3Schools** (w3schools.com) - Expected: Documentation prompts
10. **Dev.to** (dev.to) - Expected: Article/Documentation prompts

**Expected Prompts:**
- "Explain the main concepts on this page"
- "What are the key features or APIs documented here?"
- "Show me related documentation or examples"

### Social Media (5 sites)
1. **Twitter/X** (twitter.com, x.com) - Expected: Social prompts
2. **LinkedIn** (linkedin.com) - Expected: Social/Generic prompts
3. **Facebook** (facebook.com) - Expected: Social/Generic prompts
4. **Instagram** (instagram.com) - Expected: Social/Generic prompts
5. **Reddit** (reddit.com) - Expected: Article/Social prompts

**Expected Prompts:**
- "What information is available on this profile?" (for profiles)
- "Show me recent activity or posts"
- "What can I learn about this user or page?"

### Video/Media Sites (5 sites)
1. **YouTube** (youtube.com) - Expected: Video prompts
2. **Vimeo** (vimeo.com) - Expected: Video prompts
3. **Netflix** (netflix.com) - Expected: Generic prompts
4. **Hulu** (hulu.com) - Expected: Generic prompts
5. **Twitch** (twitch.tv) - Expected: Video/Social prompts

**Expected Prompts:**
- "What is this video about?"
- "Summarize the key points or topics"
- "What information is available about this content?"

### Service/Business Sites (5 sites)
1. **GoDaddy.com** - Expected: Generic/Service prompts (NOT article, NOT e-commerce unless cart present)
2. **Salesforce.com** - Expected: Generic/Service prompts
3. **HubSpot.com** - Expected: Generic/Service prompts
4. **Stripe.com** - Expected: Documentation/Generic prompts
5. **Atlassian.com** - Expected: Documentation/Generic prompts

**Expected Prompts:**
- "What is the purpose of this page?"
- "Summarize the main content"
- "Help me understand this page better"
- OR topic-based if topics extracted

### Search Engines (3 sites)
1. **Google.com** (search results) - Expected: Search prompts
2. **Bing.com** (search results) - Expected: Search prompts
3. **DuckDuckGo.com** (search results) - Expected: Search prompts

**Expected Prompts:**
- "What search results are shown on this page?"
- "Help me refine or improve my search"
- "What are the most relevant results here?"

### Blog/Content Sites (5 sites)
1. **Medium.com** - Expected: Article prompts
2. **WordPress.com** (blog pages) - Expected: Article prompts
3. **Tumblr.com** - Expected: Article/Social prompts
4. **Substack.com** - Expected: Article prompts
5. **Ghost.org** (blog pages) - Expected: Article prompts

**Expected Prompts:**
- "Summarize the main points of this article"
- "What are the key takeaways from this content?"
- "Tell me more about [Topic]"

### Educational Sites (5 sites)
1. **Khan Academy** (khanacademy.org) - Expected: Documentation/Article prompts
2. **Coursera** (coursera.org) - Expected: Generic/Service prompts
3. **edX** (edx.org) - Expected: Generic/Service prompts
4. **Wikipedia** (wikipedia.org) - Expected: Article prompts
5. **Khan Academy** - Expected: Documentation prompts

**Expected Prompts:**
- "Explain the main concepts on this page" (for tutorials)
- "Summarize the main points" (for articles)
- "What are the key takeaways?"

### Form/Application Sites (2 sites)
1. **Contact forms** - Expected: Form prompts
2. **Registration pages** - Expected: Form prompts

**Expected Prompts:**
- "Help me fill out the form on this page"
- "What information is required in this form?"
- "Guide me through submitting this form"

## Validation Criteria

For each site, validate:

1. **Page Type Detection:**
   - ✅ Correctly identifies page type (article, e-commerce, documentation, etc.)
   - ✅ Does NOT misclassify (e.g., GoDaddy as article, news sites as e-commerce)

2. **Prompt Relevance:**
   - ✅ Prompts are relevant to the actual page content
   - ✅ Prompts make sense for what the user sees on screen
   - ✅ Prompts are actionable and useful

3. **Proper Noun Capitalization:**
   - ✅ Brand names preserved correctly (GoDaddy, not "Godaddy")
   - ✅ Topic names properly capitalized

4. **Edge Cases:**
   - ✅ Homepages vs. content pages handled correctly
   - ✅ Pages with mixed content (e.g., news site with products) handled appropriately
   - ✅ Single-page apps (SPAs) work correctly

## Test Execution

To test manually:
1. Load extension in browser
2. Navigate to each test site
3. Open sidepanel
4. Verify prompts shown match expected prompts
5. Check console logs for page analysis details
6. Document any issues

## Automated Testing (Future)

A test script could:
1. Use Puppeteer/Playwright to load each site
2. Extract page context
3. Run prompt generation
4. Validate against expected results
5. Generate report

