# How to Add a Site Mapping for *.godaddy.com

This guide walks you through adding a site mapping that connects `*.godaddy.com` to the "agent" service at `https://agent.tuneify.ai/mcp`.

## Quick Reference - Exact Values Needed

When creating the mapping, use these exact values:

- **URL Pattern**: `*.godaddy.com`
- **Service Type**: 🔌 MCP Server
- **Service Name**: `agent`
- **Service URL**: `https://agent.tuneify.ai/mcp`

## Prerequisites

- The extension is installed and enabled
- You have access to the settings page

> **Note**: This guide includes screenshot references. Ensure the `screenshots/` directory exists in the same location as this file, and place the corresponding screenshot images there with the filenames referenced in each step.

## Step-by-Step Instructions

### Step 1: Sign into ANS Authentication

1. Open the extension settings page
2. Scroll to the **"Enable ANS"** section
3. In **Step 1: Sign into ANS Authentication**, click the **"🔐 Sign In to ANS"** button
4. This will open `https://ra.int.ote-godaddy.com/` in a new tab
5. Complete the sign-in process in that tab
6. The extension will automatically use your browser cookies for ANS API access

![Step 1: Enable ANS - Sign into ANS Authentication](screenshots/step1-enable-ans-signin.png)

*Figure 1: Step 1 - Enable ANS by signing into ANS Authentication. The "Sign In to ANS" button is visible with the warning message about browser cookies.*

> ⚠️ **Important**: You must complete Step 1 before proceeding. Site mappings will not work without ANS authentication.

---

### Step 2: Site-Specific Service Mappings

1. In the **"Enable ANS"** section, locate **Step 2: Site-Specific Service Mappings**
2. First, click on the **"🌐 Discover Services"** tab at the top of Step 2
3. In the search bar, type **"agent"** and press Enter or click the search icon
4. Review the search results to find the "agent" service
5. Once you've found the service (or if it's already in your services list), click on the **"🗺️ Site Mappings"** tab at the top of Step 2
6. You'll see the mapping form below the tabs

![Step 2a: Discover Services - Search for "agent"](screenshots/step2a-discover-services-agent-search.png)

*Figure 2a: Step 2 - Discover Services tab showing the search for "agent" with search results displayed. The Fetch Status log shows the API call details and results.*

#### Enter the URL Pattern

1. In the **"URL Pattern"** field, enter exactly: **`*.godaddy.com`**
   - ⚠️ **Important**: Enter this exact pattern: `*.godaddy.com` (with the asterisk and dot)
   - This pattern will match any subdomain of godaddy.com (e.g., `www.godaddy.com`, `store.godaddy.com`, `godaddy.com`, etc.)

> **Note**: If you have `godaddy.com` open in a browser tab, you can use the **"📍 Select Site from Open Tabs"** dropdown and click **"Use Selected Site"** to auto-fill, but you'll need to manually add the `*` prefix to make it `*.godaddy.com`.

#### Configure the Service Type

1. In the **"Service Type"** dropdown, select: **"🔌 MCP Server"**
   - ⚠️ **Important**: You must select **"🔌 MCP Server"** (not "🤖 A2A Agent")

#### Select the Service

1. In the **"Select Service"** dropdown, look for and select: **"agent"**
   - The service should show as: **"agent (https://agent.tuneify.ai/mcp)"**
   - Service URL: `https://agent.tuneify.ai/mcp`

> **Note**: If the "agent" service is not in the list, you must add it first. See the "Adding the Service First" section below.

#### Complete the Mapping

1. Click the **"+ Add Mapping"** button
2. The mapping will be created with:
   - **URL Pattern**: `*.godaddy.com`
   - **Service Type**: MCP Server
   - **Service**: agent
   - **Service URL**: `https://agent.tuneify.ai/mcp`

![Step 2b: Site Mappings - Form filled with values](screenshots/step2b-site-mappings-form-filled.png)

*Figure 2b: Step 2 - Site Mappings tab showing the form with all values filled in: URL Pattern: `*.godaddy.com`, Service Type: 🔌 MCP Server, Service: agent (https://agent.tuneify.ai/mcp), and the "+ Add Mapping" button ready to click.*

---

### Step 3: Verify the Mapping

1. Scroll down to **Step 3: Show Active Mappings**
2. You should see your mapping(s) listed with these exact details:
   - **URL Pattern**: `*.godaddy.com` (and optionally `godaddy.com` if you created both)
   - **Service Type**: 🔌 MCP Server (or shows the MCP icon)
   - **Service Name**: `agent`
   - **Service URL**: `https://agent.tuneify.ai/mcp`
   - A checkbox to enable/disable the mapping (should be checked by default)

![Step 3: Show Active Mappings](screenshots/step3-show-active-mappings.png)

*Figure 3: Step 3 - Show Active Mappings displaying both `*.godaddy.com` and `godaddy.com` mappings. Both show the MCP Server icon, service name "agent", and the service URL. Each mapping has a checkbox (checked) and a Delete button.*

3. ✅ The mapping is now active! When you visit any `*.godaddy.com` site (e.g., `www.godaddy.com`, `store.godaddy.com`), the extension will automatically use the "agent" service at `https://agent.tuneify.ai/mcp`.

---

## Adding the Service First (If Needed)

If the "agent" service doesn't appear in the service dropdown, you need to add it first:

### Method 1: Add as Custom Server

1. In **Step 2**, click the **"🔧 Custom"** tab
2. Fill in the form with these exact values:
   - **Server name**: `agent`
   - **Server URL**: `https://agent.tuneify.ai/mcp`
   - **API Key**: (leave blank if not required)
3. Click **"+ Add Custom Server"**
4. The service will now appear in the dropdown when creating mappings
5. Return to the **"🗺️ Site Mappings"** tab to continue with the mapping

### Method 2: Discover in Marketplace

1. In **Step 2**, click the **"🌐 Discover Services"** tab
2. Search for "agent" or "tuneify"
3. If found, click to add it to your services
4. Then proceed with the mapping steps above

---

## Troubleshooting

### The mapping doesn't appear in Step 3

- Make sure you clicked **"+ Add Mapping"** after filling in all fields
- Check that both URL Pattern and Service are filled in
- Verify the service exists in your services list

### The service doesn't work on godaddy.com

- Verify the mapping is enabled (checkbox is checked in Step 3)
- Check that you're on a `*.godaddy.com` domain
- Ensure ANS authentication is complete (Step 1)
- Check the browser console for any error messages

### Can't find the "agent" service

- Make sure you've added it as a custom server first
- Verify the URL `https://agent.tuneify.ai/mcp` is correct
- Check that the service is enabled in your services list

---

## Summary

✅ **Step 1**: Sign in to ANS  
✅ **Step 2**: 
   - Go to Site Mappings tab
   - Enter URL Pattern: **`*.godaddy.com`**
   - Select Service Type: **🔌 MCP Server**
   - Select Service: **agent** (`https://agent.tuneify.ai/mcp`)
   - Click "+ Add Mapping"  
✅ **Step 3**: Verify mapping appears in Active Mappings list with:
   - URL Pattern: `*.godaddy.com`
   - Service Type: MCP Server
   - Service: agent
   - Service URL: `https://agent.tuneify.ai/mcp`

Once complete, the extension will automatically use the "agent" service at `https://agent.tuneify.ai/mcp` when you visit any `*.godaddy.com` website!

