# Modal Handling Implementation

This document explains how modals, dialogs, and popups are handled in the browser automation system to leverage DOM methods instead of falling back to screenshots.

## Overview

Modals are now automatically detected, prioritized, and handled through DOM methods. This eliminates the need for screenshot-based fallbacks when interacting with modal dialogs.

## Key Features

### 1. Automatic Modal Detection

The system detects modals using multiple strategies:

#### Selector-Based Detection
- `<dialog>` elements with `open` attribute
- Elements with `role="dialog"` or `role="alertdialog"`
- Elements with `aria-modal="true"`
- Common class patterns: `.modal`, `.dialog`, `.popup`, `.overlay`
- Data attributes: `[data-modal]`, `[data-dialog]`, `[data-popup]`

#### Z-Index Based Detection
- Elements with `z-index > 1000` that cover >30% of viewport
- Helps catch dynamically created modals without standard attributes

### 2. Modal Metadata Extraction

For each detected modal, the system extracts:
- **Selector**: Stable CSS selector for the modal element
- **Visibility**: Whether the modal is currently visible
- **Backdrop**: Whether a backdrop/overlay exists
- **Close Button**: Automatically finds close button with:
  - `aria-label` containing "close" or "dismiss"
  - Class names like `.close`, `.close-button`
  - Text content like "×", "✕", "X", "Close", "Dismiss"
  - Data attributes like `[data-dismiss]`, `[data-close]`
- **Interactive Elements Count**: Number of clickable elements inside
- **Z-Index**: For sorting multiple modals

### 3. Element Prioritization

Elements inside modals receive a **+20 priority boost**, ensuring they're always considered first when selecting targets. This means:

- Modal buttons are prioritized over page buttons
- Modal inputs are prioritized over page inputs
- Modal links are prioritized over page links

### 4. Modal Closing Methods

The system tries multiple methods to close modals (in order):

1. **Close Button**: Uses the detected close button selector
2. **ESC Key**: Dispatches Escape key event to the modal
3. **Backdrop Click**: Clicks the backdrop/overlay if present
4. **Dialog API**: Uses `dialog.close()` for `<dialog>` elements

## Usage

### For the AI Agent

The agent automatically receives modal information in `getPageContext()`:

```json
{
  "modals": [
    {
      "selector": "#my-modal",
      "isVisible": true,
      "hasBackdrop": true,
      "closeButton": {
        "selector": "#my-modal .close-btn",
        "text": "×"
      },
      "interactiveElements": 5,
      "zIndex": 1050
    }
  ],
  "interactiveElements": [
    {
      "tag": "button",
      "text": "Submit",
      "selector": "#submit-btn",
      "inModal": true,  // ← Indicates element is in a modal
      "priority": 25    // ← Higher priority due to modal
    }
  ]
}
```

### Agent Workflow

1. **Check for modals**: If `modals` array has items, the topmost (highest z-index) modal is active
2. **Prioritize modal elements**: Look for `interactiveElements` with `inModal: true`
3. **Interact with modal**: Use selectors from modal elements
4. **Close when done**: Use `closeModal` tool or the modal's `closeButton.selector`

### Available Tools

#### `waitForModal`
Waits for a modal to appear (useful after triggering an action):
```javascript
await executeTool('waitForModal', { timeout: 5000 });
```

#### `closeModal`
Closes the currently visible modal:
```javascript
await executeTool('closeModal', {});
```

## Implementation Details

### Detection Function: `detectModals()`

Located in `content.ts`, this function:
1. Queries common modal selectors
2. Checks high z-index elements
3. Validates visibility
4. Extracts metadata (close buttons, backdrops, etc.)
5. Sorts by z-index (topmost first)

### Element in Modal Check: `isElementInModal()`

Traverses up the DOM tree to find if an element is inside a modal:
- Checks parent elements for modal indicators
- Returns the modal element if found
- Used for priority calculation

### Priority Calculation

Elements in modals get +20 priority boost:
```typescript
if (inModal) priority += 20;
```

This ensures modal elements are always considered first.

## Examples

### Example 1: Simple Modal Close

```javascript
// Get page context
const context = await executeTool('getPageContext', {});

// Check for modals
if (context.modals && context.modals.length > 0) {
  const modal = context.modals[0]; // Topmost modal
  
  // Close using close button
  if (modal.closeButton) {
    await executeTool('clickElement', {
      selector: modal.closeButton.selector
    });
  } else {
    // Fallback to closeModal tool
    await executeTool('closeModal', {});
  }
}
```

### Example 2: Interact with Modal Form

```javascript
// Get page context
const context = await executeTool('getPageContext', {});

// Find modal input (automatically prioritized)
const emailInput = context.interactiveElements.find(
  el => el.inModal && el.tag === 'input' && el.type === 'email'
);

// Type into modal input
await executeTool('type', {
  selector: emailInput.selector,
  text: 'user@example.com'
});

// Find and click submit button in modal
const submitBtn = context.interactiveElements.find(
  el => el.inModal && el.text.toLowerCase().includes('submit')
);

await executeTool('clickElement', {
  selector: submitBtn.selector
});
```

### Example 3: Wait for Modal After Action

```javascript
// Click button that opens modal
await executeTool('clickElement', {
  selector: '#open-modal-btn'
});

// Wait for modal to appear
const modalResult = await executeTool('waitForModal', {
  timeout: 5000
});

if (modalResult.success && modalResult.modals.length > 0) {
  // Modal appeared, interact with it
  const modal = modalResult.modals[0];
  // ... interact with modal elements
}
```

## Benefits

1. **No Screenshots Needed**: Modals are fully accessible via DOM
2. **Automatic Prioritization**: Modal elements are always considered first
3. **Smart Close Detection**: Automatically finds close buttons
4. **Multiple Close Methods**: Tries several strategies to close modals
5. **Z-Index Sorting**: Handles multiple modals correctly
6. **Performance**: DOM-based is faster than screenshot analysis

## Edge Cases Handled

- **Shadow DOM**: Currently checks shadow roots (can be extended)
- **Dynamic Modals**: Z-index detection catches dynamically created modals
- **Multiple Modals**: Sorted by z-index, topmost handled first
- **No Close Button**: Falls back to ESC key, backdrop click, or dialog API
- **Hidden Modals**: Only visible modals are returned
- **Nested Modals**: Parent modal is detected and prioritized

## Future Enhancements

Potential improvements:
1. Shadow DOM traversal for web components
2. Iframe modal detection
3. Animation wait (wait for modal to finish animating)
4. Modal state persistence (track which modals were closed)
5. Custom close button patterns (learn from user interactions)

## System Prompt Integration

The agent's system prompt includes:
- Instructions to check `modals` array first
- Guidance on prioritizing `inModal: true` elements
- Instructions for closing modals using close buttons
- Examples of modal interaction patterns

This ensures the agent automatically uses DOM methods for modals instead of falling back to screenshots.

