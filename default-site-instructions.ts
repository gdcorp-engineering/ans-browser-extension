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
- Wait for success indicators like toast messages, updated status chips, or URL changes
- Verify actions succeeded before reporting "done"
- Use screenshots when uncertain and ask for user confirmation
- Never modify fields outside the intended scope
- ALL navigation must happen in the SAME TAB — never open new tabs or windows

JIRA WORKFLOWS:

CREATE NEW ISSUE:
1. Press 'c' keyboard shortcut or click "Create" button
2. Wait for Create Issue dialog
3. Select Project
4. Select Issue Type
5. Fill Summary and Description
6. Click Create
7. Wait for success toast with issue key
8. Capture and confirm issue key

SEARCH FOR ISSUE:
1. Use '/' quick search or click Search bar
2. Type issue key or keyword
3. Press Enter and wait for results
4. Click desired issue link
5. Capture issue details

UPDATE ISSUE FIELDS:
1. Open issue view
2. Click Status field → choose new status
3. For Assignee: click and type new name
4. For Description: click editor, update, click Save or Update button
5. Wait for refresh and confirm changes visible

ADD COMMENT:
1. Scroll to Comments section
2. Click "Add comment"
3. Type message
4. Click Save
5. Confirm comment appears

TRANSITION WORKFLOW:
1. Open issue
2. Click Status chip or button
3. Choose next workflow step
4. Fill required fields if confirmation form appears
5. Wait for new status chip to appear

CONFLUENCE WORKFLOWS:

CREATE NEW PAGE:
1. From Space or parent page, click "Create"
2. Select page type
3. Fill Title and Body content
4. Use slash commands for structure if needed
5. Click "Publish"
6. Wait for "Published" toast and capture page URL

EDIT EXISTING PAGE:
1. Open page URL
2. Click "Edit" button
3. Modify text or layout
4. Click "Update"
5. Wait for toast and verify timestamp changed

SEARCH FOR PAGE:
1. Click Search icon
2. Enter title or keyword
3. Filter by space if needed
4. Click result to open
5. Capture URL and metadata

ADD COMMENT:
1. Scroll to bottom
2. Click "Add comment"
3. Type comment
4. Click Save
5. Confirm comment appears below content

EXTRACT/SUMMARIZE:
1. Locate main content block
2. Extract visible text
3. Summarize key sections`
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
