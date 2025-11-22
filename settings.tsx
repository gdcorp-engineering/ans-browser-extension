import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings, MCPServerConfig } from './types';
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
  google: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '1M token context' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Optimized for speed' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Latest and most capable' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation' },
  ],
};

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    provider: 'google',
    apiKey: '',
    model: 'gemini-2.5-pro',
    toolMode: 'tool-router',
    composioApiKey: '',
    mcpEnabled: false,
    mcpServers: [],
  });
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showComposioKey, setShowComposioKey] = useState(false);
  const [showAnsToken, setShowAnsToken] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', apiKey: '' });

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

  useEffect(() => {
    // Load settings from chrome.storage
    chrome.storage.local.get(['atlasSettings'], (result) => {
      if (result.atlasSettings) {
        setSettings(result.atlasSettings);
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
    const newSettings = {
      ...settings,
      mcpServers: (settings.mcpServers || []).map(s =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
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
            <option value="google">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
            <option value="openai">OpenAI</option>
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
              value={settings.customBaseUrl || ''}
              onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
              placeholder="e.g., https://your-custom-endpoint.com"
              className="api-key-input"
            />
          </div>
          <p className="help-text">
            Leave empty to use default provider endpoint. Enter a custom API endpoint to use your own provider.
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
          <p className="help-text">
            Get your GoCode Key from{' '}
            <a 
              href="https://secureservernet.sharepoint.com/sites/AIHub/SitePages/Meet-GoCode-(Alpha)--Your-smarter-gateway-to-AI-providers%E2%80%94Now-with-self-issued-keys-for-IDEs-and-CLIs.aspx#how-to-get-started-(alpha)" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              GoCode (Alpha) - How to Get Started
            </a>
          </p>
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

        {settings.mcpEnabled && (
          <div className="setting-group">
            <label>ANS API Token</label>
            <div className="api-key-input-wrapper">
              <input
                type={showAnsToken ? 'text' : 'password'}
                value={settings.ansApiToken || ''}
                onChange={(e) => setSettings({ ...settings, ansApiToken: e.target.value })}
                placeholder="eyJraWQiOi... (paste your Bearer token)"
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
            <p className="help-text">
              🔑 JWT token for ANS API access. Get your token from the <code>auth_jomax</code> cookie value at <a href="https://ra.int.dev-godaddy.com" target="_blank" rel="noopener noreferrer">ra.int.dev-godaddy.com</a>.
              <br />
              Paste just the token part (without "Bearer"). Token typically starts with "eyJ".
              <br />
              <strong>Note:</strong> The extension will set this as the <code>auth_jomax</code> cookie and also send it as a Bearer token to support both authentication methods.
            </p>
            {settings.ansApiToken && settings.ansApiToken.startsWith('Bearer ') && (
              <p style={{ color: '#dc3545', fontSize: '12px', marginTop: '5px' }}>
                ⚠️ Remove "Bearer " prefix - paste only the token part
              </p>
            )}
            {settings.ansApiToken && !settings.ansApiToken.startsWith('eyJ') && !settings.ansApiToken.startsWith('Bearer ') && settings.ansApiToken.trim().length > 0 && (
              <p style={{ color: '#ff9800', fontSize: '12px', marginTop: '5px' }}>
                ⚠️ This doesn't look like a JWT token (should start with "eyJ"). Make sure you're pasting the full token value from the auth_jomax cookie.
              </p>
            )}
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
