# Sample Prompts Validation Guide

## Quick Start

1. **Load the extension** in your browser (from `artifacts/Dev/`)
2. **Open the sidepanel** on each test site
3. **Review the prompts** - do they make sense for what's on screen?
4. **Check console logs** - look for `🔍 Page analysis:` to see detection details
5. **Document issues** - note any misclassifications or irrelevant prompts

## Test Sites by Category

### ✅ News/Article Sites (Test 10)
- [ ] CNN.com - Should show article prompts
- [ ] BBC.com - Should show article prompts  
- [ ] NYTimes.com - Should show article prompts
- [ ] WashingtonPost.com - Should show article prompts
- [ ] TheGuardian.com - Should show article prompts
- [ ] Reuters.com - Should show article prompts
- [ ] NPR.org - Should show article prompts
- [ ] AP.org - Should show article prompts
- [ ] WSJ.com - Should show article prompts
- [ ] Bloomberg.com - Should show article prompts

**Expected:** "Summarize the main points of this article", "What are the key takeaways?", etc.

### 🛒 E-commerce Sites (Test 10)
- [ ] Amazon.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] eBay.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Walmart.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Target.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] BestBuy.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Etsy.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Shopify store page - Should show e-commerce prompts IF cart buttons present
- [ ] Zappos.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Wayfair.com (product page) - Should show e-commerce prompts IF cart buttons present
- [ ] Overstock.com (product page) - Should show e-commerce prompts IF cart buttons present

**Expected:** "What products or services are available?", "Show me product details and pricing", etc.
**Note:** Homepages should NOT show e-commerce prompts unless they have cart functionality

### 📚 Documentation Sites (Test 10)
- [ ] developer.mozilla.org - Should show documentation prompts
- [ ] stackoverflow.com - Should show documentation/generic prompts
- [ ] docs.github.com - Should show documentation prompts
- [ ] react.dev - Should show documentation prompts
- [ ] vuejs.org - Should show documentation prompts
- [ ] angular.io - Should show documentation prompts
- [ ] python.org/docs - Should show documentation prompts
- [ ] nodejs.org/docs - Should show documentation prompts
- [ ] w3schools.com - Should show documentation prompts
- [ ] dev.to - Should show article/documentation prompts

**Expected:** "Explain the main concepts", "What are the key features or APIs?", etc.

### 👥 Social Media (Test 5)
- [ ] twitter.com/x.com (profile) - Should show social prompts
- [ ] linkedin.com (profile) - Should show social/generic prompts
- [ ] facebook.com (profile) - Should show social/generic prompts
- [ ] instagram.com (profile) - Should show social/generic prompts
- [ ] reddit.com (post) - Should show article/social prompts

**Expected:** "What information is available on this profile?", "Show me recent activity", etc.

### 🎥 Video Sites (Test 5)
- [ ] youtube.com (video page) - Should show video prompts
- [ ] vimeo.com (video page) - Should show video prompts
- [ ] netflix.com - Should show generic prompts
- [ ] hulu.com - Should show generic prompts
- [ ] twitch.tv (stream) - Should show video/social prompts

**Expected:** "What is this video about?", "Summarize the key points", etc.

### 🏢 Service/Business Sites (Test 5)
- [ ] GoDaddy.com - Should show generic prompts (NOT article, NOT e-commerce)
- [ ] Salesforce.com - Should show generic/service prompts
- [ ] HubSpot.com - Should show generic/service prompts
- [ ] Stripe.com - Should show documentation/generic prompts
- [ ] Atlassian.com - Should show documentation/generic prompts

**Expected:** "What is the purpose of this page?", "Summarize the main content", etc.

### 🔍 Search Engines (Test 3)
- [ ] Google.com (search results) - Should show search prompts
- [ ] Bing.com (search results) - Should show search prompts
- [ ] DuckDuckGo.com (search results) - Should show search prompts

**Expected:** "What search results are shown?", "Help me refine my search", etc.

### ✍️ Blog Sites (Test 5)
- [ ] Medium.com (article) - Should show article prompts
- [ ] WordPress.com (blog post) - Should show article prompts
- [ ] Tumblr.com (post) - Should show article/social prompts
- [ ] Substack.com (article) - Should show article prompts
- [ ] Ghost.org (blog post) - Should show article prompts

**Expected:** "Summarize the main points", "What are the key takeaways?", etc.

### 🎓 Educational Sites (Test 5)
- [ ] khanacademy.org (lesson) - Should show documentation/article prompts
- [ ] coursera.org (course) - Should show generic/service prompts
- [ ] edx.org (course) - Should show generic/service prompts
- [ ] wikipedia.org (article) - Should show article prompts
- [ ] Khan Academy tutorial - Should show documentation prompts

**Expected:** "Explain the main concepts" or "Summarize the main points"

### 📝 Form Pages (Test 2)
- [ ] Contact form page - Should show form prompts
- [ ] Registration page - Should show form prompts

**Expected:** "Help me fill out the form", "What information is required?", etc.

## Common Issues to Watch For

### ❌ False Positives
- **GoDaddy showing article prompts** - Should be generic
- **News sites showing e-commerce prompts** - Should be article
- **Service pages showing article prompts** - Should be generic

### ❌ False Negatives  
- **E-commerce product pages not showing e-commerce prompts** - Check if cart buttons are detected
- **Article pages showing generic prompts** - Check if article tag/structure is detected

### ❌ Capitalization Issues
- **"godaddy" instead of "GoDaddy"** - Should preserve original capitalization
- **Topic names not capitalized** - Should format properly

## Using the Test Script

1. Navigate to a test site
2. Open browser console (F12)
3. Copy contents of `test-prompt-validation.js`
4. Paste and run in console
5. Review the analysis output
6. Compare with actual prompts in sidepanel

## Reporting Issues

When you find an issue, note:
1. **Site URL**
2. **Expected page type**
3. **Actual page type detected**
4. **Prompts shown**
5. **Prompts expected**
6. **Console log output** (copy the `🔍 Page analysis:` section)

## Success Criteria

✅ **90%+ accuracy** - Prompts should be relevant for 45+ out of 50 sites
✅ **No false e-commerce** - Service/business sites should NOT show e-commerce prompts
✅ **Proper capitalization** - Brand names and topics should be correctly capitalized
✅ **Relevant prompts** - Prompts should make sense for what's visible on screen

