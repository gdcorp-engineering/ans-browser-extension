# Enterprise Deployment Guide

This guide explains how to deploy the ANS Browser Extension in enterprise environments where you want to bypass Chrome's manual acceptance requirement.

## The Problem

Chrome requires manual user interaction to install unsigned extensions. This cannot be bypassed programmatically for security reasons. However, there are enterprise solutions.

## Solution Options

### Option 1: Chrome Web Store (Recommended for Public Distribution)

**Pros:**
- No warnings or manual acceptance required
- Automatic updates
- Trusted by Chrome
- Works for all users

**Steps:**
1. Create a Chrome Web Store developer account ($5 one-time fee)
2. Upload the extension ZIP file
3. Submit for review
4. Once approved, users can install with one click
5. Updates are automatic

**Note:** Google will re-sign your extension, so the `.crx` file from the store will have a different signature than your self-signed one.

### Option 2: Chrome Enterprise Policies (For Organizations)

**Pros:**
- Force-install extensions without user interaction
- Centralized management
- Works for managed Chrome instances

**Requirements:**
- Chrome Enterprise or Chrome for Business
- Group Policy (Windows) or MDM (macOS/Linux)
- Administrative access

#### Windows (Group Policy)

1. **Get Extension ID:**
   - Install the extension once manually to get its ID
   - Or extract from the `.crx` file
   - The ID is visible in `chrome://extensions/` (Developer mode must be enabled)

2. **Create Policy:**
   ```json
   {
     "ExtensionInstallForcelist": [
       "YOUR_EXTENSION_ID;https://your-update-server.com/updates.xml"
     ]
   }
   ```

3. **Deploy Policy:**
   - Use Group Policy Editor (gpedit.msc)
   - Navigate to: Computer Configuration → Administrative Templates → Google → Google Chrome → Extensions
   - Enable "Configure the list of force-installed extensions"
   - Add the extension ID and update URL

#### macOS (MDM)

1. **Create Configuration Profile:**
   ```xml
   <key>ExtensionInstallForcelist</key>
   <array>
     <string>YOUR_EXTENSION_ID;https://your-update-server.com/updates.xml</string>
   </array>
   ```

2. **Deploy via MDM:**
   - Use your MDM solution (Jamf, Munki, etc.)
   - Push the configuration profile to managed devices

#### Linux

Similar to macOS, use your organization's configuration management tool.

### Option 3: Update Server (For Automatic Updates)

If you want automatic updates without the Chrome Web Store:

1. **Host an Update Manifest:**
   ```xml
   <?xml version='1.0' encoding='UTF-8'?>
   <gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
     <app appid='YOUR_EXTENSION_ID'>
       <updatecheck codebase='https://your-server.com/extension.crx' version='1.5.4' />
     </app>
   </gupdate>
   ```

2. **Configure Extension:**
   - Use `ExtensionInstallForcelist` policy with your update URL
   - Chrome will check this URL for updates

### Option 4: Developer Mode Installation Script

For development/testing environments, create a script that:
1. Opens Chrome extensions page
2. Provides clear instructions
3. Automates what can be automated

See `install-extension.sh` for an example.

## Getting the Extension ID

The extension ID is generated from your private key. To find it:

1. **After first installation:**
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Find your extension
   - The ID is shown below the extension name

2. **From the .crx file:**
   ```bash
   # Extract and decode the .crx file
   # The ID is in the extension's manifest
   ```

3. **Programmatically:**
   ```javascript
   // In Chrome DevTools console on chrome://extensions/
   chrome.management.getAll((extensions) => {
     const ext = extensions.find(e => e.name === "Agent Chat Powered by GoDaddy ANS");
     console.log(ext.id);
   });
   ```

## Best Practices

1. **For Internal/Enterprise Use:**
   - Use Chrome Enterprise Policies (Option 2)
   - Host your own update server (Option 3)
   - This provides the best user experience

2. **For Public Distribution:**
   - Publish to Chrome Web Store (Option 1)
   - This is the most trusted and user-friendly option

3. **For Development:**
   - Use "Load unpacked" method
   - This avoids all warnings and is fastest for development

## Troubleshooting

### Extension Still Shows Warning After Policy Deployment

- Ensure Chrome Enterprise is installed (not regular Chrome)
- Verify the policy is applied: `chrome://policy/`
- Check that the extension ID matches exactly
- Ensure the update URL is accessible

### Users Can Still Disable Extension

- Use `ExtensionInstallBlocklist` to prevent disabling
- Or use `ExtensionInstallAllowlist` to only allow specific extensions

## References

- [Chrome Enterprise Policies](https://support.google.com/chrome/a/answer/9026507)
- [Extension Installation](https://developer.chrome.com/docs/extensions/mv3/packaging/)
- [Chrome Web Store Publishing](https://developer.chrome.com/docs/webstore/publish/)

