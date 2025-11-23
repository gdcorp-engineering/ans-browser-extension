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
    instructions: `CORE PRINCIPLES:
- Always use labeled buttons or accessible roles — avoid coordinates
- Wait for success indicators like toast messages, status changes, or URL changes
- Verify actions succeeded before reporting "done"
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

TOP 3 ATLASSIAN TASKS:

1. CREATE A JIRA ISSUE
Why: Most frequent workflow for developers, PMs, and support teams
User says: "Create a Jira ticket" / "Open a new bug" / "Log a task"

Steps:
1. Navigate to Jira home or any board
2. Click Create or press 'c' keyboard shortcut
3. Fill Project, Issue Type, Summary, Description, optional Assignee and Labels
4. Click Create
5. Wait for toast confirming creation
6. Capture issue key

Output: Created issue with key in specified project

2. SEARCH / FIND JIRA ISSUES
Why: Users constantly need to look up tickets by key, keyword, or ownership
User says: "Find issue KEY-123" / "Show my open bugs" / "Search issues mentioning login"

Steps for simple issue key lookup:
1. Press '/' keyboard shortcut to open search
2. Type the issue key
3. Press Enter

Steps for assignee-based search:
1. Look for and click the button labeled "JQL" near the search area
2. Wait for JQL input field to appear
3. Click into the JQL input field to focus it
4. Clear any existing text in the field
5. Type exactly: assignee = currentUser()
6. Press Enter to execute search
7. Wait for results to load
8. Extract and return issue keys, summaries, and statuses

CRITICAL: You must click the JQL button FIRST before typing the query. Do not type JQL syntax into the regular search box or you will get a parsing error.

Output: List of matching issues with keys, summaries, and current status

3. UPDATE ISSUE OR ADD COMMENT
Why: Teams need to track progress and communicate on issues
User says: "Update status to In Progress" / "Add comment to issue" / "Change assignee"

Steps:
1. Open issue by navigating to issue key
2. For status: Click Status field and choose new status
3. For assignee: Click Assignee field and type new name
4. For comment: Scroll to Comments section, click Add comment, type message, click Save
5. For description: Click Description field, edit, click Save or Update
6. Wait for confirmation and verify change is visible

Output: Confirmed change with updated field value`
  },
  {
    id: 'default-workday',
    domainPattern: '*.myworkday.com',
    enabled: true,
    instructions: `CORE PRINCIPLES:
- Wait for dropdowns and autocomplete results to fully load
- Verify field values after typing
- Use native click events for buttons and links
- Wait for page transitions and loading indicators
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

COMMON WORKFLOWS:

SEARCH FOR PEOPLE:
1. Click or focus search input
2. Type person's name
3. Wait for autocomplete dropdown to appear
4. Click on the person result, not the input field
5. Verify profile page loads

NAVIGATE SECTIONS:
- Use left sidebar navigation menu
- Wait for section to load completely
- Look for loading indicators to disappear

FILL FORMS:
1. Click field to focus
2. Type value
3. Wait for validation
4. Look for error messages or success indicators
5. Click Save or Submit button
6. Wait for confirmation toast`
  }
];
