#!/bin/bash

# Agent Mode Validation Script
# This script helps validate agent mode functionality across multiple sites

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_SITES=(
  "https://www.amazon.com"
  "https://docs.google.com/forms"
  "https://en.wikipedia.org"
  "https://github.com"
)

USE_CASES=(
  "Search for 'laptop' and show me the first 3 results"
  "Fill out this form with test data"
  "Navigate to Wikipedia, search for 'Artificial Intelligence'"
  "Add this item to cart and handle any popups"
  "Search for 'python tutorial' (test tab switching)"
  "Click on a button that doesn't exist, then try alternative"
  "Navigate to login page and fill credentials"
  "Extract main points from this article"
  "Create a new project and add a task"
  "Start a long task, then stop it"
)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Agent Mode Validation Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if Chromium is available
if ! command -v chromium &> /dev/null && ! command -v chromium-browser &> /dev/null && ! command -v google-chrome &> /dev/null; then
    echo -e "${RED}Error: Chromium/Chrome not found${NC}"
    echo "Please install Chromium or Chrome to run validation tests"
    exit 1
fi

# Detect browser
if command -v chromium &> /dev/null; then
    BROWSER="chromium"
elif command -v chromium-browser &> /dev/null; then
    BROWSER="chromium-browser"
else
    BROWSER="google-chrome"
fi

echo -e "${GREEN}Using browser: ${BROWSER}${NC}"
echo ""

# Function to print test case
print_test_case() {
    local site=$1
    local use_case=$2
    local test_num=$3
    
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Test ${test_num}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Site:${NC} ${site}"
    echo -e "${BLUE}Task:${NC} ${use_case}"
    echo ""
}

# Function to open site in browser
open_site() {
    local site=$1
    echo -e "${GREEN}Opening ${site}...${NC}"
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        open -a "$BROWSER" "$site" 2>/dev/null || open "$site"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        $BROWSER "$site" > /dev/null 2>&1 &
    else
        echo -e "${RED}Unsupported OS${NC}"
        return 1
    fi
    
    sleep 2
}

# Function to create test report
create_report() {
    local report_file="agent-mode-validation-report-$(date +%Y%m%d-%H%M%S).md"
    
    cat > "$report_file" << EOF
# Agent Mode Validation Report

**Date:** $(date)
**Browser:** $BROWSER
**Extension Version:** $(cat manifest.json | grep '"version"' | head -1 | cut -d'"' -f4)

## Test Results

EOF
    
    echo "$report_file"
}

# Main validation flow
main() {
    echo -e "${BLUE}Starting validation...${NC}"
    echo ""
    echo -e "${YELLOW}Instructions:${NC}"
    echo "1. Make sure the extension is loaded in Chromium"
    echo "2. For each test, manually execute the task using agent mode"
    echo "3. Verify all validation criteria"
    echo "4. Note any issues or failures"
    echo ""
    read -p "Press Enter to start validation..."
    
    REPORT_FILE=$(create_report)
    TEST_NUM=1
    
    # Test each site with different use cases
    for site in "${TEST_SITES[@]}"; do
        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}Testing site: ${site}${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════${NC}"
        echo ""
        
        # Open site
        open_site "$site"
        
        # Test 2-3 use cases per site
        USE_CASE_COUNT=0
        for use_case in "${USE_CASES[@]}"; do
            if [ $USE_CASE_COUNT -ge 3 ]; then
                break
            fi
            
            print_test_case "$site" "$use_case" "$TEST_NUM"
            
            echo -e "${YELLOW}Manual Steps:${NC}"
            echo "1. Open the extension sidepanel"
            echo "2. Enter the task: ${use_case}"
            echo "3. Start agent mode"
            echo "4. Observe agent behavior"
            echo "5. Test tab switching during task"
            echo "6. Test stop button functionality"
            echo ""
            
            read -p "Press Enter when test is complete..."
            
            echo -e "${BLUE}Validation Checklist:${NC}"
            echo -e "  [ ] Agent executed actions correctly"
            echo -e "  [ ] Messages preserved when switching tabs"
            echo -e "  [ ] Loading state restored correctly"
            echo -e "  [ ] Overlay shows/hides appropriately"
            echo -e "  [ ] Stop button works from any tab"
            echo -e "  [ ] Agent completed task or communicated clearly"
            echo ""
            
            read -p "Did this test pass? (y/n): " result
            if [ "$result" = "y" ] || [ "$result" = "Y" ]; then
                echo -e "${GREEN}✓ Test ${TEST_NUM} PASSED${NC}"
                echo "| Test ${TEST_NUM} | ${site} | ${use_case} | ✅ PASS |" >> "$REPORT_FILE"
            else
                echo -e "${RED}✗ Test ${TEST_NUM} FAILED${NC}"
                read -p "Enter failure reason: " reason
                echo "| Test ${TEST_NUM} | ${site} | ${use_case} | ❌ FAIL | ${reason} |" >> "$REPORT_FILE"
            fi
            
            TEST_NUM=$((TEST_NUM + 1))
            USE_CASE_COUNT=$((USE_CASE_COUNT + 1))
            
            echo ""
            read -p "Press Enter to continue to next test..."
        done
    done
    
    # Add summary to report
    echo "" >> "$REPORT_FILE"
    echo "## Summary" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "Total tests: $((TEST_NUM - 1))" >> "$REPORT_FILE"
    echo "Report generated: $(date)" >> "$REPORT_FILE"
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}Validation Complete!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}Report saved to: ${REPORT_FILE}${NC}"
    echo ""
}

# Run main function
main

