# Sample Prompts Implementation

## Overview

The sample prompts feature automatically generates three contextual prompts above the chat input field based on the current webpage's DOM content. These prompts help users quickly start conversations relevant to the page they're viewing.

## Features

- **Context-Aware**: Prompts are generated based on actual page content, not hardcoded domain lists
- **Dynamic Updates**: Prompts automatically regenerate when:
  - The user switches tabs
  - The page URL changes (navigation)
  - The page refreshes
  - The sidepanel becomes visible
- **Comprehensive Analysis**: Works across many site types including:
  - News/Article sites (CNN, BBC, etc.)
  - E-commerce sites
  - Documentation pages
  - Search results
  - Social media profiles
  - Video pages
  - Form-focused pages
  - Generic content pages

## Architecture

### Components

1. **Page Context Extraction** (`content.ts`)
   - Extracts page metadata, content, links, forms, and interactive elements
   - Provides structured data about the current page

2. **Page Analysis** (`sidepanel.tsx`)
   - `analyzePageCharacteristics()`: Analyzes page structure and content
   - `detectPageType()`: Determines page type based on characteristics
   - `extractMainTopics()`: Extracts key topics from content
   - `formatNoun()`: Properly formats nouns for display

3. **Prompt Generation** (`sidepanel.tsx`)
   - `generateSamplePrompts()`: Generates contextual prompts based on analysis
   - React state management for prompt display
   - UI component for rendering prompts

### Data Flow

```
Page Load/Change
    ↓
Content Script (content.ts)
    ↓
Extract Page Context (DOM, metadata, elements)
    ↓
Sidepanel (sidepanel.tsx)
    ↓
Analyze Page Characteristics
    ↓
Detect Page Type
    ↓
Extract Main Topics
    ↓
Generate Contextual Prompts
    ↓
Display Above Chat Input
```

## Implementation Details

### Page Context Extraction

The content script extracts comprehensive page information:

```typescript
interface PageContext {
  url: string;
  title: string;
  textContent: string;        // First 10k characters
  links: Array<{text, href}>;
  images: Array<{alt, src}>;
  forms: Array<{id, action, inputs}>;
  interactiveElements: Array<{tag, text, type, ariaLabel}>;
  metadata: {
    description?: string;
    keywords?: string;
    author?: string;
  };
}
```

### Page Analysis

The system analyzes multiple characteristics:

#### Content Characteristics
- **Content Length**: Long (>2000 chars), Medium (500-2000), Short (<500)
- **Link Count**: Number of links on page
- **Image Count**: Number of images
- **Form Count**: Number of forms

#### Content Type Indicators
- **Product Keywords**: "buy", "purchase", "add to cart", "price"
- **Article Keywords**: "article", "story", "news", "report", "analysis"
- **Documentation Keywords**: "guide", "tutorial", "documentation", "api", "reference"
- **Search Keywords**: "search", "results", "query", "find"
- **Social Keywords**: "profile", "follow", "like", "share", "comment"
- **Video Keywords**: "video", "watch", "play", "stream"

#### URL Patterns
- Article paths: `/article/`, `/post/`, `/blog/`, `/news/`, `/story/`
- Product paths: `/product/`, `/item/`, `/shop/`, `/buy/`
- Search paths: `/search/`, `/results/`
- Profile paths: `/profile/`, `/user/`, `/account/`

#### Form Analysis
- **Primary Forms**: Contact, registration, submission forms
- **Secondary Forms**: Newsletter signups, search boxes

### Page Type Detection

The system detects page types using a priority-based approach:

1. **E-commerce**: Product keywords, product URLs, or images + product keywords
2. **Article/Blog/News**: Article keywords, article URLs, or long content without primary forms
3. **Documentation**: Documentation keywords, or long content + many links
4. **Search**: Search keywords, search URLs, or search box + many links
5. **Social**: Social keywords or profile URLs
6. **Video**: Video keywords
7. **Form**: Primary forms + short content (form-focused pages)
8. **Generic**: Fallback for other pages

### Topic Extraction

Main topics are extracted using frequency analysis:

1. Extract words longer than 4 characters
2. Count word frequency
3. Filter out stop words (common words like "about", "their", etc.)
4. Select top 3 most frequent words
5. Format nouns properly (capitalize first letter)

### Prompt Generation

Prompts are generated based on page type and characteristics:

#### E-commerce Pages
- "What products or services are available on this page?"
- "Show me product details and pricing information" (if many images)
- "Help me find the best deals or offers"

#### Article/News Pages
- "Summarize the main points of this article"
- "What are the key takeaways from this content?"
- "Tell me more about [Topic]" (if topics found)
- "Find related topics or links on this page" (if many links)

#### Documentation Pages
- "Explain the main concepts on this page"
- "What are the key features or APIs documented here?"
- "Show me related documentation or examples" (if many links)

#### Search Pages
- "What search results are shown on this page?"
- "Help me refine or improve my search"
- "What are the most relevant results here?"

#### Social Pages
- "What information is available on this profile?"
- "Show me recent activity or posts"
- "What can I learn about this user or page?"

#### Video Pages
- "What is this video about?"
- "Summarize the key points or topics"
- "What information is available about this content?"

