#!/usr/bin/env node

/**
 * Test script to validate XML tool description formatting
 * This tests the cleanToolDescription function from sidepanel.tsx
 */

function cleanToolDescription(text) {
    // Match patterns like <click_element>...</click_element> with nested tags
    // This handles both single-line and multi-line XML-like tool descriptions
    const xmlToolPattern = /<(\w+)>[\s\S]*?<description>(.*?)<\/description>[\s\S]*?<\/\1>/gi;
    
    let cleaned = text.replace(xmlToolPattern, (match, toolName, description) => {
        // Extract and clean the description
        if (description && description.trim()) {
            return description.trim();
        }
        // Fallback: try to extract selector if no description
        const selectorMatch = match.match(/<selector>(.*?)<\/selector>/i);
        if (selectorMatch && selectorMatch[1]) {
            const selector = selectorMatch[1].trim();
            // Make selector more readable
            const readableSelector = selector
                .replace(/button:has-text\(["'](.*?)["']\)/i, '$1 button')
                .replace(/:/g, ' ')
                .replace(/#/g, 'ID: ')
                .replace(/\./g, ' class: ');
            return `Clicking the ${readableSelector}`;
        }
        // Last resort: use tool name
        const friendlyName = toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        return `Executing ${friendlyName}`;
    });
    
    // Also handle cases without description tag
    cleaned = cleaned.replace(/<(\w+)>[\s\S]*?<selector>(.*?)<\/selector>[\s\S]*?<\/\1>/gi, (match, toolName, selector) => {
        const readableSelector = selector.trim()
            .replace(/button:has-text\(["'](.*?)["']\)/i, '$1 button')
            .replace(/:/g, ' ')
            .replace(/#/g, 'ID: ')
            .replace(/\./g, ' class: ');
        return `Clicking the ${readableSelector}`;
    });
    
    return cleaned;
}

const testCases = [
    {
        name: "Original Issue - Click Element with Description",
        input: '<click_element> <selector>button:has-text("Create")</selector> <description>Clicking the Create button to start creating a new Jira issue</description> </click_element>',
        expected: 'Clicking the Create button to start creating a new Jira issue'
    },
    {
        name: "Click Element without Description (selector only)",
        input: '<click_element> <selector>button:has-text("Submit")</selector> </click_element>',
        expected: 'Clicking the Submit button'
    },
    {
        name: "Type Element with Description",
        input: '<type_element> <selector>input[name="email"]</selector> <description>Typing email address into the input field</description> </type_element>',
        expected: 'Typing email address into the input field'
    },
    {
        name: "Multiple XML tags in one message",
        input: 'I\'ll help you with that. <click_element> <selector>button.submit</selector> <description>Clicking the submit button</description> </click_element> Then we can proceed.',
        expected: 'I\'ll help you with that. Clicking the submit button Then we can proceed.'
    },
    {
        name: "Nested XML with complex selector",
        input: '<navigate_element> <selector>a[href*="login"]</selector> <description>Navigating to the login page</description> </navigate_element>',
        expected: 'Navigating to the login page'
    }
];

console.log('🧪 Testing XML Tool Description Formatting\n');
console.log('='.repeat(70));

let passCount = 0;
let failCount = 0;

testCases.forEach((testCase, index) => {
    const result = cleanToolDescription(testCase.input);
    const passed = result === testCase.expected || result.includes(testCase.expected);
    
    console.log(`\nTest ${index + 1}: ${testCase.name}`);
    console.log(`Input:    ${testCase.input}`);
    console.log(`Expected: ${testCase.expected}`);
    console.log(`Got:      ${result}`);
    console.log(`Result:   ${passed ? '✅ PASS' : '❌ FAIL'}`);
    
    if (passed) {
        passCount++;
    } else {
        failCount++;
        console.log(`\n⚠️  Mismatch detected!`);
    }
});

console.log('\n' + '='.repeat(70));
console.log(`\n📊 Summary:`);
console.log(`   Total:  ${testCases.length}`);
console.log(`   Passed: ${passCount} ✅`);
console.log(`   Failed: ${failCount} ${failCount > 0 ? '❌' : ''}`);

if (failCount === 0) {
    console.log('\n🎉 All tests passed! The formatting function works correctly.\n');
    process.exit(0);
} else {
    console.log('\n⚠️  Some tests failed. Please review the output above.\n');
    process.exit(1);
}

