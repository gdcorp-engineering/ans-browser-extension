import { useState } from 'react';
import { initializeMcpClient } from '../services/tool-router-service';
import type { Settings as SettingsType } from '../types';

interface SettingsProps {
  settings: SettingsType | null;
  onSave: (settings: SettingsType) => void;
  onClose: () => void;
}

const PROVIDER_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Latest and most capable' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
  ],
};

const Settings = ({ settings, onSave, onClose }: SettingsProps) => {
  const [provider, setProvider] = useState<'anthropic'>(
    (settings?.provider as 'anthropic') || 'anthropic'
  );
  const [apiKey, setApiKey] = useState(settings?.googleApiKey || '');
  const [model, setModel] = useState(settings?.model || 'claude-sonnet-4-5-20250929');
  const [customBaseUrl, setCustomBaseUrl] = useState(settings?.customBaseUrl || '');
  const [composioApiKey, setComposioApiKey] = useState(settings?.composioApiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSave = async () => {
    // Initialize MCP if Composio key is provided
    if (composioApiKey) {
      console.log('Initializing MCP with Composio API key...');
      try {
        await initializeMcpClient(composioApiKey);
        console.log('MCP initialized successfully on settings save');
      } catch (error) {
        console.error('Failed to initialize MCP on settings save:', error);
      }
    }

    onSave({
      provider,
      googleApiKey: apiKey, // Still store as googleApiKey for compatibility
      composioApiKey,
      model,
      customBaseUrl,
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#ffffff',
        color: '#1a1a1a',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #e5e5e5',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Settings</h1>
        <button
          onClick={onClose}
          style={{
            padding: '6px 14px',
            backgroundColor: '#f5f5f5',
            color: '#1a1a1a',
            border: '1px solid #e5e5e5',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          Close
        </button>
      </div>

      {/* Settings Form */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* AI Provider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>AI Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const newProvider = e.target.value as 'anthropic';
                setProvider(newProvider);
                setModel(PROVIDER_MODELS[newProvider][0].id);
              }}
              style={{
                padding: '10px 12px',
                backgroundColor: '#f5f5f5',
                color: '#1a1a1a',
                border: '1px solid #e5e5e5',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            >
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </div>

          {/* Model Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                padding: '10px 12px',
                backgroundColor: '#f5f5f5',
                color: '#1a1a1a',
                border: '1px solid #e5e5e5',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            >
              {PROVIDER_MODELS[provider].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} - {m.description}
                </option>
              ))}
            </select>
          </div>

          {/* GoCode URL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>GoCode URL</label>
            <input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="e.g., https://your-custom-endpoint.com"
              style={{
                padding: '10px 12px',
                backgroundColor: '#f5f5f5',
                color: '#1a1a1a',
                border: '1px solid #e5e5e5',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
            <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>
              Leave empty to use default provider endpoint. Enter a custom API endpoint to use your own provider.
            </p>
          </div>

          {/* GoCode Key */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600 }}>
              GoCode Key <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 12px',
                  backgroundColor: '#f5f5f5',
                  color: '#1a1a1a',
                  border: '1px solid #e5e5e5',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                }}
              >
                {showApiKey ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div
        style={{
          padding: '20px',
          borderTop: '1px solid #e5e5e5',
          backgroundColor: '#ffffff',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: '600px' }}>
          <button
            onClick={handleSave}
            disabled={!apiKey}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: apiKey ? '#1a1a1a' : '#f5f5f5',
              color: apiKey ? '#ffffff' : '#999',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: apiKey ? 'pointer' : 'not-allowed',
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
