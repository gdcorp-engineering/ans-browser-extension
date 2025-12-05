# How to Revert Anthropic Browser Tools

If you want to remove the Anthropic Browser Tools feature and go back to the simple chat-only version, follow these steps:

## Option 1: Quick Revert (Just disable the feature)

**In the UI:**
1. Open the Atlas sidebar
2. Click the **◉** button to disable Browser Tools mode (it will turn to **○**)
3. Anthropic will work in simple chat mode (no navigation/browser control)

This is the **easiest way** - no code changes needed!

---

## Option 2: Full Revert (Remove the code)

If you want to completely remove the Anthropic Browser Tools code:

### Files to Delete:
```bash
rm anthropic-browser-tools.ts
```

### Files to Modify:

**1. `sidepanel.tsx` (Line 9)**

Remove this import:
```typescript
import { streamAnthropicWithBrowserTools } from './anthropic-browser-tools';
```

**2. `sidepanel.tsx` (Lines 1259-1297)**

Replace this block:
```typescript
        // Route to provider-specific browser tools
        if (settings.provider === 'google') {
          await streamWithGeminiComputerUse(newMessages);
        } else if (settings.provider === 'anthropic') {
          const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
          };
          setMessages(prev => [...prev, assistantMessage]);

          const modelToUse = settings.model === 'custom' && settings.customModelName
            ? settings.customModelName
            : settings.model;

          await streamAnthropicWithBrowserTools(
            newMessages,
            settings.apiKey,
            modelToUse,
            settings.customBaseUrl,
            (text: string) => {
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.content += text;
                }
                return updated;
              });
            },
            () => {
              // On complete
            },
            executeTool,
            abortControllerRef.current.signal
          );
        } else {
          throw new Error(`Browser Tools not supported for ${settings.provider}`);
        }
```

With this simpler version:
```typescript
        // Safety check: Ensure we have Google API key
        if (settings.provider !== 'google' || !settings.apiKey) {
          setBrowserToolsEnabled(false);
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = '⚠️ **Browser Tools requires Google Gemini**\n\nBrowser Tools only works with Google Gemini.\n\nPlease:\n1. Open Settings (⚙️)\n2. Select "Google" as provider\n3. Add your Google API key\n4. Try again';
            }
            return updated;
          });
          setIsLoading(false);
          return;
        }

        await streamWithGeminiComputerUse(newMessages);
```

### Rebuild:
```bash
npm run build
```

### Reload extension:
Go to `chrome://extensions/` and click the refresh icon on the Atlas extension.

---

## What Changed (Summary)

### New Files Added:
- ✅ `anthropic-browser-tools.ts` - Anthropic-specific browser automation

### Modified Files:
- ✅ `sidepanel.tsx` - Added routing for Anthropic browser tools in Browser Tools mode

### What Stayed the Same:
- ✅ Simple chat mode (without Browser Tools button) works exactly as before
- ✅ Google Gemini Computer Use - unchanged
- ✅ All settings and configuration - unchanged
- ✅ Composio MCP integration - unchanged

---

## Testing the Revert

After reverting, test that:
1. ✅ Anthropic simple chat still works (without Browser Tools)
2. ✅ Google Gemini Computer Use still works with Browser Tools
3. ✅ No errors in console

---

## Contact

If you have issues reverting, you can:
1. Check the git history: `git log`
2. Revert to a previous commit: `git revert <commit-hash>`
3. Or restore from backup (if you made one before changes)
