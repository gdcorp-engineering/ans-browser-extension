import type { SiteInstruction } from './types';

/**
 * Default site-specific instructions that come pre-configured
 * Users can disable or modify these through Settings
 */
export const DEFAULT_SITE_INSTRUCTIONS: SiteInstruction[] = [
  {
    id: 'default-jira',
    domainPattern: '*.atlassian.net',
    enabled: true,
    instructions: `CRITICAL: PREFER getPageContext OVER SCREENSHOTS

Screenshots are SLOW, EXPENSIVE, and INACCURATE for coordinate detection.
ALWAYS use getPageContext() FIRST to understand the page structure.
Only take screenshots as a LAST RESORT when DOM context is insufficient.

TOOL PRIORITY ORDER:
1. getPageContext() - ALWAYS call this first. Fast, free, accurate DOM info.
2. clickElement({text: "Button Text"}) - Click by visible text (PREFERRED)
3. clickElement({selector: "#id"}) - Click by CSS selector
4. click({x, y}) - LAST RESORT ONLY. Coordinates from screenshots are often wrong.

CORE PRINCIPLES:
- ALWAYS call getPageContext() first to see available elements
- Use clickElement with text or selector - NEVER coordinates unless absolutely necessary
- Wait for success indicators like toast messages, status changes, or URL changes
- Verify actions succeeded before reporting "done"
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

🛑 RETRY LIMIT: "Fail" means the goal was NOT achieved (not just errors). If you click something and it doesn't do what you intended, that's a fail. Retry ONCE with a different approach. If the goal is still not achieved, STOP and tell the user exactly what to click/do manually. Do NOT try 10 variations.

TOP 3 ATLASSIAN TASKS:

1. CREATE A JIRA ISSUE
User says: "Create a Jira ticket" / "Open a new bug" / "Log a task"

IMPORTANT: Before creating, you MUST gather required information from the user:

Step 1: Gather Project Information
1. Navigate to Jira home or any board
2. Call getPageContext() to see the page structure
3. Press 'c' keyboard shortcut or click the Create button using clickElement({text: "Create"})
4. Call getPageContext() again to see the dialog and available projects
5. Ask user: "Which project should I create this in?" and list projects from the DOM
6. Wait for user to respond with project selection

Step 2: Gather Bug Details
1. Ask user: "What is the bug summary/title?"
2. Optionally ask: "Please describe the bug (optional)"
3. Wait for user responses

Step 3: Create the Issue
1. Click on Project dropdown using clickElement({text: "Project"}) or by selector
2. Select Issue Type using clickElement
3. Type the user-provided Summary in the Summary field
4. If user provided description, type it in Description field
5. Click Create using clickElement({text: "Create"})
6. Call getPageContext() to verify success and capture the issue key
7. Report back to user with the created issue key

Output: "Created bug [ISSUE-KEY] in [PROJECT]: [Summary]"

CRITICAL: Do NOT create any issue without first asking the user for Project and Summary.

2. SEARCH / FIND JIRA ISSUES
User says: "Find issue KEY-123" / "Show my open bugs" / "Search issues mentioning login"

Steps for simple issue key lookup:
1. Press '/' keyboard shortcut to open search
2. Type the issue key
3. Press Enter

Steps for finding bugs/issues assigned to me:
1. Call getPageContext() FIRST to see available tabs and filters
2. Look for "Assigned to me" in the interactiveElements from getPageContext
3. Use clickElement({text: "Assigned to me"}) to click the tab
4. Wait 2 seconds for results to load
5. Call getPageContext() to extract the issue list from the DOM
6. STOP HERE - Return ALL visible issues from the textContent (don't scroll)

If "Assigned to me" tab not found in DOM:
1. Look for "Filters" in the sidebar from getPageContext
2. Use clickElement({text: "Filters"})
3. Call getPageContext() to see filter options
4. Click the appropriate filter using clickElement

Output: List of matching issues with keys, summaries, and current status

3. UPDATE ISSUE OR ADD COMMENT
User says: "Update status to In Progress" / "Add comment to issue" / "Change assignee"

Steps:
1. Open issue by navigating to issue key URL
2. Call getPageContext() to see the issue detail fields
3. For status: clickElement({text: "Status"}) or the current status text, then clickElement on new status
4. For assignee: clickElement on Assignee field, type new name
5. For comment: scroll to Comments, clickElement({text: "Add comment"}), type message, clickElement({text: "Save"})
6. Call getPageContext() to verify the change was applied

Output: Confirmed change with updated field value

REMEMBER: getPageContext() is your primary tool. Screenshots are expensive and inaccurate!`
  },
  {
    id: 'default-workday',
    domainPattern: '*.myworkday.com',
    enabled: true,
    instructions: `🚨 CRITICAL: PREFER getPageContext OVER SCREENSHOTS 🚨

Screenshots are SLOW, EXPENSIVE, and INACCURATE for coordinate detection.
ALWAYS use getPageContext() FIRST to understand the page structure.

TOOL PRIORITY ORDER:
1. getPageContext() - ALWAYS call this first. Fast, accurate DOM info.
2. clickElement({text: "Button Text"}) - Click by visible text (PREFERRED)
3. clickElement({selector: "#id"}) - Click by CSS selector
4. click({x, y}) - LAST RESORT ONLY. Coordinates are often wrong.

CORE PRINCIPLES:
- ALWAYS call getPageContext() first before any action
- Use clickElement with text or selector - avoid coordinates
- Wait for dropdowns and autocomplete results to fully load
- Verify field values after typing
- Wait for page transitions and loading indicators
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

🛑 RETRY LIMIT: "Fail" means the goal was NOT achieved (not just errors). If you click something and it doesn't do what you intended, that's a fail. Retry ONCE with a different approach. If the goal is still not achieved, STOP and tell the user exactly what to click/do manually. Do NOT try 10 variations.

COMMON WORKFLOWS:

SEARCH FOR PEOPLE:
1. Call getPageContext() to find the search input
2. Click or focus search input using clickElement
3. Type person's name
4. Wait for autocomplete dropdown to appear
5. Call getPageContext() to see dropdown options
6. Click on the person result using clickElement({text: "Person Name"})
7. Verify profile page loads with getPageContext()

NAVIGATE SECTIONS:
- Call getPageContext() to see available navigation options
- Use clickElement to click sidebar navigation items
- Wait for section to load completely
- Call getPageContext() to verify new content loaded

FILL FORMS:
1. Call getPageContext() to identify form fields
2. Click field to focus using clickElement
3. Type value
4. Wait for validation
5. Call getPageContext() to check for error messages
6. Click Save/Submit using clickElement({text: "Save"})
7. Call getPageContext() to verify success`
  },
  {
    id: 'default-sharepoint',
    domainPattern: '*.sharepoint.com',
    enabled: true,
    instructions: `🚨 CRITICAL: PREFER getPageContext OVER SCREENSHOTS 🚨

Screenshots are SLOW, EXPENSIVE, and INACCURATE for coordinate detection.
ALWAYS use getPageContext() FIRST to understand the page structure.
Only take screenshots when you need to READ DOCUMENT CONTENT that isn't in the DOM.

TOOL PRIORITY ORDER:
1. getPageContext() - ALWAYS call this first. Fast, accurate DOM info.
2. clickElement({text: "Button Text"}) - Click by visible text (PREFERRED)
3. clickElement({selector: "#id"}) - Click by CSS selector
4. scroll({direction: "down"}) - For scrolling through content
5. screenshot() - ONLY for reading visual document content not in DOM

CORE PRINCIPLES:
- ALWAYS call getPageContext() first before clicking anything
- Use clickElement with text or selector - avoid coordinate-based clicking
- SharePoint uses custom scrollable containers - ALWAYS use scroll tool, not arrow keys
- Office Online documents (Word, Excel, PowerPoint) have special canvas elements
- Wait for documents to fully load before interacting
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

🛑 RETRY LIMIT: "Fail" means the goal was NOT achieved (not just errors). If you click something and it doesn't do what you intended, that's a fail. Retry ONCE with a different approach. If the goal is still not achieved, STOP and tell the user exactly what to click/do manually. Do NOT try 10 variations.

SCROLLING IN SHAREPOINT/OFFICE DOCUMENTS:

CRITICAL: For scrolling in SharePoint and Office Online documents:
1. ALWAYS use scroll({direction: "down", amount: 500}) command
2. DO NOT use arrow keys (PageDown, ArrowDown) - they don't work reliably
3. DO NOT click first - just use scroll directly
4. If scroll doesn't work after 2 attempts, report the issue to the user

Example - User asks to scroll down:
❌ WRONG: Click on document, then pressKey({key: "ArrowDown"})
✅ CORRECT: scroll({direction: "down", amount: 500})

NAVIGATING SHAREPOINT SITES:
1. Call getPageContext() to see available navigation elements
2. Use clickElement({text: "Menu Item"}) to click navigation
3. Use scroll for long lists of files/folders
4. Click on document names using clickElement
5. Use browser back button to return to document library

READING DOCUMENTS:
1. Wait 2 seconds for document to load
2. Call getPageContext() first - document text may be in the DOM
3. Use scroll({direction: "down"}) to navigate through content
4. Only take screenshots if you need to see visual content not in DOM
5. Use scroll({direction: "top"}) to return to beginning

SEARCHING DOCUMENTS:
1. Use Ctrl+F (or Cmd+F on Mac) to open find dialog
2. Type search term
3. Press Enter to find next occurrence
4. Close find dialog when done

ERROR HANDLING:
If scroll command fails:
1. Call getPageContext() to understand page state
2. Report to user: "Scroll is not working on this page. This might be a technical limitation."
3. DO NOT repeatedly try arrow keys as alternative`
  }
];