#### Form Pages
- "Help me fill out the form on this page"
- "What information is required in this form?"
- "Guide me through submitting this form"

#### Generic Pages
- Content-based prompts if long content
- Link-based prompts if many links
- Search-based prompts if search box present
- Image-based prompts if many images
- Topic-based prompts if topics extracted
- Generic fallback prompts

## User Interface

### Display Logic

Prompts are displayed when:
- `samplePrompts.length > 0`
- `messages.length === 0` (empty chat)
- `!isLoading` (not currently processing)

### Interaction

- Clicking a prompt **immediately submits** it to the chat
- The prompt text is sent with page context automatically
- Prompts disappear once a message is sent

### Styling

- Light mode: Gray background with hover effects
- Dark mode: Dark gray background with blue accent on hover
- Responsive layout with proper spacing

## Code Structure

### Key Functions

#### `generateSamplePrompts()`
Main function that orchestrates prompt generation:
1. Fetches page context
2. Analyzes page characteristics
3. Detects page type
4. Extracts main topics
5. Generates contextual prompts
6. Updates React state

#### `analyzePageCharacteristics(context)`
Comprehensive page analysis returning an object with:
- Content metrics (length, link count, etc.)
- Content type indicators (keywords, patterns)
- Structural analysis (forms, interactive elements)
- Metadata presence

#### `detectPageType(characteristics)`
Determines page type using priority-based logic based on characteristics.

#### `extractMainTopics(textContent)`
Extracts main topics from text using frequency analysis.

#### `formatNoun(word)`
Formats nouns properly (capitalizes first letter).

### Event Listeners

Prompts regenerate on:
- Tab activation (`chrome.tabs.onActivated`)
- Tab updates (`chrome.tabs.onUpdated`) - URL changes and page load completion
- Visibility changes (`document.visibilitychange`) - when sidepanel becomes visible

## Examples

### Example 1: News Article (CNN.com)
**Page Characteristics:**
- Long content (>2000 chars)
- Article keywords in title
- Many links
- Secondary forms (newsletter)

**Generated Prompts:**
1. "Summarize the main points of this article"
2. "What are the key takeaways from this content?"
3. "Tell me more about [Main Topic]"

### Example 2: E-commerce Product Page
**Page Characteristics:**
- Product keywords
- Product URL pattern
- Many images
- Product forms

**Generated Prompts:**
1. "What products or services are available on this page?"
2. "Show me product details and pricing information"
3. "Help me find the best deals or offers"

### Example 3: Documentation Page
**Page Characteristics:**
- Documentation keywords
- Long content
- Many links
- Code examples

**Generated Prompts:**
1. "Explain the main concepts on this page"
2. "What are the key features or APIs documented here?"
3. "Show me related documentation or examples"

## Extensibility

### Adding New Page Types

1. Add detection logic in `detectPageType()`:
```typescript
if (characteristics.hasNewTypeKeywords || 
    characteristics.urlHasNewType) {
  return 'newtype';
}
```

2. Add prompt generation in `generateSamplePrompts()`:
```typescript
case 'newtype':
  prompts.push(`Prompt 1 for new type`);
  prompts.push(`Prompt 2 for new type`);
  prompts.push(`Prompt 3 for new type`);
  break;
```

### Adding New Characteristics

Add to `analyzePageCharacteristics()`:
```typescript
hasNewCharacteristic: /pattern/.test(textContent),
```

### Customizing Prompts

Modify the prompt generation logic in the switch statement within `generateSamplePrompts()` to customize prompts for each page type.

## Performance Considerations

- **Page Context Extraction**: Limited to 10k characters of text content
- **Topic Extraction**: Processes only words longer than 4 characters
- **Debouncing**: Prompts regenerate with a 500ms delay after page load to ensure DOM is ready
- **Caching**: No caching currently - prompts regenerate on each page change

## Future Enhancements

Potential improvements:
- Cache prompts per URL to avoid regeneration
- Use AI/ML for more intelligent topic extraction
- Learn from user interactions to improve prompt relevance
- Support for multi-language prompt generation
- Custom prompt templates per domain
- User preference for prompt style (concise vs detailed)

## Troubleshooting

### Prompts Not Showing
- Check that chat is empty (`messages.length === 0`)
- Verify page context is being extracted (check console logs)
- Ensure sidepanel has loaded completely

### Prompts Not Updating
- Check event listeners are attached (tab changes, URL changes)
- Verify `generateSamplePrompts()` is being called
- Check for errors in console

### Incorrect Page Type Detection
- Review page characteristics in console
- Adjust detection logic in `detectPageType()`
- Add more specific keywords or patterns

## Related Files

- `sidepanel.tsx`: Main implementation (lines 396-650)
- `content.ts`: Page context extraction (lines 165-273)
- `sidepanel.css`: Styling for prompts (`.sample-prompts-container`, `.sample-prompt-button`)

## Testing

To test the feature:
1. Navigate to different types of websites
2. Open the sidepanel
3. Verify prompts are relevant to the page content
4. Click a prompt to verify it submits correctly
5. Switch tabs and verify prompts update
6. Refresh page and verify prompts regenerate

## Summary

The sample prompts feature provides a user-friendly way to start conversations based on page content. It uses comprehensive page analysis to generate relevant prompts across many site types, making the extension more useful and accessible to users.

