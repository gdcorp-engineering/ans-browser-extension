# Update Checking Feature Recommendations

## Overview

PR #7 introduced an update checking feature in `settings.tsx` that queries the GitHub Actions API to check for new extension versions. This document provides recommendations for implementing this feature in the current codebase.

## Current Implementation (from PR #7)

The feature:
- Fetches latest successful workflow runs from GitHub Actions
- Extracts version from commit messages or uses build numbers
- Compares versions using semantic versioning
- Provides download links to artifacts
- Shows update status in the settings UI

**Location**: `settings.tsx` lines 88-169

## Recommendation Options

### Option 1: Enable with Current Repository Configuration ⭐ **RECOMMENDED**

**Approach**: Update the GitHub repository and workflow names to match the current codebase.

**Pros**:
- ✅ Provides immediate value to users
- ✅ Automatic update notifications
- ✅ Users can download latest versions directly from settings
- ✅ No additional infrastructure needed (uses GitHub API)
- ✅ Works with existing GitHub Actions workflow

**Cons**:
- ⚠️ Requires GitHub repository to be public or token-based auth for private repos
- ⚠️ Depends on consistent version tagging in commit messages
- ⚠️ May need to adjust workflow name if it differs from `build.yml`

**Implementation Steps**:
1. Update `GITHUB_REPO` constant in `settings.tsx`:
   ```typescript
   const GITHUB_REPO = 'gdcorp-im/ans-browser-extension-v1-temp'; // or actual repo name
   ```

2. Verify workflow name matches:
   ```typescript
   const WORKFLOW_NAME = 'build-publish-promote.yml'; // Check actual workflow name
   ```

3. Ensure version is consistently tagged in commits (e.g., `v1.5.4` or `1.5.4`)

4. Test with current repository to ensure API access works

**Code Changes Required**: Minimal - just update constants

---

### Option 2: Feature Flag with Manual Enable

**Approach**: Keep the feature code but disable it by default, allow users to enable it manually.

**Pros**:
- ✅ Safe default - won't break if repo isn't configured
- ✅ Users can opt-in when ready
- ✅ Can be enabled per-user or per-environment
- ✅ No breaking changes

**Cons**:
- ⚠️ Requires user action to enable
- ⚠️ May be confusing if users don't know about the feature
- ⚠️ Additional UI needed for toggle

**Implementation Steps**:
1. Add feature flag to settings:
   ```typescript
   const [updateCheckingEnabled, setUpdateCheckingEnabled] = useState(false);
   ```

2. Wrap update checking UI in conditional:
   ```typescript
   {updateCheckingEnabled && (
     // Update checking UI
   )}
   ```

3. Add toggle in settings UI to enable/disable

**Code Changes Required**: Moderate - add feature flag and UI toggle

---

### Option 3: Disable Completely (Remove Feature)

**Approach**: Remove the update checking code entirely.

**Pros**:
- ✅ No maintenance burden
- ✅ No dependency on GitHub API
- ✅ Simpler codebase

**Cons**:
- ❌ Users lose automatic update notifications
- ❌ Manual update process required
- ❌ May need to implement alternative update mechanism later

**Implementation Steps**:
1. Remove `checkForUpdates` function
2. Remove update checking state variables
3. Remove update checking UI elements

**Code Changes Required**: Minimal - remove code

---

## Detailed Comparison

| Aspect | Option 1 (Enable) | Option 2 (Feature Flag) | Option 3 (Disable) |
|--------|------------------|-------------------------|-------------------|
| **User Value** | High - automatic updates | Medium - opt-in | Low - manual only |
| **Maintenance** | Medium - requires version tagging | Low - optional | None |
| **Complexity** | Low - just config | Medium - add toggle | Low - remove code |
| **Risk** | Medium - depends on repo config | Low - opt-in | None |
| **Future-Proof** | High - ready to use | High - can enable later | Low - need to re-add |

## Final Recommendation

**Recommended: Option 1 (Enable with Current Repository Configuration)**

**Rationale**:
1. The feature is well-implemented and provides clear user value
2. Minimal code changes required (just update constants)
3. Works with existing GitHub Actions infrastructure
4. Can be easily disabled later if issues arise
5. Users benefit from automatic update notifications

**Next Steps**:
1. Verify the actual GitHub repository name and workflow name
2. Update constants in `settings.tsx`
3. Test the feature with a sample workflow run
4. Ensure version tagging is consistent in commit messages
5. Consider adding error handling for private repos (may need GitHub token)

## Alternative: Hybrid Approach

If repository configuration is uncertain, use **Option 2 (Feature Flag)** initially, then enable by default once verified. This provides a safe rollout path.

---

**Document Created**: November 22, 2025  
**Related PR**: #7 (Phoenix Improvements Backport)

