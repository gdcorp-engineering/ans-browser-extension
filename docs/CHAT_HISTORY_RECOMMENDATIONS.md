# Chat History Storage Recommendations

## Executive Summary

This document provides recommendations for implementing chat history persistence in the browser extension while managing memory efficiently and providing a good user experience.

## Current State

- Messages are stored in memory only (React state + refs)
- Messages are per-tab (stored in `tabMessagesRef`)
- Messages are lost when extension/browser closes
- Extension already uses `chrome.storage.local` for settings and browser memory

## Storage Strategy Recommendation

### Primary Choice: `chrome.storage.local` with IndexedDB for Large Data

**Recommended Approach: Hybrid Storage**

1. **Use `chrome.storage.local` for metadata and recent chats** (up to 50 chats)
   - Fast access
   - Automatic sync across extension instances
   - 10MB limit (shared with other extension data)
   - Good for: chat list, metadata, recent conversations

2. **Use IndexedDB for older chat history** (optional, for power users)
   - Much larger storage capacity (hundreds of MB)
   - Better for: long-term archive, bulk operations
   - More complex API but better for large datasets

**For MVP: Start with `chrome.storage.local` only**

## Recommended Limits

### Number of Chat Histories to Store

**Primary Recommendation: 30-50 chat sessions**

**Rationale:**
- Average chat session: ~10-20 messages = ~50-100KB per session
- 50 sessions × 100KB = ~5MB (well within 10MB limit)
- Leaves ~5MB for other extension data (settings, browser memory, etc.)
- Provides good user experience (weeks/months of history for typical users)

**Alternative Tiers:**
- **Conservative (20 chats)**: ~2MB, safer for users with limited storage
- **Standard (50 chats)**: ~5MB, recommended default
- **Extended (100 chats)**: ~10MB, near limit, requires careful management

### Per-Chat Limits

- **Messages per chat**: No hard limit (but warn if >100 messages)
- **Message size**: Truncate individual messages >50KB (rare edge case)
- **Total chat size**: Warn if chat exceeds 500KB

## Data Structure

### Recommended Schema

```typescript
interface ChatHistory {
  id: string;                    // UUID v4
  title: string;                 // Auto-generated or user-edited
  createdAt: number;             // Timestamp
  updatedAt: number;             // Last message timestamp
  tabId?: number;                // Original tab (optional, for context)
  url?: string;                  // Original page URL (optional)
  messageCount: number;          // Quick reference
  preview: string;               // First user message (truncated to 100 chars)
  messages: Message[];          // Full message array
}

interface ChatHistoryMetadata {
  chats: ChatHistory[];         // Array of chat sessions
  lastChatId: string | null;    // Most recent chat ID
  totalChats: number;           // Count for quick reference
  storageVersion: number;       // For future migrations
}
```

### Storage Keys

```typescript
// Main storage key
const CHAT_HISTORY_KEY = 'atlasChatHistory';

// Optional: Separate metadata for faster loading
const CHAT_METADATA_KEY = 'atlasChatMetadata';
```

## Memory Management Strategy

### 1. Automatic Cleanup

**LRU (Least Recently Used) Eviction:**
- When limit is reached, remove oldest chats first
- Keep metadata even after eviction (for "archived" indicator)
- Optionally move to IndexedDB before deletion

**Implementation:**
```typescript
// When saving new chat and limit exceeded
if (chats.length >= MAX_CHATS) {
  // Sort by updatedAt, remove oldest
  chats.sort((a, b) => a.updatedAt - b.updatedAt);
  chats.shift(); // Remove oldest
}
```

### 2. Size-Based Cleanup

**Monitor total storage size:**
- Check `chrome.storage.local.getBytesInUse()` periodically
- If >8MB, trigger aggressive cleanup (reduce to 30 chats)
- Warn user if approaching 9MB

### 3. User Controls

**Provide user options:**
- Clear all history
- Clear old chats (older than X days)
- Export chat history (JSON download)
- Import chat history
- Adjust max chats (20/50/100)

## Implementation Recommendations

### Phase 1: Basic Persistence (MVP)

1. **Save chats on completion**
   - When user starts new chat or closes sidepanel
   - Save current tab's messages as a chat session

2. **Load chat list on startup**
   - Show list of past chats in UI
   - Load full chat only when selected

3. **Auto-generate titles**
   - Use first user message (truncated to 50 chars)
   - Or use page title + timestamp

