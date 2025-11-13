#!/bin/bash

# Test MCP Server Call
# Usage: ./test-mcp.sh YOUR_ANS_API_TOKEN

if [ -z "$1" ]; then
  echo "❌ Usage: ./test-mcp.sh YOUR_ANS_API_TOKEN"
  echo "   Get your token from Chrome extension Settings"
  exit 1
fi

ANS_API_TOKEN="$1"
SERVER_URL="https://cuzu3hqrxnfig.agenth.godaddy.com/mcp"
SESSION_ID=$(date +%s)

echo "🧪 Testing MCP Server Call..."
echo "📍 Server URL: $SERVER_URL"
echo "📍 Session ID: $SESSION_ID"
echo ""

REQUEST_BODY='{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_site_name",
    "arguments": {
      "operation": "get"
    }
  }
}'

echo "📤 Request Body:"
echo "$REQUEST_BODY" | jq '.'
echo ""

echo "📡 Sending request..."
echo ""

curl -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $ANS_API_TOKEN" \
  -H "mcp-session-id: $SESSION_ID" \
  -d "$REQUEST_BODY" \
  -v

echo ""
echo "✅ Test completed!"
