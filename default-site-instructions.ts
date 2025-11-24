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

IMPORTANT: Before creating, you MUST gather required information from the user:

Step 1: Gather Project Information
1. Navigate to Jira home or any board
2. Click Create button or press 'c' keyboard shortcut to open the create dialog
3. Take a screenshot to see the Project dropdown options
4. Ask user: "Which project should I create this in?" and list the available projects you see
5. Wait for user to respond with project selection

Step 2: Gather Bug Details
1. Ask user: "What is the bug summary/title?"
2. Optionally ask: "Please describe the bug (optional)"
3. Wait for user responses

Step 3: Create the Issue
1. Click on Project dropdown and select the user's chosen project
2. Select Issue Type as "Bug" (or ask user if multiple types visible)
3. Type the user-provided Summary in the Summary field
4. If user provided description, type it in Description field
5. Optionally fill Assignee and Labels if user specified
6. Click Create button
7. Wait for toast confirmation message (e.g., "Issue created successfully")
8. Capture the issue key from the toast or URL
9. Report back to user with the created issue key

Output: "Created bug [ISSUE-KEY] in [PROJECT]: [Summary]"

CRITICAL: Do NOT create any issue without first asking the user for Project and Summary. Always be interactive.

2. SEARCH / FIND JIRA ISSUES
Why: Users constantly need to look up tickets by key, keyword, or ownership
User says: "Find issue KEY-123" / "Show my open bugs" / "Search issues mentioning login"

Steps for simple issue key lookup:
1. Press '/' keyboard shortcut to open search
2. Type the issue key
3. Press Enter

Steps for finding bugs/issues assigned to me:
OPTION 1 - Use page tabs (PREFERRED - fastest):
1. Take a screenshot to see the page
2. If you see "Assigned to me" tab at the top of the page, try clickElement({text: "Assigned to me"})
3. If clickElement fails, look for the tab position and use coordinates as last resort
4. Wait 2 seconds for results to load
5. Take ONE final screenshot
6. STOP HERE - Extract and return ALL visible issues (don't scroll, don't filter further)

OPTION 2 - Use Filters sidebar (if no tab available):
1. Take a screenshot first to see the page layout
2. Click on "Filters" in the left sidebar
3. Look for existing filters like "My open issues" or "Assigned to me"
4. Click on the appropriate filter
5. Wait 2 seconds for results to load
6. Take ONE final screenshot
7. STOP HERE - Extract and return ALL visible issues (don't scroll, don't filter further)

CRITICAL: After clicking on "Assigned to me" or a filter:
- DO NOT scroll
- DO NOT try to filter further for bugs vs tasks
- DO NOT use getPageContext or other tools
- IMMEDIATELY extract what you see and return it to the user
- The user asked for their assigned issues - give them the full list from what's visible

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
