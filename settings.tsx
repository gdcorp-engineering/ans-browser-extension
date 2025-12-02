import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings, MCPServerConfig, SiteInstruction, ServiceMapping } from './types';
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
import { generateUrlPattern, extractDomain } from './utils';

const PROVIDER_MODELS = {
  google: [
    { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro Preview (06-05)', description: 'Latest preview' },
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview (05-20)', description: 'Latest flash preview' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: '1M token context' },
    { id: 'gemini-2.5-flash-thinking-exp-01-21', name: 'Gemini 2.5 Flash Thinking', description: 'Thinking model' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Previous generation' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Lightweight' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Stable' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Latest and most capable' },
    { id: 'claude-haiku-4-5-20251110', name: 'Claude Haiku 4.5', description: 'Fast and efficient' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Previous flagship' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', description: 'Extended context' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Previous generation' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Previous generation' },
  ],
  openai: [
    { id: 'gpt-5.1', name: 'GPT-5.1', description: 'Latest flagship' },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', description: 'Code specialized' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', description: 'Fast coding' },
    { id: 'gpt-5', name: 'GPT-5', description: 'Flagship model' },
    { id: 'o3', name: 'o3', description: 'Advanced reasoning' },
    { id: 'o4-mini', name: 'o4-mini', description: 'Fast reasoning' },
    { id: 'o1', name: 'o1', description: 'Reasoning model' },
    { id: 'o1-mini', name: 'o1-mini', description: 'Efficient reasoning' },
    { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Enhanced GPT-4' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', description: 'Fast GPT-4' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', description: 'Lightweight' },
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation' },
    { id: 'gpt-4', name: 'GPT-4', description: 'Classic' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Legacy' },
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
    floatingButtonEnabled: true, // Default to enabled
    siteInstructions: [],
  });
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showComposioKey, setShowComposioKey] = useState(false);
  const [showAnsToken, setShowAnsToken] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', apiKey: '' });
  const [newSiteInstruction, setNewSiteInstruction] = useState({ domainPattern: '', instructions: '' });
  const [expandedInstructions, setExpandedInstructions] = useState<Set<string>>(new Set());
  const [editingInstruction, setEditingInstruction] = useState<string | null>(null);
  const [editedInstructionText, setEditedInstructionText] = useState<string>('');

  // Service Mapping state
  const [newMapping, setNewMapping] = useState({
    urlPattern: '',
    serviceType: 'mcp' as 'mcp' | 'a2a',
    serviceId: '',
  });
  const [allTabs, setAllTabs] = useState<Array<{ id: number; url: string; title: string }>>([]);
  const [selectedTabUrl, setSelectedTabUrl] = useState<string>('');

  // Business Marketplace state
  const [trustedBusinesses, setTrustedBusinesses] = useState<ANSBusinessService[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<ANSBusinessService[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCapability, setSelectedCapability] = useState('all');
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'custom' | 'mappings'>('marketplace');
  const [fetchLogs, setFetchLogs] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; downloadUrl: string; releaseNotes?: string; artifactName?: string } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const CURRENT_VERSION = '1.5.4'; // This should match manifest.json version
  const GITHUB_REPO = 'gdcorp-im/ans-browser-extension-v1-temp';
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
      // Fetch latest workflow runs for the build workflow
      const workflowRunsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_NAME}/runs?status=success&per_page=1`;
      const runsResponse = await fetch(workflowRunsUrl);

      if (!runsResponse.ok) {
        // Handle specific error cases
        if (runsResponse.status === 404) {
          throw new Error('Repository or workflow not found. Update checking may not be available for this repository.');
        } else if (runsResponse.status === 403) {
          throw new Error('Access denied. Repository may be private or rate limit exceeded.');
        } else {
          throw new Error(`Failed to check for updates: ${runsResponse.status} ${runsResponse.statusText}`);
        }
      }

      const runsData = await runsResponse.json();

      if (!runsData.workflow_runs || runsData.workflow_runs.length === 0) {
        setUpdateMessage('No successful builds found. The workflow may not have run yet.');
        return;
      }

      const latestRun = runsData.workflow_runs[0];

      // Extract version from commit message or use workflow run number
      const commitMessage = latestRun.head_commit?.message || '';
      const versionMatch = commitMessage.match(/v?(\d+\.\d+\.\d+)/);
      const latestVersion = versionMatch ? versionMatch[1] : `build-${latestRun.run_number}`;

      // Compare versions
      const comparison = compareVersions(latestVersion, CURRENT_VERSION);

      // Get artifacts for this run (with error handling)
      let artifact = null;
      try {
        const artifactsUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${latestRun.id}/artifacts`;
        const artifactsResponse = await fetch(artifactsUrl);
        
        if (artifactsResponse.ok) {
          const artifactsData = await artifactsResponse.json();

          // Find the latest artifact (prefer prod, then dev, then any extension artifact)
          const prodArtifact = artifactsData.artifacts?.find((a: any) => 
            a.name.startsWith('extension-prod-v') || a.name === 'extension-prod'
          );
          const devArtifact = artifactsData.artifacts?.find((a: any) => 
            a.name.startsWith('extension-dev-v') || a.name === 'extension-dev'
          );
          const anyExtensionArtifact = artifactsData.artifacts?.find((a: any) => 
            a.name.startsWith('extension-')
          );
          
          artifact = prodArtifact || devArtifact || anyExtensionArtifact;
        }
      } catch (artifactError) {
        // Artifact fetch failed, but we can still show version info
        console.warn('Failed to fetch artifacts:', artifactError);
      }

      // Build download URL - link to workflow run page where user can download artifacts
      const downloadUrl = `https://github.com/${GITHUB_REPO}/actions/runs/${latestRun.id}`;

      setUpdateAvailable({
        version: latestVersion,
        downloadUrl,
        releaseNotes: commitMessage || 'Check GitHub Actions for details',
        artifactName: artifact?.name || undefined
      });
    } catch (error) {
      console.error('Update check failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check for updates';
      setUpdateError(errorMessage);
      // Don't show error for 404/403 - these are expected for private repos or missing workflows
      if (errorMessage.includes('not found') || errorMessage.includes('Access denied')) {
        setUpdateMessage('Update checking is not available. You can manually check for updates in the GitHub repository.');
      }
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

  // Get all open tabs
  useEffect(() => {
    chrome.tabs.query({}, (tabs) => {
      const validTabs = tabs
        .filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://'))
        .map(tab => ({
          id: tab.id!,
          url: tab.url!,
          title: tab.title || 'Untitled'
        }));
      setAllTabs(validTabs);
      // Auto-select the first tab
      if (validTabs.length > 0 && !selectedTabUrl) {
        setSelectedTabUrl(validTabs[0].url);
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
        addLog(`📡 Endpoint: https://api.ote-godaddy.com/v1/agents`);

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

  // Toggle expansion of site instruction
  const toggleInstructionExpansion = (id: string) => {
    setExpandedInstructions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
        // Exit edit mode when collapsing
        if (editingInstruction === id) {
          setEditingInstruction(null);
          setEditedInstructionText('');
        }
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Start editing an instruction
  const startEditingInstruction = (instruction: SiteInstruction) => {
    setEditingInstruction(instruction.id);
    setEditedInstructionText(instruction.instructions);
  };

  // Save edited instruction
  const saveEditedInstruction = (id: string) => {
    const updatedInstructions = (settings.siteInstructions || []).map(s => {
      if (s.id === id) {
        return { ...s, instructions: editedInstructionText };
      }
      return { ...s };
    });

    setSettings({
      ...settings,
      siteInstructions: updatedInstructions,
    });

    setEditingInstruction(null);
    setEditedInstructionText('');
  };

  // Cancel editing
  const cancelEditingInstruction = () => {
    setEditingInstruction(null);
    setEditedInstructionText('');
  };

  // Service Mapping handlers
  const handleAddMapping = () => {
    if (!newMapping.urlPattern || !newMapping.serviceId) {
      return;
    }

    // Find the service details from either connected services or marketplace
    let service = settings.mcpServers?.find(s => s.id === newMapping.serviceId);

    if (!service) {
      // Try marketplace services
      const marketplaceService = trustedBusinesses.find(b => b.id === newMapping.serviceId);
      if (marketplaceService) {
        service = {
          id: marketplaceService.id,
          name: marketplaceService.name,
          url: marketplaceService.url,
          protocol: marketplaceService.protocol,
          enabled: true
        };
      }
    }

    if (!service) {
      console.error('Service not found:', newMapping.serviceId);
      return;
    }

    const mapping: ServiceMapping = {
      id: Date.now().toString(),
      urlPattern: newMapping.urlPattern,
      serviceType: newMapping.serviceType,
      serviceId: service.id,
      serviceName: service.name,
      serviceUrl: service.url,
      enabled: true,
      createdAt: Date.now(),
    };

    console.log('✅ Adding mapping:', mapping);

    const newSettings = {
      ...settings,
      serviceMappings: [...(settings.serviceMappings || []), mapping],
    };

    setSettings(newSettings);

    // Save to storage immediately
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      console.log('💾 Mapping saved to storage');
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mapping_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });

    // Reset form
    setNewMapping({
      urlPattern: '',
      serviceType: 'mcp',
      serviceId: '',
    });
  };

  const handleUseCurrentSite = () => {
    if (selectedTabUrl) {
      const pattern = generateUrlPattern(selectedTabUrl);
      setNewMapping({
        ...newMapping,
        urlPattern: pattern,
      });
    }
  };

  const handleToggleMapping = (id: string) => {
    const newSettings = {
      ...settings,
      serviceMappings: settings.serviceMappings?.map(m =>
        m.id === id ? { ...m, enabled: !m.enabled } : m
      ),
    };

    setSettings(newSettings);

    // Save to storage immediately
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      console.log('💾 Mapping toggle saved to storage');
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mapping_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
    });
  };

  const handleDeleteMapping = (id: string) => {
    const newSettings = {
      ...settings,
      serviceMappings: settings.serviceMappings?.filter(m => m.id !== id),
    };

    setSettings(newSettings);

    // Save to storage immediately
    chrome.storage.local.set({ atlasSettings: newSettings }, () => {
      console.log('💾 Mapping deleted from storage');
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'mapping_changed' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidebar not active, but settings saved');
        }
      });
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
              placeholder="Enter your GoCode key"
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
            {' '}or get your GoCode API key from: <a href="https://caas.godaddy.com/gocode/my-api-keys" target="_blank" rel="noopener noreferrer">https://caas.godaddy.com/gocode/my-api-keys</a>
          </p>
        </div>

        <div className="setting-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={settings.floatingButtonEnabled !== false}
              onChange={(e) => {
                const newSettings = { ...settings, floatingButtonEnabled: e.target.checked };
                setSettings(newSettings);
                // Auto-save and notify content scripts
                chrome.storage.local.set({ atlasSettings: newSettings }, () => {
                  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', action: 'floating_button_changed' }, () => {
                    if (chrome.runtime.lastError) {
                      console.log('Settings saved');
                    }
                  });
                });
              }}
            />
            Show Floating Button
          </label>
          <p className="help-text">
            Show the "Ask GoDaddy ANS" floating button on web pages. When disabled, you can still access the sidebar via the extension icon.
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
          <>
            {/* Unified ANS Enablement Section */}
            <div style={{
              border: '3px solid #007bff',
              borderRadius: '10px',
              padding: '25px',
              background: 'linear-gradient(to bottom, #f0f7ff 0%, #ffffff 100%)',
              marginBottom: '20px'
            }}>
              {/* Section Header */}
              <div style={{ marginBottom: '25px', paddingBottom: '15px', borderBottom: '2px solid #007bff' }}>
                <h2 style={{ margin: 0, fontSize: '20px', color: '#007bff', fontWeight: 'bold' }}>
                  🔐 Enable ANS
                </h2>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '8px', marginBottom: 0 }}>
                  Follow these three steps to enable ANS and configure site-specific service mappings:
                </p>
              </div>

              {/* Step 1: ANS Authentication */}
              <div style={{
                marginBottom: '25px',
                padding: '18px',
                background: 'white',
                border: '2px solid #007bff',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,123,255,0.1)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#007bff',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '16px'
                  }}>
                    1
                  </div>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '16px', color: '#333' }}>
                    Sign into ANS Authentication
                  </label>
                </div>
                <button
                  onClick={() => {
                    window.open('https://ra.int.ote-godaddy.com/', '_blank');
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
                <p style={{ fontSize: '12px', color: '#666', margin: 0, fontStyle: 'italic' }}>
                  ⚠️ Required first step. The extension uses your browser cookies to access the ANS API.
                </p>
              </div>

              {/* Visual Connector */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: '25px'
              }}>
                <div style={{
                  width: '3px',
                  height: '40px',
                  background: 'linear-gradient(to bottom, #007bff, #28a745)',
                  borderRadius: '2px'
                }}></div>
              </div>
            </div>
          </>
        )}

        {/* Step 2: Site-Specific Service Mappings - Always visible with tabs */}
        {settings.mcpEnabled && (
          <div style={{
            border: '3px solid #007bff',
            borderRadius: '10px',
            padding: '25px',
            background: 'linear-gradient(to bottom, #f0f7ff 0%, #ffffff 100%)',
            marginBottom: '20px'
          }}>
            {/* Step 2 Header */}
            <div style={{
              marginBottom: '20px',
              padding: '18px',
              background: 'white',
              border: '2px solid #007bff',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,123,255,0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#007bff',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}>
                  2
                </div>
                <label style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>
                  Site-Specific Service Mappings
                </label>
              </div>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '15px' }}>
                Map specific URLs to MCP servers or A2A agents. Services will only be available when browsing matching sites.
              </p>

              {/* Tabs for Service Management */}
              <div style={{ marginBottom: '0', borderBottom: '2px solid #eee' }}>
                <div style={{ display: 'flex', gap: '10px' }}>
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
                  <button
                    onClick={() => setActiveTab('mappings')}
                    style={{
                      padding: '10px 20px',
                      background: 'none',
                      border: 'none',
                      borderBottom: activeTab === 'mappings' ? '3px solid #007bff' : '3px solid transparent',
                      cursor: 'pointer',
                      fontWeight: activeTab === 'mappings' ? 'bold' : 'normal',
                      color: activeTab === 'mappings' ? '#007bff' : '#666'
                    }}
                  >
                    🗺️ Site Mappings
                  </button>
                </div>
              </div>
            </div>

            {/* Tab Content */}
            {/* Marketplace Tab - Discover GoDaddy Customer Services */}
            {activeTab === 'marketplace' && (
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
            {activeTab === 'custom' && (
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
                  setActiveTab('mappings');
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

            {/* Site Mappings Tab - Map URLs to Services */}
            {activeTab === 'mappings' && (
              <>
                {/* Unified Container for Mapping Controls */}
                <div style={{
              border: '1px solid #cce5ff',
              borderRadius: '8px',
              padding: '20px',
              background: '#f8f9ff',
              marginBottom: '20px'
            }}>
              {/* Select Site from Open Tabs */}
              {allTabs.length > 0 && (
                <div style={{
                  marginBottom: '20px',
                  padding: '12px',
                  background: 'white',
                  border: '1px solid #cce5ff',
                  borderRadius: '6px'
                }}>
                  <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', color: '#333', marginBottom: '8px' }}>
                    📍 Select Site from Open Tabs
                  </label>
                  <select
                    value={selectedTabUrl}
                    onChange={(e) => setSelectedTabUrl(e.target.value)}
                    className="model-select"
                    style={{ marginBottom: 0, width: '100%' }}
                  >
                    {allTabs.map(tab => (
                      <option key={tab.id} value={tab.url}>
                        {extractDomain(tab.url)} - {tab.title.substring(0, 50)}{tab.title.length > 50 ? '...' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Add Mapping Form */}
              <div style={{
                padding: '15px',
                background: 'white',
                border: '1px solid #cce5ff',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#333', marginBottom: '15px' }}>
                  Add New Mapping
                </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  URL Pattern
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={newMapping.urlPattern}
                    onChange={(e) => setNewMapping({ ...newMapping, urlPattern: e.target.value })}
                    placeholder="e.g., *.jira.atlassian.net or jira.company.com"
                    className="api-key-input"
                    style={{ marginBottom: 0, flex: 1 }}
                  />
                  <button
                    onClick={handleUseCurrentSite}
                    disabled={!selectedTabUrl}
                    style={{
                      padding: '8px 16px',
                      background: selectedTabUrl ? '#28a745' : '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: selectedTabUrl ? 'pointer' : 'not-allowed',
                      fontSize: '13px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Use Selected Site
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  Service Type
                </label>
                <select
                  value={newMapping.serviceType}
                  onChange={(e) => setNewMapping({ ...newMapping, serviceType: e.target.value as 'mcp' | 'a2a' })}
                  className="model-select"
                  style={{ marginBottom: 0 }}
                >
                  <option value="mcp">🔌 MCP Server</option>
                  <option value="a2a">🤖 A2A Agent</option>
                </select>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  Select Service
                </label>
                <select
                  value={newMapping.serviceId}
                  onChange={(e) => setNewMapping({ ...newMapping, serviceId: e.target.value })}
                  className="model-select"
                  style={{ marginBottom: 0 }}
                >
                  <option value="">-- Select a service --</option>
                  {(() => {
                    // Combine configured services and marketplace services
                    const connectedServices = (settings.mcpServers || []).map(s => ({
                      id: s.id,
                      name: s.name,
                      url: s.url,
                      protocol: s.protocol || 'mcp',
                      isConnected: true
                    }));

                    const marketplaceServices = trustedBusinesses.map(b => ({
                      id: b.id,
                      name: b.name,
                      url: b.url,
                      protocol: b.protocol,
                      isConnected: false
                    }));

                    // Merge and deduplicate by ID (prefer connected services)
                    const allServices = [...connectedServices, ...marketplaceServices.filter(m =>
                      !connectedServices.find(c => c.id === m.id)
                    )];

                    // Filter by service type
                    const filtered = allServices.filter(s => {
                      if (newMapping.serviceType === 'mcp') {
                        return s.protocol === 'mcp';
                      } else {
                        return s.protocol === 'a2a';
                      }
                    });

                    console.log(`🔍 Service dropdown: serviceType=${newMapping.serviceType}, connected=${connectedServices.length}, marketplace=${marketplaceServices.length}, total=${allServices.length}, filtered=${filtered.length}`);
                    if (filtered.length === 0) {
                      console.log('📋 All services protocols:', allServices.map(s => ({ name: s.name, protocol: s.protocol, connected: s.isConnected })));
                    }

                    return filtered.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.isConnected ? '✓ ' : ''}{s.name} ({s.url})
                      </option>
                    ));
                  })()}
                </select>
              </div>

              <button
                onClick={handleAddMapping}
                disabled={!newMapping.urlPattern || !newMapping.serviceId}
                style={{
                  padding: '10px 20px',
                  background: (!newMapping.urlPattern || !newMapping.serviceId) ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (!newMapping.urlPattern || !newMapping.serviceId) ? 'not-allowed' : 'pointer',
                  opacity: (!newMapping.urlPattern || !newMapping.serviceId) ? 0.5 : 1,
                  width: '100%',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                + Add Mapping
              </button>
              </div>
            </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Active Mappings List - Always displayed */}
        {settings.mcpEnabled && (
          <>
            {/* Visual Connector */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: '25px'
            }}>
              <div style={{
                width: '3px',
                height: '40px',
                background: 'linear-gradient(to bottom, #007bff, #28a745)',
                borderRadius: '2px'
              }}></div>
            </div>

            <div style={{
              border: '3px solid #28a745',
              borderRadius: '10px',
              padding: '25px',
              background: 'linear-gradient(to bottom, #f0f9f4 0%, #ffffff 100%)',
              marginBottom: '20px'
            }}>
              {/* Step 3: Active Mappings List */}
              <div style={{
                padding: '18px',
                background: 'white',
                border: '2px solid #28a745',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(40,167,69,0.1)'
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#28a745',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}>
                  3
                </div>
                <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#333' }}>
                  Show Active Mappings ({(settings.serviceMappings || []).length})
                </div>
              </div>

              {(settings.serviceMappings || []).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(settings.serviceMappings || []).map((mapping) => (
                    <div
                      key={mapping.id}
                      style={{
                        padding: '12px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        background: mapping.enabled ? 'white' : '#f8f9fa',
                        display: 'flex',
                        alignItems: 'start',
                        gap: '12px'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={mapping.enabled}
                        onChange={() => handleToggleMapping(mapping.id)}
                        style={{ marginTop: '4px', cursor: 'pointer' }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '16px' }}>
                            {mapping.serviceType === 'mcp' ? '🔌' : '🤖'}
                          </span>
                          <span style={{ fontWeight: 'bold', color: '#007bff' }}>
                            {mapping.urlPattern}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', color: '#333', marginBottom: '2px' }}>
                          Service: {mapping.serviceName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>
                          {mapping.serviceUrl}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteMapping(mapping.id)}
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
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  textAlign: 'center',
                  padding: '40px',
                  color: '#666',
                  background: '#f8f9fa',
                  borderRadius: '8px'
                }}>
                  <p>No site mappings configured yet.</p>
                  <p style={{ fontSize: '13px', marginTop: '8px' }}>
                    Add a mapping above to enable site-specific services.
                  </p>
                </div>
              )}
              </div>
            </div>
          </>
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
              {(settings.siteInstructions || []).map((instruction) => {
                const isExpanded = expandedInstructions.has(instruction.id);
                const isEditing = editingInstruction === instruction.id;
                
                return (
                  <div
                    key={instruction.id}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      background: instruction.enabled ? 'white' : '#f8f9fa',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Collapsible Header */}
                    <button
                      type="button"
                      onClick={() => toggleInstructionExpansion(instruction.id)}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'transparent',
                        border: 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                        <span style={{ fontSize: '12px', color: '#666' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span style={{ fontWeight: 'bold', color: '#007bff' }}>
                          {instruction.domainPattern}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: '#4b5563' }}>
                          <input
                            type="checkbox"
                            checked={instruction.enabled}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleSiteInstruction(instruction.id);
                            }}
                            style={{
                              width: '16px',
                              height: '16px',
                              cursor: 'pointer',
                            }}
                          />
                          <span>Apply</span>
                        </label>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSiteInstruction(instruction.id);
                          }}
                          style={{
                            padding: '4px 10px',
                            background: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px'
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </button>

                    {/* Collapsible Content */}
                    {isExpanded && (
                      <div style={{ padding: '0 12px 12px 12px', borderTop: '1px solid #eee' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                            <textarea
                              value={editedInstructionText}
                              onChange={(e) => setEditedInstructionText(e.target.value)}
                              style={{
                                width: '100%',
                                minHeight: '200px',
                                padding: '10px',
                                fontSize: '13px',
                                fontFamily: 'monospace',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                resize: 'vertical',
                                background: 'white',
                                color: '#333',
                              }}
                              placeholder="Enter site-specific instructions..."
                            />
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={cancelEditingInstruction}
                                style={{
                                  padding: '6px 12px',
                                  background: '#f3f4f6',
                                  color: '#4b5563',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEditedInstruction(instruction.id)}
                                style={{
                                  padding: '6px 12px',
                                  background: '#2563eb',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: '12px' }}>
                            <div style={{ 
                              fontSize: '13px', 
                              color: '#666', 
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'monospace',
                              lineHeight: '1.6',
                              padding: '10px',
                              background: '#f9fafb',
                              borderRadius: '4px',
                              border: '1px solid #e5e7eb',
                            }}>
                              {instruction.instructions}
                            </div>
                            <button
                              type="button"
                              onClick={() => startEditingInstruction(instruction)}
                              style={{
                                marginTop: '10px',
                                padding: '6px 12px',
                                background: '#2563eb',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
