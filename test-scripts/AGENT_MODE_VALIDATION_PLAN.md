# Agent Mode Validation Plan

## Overview
This document outlines a comprehensive validation strategy for testing agent mode functionality across multiple websites using Chromium.

## Test Sites (3-4 Different Types)

### 1. E-Commerce Site
**Site:** Amazon.com or similar
- **Complexity:** High (dynamic content, modals, forms)
- **Test Scenarios:**
  - Search for a product
  - Add item to cart
  - Navigate product pages
  - Handle modals (sign-in prompts, add to cart confirmations)

### 2. Form-Heavy Site
**Site:** Google Forms, Typeform, or similar
- **Complexity:** Medium (multiple input fields, validation)
- **Test Scenarios:**
  - Fill out multi-step form
  - Handle dropdowns and checkboxes
  - Submit form
  - Handle validation errors

### 3. Content/News Site
**Site:** Wikipedia, Medium, or similar
- **Complexity:** Low-Medium (navigation, reading)
- **Test Scenarios:**
  - Navigate between articles
  - Search for content
  - Extract and summarize information

### 4. Web Application
**Site:** GitHub, Trello, or similar
- **Complexity:** High (interactive UI, authentication)
- **Test Scenarios:**
  - Navigate repository/project
  - Create new item
  - Edit existing content
  - Handle authentication flows

## Use Cases (5-10 Agent Mode Scenarios)

### Use Case 1: Product Search and Navigation
**Site:** E-Commerce
**Task:** "Search for 'laptop' and show me the first 3 results"
**Validation:**
- ✅ Agent performs search
- ✅ Results page loads
- ✅ Agent extracts and displays results
- ✅ Messages preserved across tab switches
- ✅ Stop button works if interrupted

### Use Case 2: Form Filling
**Site:** Form-Heavy Site
**Task:** "Fill out this form with test data: name 'John Doe', email 'test@example.com', and submit it"
**Validation:**
- ✅ Agent identifies form fields
- ✅ Agent types in correct fields
- ✅ Agent handles dropdowns/selects
- ✅ Agent submits form
- ✅ Success/error message captured

### Use Case 3: Multi-Step Navigation
**Site:** Content Site
**Task:** "Go to Wikipedia, search for 'Artificial Intelligence', then navigate to the 'Machine Learning' section"
**Validation:**
- ✅ Agent navigates to site
- ✅ Agent performs search
- ✅ Agent navigates to specific section
- ✅ Agent extracts relevant content
- ✅ Overlay persists during task

### Use Case 4: Modal Handling
**Site:** E-Commerce or Web App
**Task:** "Add this item to cart and handle any popups that appear"
**Validation:**
- ✅ Agent clicks add to cart
- ✅ Agent detects modal/popup
- ✅ Agent interacts with modal (close, confirm, etc.)
- ✅ Agent continues task after modal

### Use Case 5: Tab Switching During Active Task
**Site:** Any
**Task:** "Search for 'python tutorial' and while it's working, I'll switch tabs"
**Validation:**
- ✅ Agent continues working in background
- ✅ Messages preserved when switching back
- ✅ Loading state restored
- ✅ Overlay shows on correct tab
- ✅ Stop button works from different tab

### Use Case 6: Error Recovery
**Site:** Any with potential errors
**Task:** "Click on a button that doesn't exist, then try an alternative approach"
**Validation:**
- ✅ Agent detects error
- ✅ Agent communicates error clearly
- ✅ Agent attempts alternative approach
- ✅ Agent completes task or explains why it can't

### Use Case 7: Authentication Flow
**Site:** Web Application
**Task:** "Navigate to the login page and fill in credentials (test account)"
**Validation:**
- ✅ Agent navigates to login
- ✅ Agent fills username/password
- ✅ Agent handles form submission
- ✅ Agent handles success/error states

### Use Case 8: Data Extraction
**Site:** Content Site
**Task:** "Extract the main points from this article and summarize them"
**Validation:**
- ✅ Agent reads page content
- ✅ Agent extracts key information
- ✅ Agent provides summary
- ✅ Agent handles long content

### Use Case 9: Complex Multi-Action Task
**Site:** Web Application
**Task:** "Create a new project, add a task to it, and set a due date"
**Validation:**
- ✅ Agent performs multiple sequential actions
- ✅ Agent maintains context across actions
- ✅ Agent completes all steps
- ✅ Agent verifies completion

### Use Case 10: Interruption and Resume
**Site:** Any
**Task:** "Start a long task, then I'll click stop, then ask you to continue"
**Validation:**
- ✅ Agent stops when requested
- ✅ Messages preserved after stop
- ✅ Agent can resume or start new task
- ✅ No orphaned processes

## Validation Checklist

For each use case, verify:

### Core Functionality
- [ ] Agent executes actions correctly
- [ ] Agent completes task or clearly communicates why it can't
- [ ] Agent handles errors gracefully
- [ ] Agent provides status updates

### State Management
- [ ] Messages preserved when switching tabs
- [ ] Loading state restored correctly
- [ ] Overlay shows/hides appropriately
- [ ] Stop button works from any tab
- [ ] Chat history saved correctly

### User Experience
- [ ] Agent communicates clearly
- [ ] Agent shows progress during long tasks
- [ ] Agent handles modals correctly
- [ ] Agent prioritizes modal elements
- [ ] Agent completes tasks without getting stuck

### Edge Cases
- [ ] Agent handles page reloads
- [ ] Agent handles navigation away and back
- [ ] Agent handles slow network conditions
- [ ] Agent handles dynamic content loading

## Testing Tools & Scripts

### Manual Testing Script
See `validate-agent-mode.sh` for automated test runner.

### Browser DevTools
- Network tab: Monitor API calls
- Console: Check for errors
- Application tab: Verify storage

### Extension DevTools
- Background page console
- Sidepanel console
- Content script console

## Reporting

For each test:
1. **Record:** Screenshot/video of task
2. **Document:** Any errors or unexpected behavior
3. **Note:** Performance metrics (time to complete)
4. **Verify:** All validation checkboxes

## Success Criteria

- ✅ 80%+ of use cases complete successfully
- ✅ All state management features work correctly
- ✅ No critical errors or crashes
- ✅ User can always stop agent
- ✅ Messages always preserved