### Phase 2: Enhanced Features

1. **Chat search/filter**
   - Search by title, content, date
   - Filter by date range

2. **Chat management**
   - Rename chats
   - Delete individual chats
   - Archive old chats

3. **Export/Import**
   - Export to JSON
   - Import from JSON
   - Share individual chats

### Phase 3: Advanced (Optional)

1. **IndexedDB integration**
   - Move old chats to IndexedDB
   - Keep recent chats in chrome.storage.local
   - Seamless retrieval

2. **Cloud sync** (if applicable)
   - Optional sync to user account
   - Cross-device access

## UI/UX Recommendations

### Chat History Panel

1. **Sidebar or dropdown menu**
   - Accessible from main chat interface
   - Shows list of past chats with:
     - Title
     - Preview (first message)
     - Date/time
     - Message count

2. **Chat selection**
   - Click to load chat
   - Continue conversation option
   - Delete option (with confirmation)

3. **New chat button**
   - Clear way to start fresh
   - Auto-saves previous chat

### Visual Indicators

- Badge showing number of saved chats
- Storage usage indicator (optional, in settings)
- Warning if storage is getting full

## Performance Considerations

### Lazy Loading

- **Don't load all chats at once**
- Load metadata first (titles, dates, previews)
- Load full chat only when selected
- Cache recently viewed chats in memory

### Debouncing Saves

- Don't save on every message
- Save when:
  - User starts new chat
  - User closes sidepanel
  - Chat has been idle for 30 seconds
  - User explicitly saves

### Compression (Optional)

- Compress large message arrays before storage
- Use JSON.stringify with custom replacer to remove unnecessary data
- Consider compression library for very large chats

## Migration Strategy

### Versioning

```typescript
interface StorageVersion {
  version: number;
  schema: string;
  migratedAt: number;
}
```

### Migration Path

1. Check storage version on load
2. If version mismatch, run migration
3. Preserve existing data during migration
4. Update version after successful migration

## Security & Privacy

### Data Handling

- All data stored locally (no cloud unless user opts in)
- No PII extraction or transmission
- User can clear all data at any time

### Sensitive Data

- Consider option to exclude sensitive pages (banking, etc.)
- Option to auto-delete chats after X days
- Option to exclude certain domains from history

## Testing Recommendations

### Test Cases

1. **Storage limits**
   - Test with 50+ chats
   - Test with very large messages
   - Test cleanup behavior

2. **Tab switching**
   - Verify chats persist across tab switches
   - Verify chats persist across browser restarts

3. **Edge cases**
   - Very long messages
   - Many messages in single chat
   - Rapid chat creation
   - Storage quota exceeded

4. **Performance**
   - Load time with 50 chats
   - Search performance
   - Save performance

## Recommended Defaults

```typescript
const CHAT_HISTORY_CONFIG = {
  maxChats: 50,                    // Default number of chats to keep
  maxChatSize: 500 * 1024,         // 500KB per chat (soft limit)
  maxMessageSize: 50 * 1024,       // 50KB per message (hard limit)
  autoSaveDelay: 30000,            // 30 seconds idle before auto-save
  storageWarningThreshold: 8 * 1024 * 1024,  // 8MB warning
  storageCriticalThreshold: 9 * 1024 * 1024, // 9MB critical
  enableIndexedDB: false,          // Start with chrome.storage.local only
};
```

## Implementation Priority

### Must Have (MVP)
1. ✅ Save chats to chrome.storage.local
2. ✅ Load chat list on startup
3. ✅ Basic chat selection UI
4. ✅ Auto-cleanup when limit reached
5. ✅ New chat functionality

### Should Have (v1.1)
1. ⭐ Chat search/filter
2. ⭐ Rename/delete chats
3. ⭐ Export functionality
4. ⭐ Storage usage indicator

### Nice to Have (v1.2+)
1. 💡 IndexedDB for archives
2. 💡 Import functionality
3. 💡 Cloud sync (if applicable)
4. 💡 Advanced filtering

## Conclusion

**Recommended Starting Point:**
- **Storage**: `chrome.storage.local` only (MVP)
- **Max Chats**: 50 (adjustable)
- **Cleanup**: LRU eviction when limit reached
- **UI**: Simple chat list in sidebar/dropdown
- **Save Strategy**: On new chat start or sidepanel close

This provides a solid foundation that can be enhanced based on user feedback and usage patterns.

