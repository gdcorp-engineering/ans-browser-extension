import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings, MCPServerConfig, SiteInstruction } from './types';
import { DEFAULT_SITE_INSTRUCTIONS } from './default-site-instructions';
import {
  fetchTrustedBusinesses,
  searchBusinesses,
  filterByCapability,
  getCapabilities,
  getFeaturedBusinesses,
  sortBusinesses,
  type ANSBusinessService,
} from './trusted-business-service';

const PROVIDER_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Latest and most capable' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation' },
  ],
};

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-5-20250929',
    toolMode: 'tool-router',
    composioApiKey: '',
    mcpEnabled: false,
    mcpServers: [],
    siteInstructions: [],
  });
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showComposioKey, setShowComposioKey] = useState(false);
  const [showAnsToken, setShowAnsToken] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', apiKey: '' });
  const [newSiteInstruction, setNewSiteInstruction] = useState({ domainPattern: '', instructions: '' });

  // Business Marketplace state
  const [trustedBusinesses, setTrustedBusinesses] = useState<ANSBusinessService[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<ANSBusinessService[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCapability, setSelectedCapability] = useState('all');
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'connected' | 'marketplace' | 'custom'>('connected');
  const [fetchLogs, setFetchLogs] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; downloadUrl: string; releaseNotes?: string } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const CURRENT_VERSION = '1.5.4'; // This should match manifest.json version
  const GITHUB_REPO = 'gdcorp-engineering/ans-browser-extension';
  const WORKFLOW_NAME = 'build.yml';

  // Compare semantic versions (e.g., "1.5.4" vs "1.5.3")
  const compareVersions = (v1: string, v2: string): number => {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 > part2) return 1;  // v1 is newer
      if (part1 < part2) return -1; // v2 is newer
    }

    return 0; // versions are equal
  };

  const checkForUpdates = async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    setUpdateMessage(null);
    setUpdateAvailable(null);

    try {
      // Fetch latest workflow runs for Prod environment
      const workflowRunsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_NAME}/runs?status=success&per_page=1`;
      const runsResponse = await fetch(workflowRunsUrl);

      if (!runsResponse.ok) {
        throw new Error(`Failed to check for updates: ${runsResponse.status}`);
      }

      const runsData = await runsResponse.json();

      if (!runsData.workflow_runs || runsData.workflow_runs.length === 0) {
        throw new Error('No successful builds found');
      }

      const latestRun = runsData.workflow_runs[0];

      // Extract version from commit message or use workflow run number
      const commitMessage = latestRun.head_commit?.message || '';
      const versionMatch = commitMessage.match(/v?(\d+\.\d+\.\d+)/);
      const latestVersion = versionMatch ? versionMatch[1] : `build-${latestRun.run_number}`;

      // Compare versions
      const comparison = compareVersions(latestVersion, CURRENT_VERSION);

      // Get artifacts for this run
      const artifactsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${latestRun.id}/artifacts`;
      const artifactsResponse = await fetch(artifactsUrl);
      const artifactsData = await artifactsResponse.json();

      // Find the Prod artifact
      const prodArtifact = artifactsData.artifacts?.find((a: any) => a.name === 'extension-prod');

      // Always show update available (for debugging/testing)
      // Show appropriate message based on version comparison
      let versionMessage = '';
      if (comparison > 0) {
        versionMessage = `Update Available: Version ${latestVersion}`;
      } else if (comparison === 0) {
        versionMessage = `Reinstall Current Version: ${latestVersion}`;
      } else {
        versionMessage = `Downgrade to Release Version: ${latestVersion} (from dev ${CURRENT_VERSION})`;
      }

      setUpdateAvailable({
        version: latestVersion,
        downloadUrl: `https://github.com/${GITHUB_REPO}/actions/runs/${latestRun.id}`,
        releaseNotes: commitMessage || 'Check GitHub Actions for details'
      });
    } catch (error) {
      console.error('Update check failed:', error);
      setUpdateError(error instanceof Error ? error.message : 'Failed to check for updates');
    } finally {
      setUpdateChecking(false);
    }
  };

  useEffect(() => {
    // Load settings from chrome.storage
    chrome.storage.local.get(['atlasSettings'], (result) => {
      if (result.atlasSettings) {
        const loadedSettings = result.atlasSettings;

        // Merge default site instructions with user's custom ones
        const userInstructions = loadedSettings.siteInstructions || [];
        const userInstructionIds = new Set(userInstructions.map((i: SiteInstruction) => i.id));

        // Add default instructions that don't already exist
        const defaultsToAdd = DEFAULT_SITE_INSTRUCTIONS.filter(
          (defaultInst) => !userInstructionIds.has(defaultInst.id)
        );

        const mergedInstructions = [...defaultsToAdd, ...userInstructions];

        setSettings({
          ...loadedSettings,
          siteInstructions: mergedInstructions
        });
      } else {
        // First time setup - include defaults
        setSettings({
          provider: 'anthropic',
          apiKey: '',
          model: 'claude-sonnet-4-5-20250929',
          toolMode: 'tool-router',
          composioApiKey: '',
          mcpEnabled: false,
          mcpServers: [],
          siteInstructions: DEFAULT_SITE_INSTRUCTIONS,
        });
      }
    });
  }, []);

  // Load trusted businesses from API
  useEffect(() => {
    const loadBusinesses = async () => {
      setMarketplaceLoading(true);
      setFetchLogs([]);
      setFetchError(null);

      const addLog = (msg: string) => {
        console.log(msg);
        setFetchLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
      };

      try {
        addLog('🔄 Starting fetch from ANS API...');
        addLog(`📡 Endpoint: https://ra.int.dev-godaddy.com/v1/agents`);

        if (settings.ansApiToken) {
          addLog('🔑 Using ANS API token from settings');
        } else {
          addLog('🍪 Attempting auth with browser cookies');
        }

        const businesses = await fetchTrustedBusinesses(settings.ansApiToken);

        addLog(`✅ Fetch completed: ${businesses.length} total agents`);
        addLog(`📊 Capabilities: ${getCapabilities(businesses).join(', ') || 'None'}`);

        setTrustedBusinesses(businesses);
        setFilteredBusinesses(businesses);

        if (businesses.length === 0) {
          setFetchError('API returned 0 agents - check console for details');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        addLog(`❌ Error: ${errorMsg}`);
        setFetchError(errorMsg);
        console.error('Failed to load trusted businesses:', error);
      } finally {
        setMarketplaceLoading(false);
      }
    };

    if (settings.mcpEnabled) {
      loadBusinesses();
    }
  }, [settings.mcpEnabled]);

  // Update filtered businesses when search or capability changes
  useEffect(() => {
    let result = trustedBusinesses;

    // Apply capability filter
    if (selectedCapability !== 'all') {
      result = filterByCapability(result, selectedCapability);
    }

    // Apply search
    if (searchQuery) {
      result = searchBusinesses(result, searchQuery);
    }

    setFilteredBusinesses(result);
  }, [searchQuery, selectedCapability, trustedBusinesses]);

  const handleAddServer = () => {
    if (!newServer.name || !newServer.url) return;

    const server: MCPServerConfig = {
      id: Date.now().toString(),
      name: newServer.name,
      url: newServer.url,
      apiKey: newServer.apiKey || undefined,
      enabled: true,
    };

    setSettings({
      ...settings,
      mcpServers: [...(settings.mcpServers || []), server],
    });

    setNewServer({ name: '', url: '', apiKey: '' });
  };

  const handleRemoveServer = (id: string) => {
    const newSettings = {
      ...settings,
      mcpServers: (settings.mcpServers || []).filter(s => s.id !== id),
    };

    setSettings(newSettings);

    // Auto-save and notify sidebar
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mcp_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });
  };

  const handleToggleServer = (id: string) => {
    console.log('Toggle server called for id:', id);
    console.log('Current settings.mcpServers:', settings.mcpServers);

    // Create a completely new array to ensure React detects the change
    const updatedServers = (settings.mcpServers || []).map(s => {
      if (s.id === id) {
        console.log('Toggling server:', s.name, 'from', s.enabled, 'to', !s.enabled);
        return { ...s, enabled: !s.enabled };
      }
      return { ...s };
    });

    const newSettings = {
      ...settings,
      mcpServers: updatedServers,
    };

    console.log('New settings:', newSettings);

    // Force state update with new reference
    setSettings(newSettings);

    // Auto-save and notify sidebar
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      console.log('Settings saved to storage');
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mcp_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });
  };

  // Connect to a trusted business from marketplace
  const handleConnectBusiness = (business: ANSBusinessService) => {
    const isAlreadyConnected = (settings.mcpServers || []).some(
      s => s.url === business.url
    );

    if (isAlreadyConnected) {
      console.log('Business already connected');
      return;
    }

    const server: MCPServerConfig = {
      id: business.id,
      name: business.name,
      url: business.url,
      protocol: business.protocol || 'mcp', // Use protocol from business, default to 'mcp'
      enabled: true,
      isTrusted: true,
      isCustom: false,
      businessInfo: {
        description: business.description,
        category: business.capability, // Store capability as category in businessInfo
        location: business.location,
        website: business.website,
        rating: business.rating,
      },
    };

    const newSettings = {
      ...settings,
      mcpServers: [...(settings.mcpServers || []), server],
    };

    setSettings(newSettings);

    // Auto-save and notify sidebar
    console.log('💾 Auto-saving settings after connect...');
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      console.log('✅ Settings saved to chrome.storage');
      console.log('📤 Sending SETTINGS_UPDATED message with action: mcp_changed');
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mcp_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('⚠️  Sidebar not active, but settings saved');
        } else {
          console.log('✅ Message sent to sidebar successfully');
        }
      });
    });

    console.log(`✅ Connected to ${business.name}`);
  };

  // Disconnect from a business
  const handleDisconnectBusiness = (id: string) => {
    const newSettings = {
      ...settings,
      mcpServers: (settings.mcpServers || []).filter(s => s.id !== id),
    };

    setSettings(newSettings);

    // Auto-save and notify sidebar
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mcp_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });

    console.log(`✅ Disconnected from service`);
  };

  // Check if business is connected
  const isBusinessConnected = (businessUrl: string): boolean => {
    return (settings.mcpServers || []).some(s => s.url === businessUrl);
  };

  // Site Instructions handlers
  const handleAddSiteInstruction = () => {
    if (!newSiteInstruction.domainPattern || !newSiteInstruction.instructions) return;

    const siteInstruction: SiteInstruction = {
      id: Date.now().toString(),
      domainPattern: newSiteInstruction.domainPattern,
      instructions: newSiteInstruction.instructions,
      enabled: true,
    };

    setSettings({
      ...settings,
      siteInstructions: [...(settings.siteInstructions || []), siteInstruction],
    });

    setNewSiteInstruction({ domainPattern: '', instructions: '' });
  };

  const handleRemoveSiteInstruction = (id: string) => {
    setSettings({
      ...settings,
      siteInstructions: (settings.siteInstructions || []).filter(s => s.id !== id),
    });
  };

  const handleToggleSiteInstruction = (id: string) => {
    const updatedInstructions = (settings.siteInstructions || []).map(s => {
      if (s.id === id) {
        return { ...s, enabled: !s.enabled };
      }
      return { ...s };
    });

    setSettings({
      ...settings,
      siteInstructions: updatedInstructions,
    });
  };

  const handleSave = () => {
    chrome.storage.local.set({ atlasSettings: settings }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // Send message to sidebar to refresh
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });
  };

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Configure your AI provider and preferences</p>
      </div>

      <div className="settings-content">
        {/* Update Section */}
        <div className="setting-group" style={{ background: '#f8f9fa', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <label style={{ marginBottom: '4px', display: 'block' }}>Extension Updates</label>
              <span style={{ fontSize: '13px', color: '#666' }}>Current version: {CURRENT_VERSION}</span>
            </div>
            <button
              onClick={checkForUpdates}
              disabled={updateChecking}
              style={{
                padding: '8px 16px',
                background: updateChecking ? '#6c757d' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: updateChecking ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              {updateChecking ? '⏳ Checking...' : '🔄 Check for Updates'}
            </button>
          </div>

          {updateMessage && (
            <div style={{
              padding: '12px',
              background: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '6px',
              color: '#155724',
              fontSize: '14px'
            }}>
              {updateMessage}
            </div>
          )}

          {updateError && (
            <div style={{
              padding: '12px',
              background: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '6px',
              color: '#721c24',
              fontSize: '14px'
            }}>
              ⚠️ {updateError}
            </div>
          )}

          {updateAvailable && (
            <div style={{
              padding: '16px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '6px'
            }}>
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#856404', fontSize: '15px' }}>
                  {(() => {
                    const comparison = compareVersions(updateAvailable.version, CURRENT_VERSION);
                    if (comparison > 0) {
                      return `🎉 Update Available: Version ${updateAvailable.version}`;
                    } else if (comparison === 0) {
                      return `🔄 Reinstall Current Version: ${updateAvailable.version}`;
                    } else {
                      return `⬇️ Latest Release: Version ${updateAvailable.version}`;
                    }
                  })()}
                </strong>
              </div>
              {updateAvailable.releaseNotes && (
                <div style={{
                  fontSize: '13px',
                  color: '#856404',
                  marginBottom: '12px',
                  maxHeight: '100px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap'
                }}>
                  {updateAvailable.releaseNotes}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <button
                  onClick={() => window.open(updateAvailable.downloadUrl, '_blank')}
                  style={{
                    padding: '10px 16px',
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  📥 Download Update
                </button>
                <button
                  onClick={() => {
                    // Open Chrome extensions page to show the path
                    chrome.tabs.create({
                      url: 'chrome://extensions/?id=' + chrome.runtime.id
                    });

                    // Show helpful alert
                    setTimeout(() => {
                      alert('📂 Finding Your Install Folder:\n\n1. The Chrome extensions page just opened\n2. Make sure "Developer mode" is enabled (toggle in top-right)\n3. Find "GoDaddy ANS Chat Sidebar" extension\n4. Look for "Loaded from:" - that shows your install folder path\n5. You can click the blue folder path to open it in Finder/Explorer');
                    }, 500);
                  }}
                  style={{
                    padding: '10px 16px',
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}
                >
                  📂 Show Install Path
                </button>
              </div>
              <div style={{
                padding: '12px',
                background: '#fff',
                border: '1px solid #ffc107',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#333'
              }}>
                <strong>📋 Update Instructions:</strong>
                <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                  <li>Click <strong>"Download Update"</strong> → Sign in with SSO → Download <strong>extension-prod</strong> artifact</li>
                  <li>Click <strong>"Show Install Path"</strong> to open Chrome's extension management page</li>
                  <li>On that page, find this extension and note the path shown under "ID" (for unpacked extensions, you'll see the folder path)</li>
                  <li>Extract the downloaded zip file and replace all files in that folder</li>
                  <li>Go back to <code>chrome://extensions/</code> and click the reload button (↻) for this extension</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="setting-group">
          <label>AI Provider</label>
          <select
            value={settings.provider}
            onChange={(e) => {
              const newProvider = e.target.value as Settings['provider'];
              setSettings({
                ...settings,
                provider: newProvider,
                model: PROVIDER_MODELS[newProvider][0].id
              });
            }}
            className="model-select"
          >
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>

        <div className="setting-group">
          <label>Model</label>
          <select
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            className="model-select"
          >
            {PROVIDER_MODELS[settings.provider].map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.description}
              </option>
            ))}
            <option value="custom">Custom Model</option>
          </select>
        </div>

        {settings.model === 'custom' && (
          <div className="setting-group">
            <label>Custom Model Name</label>
            <input
              type="text"
              value={settings.customModelName || ''}
              onChange={(e) => setSettings({ ...settings, customModelName: e.target.value })}
              placeholder="e.g., claude-sonnet-4-5-20250929"
              className="api-key-input"
            />
            <p className="help-text">
              Enter the exact model name/ID for your custom provider endpoint.
            </p>
          </div>
        )}

        {/* Composio API Key - Hidden from UI
        <div className="setting-group">
          <label>Composio API Key</label>
          <div className="api-key-input-wrapper">
            <input
              type={showComposioKey ? 'text' : 'password'}
              value={settings.composioApiKey || ''}
              onChange={(e) => setSettings({ ...settings, composioApiKey: e.target.value })}
              placeholder="Enter your Composio API key (optional)"
              className="api-key-input"
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowComposioKey(!showComposioKey)}
            >
              {showComposioKey ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
          <p className="help-text">
            Enable Composio Tool Router for access to 500+ app integrations. Get your key from{' '}
            <a href="https://app.composio.dev/settings" target="_blank" rel="noopener noreferrer">
              Composio Dashboard
            </a>
          </p>
        </div>
        */}

        <div className="setting-group">
          <label>GoCode URL</label>
          <div className="api-key-input-wrapper">
            <input
              type="text"
              value={settings.customBaseUrl || 'https://caas-gocode-prod.caas-prod.prod.onkatana.net'}
              onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
              placeholder="https://caas-gocode-prod.caas-prod.prod.onkatana.net"
              className="api-key-input"
            />
          </div>
          <p className="help-text">
            GoCode API endpoint for Claude requests.
          </p>
        </div>

        <div className="setting-group">
          <label>GoCode Key</label>
          <div className="api-key-input-wrapper">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder="Enter your API key"
              className="api-key-input"
            />
            <button
              type="button"
              className="toggle-visibility"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
        </div>

        <div className="setting-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={settings.mcpEnabled || false}
              onChange={(e) => setSettings({ ...settings, mcpEnabled: e.target.checked })}
            />
            Enable Business Services
          </label>
          <p className="help-text">
            🌐 Access 115 Million verified GoDaddy customer services through AI chat. Book appointments, place orders, and interact with businesses naturally.
          </p>
        </div>

        <div className="setting-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={settings.autoSaveScreenshots || false}
              onChange={(e) => setSettings({ ...settings, autoSaveScreenshots: e.target.checked })}
            />
            Auto-save Screenshots
          </label>
          <p className="help-text">
            📸 Automatically save all screenshots to your Downloads folder for debugging and review.
          </p>
        </div>

        <div className="setting-group">
          <h3 style={{ marginBottom: '15px', fontSize: '16px' }}>💬 Conversation Memory Settings</h3>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={settings.enableConversationPersistence !== false}
              onChange={(e) => setSettings({ ...settings, enableConversationPersistence: e.target.checked })}
            />
            Save Conversations
          </label>
          <p className="help-text" style={{ marginBottom: '15px' }}>
            💾 Automatically save conversations to local storage. When enabled, your chat history persists across sessions and browser restarts.
          </p>

          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Initial Message History (default: 10)
          </label>
          <input
            type="number"
            min="1"
            max="50"
            value={settings.conversationHistoryLength || 10}
            onChange={(e) => setSettings({ ...settings, conversationHistoryLength: parseInt(e.target.value) || 10 })}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '5px',
              border: '1px solid #ddd',
              borderRadius: '4px'
            }}
          />
          <p className="help-text" style={{ marginBottom: '15px' }}>
            📊 Number of previous messages to include when starting a new request. Higher values provide more context but use more tokens.
          </p>

          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Loop Message History (default: 15)
          </label>
          <input
            type="number"
            min="4"
            max="50"
            value={settings.conversationLoopHistoryLength || 15}
            onChange={(e) => setSettings({ ...settings, conversationLoopHistoryLength: parseInt(e.target.value) || 15 })}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '5px',
              border: '1px solid #ddd',
              borderRadius: '4px'
            }}
          />
          <p className="help-text" style={{ marginBottom: '15px' }}>
            🔄 Maximum messages kept during browser automation tool loops. Prevents context overflow during multi-step operations.
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={settings.enableSmartSummarization !== false}
              onChange={(e) => setSettings({ ...settings, enableSmartSummarization: e.target.checked })}
            />
            Smart Summarization
          </label>
          <p className="help-text">
            🤖 Automatically summarize old messages when approaching context limits. Preserves conversation flow while reducing token usage.
          </p>
        </div>

        {settings.mcpEnabled && (
          <div className="setting-group">
            <label>ANS Authentication</label>
            <button
              onClick={() => {
                window.open('https://ra.int.dev-godaddy.com/', '_blank');
              }}
              style={{
                padding: '12px 20px',
                background: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '10px',
                width: '100%'
              }}
            >
              🔐 Sign In to ANS
            </button>
            <p className="help-text">
              Click the button above to sign in to ANS. Once signed in, the extension will automatically use your browser cookies to access the ANS API.
              <br />
              <br />
              <strong>Advanced:</strong> If cookie authentication doesn't work, you can manually enter a Bearer token below (optional).
            </p>
            <div className="api-key-input-wrapper" style={{ marginTop: '10px' }}>
              <input
                type={showAnsToken ? 'text' : 'password'}
                value={settings.ansApiToken || ''}
                onChange={(e) => setSettings({ ...settings, ansApiToken: e.target.value })}
                placeholder="Optional: Manual Bearer token (eyJraWQiOi...)"
                className="api-key-input"
              />
              <button
                type="button"
                className="toggle-visibility"
                onClick={() => setShowAnsToken(!showAnsToken)}
              >
                {showAnsToken ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
        )}

        {settings.mcpEnabled && (
          <>
            {/* Tabs */}
            <div className="setting-group">
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #eee' }}>
                <button
                  onClick={() => setActiveTab('connected')}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'connected' ? '3px solid #007bff' : '3px solid transparent',
                    cursor: 'pointer',
                    fontWeight: activeTab === 'connected' ? 'bold' : 'normal',
                    color: activeTab === 'connected' ? '#007bff' : '#666'
                  }}
                >
                  My Services ({(settings.mcpServers || []).length})
                </button>
                <button
                  onClick={() => setActiveTab('marketplace')}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'marketplace' ? '3px solid #007bff' : '3px solid transparent',
                    cursor: 'pointer',
                    fontWeight: activeTab === 'marketplace' ? 'bold' : 'normal',
                    color: activeTab === 'marketplace' ? '#007bff' : '#666'
                  }}
                >
                  🌐 Discover Services
                </button>
                <button
                  onClick={() => setActiveTab('custom')}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'custom' ? '3px solid #007bff' : '3px solid transparent',
                    cursor: 'pointer',
                    fontWeight: activeTab === 'custom' ? 'bold' : 'normal',
                    color: activeTab === 'custom' ? '#007bff' : '#666'
                  }}
                >
                  🔧 Custom
                </button>
              </div>
            </div>
          </>
        )}

        {/* My Services Tab */}
        {settings.mcpEnabled && activeTab === 'connected' && (
          <div className="setting-group">
            <label>Connected Services</label>

            {(settings.mcpServers || []).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(settings.mcpServers || []).map((server) => (
                  <div
                    key={server.id}
                    style={{
                      padding: '16px',
                      border: server.isTrusted ? '2px solid #28a745' : '1px solid #ddd',
                      borderRadius: '8px',
                      background: '#f9f9f9'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{server.name}</div>
                          {server.isTrusted && <span style={{ background: '#28a745', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>✓ Verified</span>}
                          {server.isCustom && <span style={{ background: '#ffc107', color: '#333', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>⚠️  Custom</span>}
                        </div>

                        {server.businessInfo?.description && (
                          <div style={{ fontSize: '13px', color: '#666', marginBottom: '6px' }}>
                            {server.businessInfo.description}
                          </div>
                        )}

                        <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                          {server.businessInfo?.location && `📍 ${server.businessInfo.location} • `}
                          {server.businessInfo?.category && `${server.businessInfo.category}`}
                        </div>

                        <div style={{ fontSize: '11px', color: '#999' }}>{server.url}</div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={server.enabled}
                            onChange={() => handleToggleServer(server.id)}
                          />
                          Active
                        </label>
                        <button
                          onClick={() => handleDisconnectBusiness(server.id)}
                          style={{
                            padding: '6px 12px',
                            background: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
                <p style={{ fontSize: '16px', marginBottom: '10px' }}>No services connected yet</p>
                <p style={{ fontSize: '14px', marginBottom: '20px' }}>Discover and connect to GoDaddy customer services</p>
                <button
                  onClick={() => setActiveTab('marketplace')}
                  style={{
                    padding: '10px 20px',
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  🌐 Browse Marketplace
                </button>
              </div>
            )}
          </div>
        )}

        {/* Marketplace Tab - Discover GoDaddy Customer Services */}
        {settings.mcpEnabled && activeTab === 'marketplace' && (
          <div className="setting-group">
            <label>ANS Business Marketplace</label>

            {/* Search and Filter */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="🔍 Search by name, ID, or capability..."
                  className="api-key-input"
                  style={{ flex: 1, marginBottom: 0 }}
                />
                <button
                  onClick={() => {
                    // Force reload by toggling mcpEnabled
                    const current = settings.mcpEnabled;
                    setSettings({ ...settings, mcpEnabled: false });
                    setTimeout(() => setSettings({ ...settings, mcpEnabled: current }), 10);
                  }}
                  disabled={marketplaceLoading}
                  style={{
                    padding: '8px 16px',
                    background: marketplaceLoading ? '#6c757d' : '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: marketplaceLoading ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  {marketplaceLoading ? '⏳' : '🔄'} Refresh
                </button>
              </div>

              <select
                value={selectedCapability}
                onChange={(e) => setSelectedCapability(e.target.value)}
                className="model-select"
              >
                <option value="all">All Capabilities</option>
                {getCapabilities(trustedBusinesses).map(cap => (
                  <option key={cap} value={cap}>{cap}</option>
                ))}
              </select>
            </div>

            {/* Debug/Status Information */}
            {(fetchLogs.length > 0 || fetchError) && (
              <div style={{
                marginBottom: '20px',
                padding: '12px',
                background: fetchError ? '#fff3cd' : '#e7f3ff',
                border: `1px solid ${fetchError ? '#ffc107' : '#007bff'}`,
                borderRadius: '6px',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', fontFamily: 'sans-serif' }}>
                  📋 Fetch Status
                </div>
                {fetchError && (
                  <div style={{ color: '#856404', marginBottom: '8px', fontWeight: 'bold' }}>
                    ⚠️ {fetchError}
                  </div>
                )}
                {fetchLogs.map((log, idx) => (
                  <div key={idx} style={{ marginBottom: '4px', color: '#333' }}>
                    {log}
                  </div>
                ))}
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#666', fontFamily: 'sans-serif' }}>
                  Total businesses loaded: {trustedBusinesses.length} |
                  Filtered results: {filteredBusinesses.length}
                  {searchQuery && ` | Search: "${searchQuery}"`}
                  {selectedCapability !== 'all' && ` | Capability: ${selectedCapability}`}
                </div>
              </div>
            )}

            {marketplaceLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                Loading services...
              </div>
            ) : filteredBusinesses.length > 0 ? (
              <>
                <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666' }}>
                  Showing all {filteredBusinesses.length} services
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '500px', overflowY: 'auto' }}>
                  {filteredBusinesses.map((business) => {
                  const connected = isBusinessConnected(business.url);
                  return (
                    <div
                      key={business.id}
                      style={{
                        padding: '16px',
                        border: '1px solid #ddd',
                        borderRadius: '8px',
                        background: connected ? '#f0f8ff' : 'white'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{business.name}</div>
                            <span style={{ background: '#28a745', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>✓ Verified</span>
                          </div>

                          {business.description && (
                            <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
                              {business.description}
                            </div>
                          )}

                          <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                            {business.location && `📍 ${business.location}`}
                            {business.capability && ` • Capability: ${business.capability}`}
                            {business.rating && ` • ⭐ ${business.rating}/5`}
                            {business.connectionCount && ` • ${business.connectionCount} connections`}
                          </div>

                          <div style={{ fontSize: '11px', color: '#999', fontFamily: 'monospace' }}>
                            ID: {business.id}
                          </div>
                        </div>

                        <button
                          onClick={() => connected ? handleDisconnectBusiness(business.id) : handleConnectBusiness(business)}
                          style={{
                            padding: '8px 16px',
                            background: connected ? '#dc3545' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px'
                          }}
                        >
                          {connected ? 'Disconnect' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                <p>No services found matching your search</p>
              </div>
            )}
          </div>
        )}

        {/* Custom Tab - Add Your Own MCP Server */}
        {settings.mcpEnabled && activeTab === 'custom' && (
          <div className="setting-group">
            <label>Custom MCP Server</label>
            <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
              ⚠️  Custom servers are not verified by GoDaddy ANS. Only connect to services you trust.
            </p>

            <div style={{ marginBottom: '15px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  placeholder="Server name (e.g., My Private Service)"
                  className="api-key-input"
                  style={{ marginBottom: '8px' }}
                />
                <input
                  type="text"
                  value={newServer.url}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  placeholder="Server URL (e.g., http://localhost:3000/mcp)"
                  className="api-key-input"
                  style={{ marginBottom: '8px' }}
                />
                <input
                  type="text"
                  value={newServer.apiKey}
                  onChange={(e) => setNewServer({ ...newServer, apiKey: e.target.value })}
                  placeholder="API Key (optional)"
                  className="api-key-input"
                />
              </div>
              <button
                onClick={() => {
                  if (!newServer.name || !newServer.url) return;
                  const server: MCPServerConfig = {
                    id: Date.now().toString(),
                    name: newServer.name,
                    url: newServer.url,
                    apiKey: newServer.apiKey || undefined,
                    enabled: true,
                    isCustom: true,
                    isTrusted: false,
                  };
                  setSettings({
                    ...settings,
                    mcpServers: [...(settings.mcpServers || []), server],
                  });
                  setNewServer({ name: '', url: '', apiKey: '' });
                  setActiveTab('connected');
                }}
                disabled={!newServer.name || !newServer.url}
                style={{
                  padding: '10px 20px',
                  background: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  opacity: (!newServer.name || !newServer.url) ? 0.5 : 1
                }}
              >
                + Add Custom Server
              </button>
            </div>
          </div>
        )}

        {/* Site-Specific Instructions */}
        <div className="setting-group">
          <label>🌐 Site-Specific Instructions</label>
          <p className="help-text">
            Add custom instructions that will automatically apply when browsing specific domains.
            Useful for providing navigation guidance for internal tools like Confluence, Jira, etc.
          </p>

          {(settings.siteInstructions || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '15px' }}>
              {(settings.siteInstructions || []).map((instruction) => (
                <div
                  key={instruction.id}
                  style={{
                    padding: '12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    background: instruction.enabled ? 'white' : '#f8f9fa',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: '#007bff', marginBottom: '4px' }}>
                        {instruction.domainPattern}
                      </div>
                      <div style={{ fontSize: '13px', color: '#666', whiteSpace: 'pre-wrap' }}>
                        {instruction.instructions}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
                      <button
                        onClick={() => handleToggleSiteInstruction(instruction.id)}
                        style={{
                          padding: '6px 12px',
                          background: instruction.enabled ? '#28a745' : '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        {instruction.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => handleRemoveSiteInstruction(instruction.id)}
                        style={{
                          padding: '6px 12px',
                          background: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#666', fontSize: '14px', fontStyle: 'italic', marginBottom: '15px' }}>
              No site instructions configured yet.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="text"
              value={newSiteInstruction.domainPattern}
              onChange={(e) => setNewSiteInstruction({ ...newSiteInstruction, domainPattern: e.target.value })}
              placeholder="Domain pattern (e.g., *.atlassian.net or confluence.company.com)"
              className="api-key-input"
            />
            <textarea
              value={newSiteInstruction.instructions}
              onChange={(e) => setNewSiteInstruction({ ...newSiteInstruction, instructions: e.target.value })}
              placeholder="Custom instructions for this site&#10;Example:&#10;- To search: Use the Search button in top-right corner&#10;- To create a page: Click Create button&#10;- Navigation is via left sidebar"
              rows={5}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '14px',
                fontFamily: 'monospace',
                border: '1px solid #ddd',
                borderRadius: '6px',
                resize: 'vertical'
              }}
            />
            <button
              onClick={handleAddSiteInstruction}
              disabled={!newSiteInstruction.domainPattern || !newSiteInstruction.instructions}
              style={{
                padding: '10px 20px',
                background: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                opacity: (!newSiteInstruction.domainPattern || !newSiteInstruction.instructions) ? 0.5 : 1
              }}
            >
              + Add Site Instructions
            </button>
          </div>
        </div>

        <button
          className={`save-button ${saved ? 'saved' : ''}`}
          onClick={handleSave}
          disabled={!settings.apiKey}
        >
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>

        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-icon">◉</div>
            <h3>Browser Tools</h3>
            <p>Click the Browser Tools button (◉) to enable Gemini 2.5 Computer Use for direct browser automation with screenshots</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🌐</div>
            <h3>Business Marketplace</h3>
            <p>Discover and connect to 115 Million verified GoDaddy customer services. Book appointments, order products, and interact with businesses through AI chat.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔧</div>
            <h3>Tool Router</h3>
            <p>Add Composio API key to access 500+ integrations (Gmail, Slack, GitHub, etc.) via AI SDK</p>
          </div>
        </div>

        <div className="info-box">
          <h3>🔒 Privacy & Security</h3>
          <p>Your API keys are stored locally in your browser and only sent to the respective AI providers. Never shared with third parties.</p>
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<SettingsPage />);
