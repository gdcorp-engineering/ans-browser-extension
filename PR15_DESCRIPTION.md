# PR #15: Security Vulnerabilities Fix and Audio File Embedding Improvements

## Overview

This PR resolves 41 security alerts and fixes audio file embedding issues in the browser extension.

## Security Fixes

### Dependency Updates
- **@modelcontextprotocol/sdk**: Updated from `^1.0.4` to `^1.24.1`
  - Fixes high severity DNS rebinding vulnerability (GHSA-w48q-cv73-mx4w)
  - Range: `<1.24.0` → `^1.24.1`

- **vite**: Updated from `^5.4.10` to `^7.2.6`
  - Fixes moderate severity esbuild vulnerability (GHSA-67mh-4wv8-2f99)
  - Major version update with breaking changes handled

- **electron**: Updated from `^28.0.0` to `^39.2.4`
  - Fixes moderate severity ASAR integrity bypass (GHSA-vmqv-hx8q-j7mg)
  - Range: `<35.7.5` → `^39.2.4`

- **Additional Updates**:
  - `@ai-sdk/anthropic`: `^2.0.35` → `^2.0.53`
  - `@ai-sdk/google`: `^2.0.23` → `^2.0.44`
  - `@ai-sdk/openai`: `^2.0.53` → `^2.0.76`
  - `@ai-sdk/react`: `^1.0.10` → `^1.2.12`
  - `@ai-sdk/mcp`: Added `^0.0.11` (new dependency)
  - `ai`: `^5.0.76` → `^5.0.106`
  - `@types/node`: `^24.9.1` → `^24.10.1`
  - `@types/react`: `^18.3.12` → `^18.3.27`
  - `@types/react-dom`: `^18.3.1` → `^18.3.7`
  - `playwright`: `^1.56.1` → `^1.57.0`
  - `@playwright/test`: `^1.56.1` → `^1.57.0`

### Verification
- ✅ Main package: 0 vulnerabilities
- ✅ Electron-browser package: 0 vulnerabilities
- ✅ All transitive dependencies updated and secured

## API Migration Fix

### experimental_createMCPClient Import Fix
- **Issue**: `experimental_createMCPClient` was moved from `ai` package to `@ai-sdk/mcp` in ai v5
- **Fix**: Updated imports in:
  - `mcp-service.ts`: Changed from `'ai'` to `'@ai-sdk/mcp'`
  - `sidepanel.tsx`: Changed from `'ai'` to `'@ai-sdk/mcp'`
- **Result**: Build now succeeds without import errors

## Audio File Embedding Fixes

### Issues Fixed
1. **AudioLink not extracted when no content array**: Fixed extraction logic in `mcp-service.ts` to check for audioLink even when response has no content array
2. **AudioLink appearing in AI response text**: Extracted audioLink from tool results before stringifying, preventing it from appearing in the AI's generated text
3. **Missing nested audioLink check**: Added check for `result.result.audioLink` structure
4. **Audio display incomplete**: Added clickable link display alongside embedded player

### Changes Made

#### mcp-service.ts
- Added audioLink extraction when response has no content array
- Improved logging for audioLink detection

#### anthropic-browser-tools.ts
- Extract audioLink from tool results before stringifying
- Remove audioLink from content sent to AI (prevents URL in response)
- Store audioLink separately on tool result object

#### sidepanel.tsx
- Added nested audioLink check (`result.result.audioLink`)
- Enhanced audio display to show:
  - Summary text (message content)
  - Clickable audio link with headphone icon
  - Embedded audio player with controls
- Improved audio player styling and error handling

### Result
When audio files are generated (e.g., music generation tools), users now see:
1. ✅ **Summary text** - The description/lyrics from the AI
2. ✅ **Clickable link** - Direct link to audio file (opens in new tab)
3. ✅ **Embedded player** - Inline audio player with play controls

## Files Changed

- `package.json` - Dependency updates
- `package-lock.json` - Lock file updates
- `electron-browser/package.json` - Dependency updates
- `electron-browser/package-lock.json` - Lock file updates
- `mcp-service.ts` - AudioLink extraction fixes
- `anthropic-browser-tools.ts` - AudioLink extraction and content sanitization
- `sidepanel.tsx` - Audio display improvements and import fix
- `content.ts` - Minor updates

## Testing

- ✅ Build succeeds without errors
- ✅ All security vulnerabilities resolved (npm audit shows 0 vulnerabilities)
- ✅ Audio files display correctly with link and embedded player
- ✅ No breaking changes to existing functionality

## Impact

- **Security**: All 41 security alerts resolved
- **User Experience**: Audio files now properly embedded with both link and player
- **Stability**: Updated to latest stable versions of all dependencies
- **Compatibility**: Maintained compatibility with existing features

